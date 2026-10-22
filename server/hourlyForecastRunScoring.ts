import type {AuxiliaryReferences} from '../shared/physicalAuxiliaryReference';
import { FORECAST_HORIZON_WINDOWS, getForecastHorizonWindow } from "../shared/forecastHorizon";
import { scoreQualifiedHourlyModels, type QualifiedHourlyModelScore } from "./qualifiedHourlyScoring";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";
import {
  createHourlyComparisonDiagnostics,
  recordHourlyComparisonFirstRejection,
  type HourlyComparisonDiagnostic,
} from "./hourlyComparisonDiagnostics";

export const HOURLY_FORECAST_VARIABLES = [
  "temperature",
  "precipitation",
  "wind_speed",
  "wind_gust",
  "humidity",
  "pressure",
] as const;
export type HourlyForecastVariable = (typeof HOURLY_FORECAST_VARIABLES)[number];

export function isHourlyForecastVariable(value: string): value is HourlyForecastVariable {
  return (HOURLY_FORECAST_VARIABLES as readonly string[]).includes(value);
}

export function normalizeHourlyForecastVariable(value: string): HourlyForecastVariable | null {
  const normalized = value === "surface_pressure" ? "pressure" : value;
  return isHourlyForecastVariable(normalized) ? normalized : null;
}

export type HourlyForecastRunValue = {
  id?: number;
  captureRunId: string;
  locationKey: string;
  targetDate: string;
  sourceName: string;
  modelName: string;
  modelId: string | null;
  requestStartedAt: number;
  availableAt: number;
  validTime: number;
  variable: HourlyForecastVariable;
  value: number | null;
  unit: string | null;
};

export type HourlyPhysicalSnapshot = {
  auxiliaryReferences?:AuxiliaryReferences;
  id?: number;
  locationKey: string;
  date: string;
  hour: number;
  stationCount: number;
  temperature: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust?: number | null;
  humidity?: number | null;
  humidityStationCount?: number;
  pressure?: number | null;
  collectedAt?: Date | string | number | null;
  confidenceScore?: number | null;
  stationsUsed?: unknown;
};

export type HourlyForecastRunScore = {
  locationKey: string;
  date: string;
  sourceName: string;
  modelName: string;
  modelId: string | null;
  variable: HourlyForecastVariable;
  horizonBucket: string;
  observationCount: number;
  evaluableObservationCount: number;
  sampleSize: number;
  coverageRatio: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  scoringValidationVersion: number | null;
};

export type HourlyExactForecastComparison = {
  forecastRunValueId: number | null;
  observationSnapshotId: number | null;
  captureRunId: string;
  locationKey: string;
  sourceName: string;
  modelName: string;
  modelId: string | null;
  variable: HourlyForecastVariable;
  validTime: number;
  availableAt: number;
  horizonMilliseconds: number;
  horizonMinutes: number;
  horizonBucket: string;
  forecastValue: number;
  forecastUnit: string | null;
  observedValue: number;
  observedUnit: string;
  signedError: number;
  absoluteError: number;
  observationDate: string;
  observationHour: number;
  observationReferenceAt: number;
  observationCollectedAt: number | null;
  stationCount: number;
  confidenceScore: number | null;
  stationsUsed: unknown | null;
};

export type HourlyExactForecastRunScore = {
  locationKey: string;
  date: string;
  sourceName: string;
  modelName: string;
  modelId: string | null;
  variable: HourlyForecastVariable;
  horizonMilliseconds: number;
  horizonMinutes: number;
  horizonBucket: string;
  observationCount: number;
  evaluableObservationCount: number;
  sampleSize: number;
  coverageRatio: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  scoringValidationVersion: number | null;
};

export type HourlyForecastRunEvaluation = {
  scores: HourlyForecastRunScore[];
  exactComparisons: HourlyExactForecastComparison[];
  exactScores: HourlyExactForecastRunScore[];
  compatibilityScores: QualifiedHourlyModelScore[];
  diagnostics: HourlyComparisonDiagnostic[];
};

type ModelDescriptor = Pick<HourlyForecastRunValue, "locationKey" | "targetDate" | "sourceName" | "modelName" | "modelId">;
type ObservationOpportunity = {
  snapshot: HourlyPhysicalSnapshot;
  validTime: number | null;
  observedValue: number;
  earliestContributorObservedAt: number;
};

type ForecastRunGroup = {
  captureRunId: string;
  requestStartedAt: number;
  availableAt: number;
  byVariable: Map<HourlyForecastVariable, HourlyForecastRunValue>;
};

function modelKey(value: ModelDescriptor): string {
  return [value.locationKey, value.targetDate, value.sourceName, value.modelName, value.modelId ?? ""].join("|");
}

function observationModelKey(snapshot: HourlyPhysicalSnapshot, model: ModelDescriptor): string {
  return `${modelKey(model)}|${snapshot.date}|${snapshot.hour}`;
}

function forecastSeriesKey(value: Pick<HourlyForecastRunValue, "locationKey" | "targetDate" | "sourceName" | "modelName" | "modelId" | "validTime" | "variable">): string {
  return [modelKey(value), value.validTime, value.variable].join("|");
}

function observationValue(snapshot: HourlyPhysicalSnapshot, variable: HourlyForecastVariable): number | null {
  const values: Record<HourlyForecastVariable, number | null | undefined> = {
    temperature: snapshot.temperature,
    precipitation: snapshot.precipitation,
    wind_speed: snapshot.windSpeed,
    wind_gust: snapshot.windGust,
    humidity: snapshot.humidity,
    pressure: snapshot.pressure,
  };
  const value = values[variable];
  return value != null && Number.isFinite(value) ? value : null;
}

function observationUnit(variable: HourlyForecastVariable): string {
  switch (variable) {
    case "temperature": return "°C";
    case "precipitation": return "mm";
    case "wind_speed":
    case "wind_gust": return "km/h";
    case "humidity": return "%";
    case "pressure": return "hPa";
  }
}

function epochMilliseconds(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  const result = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

type StationMeasurementField = "temperature" | "precipitation" | "windSpeed" | "windGust" | "humidity" | "pressure";

const STATION_FIELD_BY_VARIABLE: Record<HourlyForecastVariable, StationMeasurementField> = {
  temperature: "temperature",
  precipitation: "precipitation",
  wind_speed: "windSpeed",
  wind_gust: "windGust",
  humidity: "humidity",
  pressure: "pressure",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept only an absolute ISO timestamp; date-only and local-time strings are not measurement evidence. */
function absoluteMeasurementEpoch(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  const datePart = `${year}-${month}-${day}`;
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (zone && zone.toUpperCase() !== "Z") {
    const [, offsetHour, offsetMinute] = /[+-](\d{2}):(\d{2})$/.exec(zone) ?? [];
    if (offsetHour == null || offsetMinute == null || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
  }
  const parsed = Date.parse(text.replace(/z$/i, "Z"));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Return the conservative earliest measurement time for this field's actual contributors. */
function earliestContributorObservedAt(
  snapshot: HourlyPhysicalSnapshot,
  variable: HourlyForecastVariable,
): number | null {
  if (!Array.isArray(snapshot.stationsUsed) || snapshot.stationsUsed.length === 0) return null;
  const field = STATION_FIELD_BY_VARIABLE[variable];
  let earliest = Number.POSITIVE_INFINITY;
  let contributorCount = 0;
  for (const station of snapshot.stationsUsed) {
    if (!isRecord(station) || typeof station.stationId !== "string" || station.stationId.trim().length === 0
      || !isRecord(station.fieldWeights)) return null;
    if (!Object.prototype.hasOwnProperty.call(station.fieldWeights, field)) continue;
    const weight = station.fieldWeights[field];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) return null;
    if (weight === 0) continue;
    // Snapshots archived before per-field measurement times keep the station-level
    // absolute timestamp as their only measurement evidence — the same fallback the
    // daily verifier applies. A per-field table missing this field's own time still
    // rejects the field: an absent measurement is never replaced by another field's.
    const observedAt = isRecord(station.measurementTimes)
      ? absoluteMeasurementEpoch(station.measurementTimes[field])
      : absoluteMeasurementEpoch(station.observedAt);
    if (observedAt == null) return null;
    earliest = Math.min(earliest, observedAt);
    contributorCount += 1;
  }
  return contributorCount > 0 && Number.isFinite(earliest) ? earliest : null;
}

function jsonSignature(value: unknown): string {
  try { return JSON.stringify(value ?? null) ?? "null"; } catch { return "[unserializable]"; }
}

function equalNullableNumber(left: number | null | undefined, right: number | null | undefined): boolean {
  return (left == null && right == null) || (left != null && right != null && Object.is(left, right));
}

/** Deduplicates exact replays and excludes conflicting duplicates for the same immutable run value. */
function deduplicateRunValues(values: HourlyForecastRunValue[]): HourlyForecastRunValue[] {
  const groups = new Map<string, HourlyForecastRunValue[]>();
  for (const value of values) {
    if (!Number.isFinite(value.validTime) || !Number.isFinite(value.availableAt) || !Number.isFinite(value.requestStartedAt)) continue;
    const key = `${forecastSeriesKey(value)}|${value.captureRunId}`;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  const result: HourlyForecastRunValue[] = [];
  for (const duplicates of Array.from(groups.values())) {
    const first = duplicates[0];
    const identical = duplicates.every((item) => item.availableAt === first.availableAt
      && item.requestStartedAt === first.requestStartedAt
      && item.unit === first.unit
      && equalNullableNumber(item.value, first.value));
    if (identical) result.push(first);
  }
  return result;
}

function uniqueSnapshots(snapshots: HourlyPhysicalSnapshot[]): HourlyPhysicalSnapshot[] {
  const groups = new Map<string, HourlyPhysicalSnapshot[]>();
  for (const snapshot of snapshots) {
    if (!Number.isInteger(snapshot.hour) || snapshot.hour < 0 || snapshot.hour > 23 || snapshot.stationCount <= 0) continue;
    const key = `${snapshot.locationKey}|${snapshot.date}|${snapshot.hour}`;
    groups.set(key, [...(groups.get(key) ?? []), snapshot]);
  }
  const result: HourlyPhysicalSnapshot[] = [];
  for (const duplicates of Array.from(groups.values())) {
    const first = duplicates[0];
    const identical = duplicates.every((item) => item.stationCount === first.stationCount
      && item.id === first.id
      && epochMilliseconds(item.collectedAt) === epochMilliseconds(first.collectedAt)
      && equalNullableNumber(item.confidenceScore, first.confidenceScore)
      && jsonSignature(item.stationsUsed) === jsonSignature(first.stationsUsed)
      && (HOURLY_FORECAST_VARIABLES.every((variable) => equalNullableNumber(observationValue(item, variable), observationValue(first, variable)))));
    if (identical) result.push(first);
  }
  return result;
}

function descriptorOf(value: HourlyForecastRunValue): ModelDescriptor {
  return {
    locationKey: value.locationKey,
    targetDate: value.targetDate,
    sourceName: value.sourceName,
    modelName: value.modelName,
    modelId: value.modelId,
  };
}

function latestAdmissibleValue(
  candidates: HourlyForecastRunValue[],
  availableBefore: number,
): HourlyForecastRunValue | null {
  const admissible = candidates.filter((candidate) => candidate.availableAt < availableBefore
    && candidate.value != null && Number.isFinite(candidate.value));
  if (admissible.length === 0) return null;
  admissible.sort((left, right) => right.availableAt - left.availableAt
    || right.requestStartedAt - left.requestStartedAt
    || left.captureRunId.localeCompare(right.captureRunId));
  const latest = admissible[0];
  const tied = admissible.filter((candidate) => candidate.availableAt === latest.availableAt
    && candidate.requestStartedAt === latest.requestStartedAt);
  if (tied.some((candidate) => !equalNullableNumber(candidate.value, latest.value))) return null;
  return latest;
}

function latestAdmissibleRun(
  candidates: HourlyForecastRunValue[],
  availableBefore: number,
): HourlyForecastRunValue | null {
  const admissible = candidates.filter((candidate) => candidate.availableAt < availableBefore);
  if (admissible.length === 0) return null;
  admissible.sort((left, right) => right.availableAt - left.availableAt
    || right.requestStartedAt - left.requestStartedAt
    || left.captureRunId.localeCompare(right.captureRunId));
  const latest = admissible[0];
  const tied = admissible.filter((candidate) => candidate.availableAt === latest.availableAt
    && candidate.requestStartedAt === latest.requestStartedAt);
  if (tied.some((candidate) => !equalNullableNumber(candidate.value, latest.value))) return null;
  return latest;
}

function latestCompatibleRun(
  rows: HourlyForecastRunValue[],
  observationAt: number,
): ForecastRunGroup | null {
  const byRun = new Map<string, ForecastRunGroup>();
  for (const row of rows) {
    if (row.availableAt >= observationAt) continue;
    let run = byRun.get(row.captureRunId);
    if (!run) {
      run = { captureRunId: row.captureRunId, requestStartedAt: row.requestStartedAt, availableAt: row.availableAt, byVariable: new Map() };
      byRun.set(row.captureRunId, run);
    }
    if (row.availableAt !== run.availableAt || row.requestStartedAt !== run.requestStartedAt) continue;
    run.byVariable.set(row.variable, row);
  }
  const candidates = Array.from(byRun.values()).filter((run) => {
    return HOURLY_FORECAST_VARIABLES.some((variable) => {
      const value = run.byVariable.get(variable)?.value;
      return value != null && Number.isFinite(value);
    });
  });
  candidates.sort((left, right) => right.availableAt - left.availableAt
    || right.requestStartedAt - left.requestStartedAt
    || left.captureRunId.localeCompare(right.captureRunId));
  if (candidates.length === 0) return null;
  const latest = candidates[0];
  const tied = candidates.filter((run) => run.availableAt === latest.availableAt && run.requestStartedAt === latest.requestStartedAt);
  if (tied.length > 1) {
    const signature = (run: ForecastRunGroup) => HOURLY_FORECAST_VARIABLES
      .map((variable) => run.byVariable.get(variable)?.value ?? null)
      .join("|");
    if (tied.some((run) => signature(run) !== signature(latest))) return null;
  }
  return latest;
}

function calculateErrors(errors: number[]) {
  if (errors.length === 0) return { mae: null, rmse: null, bias: null };
  return {
    mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length),
    bias: errors.reduce((sum, error) => sum + error, 0) / errors.length,
  };
}

/**
 * Evaluates immutable hourly forecast snapshots against qualified physical observations.
 * A field pair requires absolute measurement times for every station with a positive fieldWeight;
 * availableAt must be strictly before the earliest such measurement and the unchanged validTime.
 * The lead remains validTime - availableAt, and the latest admissible non-missing value is selected.
 */
export function evaluateHourlyForecastRuns(
  snapshotsInput: HourlyPhysicalSnapshot[],
  forecastValuesInput: HourlyForecastRunValue[],
): HourlyForecastRunEvaluation {
  const snapshots = uniqueSnapshots(snapshotsInput);
  const forecastValues = deduplicateRunValues(forecastValuesInput);
  const valuesBySeries = new Map<string, HourlyForecastRunValue[]>();
  const models = new Map<string, ModelDescriptor>();
  for (const value of forecastValues) {
    const descriptor = descriptorOf(value);
    models.set(modelKey(descriptor), descriptor);
    const key = forecastSeriesKey(value);
    valuesBySeries.set(key, [...(valuesBySeries.get(key) ?? []), value]);
  }

  const scores: HourlyForecastRunScore[] = [];
  const exactComparisons: HourlyExactForecastComparison[] = [];
  const exactScoreGroups = new Map<string, {
    score: Omit<HourlyExactForecastRunScore, "sampleSize" | "coverageRatio" | "mae" | "rmse" | "bias" | "scoringValidationVersion">;
    errors: number[];
    validationPassed: boolean;
  }>();
  const latestCompatibleRuns = new Map<string, ForecastRunGroup>();
  const compatibilityForecasts: Array<{
    modelName: string;
    hour: number;
    temperature: number | null;
    precipitation: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    humidity: number | null;
    pressure: number | null;
  }> = [];
  const compatibilitySnapshots: HourlyPhysicalSnapshot[] = [];

  for (const snapshot of snapshots) {
    const observationAt = parisLocalHourToUniqueEpochMs(snapshot.date, snapshot.hour);
    if (observationAt == null) continue;
    const matchingModels = Array.from(models.values()).filter((model) => model.locationKey === snapshot.locationKey && model.targetDate === snapshot.date);
    for (const model of matchingModels) {
      // Index lookup instead of a full scan per snapshot × model: identical rows,
      // but keeps multi-week read-only recomputation linear instead of quadratic.
      const validRows = HOURLY_FORECAST_VARIABLES.flatMap((variable) =>
        valuesBySeries.get(forecastSeriesKey({ ...model, validTime: observationAt, variable })) ?? []);
      const earliestByVariable = new Map<HourlyForecastVariable, number>();
      for (const variable of HOURLY_FORECAST_VARIABLES) {
        const earliest = earliestContributorObservedAt(snapshot, variable);
        if (earliest != null) earliestByVariable.set(variable, earliest);
      }
      const eligibleRows = validRows.filter((row) => {
        const earliest = earliestByVariable.get(row.variable);
        // Preserve a positive forecast lead while requiring the field's own measured observation time.
        return earliest != null && row.availableAt < observationAt && row.availableAt < earliest;
      });
      const compatibleRun = latestCompatibleRun(eligibleRows, observationAt);
      if (!compatibleRun) continue;
      latestCompatibleRuns.set(observationModelKey(snapshot, model), compatibleRun);
      const observed = (variable: HourlyForecastVariable) => earliestByVariable.has(variable)
        ? observationValue(snapshot, variable)
        : null;
      const get = (variable: HourlyForecastVariable) => {
        const value = compatibleRun.byVariable.get(variable)?.value;
        return value != null && Number.isFinite(value) ? value : null;
      };
      const compatibilitySnapshot: HourlyPhysicalSnapshot = {
        ...snapshot,
        temperature: observed("temperature"),
        precipitation: observed("precipitation"),
        windSpeed: observed("wind_speed"),
        windGust: observed("wind_gust"),
        humidity: observed("humidity"),
        pressure: observed("pressure"),
      };
      const compatibilityForecast = {
        modelName: model.modelName,
        hour: snapshot.hour,
        temperature: get("temperature"),
        precipitation: get("precipitation"),
        windSpeed: get("wind_speed"),
        windGusts: get("wind_gust"),
        humidity: get("humidity"),
        pressure: get("pressure"),
      };
      const hasQualifiedPair = HOURLY_FORECAST_VARIABLES.some((variable) =>
        observed(variable) != null && get(variable) != null);
      if (!hasQualifiedPair) continue;
      compatibilityForecasts.push(compatibilityForecast);
      compatibilitySnapshots.push(compatibilitySnapshot);
    }
  }

  for (const model of Array.from(models.values())) {
    const modelSnapshots = snapshots.filter((snapshot) => snapshot.locationKey === model.locationKey && snapshot.date === model.targetDate);
    for (const variable of HOURLY_FORECAST_VARIABLES) {
      const opportunities: ObservationOpportunity[] = modelSnapshots.flatMap((snapshot) => {
        const observedValue = observationValue(snapshot, variable);
        const earliest = earliestContributorObservedAt(snapshot, variable);
        if (observedValue == null || earliest == null) return [];
        return [{ snapshot, validTime: parisLocalHourToUniqueEpochMs(snapshot.date, snapshot.hour), observedValue, earliestContributorObservedAt: earliest }];
      });
      const observedOpportunities = opportunities.filter((opportunity) => opportunity.validTime != null);
      const errorsByHorizon = new Map<string, number[]>();
      const evaluableObservationCountsByHorizon = new Map<string, number>();
      const latestCompatibleValidationByHorizon = new Map<string, boolean>();
      for (const opportunity of observedOpportunities) {
        const compatibleRun = latestCompatibleRuns.get(observationModelKey(opportunity.snapshot, model));
        const validTime = opportunity.validTime!;
        const key = forecastSeriesKey({ ...model, validTime, variable });
        const candidates = valuesBySeries.get(key) ?? [];
        const admissionCutoff = Math.min(validTime, opportunity.earliestContributorObservedAt);
        const selected = latestAdmissibleValue(candidates, admissionCutoff);
        // A recorded exact-time run with a missing variable is an availability
        // opportunity only if it predates both the measurement and the unchanged validTime.
        // Unverifiable station/field metadata was removed before this denominator is built.
        const opportunityRun = selected ?? latestAdmissibleRun(candidates, admissionCutoff);
        if (!opportunityRun) continue;
        const horizonMinutes = (validTime - opportunityRun.availableAt) / 60_000;
        const horizon = getForecastHorizonWindow(horizonMinutes);
        if (!horizon) continue;
        evaluableObservationCountsByHorizon.set(horizon.key, (evaluableObservationCountsByHorizon.get(horizon.key) ?? 0) + 1);
        const horizonMilliseconds = validTime - opportunityRun.availableAt;
        if (!Number.isSafeInteger(horizonMilliseconds) || horizonMilliseconds <= 0) continue;
        const exactKey = [modelKey(model), variable, horizonMilliseconds].join("|");
        let exactGroup = exactScoreGroups.get(exactKey);
        if (!exactGroup) {
          exactGroup = {
            score: {
              locationKey: model.locationKey,
              date: model.targetDate,
              sourceName: model.sourceName,
              modelName: model.modelName,
              modelId: model.modelId,
              variable,
              horizonMilliseconds,
              horizonMinutes,
              horizonBucket: horizon.key,
              observationCount: 0,
              evaluableObservationCount: 0,
            },
            errors: [],
            validationPassed: true,
          };
          exactScoreGroups.set(exactKey, exactGroup);
        }
        exactGroup.score.observationCount += 1;
        exactGroup.score.evaluableObservationCount += 1;
        if (!selected) continue;
        const selectedRunPassedLatestCompatible = compatibleRun != null
          && opportunityRun.captureRunId === compatibleRun.captureRunId;
        exactGroup.validationPassed = exactGroup.validationPassed && selectedRunPassedLatestCompatible;
        const signedError = selected.value! - opportunity.observedValue;
        const errors = errorsByHorizon.get(horizon.key) ?? [];
        errors.push(signedError);
        errorsByHorizon.set(horizon.key, errors);
        latestCompatibleValidationByHorizon.set(
          horizon.key,
          (latestCompatibleValidationByHorizon.get(horizon.key) ?? true) && selectedRunPassedLatestCompatible,
        );
        exactGroup.errors.push(signedError);
        exactComparisons.push({
          forecastRunValueId: Number.isSafeInteger(selected.id) && selected.id! > 0 ? selected.id! : null,
          observationSnapshotId: Number.isSafeInteger(opportunity.snapshot.id) && opportunity.snapshot.id! > 0 ? opportunity.snapshot.id! : null,
          captureRunId: selected.captureRunId,
          locationKey: selected.locationKey,
          sourceName: selected.sourceName,
          modelName: selected.modelName,
          modelId: selected.modelId,
          variable,
          validTime,
          availableAt: selected.availableAt,
          horizonMilliseconds,
          horizonMinutes,
          horizonBucket: horizon.key,
          forecastValue: selected.value!,
          forecastUnit: selected.unit,
          observedValue: opportunity.observedValue,
          observedUnit: observationUnit(variable),
          signedError,
          absoluteError: Math.abs(signedError),
          observationDate: opportunity.snapshot.date,
          observationHour: opportunity.snapshot.hour,
          observationReferenceAt: validTime,
          observationCollectedAt: epochMilliseconds(opportunity.snapshot.collectedAt),
          stationCount: opportunity.snapshot.stationCount,
          confidenceScore: opportunity.snapshot.confidenceScore != null && Number.isFinite(opportunity.snapshot.confidenceScore)
            ? opportunity.snapshot.confidenceScore
            : null,
          stationsUsed: opportunity.snapshot.stationsUsed ?? null,
        });
      }
      for (const horizon of FORECAST_HORIZON_WINDOWS) {
        const errors = errorsByHorizon.get(horizon.key) ?? [];
        const evaluableObservationCount = evaluableObservationCountsByHorizon.get(horizon.key) ?? 0;
        scores.push({
          locationKey: model.locationKey,
          date: model.targetDate,
          sourceName: model.sourceName,
          modelName: model.modelName,
          modelId: model.modelId,
          variable,
          horizonBucket: horizon.key,
          observationCount: opportunities.length,
          // The denominator contains only immutable forecast values from runs before
          // both this field's earliest contributor measurement and the exact validTime.
          // Missing/unverifiable observations and out-of-scope runs never count.
          evaluableObservationCount,
          sampleSize: errors.length,
          coverageRatio: evaluableObservationCount > 0 ? errors.length / evaluableObservationCount : 0,
          ...calculateErrors(errors),
          scoringValidationVersion: errors.length > 0 && latestCompatibleValidationByHorizon.get(horizon.key) === true
            ? HOURLY_SCORING_VALIDATION_VERSION
            : null,
        });
      }
    }
  }

  const serviceNameCounts = new Map<string, number>();
  for (const model of Array.from(models.values())) serviceNameCounts.set(model.modelName, (serviceNameCounts.get(model.modelName) ?? 0) + 1);
  const legacyForecasts = compatibilityForecasts.map((forecast) => ({
    ...forecast,
    modelName: (serviceNameCounts.get(forecast.modelName) ?? 0) > 1 ? `${forecast.modelName} (${forecast.modelName})` : forecast.modelName,
  }));
  const compatibilityScores = scoreQualifiedHourlyModels(compatibilitySnapshots, legacyForecasts);
  const exactScores: HourlyExactForecastRunScore[] = Array.from(exactScoreGroups.values()).map(({ score, errors, validationPassed }) => ({
    ...score,
    sampleSize: errors.length,
    coverageRatio: score.evaluableObservationCount > 0 ? errors.length / score.evaluableObservationCount : 0,
    ...calculateErrors(errors),
    scoringValidationVersion: errors.length > 0 && validationPassed ? HOURLY_SCORING_VALIDATION_VERSION : null,
  })).sort((left, right) => left.modelName.localeCompare(right.modelName)
    || left.variable.localeCompare(right.variable)
    || left.horizonMilliseconds - right.horizonMilliseconds);
  exactComparisons.sort((left, right) => left.modelName.localeCompare(right.modelName)
    || left.variable.localeCompare(right.variable)
    || left.validTime - right.validTime
    || left.availableAt - right.availableAt);

  const diagnostics = createHourlyComparisonDiagnostics("ordinary_hourly", HOURLY_FORECAST_VARIABLES);
  const diagnosticsByVariable = new Map(diagnostics.map((diagnostic) => [diagnostic.variable, diagnostic]));
  const snapshotsBySlot = new Map<string, HourlyPhysicalSnapshot>();
  for (const snapshot of snapshots) {
    const validTime = parisLocalHourToUniqueEpochMs(snapshot.date, snapshot.hour);
    if (validTime != null) snapshotsBySlot.set([snapshot.locationKey, snapshot.date, validTime].join("|"), snapshot);
  }
  const retainedComparisonKeys = new Set(exactComparisons.map((comparison) => [
    comparison.locationKey,
    comparison.observationDate,
    comparison.sourceName,
    comparison.modelName,
    comparison.modelId ?? "",
    comparison.validTime,
    comparison.variable,
    comparison.captureRunId,
  ].join("|")));
  const deduplicatedForecasts = new Set(forecastValues);

  // This is a place/time aggregate comparison. `stationsUsed` supplies only the
  // field-contributor weights and measurement timestamps for qualification.
  for (const forecast of forecastValuesInput) {
    const diagnostic = diagnosticsByVariable.get(forecast.variable);
    if (!diagnostic) continue;
    diagnostic.archivedForecasts += 1;
    if (!Number.isFinite(forecast.validTime) || !Number.isFinite(forecast.availableAt)
      || !Number.isFinite(forecast.requestStartedAt)) {
      recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_METADATA_INVALID");
      continue;
    }
    if (!deduplicatedForecasts.has(forecast)) {
      recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_REPLAY_OR_CONFLICTING_DUPLICATE");
      continue;
    }
    const snapshot = snapshotsBySlot.get([forecast.locationKey, forecast.targetDate, forecast.validTime].join("|"));
    if (!snapshot) {
      recordHourlyComparisonFirstRejection(diagnostic, "NO_MATCHING_LOCATION_VALID_TIME_OBSERVATION");
      continue;
    }
    diagnostic.opportunitiesAtSameLocationAndValidTime += 1;
    const observed = observationValue(snapshot, forecast.variable);
    const earliestMeasurementAt = earliestContributorObservedAt(snapshot, forecast.variable);
    if (observed == null || earliestMeasurementAt == null) {
      recordHourlyComparisonFirstRejection(diagnostic, "NO_QUALIFIED_PHYSICAL_OBSERVATION");
      continue;
    }
    diagnostic.qualifiedPhysicalObservationsPresent += 1;
    if (forecast.availableAt >= forecast.validTime) {
      recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_AVAILABLE_AT_OR_AFTER_VALID_TIME");
      continue;
    }
    if (forecast.availableAt >= earliestMeasurementAt) {
      recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_AVAILABLE_AT_OR_AFTER_MEASUREMENT_TIME");
      continue;
    }
    diagnostic.temporallyAdmissible += 1;
    if (forecast.value == null || !Number.isFinite(forecast.value)) {
      recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_VALUE_MISSING_OR_NONFINITE");
      continue;
    }
    diagnostic.admissiblePairs += 1;

    const selected = latestAdmissibleValue(
      valuesBySeries.get(forecastSeriesKey(forecast)) ?? [],
      Math.min(forecast.validTime, earliestMeasurementAt),
    );
    if (!selected) {
      recordHourlyComparisonFirstRejection(diagnostic, "AMBIGUOUS_ADMISSIBLE_FORECAST_TIE");
      continue;
    }
    if (selected !== forecast) {
      recordHourlyComparisonFirstRejection(diagnostic, "SUPERSEDED_BY_LATER_ADMISSIBLE_FORECAST");
      continue;
    }
    const horizonMilliseconds = forecast.validTime - forecast.availableAt;
    if (!Number.isSafeInteger(horizonMilliseconds) || horizonMilliseconds <= 0
      || !getForecastHorizonWindow(horizonMilliseconds / 60_000)) {
      recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_OUTSIDE_SCORING_HORIZON");
      continue;
    }
    const retainedKey = [
      forecast.locationKey,
      forecast.targetDate,
      forecast.sourceName,
      forecast.modelName,
      forecast.modelId ?? "",
      forecast.validTime,
      forecast.variable,
      forecast.captureRunId,
    ].join("|");
    if (!retainedComparisonKeys.has(retainedKey)) {
      recordHourlyComparisonFirstRejection(diagnostic, "NOT_RETAINED_BY_CURRENT_SCORER");
      continue;
    }
    diagnostic.retainedComparisons += 1;
  }

  return { scores, exactComparisons, exactScores, compatibilityScores, diagnostics };
}
