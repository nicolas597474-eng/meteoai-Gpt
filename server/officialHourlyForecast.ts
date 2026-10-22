import { getForecastHorizonWindow } from "../shared/forecastHorizon";
import { HOURLY_FORECAST_VARIABLES as HOURLY_SCORING_VARIABLES } from "./hourlyForecastRunScoring";
import { HOURLY_FORECAST_VARIABLES as ARCHIVED_HOURLY_VARIABLES } from "./forecastVariableCoverage";
import { getHourlyForecastEvaluationHistory, makeLocationKey, type HourlyExactHorizonHistoryKey } from "./db";
import type { HourlyForecastRunValue } from "../drizzle/schema";
import { conditionFromWeatherValues } from "./weatherConditionLabels";
import { getParisDateAndHour } from "./parisHourlyTime";
import { getParisDateDaysAgo } from "./weatherTime";
import { PRECIPITATION_RAIN_THRESHOLD_MM, summarizePrecipitationModels } from "../shared/precipitationConsensus";
import { getModelCountCoverageLevel, type ModelCountCoverageLevel } from "../shared/modelCoverageConfidence";
import {
  HONDEGHEM,
  OFFICIAL_HOURLY_MODELS,
  collectHourlyForecastAllModelsWithDiagnostics,
  type HourlyAvailabilityStatus,
  type HourlyCalibrationStatus,
  type HourlyModelForecast,
  type HourlyModelWeightDiagnostic,
  type HourlyPoint,
  type HourlyPointWeighting,
  type HourlyVariableWeighting,
  type HourlyWeightingUnavailableReason,
} from "./weatherServices";
import { calculateRobustFallbackMultipliers, MODEL_FUSION_WEIGHT_CAP, normalizeModelWeightsWithCap, PERFORMANCE_PRIOR_DAYS } from "./fusionPerformance";
import { PUBLIC_RANKING_EVIDENCE_THRESHOLDS } from "./weatherReliabilityConfig";
import { summarizeHourlyHistoricalEvidence, type HourlyHistoricalScoreRow } from "./hourlyHistoricalEvidence";
import type {
  HourlyHistoricalEvidence,
  HourlySelectionEvidenceBasis,
  HourlyVariableSelectionReason,
  HourlyVariableSelectionStrategy,
  ManualHourlyOverride,
} from "../shared/hourlyModelMetrics";
import { filterCurrentHourlyScoringRows } from "../shared/hourlyScoringValidation";
import { selectEligibleModelsForHorizon, type ForecastModelCandidate, type ForecastModelEligibilityDiagnostic, type SelectedForecastModel } from "./forecastModelSelection";

export type OfficialHourlyModelName = (typeof OFFICIAL_HOURLY_MODELS)[number]["name"];
export const OFFICIAL_HOURLY_MODEL_NAMES: readonly OfficialHourlyModelName[] = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
export const OFFICIAL_HOURLY_HISTORY_DAYS = 365;

const MODEL_NAME_SET = new Set<string>(OFFICIAL_HOURLY_MODEL_NAMES);
const MODEL_ID_BY_NAME = new Map<string, string>(OFFICIAL_HOURLY_MODELS.map((model) => [model.name, model.modelId] as const));
const HISTORY_VARIABLES = HOURLY_SCORING_VARIABLES;
const HISTORY_VARIABLE_SET = new Set<string>(HISTORY_VARIABLES);
type OfficialHourlyVariable =
  | "temperature"
  | "apparent_temperature"
  | "precipitation"
  | "wind_speed"
  | "wind_direction"
  | "wind_gust"
  | "humidity"
  | "pressure"
  | "cloud_cover"
  | "weather_code"
  | "cloud_cover_low"
  | "cloud_cover_mid"
  | "cloud_cover_high"
  | "uv_index"
  | "dew_point"
  | "visibility"
  | "shortwave_radiation";

type HourlyModelValue = {
  modelName: OfficialHourlyModelName;
  modelId: string | null;
  sourceName: string | null;
  runId: string | null;
  runIdKind: "capture" | "provider" | "unknown";
  requestStartedAt: number | null;
  availableAt: number | null;
  providerRunAt: number | null;
  hour: HourlyModelForecast["hours"][number];
};

type SelectedHourlyModel = SelectedForecastModel<HourlyModelValue>;
type HourlyHistoricalEvidenceSelection = {
  evidence: HourlyHistoricalEvidence | null;
  exactEvidence: HourlyHistoricalEvidence | null;
  bucketEvidence: HourlyHistoricalEvidence | null;
  calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_HORIZON" | "EXACT_LOCAL_MODEL_VARIABLE_BUCKET" | "UNCALIBRATED_ROBUST";
};
type PreparedHourlyModel = {
  selected: SelectedHourlyModel;
  evidence: HourlyHistoricalEvidence | null;
  exactEvidence: HourlyHistoricalEvidence | null;
  bucketEvidence: HourlyHistoricalEvidence | null;
  calibrationLevel: HourlyHistoricalEvidenceSelection["calibrationLevel"];
  calibrationStatus: HourlyCalibrationStatus;
  horizonMilliseconds: number | null;
  reliability: number;
  rawWeight: number;
  ensembleWeight: number;
  robustFallbackWeight: number | null;
  finalWeight: number;
  contributes: boolean;
};

type VariableForecastValue = {
  value: number | null;
  weighting: HourlyVariableWeighting;
  selected: PreparedHourlyModel[];
};

const FORECAST_FIELD_BY_VARIABLE: Record<OfficialHourlyVariable, keyof HourlyModelForecast["hours"][number]> = {
  temperature: "temperature",
  apparent_temperature: "apparentTemperature",
  precipitation: "precipitation",
  wind_speed: "windSpeed",
  wind_direction: "windDirection",
  wind_gust: "windGusts",
  humidity: "humidity",
  pressure: "pressure",
  cloud_cover: "cloudCover",
  weather_code: "weatherCode",
  cloud_cover_low: "cloudLow",
  cloud_cover_mid: "cloudMid",
  cloud_cover_high: "cloudHigh",
  uv_index: "uvIndex",
  dew_point: "dewPoint",
  visibility: "visibility",
  shortwave_radiation: "solarRadiation",
};

const OFFICIAL_HOURLY_FUSION_VARIABLES = Object.keys(FORECAST_FIELD_BY_VARIABLE) as OfficialHourlyVariable[];
const ARCHIVED_VARIABLE_FIELD: Readonly<Record<string, keyof HourlyModelForecast["hours"][number]>> = Object.fromEntries(
  ARCHIVED_HOURLY_VARIABLES.map(({ key, valueField }) => [key, valueField]),
);

/** Rebuild the latest archived run for each official model without consulting Best Match. */
export function reconstructOfficialHourlyModelsFromArchive(
  rows: readonly HourlyForecastRunValue[],
  targetDate: string,
): HourlyModelForecast[] {
  type Capture = {
    captureRunId: string;
    modelName: OfficialHourlyModelName;
    modelId: string;
    sourceName: string;
    requestStartedAt: number;
    availableAt: number;
    maxId: number;
    rows: HourlyForecastRunValue[];
  };

  const capturesByModel = new Map<OfficialHourlyModelName, Map<string, Capture>>();
  for (const row of rows) {
    if (row.targetDate !== targetDate || !MODEL_NAME_SET.has(row.modelName)) continue;
    const modelName = row.modelName as OfficialHourlyModelName;
    const expectedModelId = MODEL_ID_BY_NAME.get(modelName);
    if (row.sourceName !== "open-meteo" || row.modelId !== expectedModelId) continue;
    if (!Number.isFinite(row.requestStartedAt) || !Number.isFinite(row.availableAt) || !Number.isFinite(row.validTime)) continue;

    const captures = capturesByModel.get(modelName) ?? new Map<string, Capture>();
    const capture = captures.get(row.captureRunId) ?? {
      captureRunId: row.captureRunId,
      modelName,
      modelId: expectedModelId,
      sourceName: row.sourceName,
      requestStartedAt: row.requestStartedAt,
      availableAt: row.availableAt,
      maxId: row.id,
      rows: [],
    };
    capture.maxId = Math.max(capture.maxId, row.id);
    capture.rows.push(row);
    captures.set(row.captureRunId, capture);
    capturesByModel.set(modelName, captures);
  }

  const forecasts: HourlyModelForecast[] = [];
  for (const modelName of OFFICIAL_HOURLY_MODEL_NAMES) {
    const captures = Array.from(capturesByModel.get(modelName)?.values() ?? []);
    captures.sort((left, right) => left.availableAt - right.availableAt
      || left.requestStartedAt - right.requestStartedAt
      || left.maxId - right.maxId);
    const latest = captures.at(-1);
    if (!latest) continue;

    const hoursByValidAt = new Map<number, HourlyModelForecast["hours"][number]>();
    for (const row of latest.rows) {
      const field = ARCHIVED_VARIABLE_FIELD[row.variable];
      if (!field) continue;
      const parisTime = getParisDateAndHour(row.validTime);
      if (!parisTime || parisTime.date !== targetDate) continue;
      const hour = hoursByValidAt.get(row.validTime) ?? {
        validAt: row.validTime,
        hour: parisTime.hour,
        temperature: null,
        apparentTemperature: null,
        precipitation: null,
        rain: null,
        showers: null,
        windSpeed: null,
        windGusts: null,
        windDirection: null,
        humidity: null,
        pressure: null,
        cloudCover: null,
        weatherCode: null,
        uvIndex: null,
        dewPoint: null,
        visibility: null,
        solarRadiation: null,
        cloudLow: null,
        cloudMid: null,
        cloudHigh: null,
        snowfall: null,
      };
      (hour as unknown as Record<string, number | null | undefined>)[field] = row.value != null && Number.isFinite(row.value) ? row.value : null;
      hoursByValidAt.set(row.validTime, hour);
    }

    forecasts.push({
      modelName,
      modelId: latest.modelId,
      sourceName: latest.sourceName,
      captureRunId: latest.captureRunId,
      requestStartedAt: latest.requestStartedAt,
      availableAt: latest.availableAt,
      providerRunAt: null,
      hours: Array.from(hoursByValidAt.values()).sort((left, right) => (left.validAt ?? 0) - (right.validAt ?? 0)),
    });
  }
  return forecasts;
}

export type OfficialHourlyEvaluationHistoryScore = HourlyHistoricalScoreRow;

export type OfficialHourlyWeightingSummary = {
  status: "historical_skill" | "mixed" | "robust_fallback" | "single_model" | "unavailable";
  availabilityStatus: HourlyAvailabilityStatus;
  calibrationStatus: HourlyCalibrationStatus;
  historyStatus: "available" | "unavailable";
  historyWindowDays: number;
  minimumComparisons: number;
  minimumComparableDays: number;
  bestMatchIncluded: false;
  manualOverride?: ManualHourlyOverride;
  modelsConsidered: readonly OfficialHourlyModelName[];
  modelsWithData: readonly OfficialHourlyModelName[];
  horizons: Array<{
    variable: string;
    horizonBucket: string | null;
    method: "historical_skill" | "mixed" | "robust_fallback" | "single_model" | "unavailable";
    selectionStrategyCounts: Record<HourlyVariableSelectionStrategy, number>;
    bestModelHourCounts: Array<{ modelName: string; hourCount: number }>;
    selectionReasonCounts: Array<{ reason: HourlyVariableSelectionReason; hourCount: number }>;
    availabilityStatus: HourlyAvailabilityStatus;
    calibrationStatus: HourlyCalibrationStatus;
    unavailableReason: HourlyWeightingUnavailableReason | null;
    hourCount: number;
    availableModelCount: number;
    evidenceEligibleModelCount: number;
    contributingModelCount: number;
    coverageLevelCounts: Record<ModelCountCoverageLevel, number>;
    modelNamesWithData: readonly OfficialHourlyModelName[];
  }>;
};

export type OfficialHourlyForecastResult = {
  hours: HourlyPoint[];
  weighting: OfficialHourlyWeightingSummary;
};

export type CollectedOfficialHourlyForecast = OfficialHourlyForecastResult & {
  modelForecasts: HourlyModelForecast[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function normalizeWeights(weights: ReadonlyMap<string, number>): Map<string, number> | null {
  const usable = Array.from(weights).filter(([, value]) => Number.isFinite(value) && value > 0);
  const total = usable.reduce((sum, [, value]) => sum + value, 0);
  return total > 0 ? new Map(usable.map(([key, value]) => [key, value / total])) : null;
}

function weightedMean(items: Array<{ value: number | null | undefined; weight: number }>): number | null {
  const usable = items.filter((item) => isFiniteNumber(item.value) && Number.isFinite(item.weight) && item.weight > 0);
  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (!(totalWeight > 0)) return null;
  return usable.reduce((sum, item) => sum + item.value! * item.weight, 0) / totalWeight;
}

function weightedCircularMeanDegrees(items: Array<{ value: number | null | undefined; weight: number }>): number | null {
  const usable = items.filter((item) => isFiniteNumber(item.value) && Number.isFinite(item.weight) && item.weight > 0);
  if (usable.length === 0) return null;
  const radians = usable.map((item) => (item.value! * Math.PI) / 180);
  const sin = usable.reduce((sum, item, index) => sum + Math.sin(radians[index]!) * item.weight, 0);
  const cos = usable.reduce((sum, item, index) => sum + Math.cos(radians[index]!) * item.weight, 0);
  if (Math.hypot(sin, cos) < 1e-12) return null;
  return ((Math.atan2(sin, cos) * 180 / Math.PI) + 360) % 360;
}

function weightedMode(items: Array<{ value: number | null | undefined; weight: number }>): number | null {
  const votes = new Map<number, number>();
  for (const item of items) {
    if (!Number.isInteger(item.value) || !Number.isFinite(item.weight) || item.weight <= 0) continue;
    votes.set(item.value!, (votes.get(item.value!) ?? 0) + item.weight);
  }
  return Array.from(votes.entries())
    .sort(([leftValue, leftWeight], [rightValue, rightWeight]) => rightWeight - leftWeight || leftValue - rightValue)[0]?.[0] ?? null;
}

function summarizeModelValues(values: unknown[]): {
  min: number | null;
  max: number | null;
  median: number | null;
  standardDeviation: number | null;
  range: number | null;
  availableModelCount: number;
} {
  const finiteValues = values.filter(isFiniteNumber);
  if (finiteValues.length === 0) return { min: null, max: null, median: null, standardDeviation: null, range: null, availableModelCount: 0 };
  const center = median(finiteValues);
  if (finiteValues.length === 1) return { min: finiteValues[0]!, max: finiteValues[0]!, median: center, standardDeviation: null, range: null, availableModelCount: 1 };
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const mean = finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  const standardDeviation = Math.sqrt(finiteValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finiteValues.length);
  return { min, max, median: center, standardDeviation, range: max - min, availableModelCount: finiteValues.length };
}

function maximumCircularSpread(values: unknown[]): number | null {
  const finite = values.filter(isFiniteNumber).map((value) => ((value % 360) + 360) % 360).sort((left, right) => left - right);
  if (finite.length < 2) return null;
  let largestGap = 0;
  for (let index = 0; index < finite.length; index++) {
    const current = finite[index]!;
    const next = finite[(index + 1) % finite.length]! + (index === finite.length - 1 ? 360 : 0);
    largestGap = Math.max(largestGap, next - current);
  }
  return 360 - largestGap;
}

function getCoverageLevel(modelCount: number): ModelCountCoverageLevel {
  return getModelCountCoverageLevel(modelCount);
}

function getAvailabilityStatus(modelCount: number): HourlyAvailabilityStatus {
  return modelCount === 0 ? "UNAVAILABLE" : modelCount === 1 ? "SINGLE_MODEL" : "FUSED";
}

function getCalibrationStatus(statuses: readonly HourlyCalibrationStatus[]): HourlyCalibrationStatus {
  if (statuses.length === 0 || statuses.every((status) => status === "UNAVAILABLE")) return "UNAVAILABLE";
  if (statuses.every((status) => status === "CALIBRATED")) return "CALIBRATED";
  if (statuses.some((status) => status === "CALIBRATED" || status === "PARTIALLY_CALIBRATED")) return "PARTIALLY_CALIBRATED";
  return "UNCALIBRATED_ROBUST";
}

function getVariableMethod(
  availabilityStatus: HourlyAvailabilityStatus,
  calibrationStatus: HourlyCalibrationStatus,
): HourlyVariableWeighting["method"] {
  if (availabilityStatus === "UNAVAILABLE") return "unavailable";
  if (availabilityStatus === "SINGLE_MODEL") return "single_model";
  if (calibrationStatus === "CALIBRATED") return "historical_skill";
  if (calibrationStatus === "PARTIALLY_CALIBRATED") return "mixed";
  return "robust_fallback";
}

type BestModelSelection = {
  selected: PreparedHourlyModel | null;
  strategy: HourlyVariableSelectionStrategy;
  evidenceBasis: HourlySelectionEvidenceBasis;
  reason: HourlyVariableSelectionReason;
};

function hasQualifiedMetrics(evidence: HourlyHistoricalEvidence | null): evidence is HourlyHistoricalEvidence & {
  metrics: NonNullable<HourlyHistoricalEvidence["metrics"]>;
} {
  return evidence?.status === "qualified" && evidence.metrics != null;
}

function selectBestQualifiedModel(
  prepared: readonly PreparedHourlyModel[],
  variable: OfficialHourlyVariable,
): BestModelSelection {
  if (prepared.length === 0) {
    return { selected: null, strategy: "unavailable", evidenceBasis: null, reason: "no_admissible_model" };
  }
  if (prepared.length === 1) {
    return { selected: prepared[0]!, strategy: "only_available_model", evidenceBasis: null, reason: "only_model_available" };
  }
  if (!HISTORY_VARIABLE_SET.has(variable)) {
    return { selected: null, strategy: "weighted_ensemble_fallback", evidenceBasis: null, reason: "variable_without_station_validation" };
  }

  const exactLead = prepared[0]!.horizonMilliseconds;
  const exactBucket = prepared[0]!.selected.horizonBucket;
  const exactComparable = exactLead != null
    && exactBucket != null
    && prepared.every((item) => hasQualifiedMetrics(item.exactEvidence)
      && item.horizonMilliseconds === exactLead
      && item.selected.horizonBucket === exactBucket);
  const bucket = prepared[0]!.selected.horizonBucket;
  const bucketComparable = bucket != null
    && prepared.every((item) => hasQualifiedMetrics(item.bucketEvidence)
      && item.selected.horizonBucket === bucket);

  const basis: HourlySelectionEvidenceBasis = exactComparable
    ? "exact_lead"
    : bucketComparable ? "horizon_bucket" : null;
  if (!basis) {
    const hasQualifiedButIncomparableEvidence = prepared.every((item) => hasQualifiedMetrics(item.evidence));
    const hasUnavailableHistory = prepared.every((item) => item.evidence?.status === "history_unavailable");
    const reason: HourlyVariableSelectionReason = hasQualifiedButIncomparableEvidence
      ? "incomparable_horizons"
      : hasUnavailableHistory ? "historical_scores_unavailable" : "insufficient_qualified_history";
    return { selected: null, strategy: "weighted_ensemble_fallback", evidenceBasis: null, reason };
  }

  const evidenceFor = (item: PreparedHourlyModel) => basis === "exact_lead" ? item.exactEvidence! : item.bucketEvidence!;
  const metrics = prepared.map((item) => evidenceFor(item).metrics!);
  const baselineMae = median(metrics.map((item) => item.mae));
  const ranked = prepared.map((item, index) => {
    const score = metrics[index]!;
    const comparisonReliability = score.comparisonCount / (score.comparisonCount + PERFORMANCE_PRIOR_DAYS);
    const dayReliability = score.evaluatedDays / (score.evaluatedDays + PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays);
    const reliability = comparisonReliability * dayReliability;
    const regularizedMae = baselineMae > 0
      ? baselineMae + reliability * (score.mae - baselineMae)
      : score.mae;
    return { item, regularizedMae };
  }).sort((left, right) => left.regularizedMae - right.regularizedMae
    || left.item.selected.modelName.localeCompare(right.item.selected.modelName));
  const best = ranked[0]!;
  const runnerUp = ranked[1]!;
  const tieTolerance = Math.max(1, Math.abs(best.regularizedMae)) * 1e-9;
  if (Math.abs(runnerUp.regularizedMae - best.regularizedMae) <= tieTolerance) {
    return { selected: null, strategy: "weighted_ensemble_fallback", evidenceBasis: null, reason: "tied_qualified_scores" };
  }
  return {
    selected: best.item,
    strategy: "qualified_best_model",
    evidenceBasis: basis,
    reason: "qualified_comparable_history",
  };
}

function ineligibilityReasonByModel(diagnostics: readonly ForecastModelEligibilityDiagnostic[]): Array<HourlyVariableWeighting["modelReasons"][number]> {
  return diagnostics.filter((item) => !item.eligible).map((item) => ({
    modelName: item.modelName,
    reason: item.reason ?? "Valeur non admissible.",
    sourceName: item.sourceName,
    modelId: item.modelId,
    runId: item.runId,
    availableAt: item.availableAt,
    validTime: item.validTime,
    horizonMinutes: item.horizonMinutes,
    horizonBucket: item.horizonBucket,
  }));
}

function makeDiagnostic(
  source: PreparedHourlyModel,
  finalWeight: number,
  contributes: boolean,
): HourlyModelWeightDiagnostic {
  const selected = source.selected;
  return {
    modelName: selected.modelName,
    modelId: selected.modelId ?? MODEL_ID_BY_NAME.get(selected.modelName)!,
    sourceName: selected.sourceName ?? "unknown",
    runId: selected.runId,
    runIdKind: selected.runIdKind ?? "unknown",
    requestStartedAt: selected.requestStartedAt ?? null,
    availableAt: selected.availableAt!,
    validTime: selected.validTime!,
    horizonMinutes: selected.horizonMinutes,
    horizonBucket: selected.horizonBucket,
    value: selected.value,
    reliability: source.reliability,
    historicalScore: source.evidence?.metrics ?? null,
    calibrationLevel: source.calibrationLevel,
    calibrationStatus: source.calibrationStatus,
    rawWeight: source.rawWeight,
    robustFallbackWeight: source.robustFallbackWeight,
    weight: finalWeight,
    contributedToValue: contributes,
    ...(source.evidence ? { historicalEvidence: source.evidence } : {}),
    ...(source.exactEvidence ? { exactHorizonEvidence: source.exactEvidence } : {}),
  };
}

function computeVariableForecastValue(input: {
  variable: OfficialHourlyVariable;
  candidates: HourlyModelValue[];
  historyAvailable: boolean;
  referenceAt: number;
  availabilityReasonByModel: Readonly<Record<string, string>>;
  getHistoricalEvidence: (
    modelName: OfficialHourlyModelName,
    variable: OfficialHourlyVariable,
    horizonMilliseconds: number,
    horizonBucket: string,
  ) => HourlyHistoricalEvidenceSelection;
}): { result: VariableForecastValue; selectionDiagnostics: ForecastModelEligibilityDiagnostic[] } {
  const { variable, candidates, historyAvailable, referenceAt, availabilityReasonByModel, getHistoricalEvidence } = input;
  const field = FORECAST_FIELD_BY_VARIABLE[variable];
  const selectionCandidates: ForecastModelCandidate<HourlyModelValue>[] = candidates.map((model) => {
    const expectedId = MODEL_ID_BY_NAME.get(model.modelName)!;
    const qualityReason = model.modelId !== expectedId
      ? "Identifiant de modèle incohérent avec le catalogue officiel."
      : model.sourceName !== "open-meteo"
        ? "La source n’est pas le fournisseur officiel Open-Meteo."
        : undefined;
    return {
      modelName: model.modelName,
      modelId: model.modelId,
      sourceName: model.sourceName,
      runId: model.runId,
      runIdKind: model.runIdKind,
      requestStartedAt: model.requestStartedAt,
      availableAt: model.availableAt,
      providerRunAt: model.providerRunAt,
      validTime: model.hour.validAt,
      value: model.hour[field],
      qualityStatus: qualityReason ? "rejected" : "qualified",
      ...(qualityReason ? { qualityReason } : {}),
      metadata: model,
    };
  });
  const selection = selectEligibleModelsForHorizon(selectionCandidates, {
    expectedModelNames: OFFICIAL_HOURLY_MODEL_NAMES,
    variable,
    validTime: candidates[0]?.hour.validAt ?? Number.NaN,
    referenceAt,
    leadTimeBasis: "provider_run_at",
    allowUnknownLead: true,
    horizonBucketForMinutes: (horizonMinutes) => getForecastHorizonWindow(horizonMinutes)?.key ?? null,
    allowUnscoredHorizons: true,
    missingReasonByModel: availabilityReasonByModel,
  });
  const valueHistory = selection.eligible.map((selected) => {
    const horizonMilliseconds = selected.providerRunAt != null && selected.validTime != null
      ? selected.validTime - selected.providerRunAt
      : Number.NaN;
    const evidence = selected.horizonBucket == null || !HISTORY_VARIABLE_SET.has(variable) || !Number.isSafeInteger(horizonMilliseconds) || horizonMilliseconds <= 0
      ? { evidence: null, exactEvidence: null, bucketEvidence: null, calibrationLevel: "UNCALIBRATED_ROBUST" as const }
      : getHistoricalEvidence(selected.modelName as OfficialHourlyModelName, variable, horizonMilliseconds, selected.horizonBucket);
    return { selected, ...evidence };
  });
  const metricsByBucket = new Map<string, number[]>();
  for (const item of valueHistory) {
    if (!item.evidence?.metrics) continue;
    const key = item.selected.horizonBucket ?? "unscored";
    const list = metricsByBucket.get(key) ?? [];
    list.push(item.evidence.metrics.mae);
    metricsByBucket.set(key, list);
  }
  const baselineByBucket = new Map(Array.from(metricsByBucket, ([key, values]) => [key, median(values)] as const));
  const prepared: PreparedHourlyModel[] = valueHistory.map(({ selected, evidence, exactEvidence, bucketEvidence, calibrationLevel }) => {
    const fullyCalibrated = evidence?.status === "qualified" && evidence.metrics != null;
    const partiallyCalibrated = evidence?.metrics != null && ["insufficient_evidence", "incomplete_metrics"].includes(evidence.status);
    const calibrationStatus: HourlyCalibrationStatus = fullyCalibrated
      ? "CALIBRATED"
      : partiallyCalibrated ? "PARTIALLY_CALIBRATED" : "UNCALIBRATED_ROBUST";
    const metrics = evidence?.metrics ?? null;
    const baseline = baselineByBucket.get(selected.horizonBucket ?? "unscored") ?? 0;
    const comparisonReliability = metrics
      ? metrics.comparisonCount / (metrics.comparisonCount + PERFORMANCE_PRIOR_DAYS)
      : 0;
    const dayReliability = metrics
      ? metrics.evaluatedDays / (metrics.evaluatedDays + PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays)
      : 0;
    const reliability = comparisonReliability * dayReliability;
    const regularizedMae = metrics && baseline > 0
      ? baseline + reliability * (metrics.mae - baseline)
      : baseline;
    const skillMultiplier = baseline > 0 && regularizedMae > 0
      ? Math.max(0.3, Math.min(2, baseline / regularizedMae))
      : 1;
    const historicalMultiplier = metrics ? 1 + reliability * (skillMultiplier - 1) : 1;
    return {
      selected,
      evidence,
      exactEvidence,
      bucketEvidence,
      calibrationLevel,
      calibrationStatus,
      horizonMilliseconds: Number.isSafeInteger(selected.providerRunAt) && selected.validTime != null
        ? selected.validTime - selected.providerRunAt!
        : null,
      reliability,
      rawWeight: historicalMultiplier,
      ensembleWeight: 0,
      robustFallbackWeight: null,
      finalWeight: 0,
      contributes: true,
    };
  });

  // Robust outlier control is local to one variable and one scored horizon; it never
  // compares a model at a different lead time or uses absent values as zeros.
  const fallbackGroups = new Map<string, PreparedHourlyModel[]>();
  for (const item of prepared) {
    if (item.calibrationStatus !== "UNCALIBRATED_ROBUST" || variable === "wind_direction" || variable === "weather_code") continue;
    const horizonKey = item.selected.horizonBucket ?? (item.selected.horizonMinutes == null
      ? "unscored-unknown-lead"
      : `unscored-${Math.floor(item.selected.horizonMinutes / 60)}`);
    const group = fallbackGroups.get(horizonKey) ?? [];
    group.push(item);
    fallbackGroups.set(horizonKey, group);
  }
  Array.from(fallbackGroups.values()).forEach((group) => {
    const multipliers = calculateRobustFallbackMultipliers(group.map((item) => ({
      modelId: item.selected.modelId ?? item.selected.modelName,
      value: item.selected.value,
    })));
    for (const item of group) {
      const multiplier = multipliers.get(item.selected.modelId ?? item.selected.modelName) ?? 1;
      item.robustFallbackWeight = multiplier;
      item.rawWeight *= multiplier;
    }
  });

  const availableCount = prepared.length;
  const bestSelection = selectBestQualifiedModel(prepared, variable);
  const wetModels = variable === "precipitation"
    ? prepared.filter((item) => item.selected.value >= PRECIPITATION_RAIN_THRESHOLD_MM)
    : prepared;
  const ensembleContributors = variable === "precipitation" && wetModels.length > 0 ? wetModels : prepared;
  const rawByModel = new Map(ensembleContributors.map((item) => [item.selected.modelId ?? item.selected.modelName, item.rawWeight] as const));
  const cappedByModel = normalizeModelWeightsWithCap(
    Array.from(rawByModel, ([modelId, rawWeight]) => ({ modelId, rawWeight })),
    1,
    MODEL_FUSION_WEIGHT_CAP,
  );
  const ensembleByModel = cappedByModel
    ? new Map(Array.from(cappedByModel, ([modelId, weight]) => [modelId, weight] as const))
    : normalizeWeights(rawByModel);
  const useQualifiedWinner = bestSelection.strategy === "qualified_best_model" && bestSelection.selected != null;
  const valueContributors = useQualifiedWinner ? [bestSelection.selected!] : ensembleContributors;
  for (const item of prepared) {
    const modelId = item.selected.modelId ?? item.selected.modelName;
    item.ensembleWeight = ensembleContributors.includes(item) ? ensembleByModel?.get(modelId) ?? 0 : 0;
    item.contributes = useQualifiedWinner ? item === bestSelection.selected : ensembleContributors.includes(item);
    item.finalWeight = item.contributes
      ? useQualifiedWinner ? 1 : ensembleByModel?.get(modelId) ?? 0
      : 0;
  }

  const availabilityStatus = getAvailabilityStatus(availableCount);
  const availableCalibrationStatuses = prepared.map((item) => item.calibrationStatus);
  const calibrationStatus = getCalibrationStatus(availableCalibrationStatuses);
  const method = getVariableMethod(availabilityStatus, calibrationStatus);
  const contributorValues = valueContributors.map((item) => ({ value: item.selected.value, weight: item.finalWeight }));
  const computedValue = variable === "weather_code"
    ? weightedMode(contributorValues)
    : variable === "wind_direction"
      ? weightedCircularMeanDegrees(contributorValues)
      : variable === "precipitation" && wetModels.length === 0
        ? (availableCount > 0 ? 0 : null)
        : weightedMean(contributorValues);
  const evidenceEligible = prepared.filter((item) => item.calibrationStatus === "CALIBRATED");
  const minComparisons = prepared.flatMap((item) => item.evidence?.metrics ? [item.evidence.metrics.comparisonCount] : []);
  const minComparableDays = prepared.flatMap((item) => item.evidence?.metrics ? [item.evidence.metrics.evaluatedDays] : []);
  const calibrationReasons = prepared.filter((item) => item.calibrationStatus !== "CALIBRATED").map((item) => ({
    modelName: item.selected.modelName,
    reason: !HISTORY_VARIABLE_SET.has(variable)
      ? "Aucune série d’observations physiques n’est disponible pour calibrer cette variable; la valeur reste incluse avec un repli robuste non calibré."
      : !historyAvailable
        ? "Historique indisponible; la valeur reste incluse avec une pondération robuste non calibrée."
        : item.selected.horizonMinutes == null
          ? "providerRunAt absent ou non attesté pour ce run; lead inconnu, valeur incluse avec une pondération robuste non calibrée."
          : item.selected.horizonBucket == null
            ? "Aucun bucket historique ne correspond à cet horizon; la valeur reste incluse avec une pondération robuste non calibrée."
        : item.exactEvidence?.status === "insufficient_evidence" && !item.evidence?.metrics
          ? `Preuve strictement au lead exact insuffisante (${item.exactEvidence.metrics?.comparisonCount ?? 0} comparaisons, ${item.exactEvidence.metrics?.evaluatedDays ?? 0} jours); aucune preuve bucket exploitable, repli robuste appliqué.`
        : item.exactEvidence?.status === "incomplete_metrics" && !item.evidence?.metrics
          ? "Les métriques disponibles au lead exact sont incomplètes et aucune preuve bucket exploitable n’existe; repli robuste appliqué."
        : item.evidence?.status === "insufficient_evidence"
          ? `Preuve partielle (${item.evidence.metrics?.comparisonCount ?? 0} comparaisons, ${item.evidence.metrics?.evaluatedDays ?? 0} jours); pondération régularisée.`
          : item.evidence?.status === "incomplete_metrics"
            ? "Certaines lignes historiques sont incomplètes; la valeur reste incluse avec un repli robuste."
          : item.evidence?.status === "no_evidence"
            ? `Aucune preuve historique admissible dans la fenêtre glissante de ${OFFICIAL_HOURLY_HISTORY_DAYS} jours; les archives hors fenêtre sont conservées et exclues des poids; repli robuste appliqué.`
            : "Aucune preuve historique qualifiée pour ce modèle, cette variable et cet horizon; repli robuste appliqué.",
    horizonBucket: item.selected.horizonBucket,
  }));
  const historicalEvidence = prepared.flatMap((item) => item.evidence ? [item.evidence] : []);
  const sourceDiagnostics = prepared.map((item) => makeDiagnostic(item, item.finalWeight, item.contributes));
  const contributingModelCount = prepared.filter((item) => item.contributes && item.finalWeight > 0).length;
  const buckets = Array.from(new Set(prepared.map((item) => item.selected.horizonBucket)));
  const unavailableReason: HourlyWeightingUnavailableReason | null = availableCount === 0 ? "no_model_data" : null;
  const weighting: HourlyVariableWeighting = {
    variable,
    method,
    selectionStrategy: bestSelection.strategy,
    selectedModelName: bestSelection.strategy === "qualified_best_model" || bestSelection.strategy === "only_available_model"
      ? bestSelection.selected?.selected.modelName ?? null
      : null,
    selectionEvidenceBasis: bestSelection.evidenceBasis,
    selectionReason: bestSelection.reason,
    horizonBucket: buckets.length === 1 ? buckets[0]! : null,
    availabilityStatus,
    calibrationStatus,
    unavailableReason,
    expectedModelCount: OFFICIAL_HOURLY_MODEL_NAMES.length,
    availableModelCount: availableCount,
    evidenceEligibleModelCount: evidenceEligible.length,
    contributingModelCount,
    coverageLevel: getCoverageLevel(contributingModelCount),
    availableModels: prepared.map((item) => item.selected.modelName),
    evidenceEligibleModels: evidenceEligible.map((item) => item.selected.modelName),
    modelReasons: ineligibilityReasonByModel(selection.diagnostics),
    calibrationReasons,
    modelsWithData: prepared.map((item) => item.selected.modelName),
    modelWeights: sourceDiagnostics,
    minimumComparisons: minComparisons.length > 0 ? Math.min(...minComparisons) : null,
    minimumComparableDays: minComparableDays.length > 0 ? Math.min(...minComparableDays) : null,
    historicalEvidence,
  };
  return {
    result: { value: computedValue, weighting, selected: prepared },
    selectionDiagnostics: selection.diagnostics,
  };
}

function makePoint(
  validAt: number,
  variableValues: Map<OfficialHourlyVariable, VariableForecastValue>,
): HourlyPoint | null {
  const parisTime = getParisDateAndHour(validAt);
  if (!parisTime) return null;
  const valueFor = (variable: OfficialHourlyVariable) => variableValues.get(variable)?.value ?? null;
  const temperatureValue = variableValues.get("temperature")!;
  const precipitationValue = variableValues.get("precipitation")!;
  const precipitationSelection = precipitationValue.selected;
  const precipitationModels = precipitationSelection.map(({ selected }) => ({
    modelName: selected.modelName,
    amountMm: selected.value,
  }));
  const wetPrecipitationModels = precipitationSelection.filter(({ selected }) => selected.value >= PRECIPITATION_RAIN_THRESHOLD_MM);
  const conditionalMean = weightedMean(wetPrecipitationModels.map((item) => ({ value: item.selected.value, weight: item.ensembleWeight })));
  const precipitationMetrics = summarizePrecipitationModels(
    precipitationModels,
    precipitationSelection.map(({ selected }) => selected.modelName),
    {
      configuredModelNames: OFFICIAL_HOURLY_MODEL_NAMES,
      ...(wetPrecipitationModels.length > 0 ? {
        conditionalMeanMm: conditionalMean,
        conditionalMeanMethod: precipitationValue.weighting.calibrationStatus === "CALIBRATED" ? "historical_skill" : "robust_fallback",
      } : {}),
    },
  );
  const precipitation = precipitationValue.weighting.selectionStrategy === "qualified_best_model"
    || precipitationValue.weighting.selectionStrategy === "only_available_model"
    ? precipitationValue.value
    : precipitationMetrics.consensusEstimateMm;
  const temperature = valueFor("temperature");
  const windSpeed = valueFor("wind_speed");
  const windGust = valueFor("wind_gust");
  const humidity = valueFor("humidity");
  const pressure = valueFor("pressure");
  const windDirectionValue = variableValues.get("wind_direction")!;
  const cloudCoverValue = variableValues.get("cloud_cover")!;
  const windDirection = valueFor("wind_direction");
  const cloudCover = valueFor("cloud_cover");
  const weatherCode = valueFor("weather_code");
  const rawTemperatures = temperatureValue.selected.map(({ selected }) => ({ name: selected.modelName, temperature: selected.value }));
  const temperatureSummary = summarizeModelValues(rawTemperatures.map(({ temperature: value }) => value));
  const temperatureExtremes = [...rawTemperatures].sort((left, right) => left.temperature - right.temperature || left.name.localeCompare(right.name));
  const windSpeedSummary = summarizeModelValues(variableValues.get("wind_speed")!.selected.map(({ selected }) => selected.value));
  const windGustSummary = summarizeModelValues(variableValues.get("wind_gust")!.selected.map(({ selected }) => selected.value));
  const humiditySummary = summarizeModelValues(variableValues.get("humidity")!.selected.map(({ selected }) => selected.value));
  const cloudCoverSummary = summarizeModelValues(cloudCoverValue.selected.map(({ selected }) => selected.value));
  const availableModels = Array.from(new Set(OFFICIAL_HOURLY_FUSION_VARIABLES.flatMap((variable) => variableValues.get(variable)!.weighting.availableModels)));
  const variableWeightings = OFFICIAL_HOURLY_FUSION_VARIABLES.map((variable) => variableValues.get(variable)!.weighting);
  const scoredVariables = variableWeightings.filter((item) => item.calibrationStatus === "CALIBRATED").map((item) => item.variable);
  const robustVariables = variableWeightings.filter((item) => item.calibrationStatus === "PARTIALLY_CALIBRATED" || item.calibrationStatus === "UNCALIBRATED_ROBUST").map((item) => item.variable);
  const unavailableVariables = variableWeightings.filter((item) => item.availabilityStatus === "UNAVAILABLE").map((item) => item.variable);
  const availabilityStatus = getAvailabilityStatus(availableModels.length);
  const calibrationStatus = getCalibrationStatus(variableWeightings.filter((item) => item.availabilityStatus !== "UNAVAILABLE").map((item) => item.calibrationStatus));
  const pointMethod = availabilityStatus === "UNAVAILABLE"
    ? "unavailable"
    : availabilityStatus === "SINGLE_MODEL"
      ? "single_model"
      : calibrationStatus === "CALIBRATED" ? "historical_skill"
        : calibrationStatus === "PARTIALLY_CALIBRATED" ? "mixed" : "robust_fallback";
  const reasons = variableWeightings.flatMap((item) => item.unavailableReason ? [item.unavailableReason] : []);
  const allBuckets = Array.from(new Set(variableWeightings.flatMap((item) => item.modelWeights.map((model) => model.horizonBucket))));
  const horizonBucket = allBuckets.length === 1 ? allBuckets[0]! : null;
  const counts = variableWeightings.filter((item) => item.availabilityStatus !== "UNAVAILABLE");
  const minimumComparisons = counts.flatMap((item) => item.minimumComparisons == null ? [] : [item.minimumComparisons]);
  const minimumComparableDays = counts.flatMap((item) => item.minimumComparableDays == null ? [] : [item.minimumComparableDays]);
  const condition = precipitation == null && cloudCover == null
    ? null
    : conditionFromWeatherValues(precipitation, cloudCover);
  const precipIntensity = precipitation == null || precipitation <= 0
    ? null
    : precipitation > 5 ? "heavy" : precipitation > 1 ? "moderate" : "light";

  // Pass through the exact raw component values of existing precipitation contributors.
  // This adds no component averaging, replacement zeros, or new weighting decision.
  const precipitationComponents = precipitationSelection
    .filter(({ contributes, finalWeight }) => contributes && finalWeight > 0)
    .map(({ selected }) => ({
      modelName: selected.modelName,
      rain: isFiniteNumber(selected.metadata.hour.rain) ? selected.metadata.hour.rain : null,
      showers: isFiniteNumber(selected.metadata.hour.showers) ? selected.metadata.hour.showers : null,
      snowfall: isFiniteNumber(selected.metadata.hour.snowfall) ? selected.metadata.hour.snowfall : null,
    }));

  const point: HourlyPoint = {
    date: parisTime.date,
    hour: `${String(parisTime.hour).padStart(2, "0")}:00`,
    validAt,
    temp: temperature,
    apparentTemp: valueFor("apparent_temperature"),
    precipitation,
    precipitationComponents,
    windSpeed,
    windGust,
    windDirection,
    cloudCover,
    humidity,
    uvIndex: valueFor("uv_index"),
    condition,
    weatherCode,
    pressure,
    dewPoint: valueFor("dew_point"),
    visibility: valueFor("visibility"),
    solarRadiation: valueFor("shortwave_radiation"),
    cloudLow: valueFor("cloud_cover_low"),
    cloudMid: valueFor("cloud_cover_mid"),
    cloudHigh: valueFor("cloud_cover_high"),
    precipType: null,
    precipIntensity,
    multiModelMetrics: {
      source: "official_seven_models",
      bestMatchIncluded: false,
      expectedModelCount: availableModels.length,
      modelsExpected: availableModels,
      configuredModelCount: OFFICIAL_HOURLY_MODEL_NAMES.length,
      modelsConfigured: OFFICIAL_HOURLY_MODEL_NAMES,
      temperature: {
        ...temperatureSummary,
        weightedMean: temperature,
        modelsWithData: rawTemperatures.map(({ name }) => name),
        minModel: temperatureExtremes[0]?.name ?? null,
        maxModel: temperatureExtremes.at(-1)?.name ?? null,
      },
      precipitation: precipitationMetrics,
      dispersion: {
        windSpeed: { range: windSpeedSummary.range, standardDeviation: windSpeedSummary.standardDeviation, availableModelCount: windSpeedSummary.availableModelCount },
        windGust: { range: windGustSummary.range, standardDeviation: windGustSummary.standardDeviation, availableModelCount: windGustSummary.availableModelCount },
        windDirection: {
          range: maximumCircularSpread(windDirectionValue.selected.map(({ selected }) => selected.value)),
          standardDeviation: null,
          availableModelCount: windDirectionValue.selected.length,
        },
        humidity: { range: humiditySummary.range, standardDeviation: humiditySummary.standardDeviation, availableModelCount: humiditySummary.availableModelCount },
        cloudCover: { range: cloudCoverSummary.range, standardDeviation: cloudCoverSummary.standardDeviation, availableModelCount: cloudCoverSummary.availableModelCount },
      },
    },
    forecastWeighting: {
      method: pointMethod,
      availabilityStatus,
      calibrationStatus,
      expectedModelCount: OFFICIAL_HOURLY_MODEL_NAMES.length,
      availableModelCount: availableModels.length,
      evidenceEligibleModelCount: new Set(variableWeightings.flatMap((item) => item.evidenceEligibleModels)).size,
      contributingModelCount: new Set(variableWeightings.flatMap((item) => item.modelWeights.filter((model) => model.contributedToValue && model.weight > 0).map((model) => model.modelName))).size,
      horizonBucket,
      unavailableReason: reasons[0] ?? null,
      scoredVariables,
      robustVariables,
      unavailableVariables,
      minimumComparisons: minimumComparisons.length > 0 ? Math.min(...minimumComparisons) : null,
      minimumComparableDays: minimumComparableDays.length > 0 ? Math.min(...minimumComparableDays) : null,
      variableWeightings,
      modelsWithData: availableModels,
    } satisfies HourlyPointWeighting,
  };
  return point;
}

export function computeOfficialHourlyForecast(
  modelForecasts: readonly HourlyModelForecast[],
  historyScores: readonly OfficialHourlyEvaluationHistoryScore[],
  options: {
    historyAvailable?: boolean;
    historyBasis?: 'ordinary' | 'provider_run';
    exactHistoryAvailable?: boolean;
    exactHistoryScores?: readonly OfficialHourlyEvaluationHistoryScore[];
    referenceAt?: number;
    availabilityReasonByModel?: Readonly<Record<string, string>>;
  } = {},
): OfficialHourlyForecastResult {
  const historyAvailable = options.historyAvailable !== false;
  const exactHistoryAvailable = options.exactHistoryAvailable ?? (options.exactHistoryScores != null);
  // Le marqueur ordinaire v1 ne certifie jamais un cycle fournisseur : chemin v2 séparé.
  const filterHistory = options.historyBasis === 'provider_run'
    ? (rows:readonly OfficialHourlyEvaluationHistoryScore[])=>rows.filter(row=>row.leadBasis==='provider_run'&&row.scoringValidationVersion===2)
    : filterCurrentHourlyScoringRows;
  const currentHistoryScores = filterHistory(historyScores);
  const exactHistoryScores = filterHistory(options.exactHistoryScores ?? []);
  const referenceAt = options.referenceAt ?? Date.now();
  const periodStartDate = getParisDateDaysAgo(OFFICIAL_HOURLY_HISTORY_DAYS);
  const availabilityReasonByModel = options.availabilityReasonByModel ?? {};
  const byValidTime = new Map<number, HourlyModelValue[]>();

  for (const forecast of modelForecasts) {
    if (!MODEL_NAME_SET.has(forecast.modelName)) continue;
    const modelName = forecast.modelName as OfficialHourlyModelName;
    for (const hour of forecast.hours) {
      if (!isFiniteNumber(hour.validAt)) continue;
      const values = byValidTime.get(hour.validAt) ?? [];
      values.push({
        modelName,
        modelId: forecast.modelId ?? null,
        sourceName: forecast.sourceName ?? null,
        runId: forecast.captureRunId ?? null,
        runIdKind: forecast.captureRunId ? "capture" : "unknown",
        requestStartedAt: isFiniteNumber(forecast.requestStartedAt) ? forecast.requestStartedAt : null,
        availableAt: isFiniteNumber(forecast.availableAt) ? forecast.availableAt : null,
        providerRunAt: isFiniteNumber(forecast.providerRunAt) ? forecast.providerRunAt : null,
        hour,
      });
      byValidTime.set(hour.validAt, values);
    }
  }

  const forecastDates = Array.from(byValidTime.keys())
    .map((validAt) => getParisDateAndHour(validAt)?.date)
    .filter((date): date is string => date != null)
    .sort();
  const beforeDate = forecastDates[0] ?? null;
  const historicalEvidenceByKey = new Map<string, HourlyHistoricalEvidenceSelection>();
  const bucketEvidenceByKey = new Map<string, HourlyHistoricalEvidence>();
  const getHistoricalEvidence = (
    modelName: OfficialHourlyModelName,
    variable: OfficialHourlyVariable,
    horizonMilliseconds: number,
    horizonBucket: string,
  ): HourlyHistoricalEvidenceSelection => {
    const key = [modelName, variable, horizonMilliseconds, horizonBucket].join("|");
    const existing = historicalEvidenceByKey.get(key);
    if (existing) return existing;
    const baseInput = {
      modelName,
      modelId: MODEL_ID_BY_NAME.get(modelName)!,
      variable,
      horizonBucket,
      beforeDate,
      periodStartDate,
    };
    const exactEvidence = summarizeHourlyHistoricalEvidence(exactHistoryScores, {
      ...baseInput,
      horizonMilliseconds,
      historyAvailable: exactHistoryAvailable,
    });
    const exactQualified = exactEvidence.status === "qualified" && exactEvidence.metrics != null;
    const bucketKey = [modelName, variable, horizonBucket].join("|");
    let bucketEvidence = bucketEvidenceByKey.get(bucketKey);
    if (!bucketEvidence) {
      bucketEvidence = summarizeHourlyHistoricalEvidence(currentHistoryScores, { ...baseInput, historyAvailable });
      bucketEvidenceByKey.set(bucketKey, bucketEvidence);
    }
    const result: HourlyHistoricalEvidenceSelection = {
      evidence: exactQualified ? exactEvidence : bucketEvidence,
      exactEvidence,
      bucketEvidence,
      calibrationLevel: exactQualified
        ? "EXACT_LOCAL_MODEL_VARIABLE_HORIZON"
        : bucketEvidence.metrics != null ? "EXACT_LOCAL_MODEL_VARIABLE_BUCKET" : "UNCALIBRATED_ROBUST",
    };
    historicalEvidenceByKey.set(key, result);
    return result;
  };
  const hours: HourlyPoint[] = [];
  const summaryRows = new Map<string, {
    variable: string;
    horizonBucket: string | null;
    method: "historical_skill" | "mixed" | "robust_fallback" | "single_model" | "unavailable";
    selectionStrategyCounts: Record<HourlyVariableSelectionStrategy, number>;
    bestModelHourCounts: Map<string, number>;
    selectionReasonCounts: Map<HourlyVariableSelectionReason, number>;
    availabilityStatus: HourlyAvailabilityStatus;
    calibrationStatus: HourlyCalibrationStatus;
    unavailableReason: HourlyWeightingUnavailableReason | null;
    hourCount: number;
    availableModelCount: number;
    evidenceEligibleModelCount: number;
    contributingModelCount: number;
    coverageLevelCounts: Record<ModelCountCoverageLevel, number>;
    modelNamesWithData: Set<OfficialHourlyModelName>;
  }>();
  const allModelsWithData = new Set<OfficialHourlyModelName>();

  for (const [validAt, modelValues] of Array.from(byValidTime.entries()).sort((left, right) => left[0] - right[0])) {
    const variableValues = new Map<OfficialHourlyVariable, VariableForecastValue>();
    for (const variable of OFFICIAL_HOURLY_FUSION_VARIABLES) {
      const { result } = computeVariableForecastValue({
        variable,
        candidates: modelValues,
        historyAvailable,
        referenceAt,
        availabilityReasonByModel,
        getHistoricalEvidence,
      });
      variableValues.set(variable, result);
    }

    const point = makePoint(validAt, variableValues);
    if (!point) continue;
    hours.push(point);
    point.forecastWeighting?.modelsWithData.forEach((name) => allModelsWithData.add(name as OfficialHourlyModelName));

    for (const weighting of point.forecastWeighting?.variableWeightings ?? []) {
      if (validAt <= referenceAt && weighting.availabilityStatus === "UNAVAILABLE") continue;
      const key = `${weighting.variable}|${weighting.horizonBucket ?? "mixed"}|${weighting.method}|${weighting.calibrationStatus}|${weighting.availabilityStatus}|${weighting.unavailableReason ?? ""}`;
      const row = summaryRows.get(key) ?? {
        variable: weighting.variable,
        horizonBucket: weighting.horizonBucket,
        method: weighting.method,
        selectionStrategyCounts: {
          qualified_best_model: 0,
          weighted_ensemble_fallback: 0,
          only_available_model: 0,
          unavailable: 0,
        },
        bestModelHourCounts: new Map<string, number>(),
        selectionReasonCounts: new Map<HourlyVariableSelectionReason, number>(),
        availabilityStatus: weighting.availabilityStatus,
        calibrationStatus: weighting.calibrationStatus,
        unavailableReason: weighting.unavailableReason,
        hourCount: 0,
        availableModelCount: 0,
        evidenceEligibleModelCount: 0,
        contributingModelCount: 0,
        coverageLevelCounts: { NONE: 0, SINGLE_MODEL: 0, LIMITED: 0, MODERATE: 0, BROAD: 0 },
        modelNamesWithData: new Set<OfficialHourlyModelName>(),
      };
      row.hourCount++;
      row.availableModelCount += weighting.availableModelCount;
      row.evidenceEligibleModelCount += weighting.evidenceEligibleModelCount;
      row.contributingModelCount += weighting.contributingModelCount;
      row.coverageLevelCounts[weighting.coverageLevel] += 1;
      row.selectionStrategyCounts[weighting.selectionStrategy] += 1;
      if (weighting.selectedModelName) {
        row.bestModelHourCounts.set(weighting.selectedModelName, (row.bestModelHourCounts.get(weighting.selectedModelName) ?? 0) + 1);
      }
      if (weighting.selectionStrategy === "weighted_ensemble_fallback") {
        row.selectionReasonCounts.set(weighting.selectionReason, (row.selectionReasonCounts.get(weighting.selectionReason) ?? 0) + 1);
      }
      weighting.availableModels.forEach((name) => row.modelNamesWithData.add(name as OfficialHourlyModelName));
      summaryRows.set(key, row);
    }
  }

  const allVariableWeightings = hours.flatMap((point) => point.forecastWeighting?.variableWeightings ?? []);
  const availableWeightings = allVariableWeightings.filter((item) => item.availabilityStatus !== "UNAVAILABLE");
  const unionAvailable = new Set(availableWeightings.flatMap((item) => item.availableModels));
  const unionCalibrated = new Set(availableWeightings.flatMap((item) => item.evidenceEligibleModels));
  const availabilityStatus = getAvailabilityStatus(unionAvailable.size);
  const calibrationStatus = getCalibrationStatus(availableWeightings.map((item) => item.calibrationStatus));
  const status: OfficialHourlyWeightingSummary["status"] = availabilityStatus === "UNAVAILABLE"
    ? "unavailable"
    : availabilityStatus === "SINGLE_MODEL" ? "single_model"
      : calibrationStatus === "CALIBRATED" ? "historical_skill"
        : calibrationStatus === "PARTIALLY_CALIBRATED" ? "mixed" : "robust_fallback";

  return {
    hours,
    weighting: {
      status,
      availabilityStatus,
      calibrationStatus,
      historyStatus: historyAvailable ? "available" : "unavailable",
      historyWindowDays: OFFICIAL_HOURLY_HISTORY_DAYS,
      minimumComparisons: PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons,
      minimumComparableDays: PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays,
      bestMatchIncluded: false,
      modelsConsidered: OFFICIAL_HOURLY_MODEL_NAMES,
      modelsWithData: Array.from(allModelsWithData),
      horizons: Array.from(summaryRows.values()).map((row) => ({
        ...row,
        bestModelHourCounts: Array.from(row.bestModelHourCounts, ([modelName, hourCount]) => ({ modelName, hourCount }))
          .sort((left, right) => right.hourCount - left.hourCount || left.modelName.localeCompare(right.modelName)),
        selectionReasonCounts: Array.from(row.selectionReasonCounts, ([reason, hourCount]) => ({ reason, hourCount }))
          .sort((left, right) => right.hourCount - left.hourCount || left.reason.localeCompare(right.reason)),
        modelNamesWithData: Array.from(row.modelNamesWithData),
      })),
    },
  };
}

/** Collects one shared official hourly forecast and its read-only historical score window. */
/**
 * Budget de latence du chemin interactif (page Dashboard / Prévisions).
 * Le contrôleur local annule réellement les requêtes fournisseurs avant le
 * seuil UX de 8 s. Le mode scheduled ne passe jamais par cette borne.
 */
export const INTERACTIVE_HOURLY_RESPONSE_BUDGET_MS = 7_200;
export const INTERACTIVE_HOURLY_MODEL_TIMEOUT_MS = 6_500;
export const INTERACTIVE_HOURLY_RETRY_BUDGET_MS = 0;

export type CollectOfficialHourlyForecastOptions = {
  forecastDays?: number;
  interactive?: boolean;
  /** Caller-owned cancellation for a non-shared, direct collection. */
  signal?: AbortSignal;
  /** Absolute deadline set before any preceding interactive work (for example archive I/O). */
  deadlineAt?: number;
};

function unavailableInteractiveHourlyResult(reason: string): CollectedOfficialHourlyForecast {
  const availabilityReasonByModel = Object.fromEntries(
    OFFICIAL_HOURLY_MODEL_NAMES.map((modelName) => [modelName, reason]),
  );
  return {
    ...computeOfficialHourlyForecast([], [], {
      historyAvailable: false,
      exactHistoryAvailable: false,
      availabilityReasonByModel,
    }),
    modelForecasts: [],
  };
}

export async function collectOfficialHourlyForecast(
  targetDate: string,
  coords?: { lat: number; lon: number },
  options: CollectOfficialHourlyForecastOptions = {},
): Promise<CollectedOfficialHourlyForecast> {
  const location = coords ?? HONDEGHEM;
  const startedAt = Date.now();
  const interactiveBudgetMs = options.interactive
    ? Math.max(0, Math.min(
      INTERACTIVE_HOURLY_RESPONSE_BUDGET_MS,
      options.deadlineAt == null ? INTERACTIVE_HOURLY_RESPONSE_BUDGET_MS : options.deadlineAt - startedAt,
    ))
    : null;
  if (interactiveBudgetMs === 0) {
    return unavailableInteractiveHourlyResult("Le budget de réponse interactive est déjà expiré; aucune prévision horaire n’est publiée.");
  }
  const interactiveController = options.interactive
    ? new AbortController()
    : null;
  const budgetSignal = interactiveController
    ? AbortSignal.any([interactiveController.signal, ...(options.signal ? [options.signal] : [])])
    : options.signal;
  let resolveBudgetExpiry: (() => void) | null = null;
  const budgetExpired = interactiveController
    ? new Promise<"budget_expired">((resolve) => { resolveBudgetExpiry = () => resolve("budget_expired"); })
    : null;
  const budgetTimer = interactiveController
    ? setTimeout(() => {
      interactiveController.abort(new DOMException("Interactive weather budget exhausted", "TimeoutError"));
      resolveBudgetExpiry?.();
    }, interactiveBudgetMs!)
    : null;
  let collection;
  try {
    const collectionPromise = collectHourlyForecastAllModelsWithDiagnostics(targetDate, location, {
      includeBestMatch: false,
      includeNextDay: true,
      forecastDays: options.forecastDays ?? 2,
      ...(options.interactive ? {
        timeoutMs: INTERACTIVE_HOURLY_MODEL_TIMEOUT_MS,
        retryBudgetMs: INTERACTIVE_HOURLY_RETRY_BUDGET_MS,
        signal: budgetSignal,
      } : options.signal ? { signal: options.signal } : {}),
    });
    // L’expiration annule les requêtes encore en vol via `budgetSignal`, mais
    // l’agrégateur attend que leurs diagnostics soient matérialisés. Ainsi les
    // modèles déjà reçus restent visibles comme réponse partielle au lieu d’être
    // effacés par une course avec le minuteur global.
    collection = await collectionPromise;
    if (budgetSignal?.aborted && collection.forecasts.length === 0) {
      return unavailableInteractiveHourlyResult("Le fournisseur n’a pas répondu avant le budget interactif; aucune valeur horaire n’est publiée.");
    }
    const modelForecasts = collection.forecasts;
    const availabilityReasonByModel = Object.fromEntries(collection.diagnostics
      .filter((diagnostic) => diagnostic.status !== "succeeded")
      .map((diagnostic) => [diagnostic.modelName, diagnostic.errorCode ?? `Collecte ${diagnostic.status}; ${diagnostic.valuesReceived}/${diagnostic.expectedValueCount} valeurs reçues.`]));
    const referenceAt = Date.now();
    let historyAvailable = false;
    let exactHistoryAvailable = false;
    let historyScores: OfficialHourlyEvaluationHistoryScore[] = [];
    let exactHistoryScores: OfficialHourlyEvaluationHistoryScore[] = [];
    const exactHistoryKeys = new Map<string, HourlyExactHorizonHistoryKey>();
    for (const forecast of modelForecasts) {
      if (!MODEL_NAME_SET.has(forecast.modelName)
        || forecast.sourceName !== "open-meteo"
        || forecast.modelId !== MODEL_ID_BY_NAME.get(forecast.modelName)
        || !isFiniteNumber(forecast.providerRunAt)
        || !Number.isSafeInteger(forecast.providerRunAt)
        || !isFiniteNumber(forecast.availableAt)
        || forecast.providerRunAt > forecast.availableAt) continue;
      for (const hour of forecast.hours) {
        if (!isFiniteNumber(hour.validAt) || hour.validAt <= forecast.providerRunAt) continue;
        const horizonMilliseconds = hour.validAt - forecast.providerRunAt;
        if (!Number.isSafeInteger(horizonMilliseconds) || !getForecastHorizonWindow(horizonMilliseconds / 60_000)) continue;
        for (const variable of HISTORY_VARIABLES) {
          if (!isFiniteNumber(hour[FORECAST_FIELD_BY_VARIABLE[variable]])) continue;
          const key = {
            modelName: forecast.modelName,
            modelId: forecast.modelId!,
            variable,
            horizonMilliseconds,
          };
          exactHistoryKeys.set([key.modelName, key.modelId, key.variable, key.horizonMilliseconds].join("|"), key);
        }
      }
    }
    try {
      const historyRequest = getHourlyForecastEvaluationHistory(
        makeLocationKey(location.lat, location.lon),
        getParisDateDaysAgo(OFFICIAL_HOURLY_HISTORY_DAYS),
        getParisDateDaysAgo(1),
        Array.from(exactHistoryKeys.values()),
      );
      const remainingBudgetMs = interactiveBudgetMs == null
        ? null
        : Math.max(0, interactiveBudgetMs - (Date.now() - startedAt));
      const history = remainingBudgetMs == null
        ? await historyRequest
        : remainingBudgetMs === 0
          ? null
          : await new Promise<Awaited<typeof historyRequest> | null>((resolve) => {
            const timer = setTimeout(() => resolve(null), remainingBudgetMs);
            void historyRequest.then(
              (value) => { clearTimeout(timer); resolve(value); },
              () => { clearTimeout(timer); resolve(null); },
            );
          });
      if (history) {
        historyAvailable = history.available;
        historyScores = history.rows;
        exactHistoryAvailable = history.exactAvailable;
        exactHistoryScores = history.exactRows;
      }
    } catch (error) {
      console.warn("[OfficialHourly] Historical scores unavailable; available forecasts will use a robust non-calibrated weighting:", error);
    }
    return {
      ...computeOfficialHourlyForecast(modelForecasts, historyScores, { historyAvailable, exactHistoryAvailable, exactHistoryScores, referenceAt, availabilityReasonByModel }),
      modelForecasts,
    };
  } finally {
    if (budgetTimer) clearTimeout(budgetTimer);
  }
}
