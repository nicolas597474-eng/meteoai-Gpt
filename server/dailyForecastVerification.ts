import type { InsertDailyForecastObservationComparison, InsertForecastRun, ForecastRun } from "../drizzle/schema";
import { getParisDateAndHour, parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";
import { getStationSourceKind, type StationSource } from "./stationService";
import { buildQualifiedDailyObservation, type PhysicalSnapshot } from "./physicalObservationAggregation";
import { OFFICIAL_HOURLY_MODELS } from "./officialModels";

export const METEOAI_DAILY_FUSION_SERVICE_NAME = "MeteoAI";
export const METEOAI_DAILY_FUSION_MODEL_ID = "meteoai-official-daily-v2";

export type MeteoAIDailyFusionArchiveInput = {
  locationKey: string;
  targetDate: string;
  availableAt: number;
  forecast: {
    tempMax: number | null;
    tempMin: number | null;
    precipitation: number | null;
    windSpeed: number | null;
    windGust?: number | null;
    humidity?: number | null;
    cloudCover?: number | null;
    condition?: string | null;
    coreCalibrationComplete: boolean;
    methodNote?: string;
    weights?: unknown;
    trace?: unknown;
  };
};

/** Build one new immutable forecast_runs row; never reconstruct or backfill past emissions. */
export function buildMeteoAIDailyFusionArchiveRun(input: MeteoAIDailyFusionArchiveInput): InsertForecastRun | null {
  const validDate = nextIsoDate(input.targetDate) != null;
  const availableDate = getParisDateAndHour(input.availableAt)?.date;
  if (!validDate || !availableDate || input.targetDate < availableDate || !Number.isFinite(input.availableAt)) return null;
  const finite = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value : null;
  return {
    locationKey: input.locationKey,
    validDate: input.targetDate,
    serviceName: METEOAI_DAILY_FUSION_SERVICE_NAME,
    provider: "meteoai",
    modelId: METEOAI_DAILY_FUSION_MODEL_ID,
    sourceKind: "service_forecast",
    issuedAt: input.availableAt,
    tempMax: finite(input.forecast.tempMax),
    tempMin: finite(input.forecast.tempMin),
    precipitation: finite(input.forecast.precipitation),
    windSpeed: finite(input.forecast.windSpeed),
    windGust: finite(input.forecast.windGust),
    humidity: finite(input.forecast.humidity),
    cloudCover: finite(input.forecast.cloudCover),
    condition: input.forecast.condition ?? null,
    rawData: {
      archiveKind: "meteoai_daily_fusion",
      fusionVersion: 2,
      availableAt: input.availableAt,
      coreCalibrationComplete: input.forecast.coreCalibrationComplete,
      methodNote: input.forecast.methodNote ?? null,
      weights: input.forecast.weights ?? null,
      trace: input.forecast.trace ?? null,
    } as any,
  };
}

export type ComparisonIssueCode =
  | "no_forecast_runs"
  | "no_qualified_physical_observation"
  | "insufficient_variable_coverage"
  | "physical_station_provenance_missing"
  | "physical_station_measurement_time_missing"
  | "physical_station_measurement_date_mismatch"
  | "forecast_available_after_measurement"
  | "forecast_value_missing"
  | "no_comparable_pairs"
  | "meteoai_fusion_run_missing"
  | "meteoai_fusion_value_unavailable";

export type DailyForecastComparisonIssue = {
  code: ComparisonIssueCode;
  count: number;
  variable?: InsertDailyForecastObservationComparison["variable"];
  modelId?: string;
};

export type DailyForecastVerificationPair = InsertDailyForecastObservationComparison & {
  forecastIssuedAt: number;
  stationEvidence: StationMeasurementEvidence[];
};

export type StationMeasurementEvidence = {
  stationId: string;
  stationName: string;
  source: string;
  snapshotHour: number;
  observedAt: number;
  value: number;
  weight: number | null;
};

export type DailyForecastVerificationGroup = {
  serviceName: string;
  modelId: string;
  variable: InsertDailyForecastObservationComparison["variable"];
  horizonBucket: InsertDailyForecastObservationComparison["horizonBucket"];
  unit: string;
  mae: number;
  rmse: number;
  bias: number;
  pairCount: number;
  evaluatedDays: number;
  validDates: string[];
};

export type DailyForecastVerificationReadModel = {
  status: "available" | "unavailable";
  reason: string | null;
  locationKey: string;
  validDate: string;
  validFromAt: number | null;
  validToAt: number | null;
  timezone: "Europe/Paris";
  availableAtRule: "max(issue time, immutable archive capture time)";
  observationSource: "qualified_physical_stations_only";
  forecastRunCount: number;
  qualifiedSnapshotHours: number;
  pairs: DailyForecastVerificationPair[];
  groups: DailyForecastVerificationGroup[];
  meteoai: {
    status: "available" | "unavailable";
    reason: string | null;
    pairCount: number | null;
    groups: DailyForecastVerificationGroup[];
  };
  issues: DailyForecastComparisonIssue[];
};

const OFFICIAL_MODELS = new Map<string, string>(OFFICIAL_HOURLY_MODELS.map((model) => [model.name, model.modelId]));
const PHYSICAL_VARIABLE_FIELD = {
  temperature_max: "temperature",
  temperature_min: "temperature",
  precipitation_sum: "precipitation",
  wind_speed_max: "windSpeed",
  wind_gust_max: "windGust",
} as const;
const DAILY_VARIABLES = [
  "temperature_max",
  "temperature_min",
  "precipitation_sum",
  "wind_speed_max",
  "wind_gust_max",
] as const satisfies readonly InsertDailyForecastObservationComparison["variable"][];

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function timestamp(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Shared guard for every downstream scorer/reader: archived times and every source station must form the exact physical measurement window. */
export function isComparableDailyForecastObservationPair(
  row: Pick<InsertDailyForecastObservationComparison, "forecastAvailableAt" | "observationWindowStartAt" | "observationWindowEndAt" | "stationEvidence" | "validDate">,
): boolean {
  if (row.forecastAvailableAt == null || row.observationWindowStartAt == null || row.observationWindowEndAt == null
    || row.forecastAvailableAt >= row.observationWindowStartAt
    || row.observationWindowEndAt < row.observationWindowStartAt
    || !Array.isArray(row.stationEvidence) || row.stationEvidence.length === 0) return false;
  const measuredAt: number[] = [];
  for (const item of row.stationEvidence) {
    if (!isRecord(item) || typeof item.stationId !== "string" || typeof item.source !== "string"
      || getStationSourceKind(item.source as StationSource, item.stationId) !== "physical"
      || finite(item.value) == null) return false;
    const observedAt = timestamp(item.observedAt);
    if (observedAt == null || getParisDateAndHour(observedAt)?.date !== row.validDate) return false;
    measuredAt.push(observedAt);
  }
  return Math.min(...measuredAt) === row.observationWindowStartAt
    && Math.max(...measuredAt) === row.observationWindowEndAt;
}

export function getDailyForecastHorizon(issuedAt: number, validDate: string): { bucket: InsertDailyForecastObservationComparison["horizonBucket"]; leadTimeMinutes: number } | null {
  const endOfValidDay = getDailyForecastValidTime(validDate);
  const leadMs = endOfValidDay == null ? NaN : endOfValidDay - issuedAt;
  if (!Number.isFinite(leadMs) || leadMs <= 0) return null;
  const leadHours = leadMs / 3_600_000;
  if (leadHours > 15 * 24) return null;
  const bucket: InsertDailyForecastObservationComparison["horizonBucket"] = leadHours <= 6 ? "0-6h"
    : leadHours <= 24 ? "6-24h"
      : leadHours <= 3 * 24 ? "1-3d"
        : leadHours <= 7 * 24 ? "4-7d"
          : "8-15d";
  return { bucket, leadTimeMinutes: Math.floor(leadMs / 60_000) };
}

/** End-of-day validTime for a daily value, expressed as a unique Paris-local epoch. */
export function getDailyForecastValidTime(validDate: string): number | null {
  const followingDate = nextIsoDate(validDate);
  return followingDate ? parisLocalHourToUniqueEpochMs(followingDate, 0) : null;
}

function supportedRun(run: ForecastRun): boolean {
  if (run.sourceKind === "model_forecast") {
    return OFFICIAL_MODELS.get(run.serviceName) === run.modelId;
  }
  return run.sourceKind === "service_forecast"
    && run.serviceName === METEOAI_DAILY_FUSION_SERVICE_NAME
    && run.provider === "meteoai"
    && run.modelId === METEOAI_DAILY_FUSION_MODEL_ID;
}

function forecastValue(run: ForecastRun, variable: InsertDailyForecastObservationComparison["variable"]): number | null {
  switch (variable) {
    case "temperature_max": return finite(run.tempMax);
    case "temperature_min": return finite(run.tempMin);
    case "precipitation_sum": return finite(run.precipitation);
    case "wind_speed_max": return finite(run.windSpeed);
    case "wind_gust_max": return finite(run.windGust);
  }
}

function observedValue(
  observation: ReturnType<typeof buildQualifiedDailyObservation>,
  variable: InsertDailyForecastObservationComparison["variable"],
): number | null {
  switch (variable) {
    case "temperature_max": return finite(observation.tempMax);
    case "temperature_min": return finite(observation.tempMin);
    case "precipitation_sum": return finite(observation.precipitationSum);
    case "wind_speed_max": return finite(observation.windSpeed);
    case "wind_gust_max": return finite(observation.windGust);
  }
}

function coverageIsQualified(
  observation: ReturnType<typeof buildQualifiedDailyObservation>,
  variable: InsertDailyForecastObservationComparison["variable"],
): boolean {
  if (variable === "temperature_max" || variable === "temperature_min") return observation.isQualified && observation.coverageHours >= 18;
  if (variable === "precipitation_sum") return observation.precipitationCoverageHours === 24;
  if (variable === "wind_speed_max") return observation.windSpeedCoverageHours >= 18;
  return observation.windGustCoverageHours >= 18;
}

function extremeSnapshots(
  snapshots: PhysicalSnapshot[],
  variable: InsertDailyForecastObservationComparison["variable"],
  targetValue: number,
): PhysicalSnapshot[] {
  const field = PHYSICAL_VARIABLE_FIELD[variable];
  const candidates = snapshots.filter((snapshot) => {
    if (snapshot.stationCount < 1 || !Number.isInteger(snapshot.hour) || snapshot.hour < 0 || snapshot.hour > 23) return false;
    if ((variable === "wind_speed_max" || variable === "wind_gust_max") && !Number.isFinite(snapshot.temperature)) return false;
    const value = finite(snapshot[field]);
    return value != null && value === targetValue;
  });
  return candidates;
}

function selectedSnapshotsForVariable(
  snapshots: PhysicalSnapshot[],
  variable: InsertDailyForecastObservationComparison["variable"],
  observation: ReturnType<typeof buildQualifiedDailyObservation>,
): PhysicalSnapshot[] | null {
  const value = observedValue(observation, variable);
  if (value == null || !coverageIsQualified(observation, variable)) return null;
  if (variable === "precipitation_sum") {
    const hourly = snapshots.filter((snapshot) => snapshot.stationCount >= 1
      && Number.isInteger(snapshot.hour) && snapshot.hour >= 0 && snapshot.hour <= 23
      && finite(snapshot.precipitation) != null && finite(snapshot.precipitation)! >= 0);
    const byHour = new Map<number, PhysicalSnapshot>();
    for (const snapshot of hourly) {
      if (byHour.has(snapshot.hour)) return null;
      byHour.set(snapshot.hour, snapshot);
    }
    return byHour.size === 24 ? Array.from(byHour.values()) : null;
  }
  const selected = extremeSnapshots(snapshots, variable, value);
  return selected.length > 0 ? selected : null;
}

function stationEvidenceForSnapshot(
  snapshot: PhysicalSnapshot,
  variable: InsertDailyForecastObservationComparison["variable"],
  validDate: string,
): { evidence: StationMeasurementEvidence[]; reason?: ComparisonIssueCode } {
  if (snapshot.date !== validDate) return { evidence: [], reason: "physical_station_measurement_date_mismatch" };
  if (!Array.isArray(snapshot.stationsUsed) || snapshot.stationsUsed.length < 1 || snapshot.stationsUsed.length !== snapshot.stationCount) {
    return { evidence: [], reason: "physical_station_provenance_missing" };
  }
  const field = PHYSICAL_VARIABLE_FIELD[variable];
  const evidence: StationMeasurementEvidence[] = [];
  for (const raw of snapshot.stationsUsed) {
    if (!isRecord(raw)) return { evidence: [], reason: "physical_station_provenance_missing" };
    const stationId = typeof raw.stationId === "string" ? raw.stationId : "";
    const source = typeof raw.source === "string" ? raw.source : "";
    if (!stationId || getStationSourceKind(source as StationSource, stationId) !== "physical") {
      return { evidence: [], reason: "physical_station_provenance_missing" };
    }
    const stationValue = finite(raw[field]);
    if (stationValue == null) continue;
    const measurementTimes = isRecord(raw.measurementTimes) ? raw.measurementTimes : null;
    const observedAt = timestamp(measurementTimes ? measurementTimes[field] : raw.observedAt);
    if (observedAt == null) return { evidence: [], reason: "physical_station_measurement_time_missing" };
    const measuredParisDate = getParisDateAndHour(observedAt)?.date;
    if (measuredParisDate !== validDate) return { evidence: [], reason: "physical_station_measurement_date_mismatch" };
    evidence.push({
      stationId,
      stationName: typeof raw.name === "string" ? raw.name : stationId,
      source,
      snapshotHour: snapshot.hour,
      observedAt,
      value: stationValue,
      weight: finite(raw.weight),
    });
  }
  if (evidence.length === 0) return { evidence: [], reason: "physical_station_provenance_missing" };
  return { evidence };
}

function stationEvidenceForVariable(
  snapshots: PhysicalSnapshot[],
  variable: InsertDailyForecastObservationComparison["variable"],
  validDate: string,
  observation: ReturnType<typeof buildQualifiedDailyObservation>,
): { evidence: StationMeasurementEvidence[]; reason?: ComparisonIssueCode } {
  const selected = selectedSnapshotsForVariable(snapshots, variable, observation);
  if (!selected) return { evidence: [], reason: "insufficient_variable_coverage" };
  const evidence: StationMeasurementEvidence[] = [];
  for (const snapshot of selected) {
    const result = stationEvidenceForSnapshot(snapshot, variable, validDate);
    if (result.reason) return { evidence: [], reason: result.reason };
    evidence.push(...result.evidence);
  }
  return evidence.length ? { evidence } : { evidence: [], reason: "physical_station_provenance_missing" };
}

function nextIsoDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function variableUnit(variable: InsertDailyForecastObservationComparison["variable"]): string {
  return variable === "temperature_max" || variable === "temperature_min" ? "°C"
    : variable === "precipitation_sum" ? "mm" : "km/h";
}

function aggregatePairs(pairs: DailyForecastVerificationPair[]): DailyForecastVerificationGroup[] {
  const groups = new Map<string, DailyForecastVerificationPair[]>();
  for (const pair of pairs) {
    const key = [pair.serviceName, pair.modelId, pair.variable, pair.horizonBucket].join("\u001f");
    const group = groups.get(key) ?? [];
    group.push(pair);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => {
    const first = group[0];
    const errors = group.map((pair) => pair.signedError);
    const validDates = Array.from(new Set(group.map((pair) => pair.validDate))).sort();
    return {
      serviceName: first.serviceName,
      modelId: first.modelId,
      variable: first.variable,
      horizonBucket: first.horizonBucket,
      unit: variableUnit(first.variable),
      mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
      rmse: Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length),
      bias: errors.reduce((sum, error) => sum + error, 0) / errors.length,
      pairCount: group.length,
      evaluatedDays: validDates.length,
      validDates,
    };
  }).sort((left, right) => left.serviceName.localeCompare(right.serviceName)
    || left.variable.localeCompare(right.variable)
    || left.horizonBucket.localeCompare(right.horizonBucket));
}

export function buildDailyForecastVerificationReadModel(
  locationKey: string,
  validDate: string,
  runs: ForecastRun[],
  snapshots: PhysicalSnapshot[],
): DailyForecastVerificationReadModel {
  const followingDate = nextIsoDate(validDate);
  const validFromAt = parisLocalHourToUniqueEpochMs(validDate, 0);
  const validToAt = followingDate ? parisLocalHourToUniqueEpochMs(followingDate, 0) : null;
  const sameDayRuns = runs.filter((run) => run.locationKey === locationKey && run.validDate === validDate && supportedRun(run));
  const observation = buildQualifiedDailyObservation(snapshots);
  const issues = new Map<string, DailyForecastComparisonIssue>();
  const addIssue = (code: ComparisonIssueCode, variable?: InsertDailyForecastObservationComparison["variable"], modelId?: string) => {
    const key = `${code}:${variable ?? ""}:${modelId ?? ""}`;
    const existing = issues.get(key);
    issues.set(key, { code, ...(variable ? { variable } : {}), ...(modelId ? { modelId } : {}), count: (existing?.count ?? 0) + 1 });
  };
  const pairs: DailyForecastVerificationPair[] = [];

  if (sameDayRuns.length === 0) addIssue("no_forecast_runs");
  if (snapshots.length === 0 || !observation.isQualified) addIssue("no_qualified_physical_observation");

  for (const run of sameDayRuns) {
    const issuedAt = timestamp(run.issuedAt);
    const capturedAt = timestamp(run.capturedAt);
    const availableAt = issuedAt == null || capturedAt == null ? null : Math.max(issuedAt, capturedAt);
    if (availableAt == null) {
      addIssue("forecast_value_missing", undefined, run.modelId ?? undefined);
      continue;
    }
    const horizon = getDailyForecastHorizon(issuedAt!, validDate);
    if (!horizon || run.id == null) continue;
    for (const variable of DAILY_VARIABLES) {
      const forecast = forecastValue(run, variable);
      if (forecast == null) {
        if (run.modelId === METEOAI_DAILY_FUSION_MODEL_ID) addIssue("meteoai_fusion_value_unavailable", variable, run.modelId);
        else addIssue("forecast_value_missing", variable, run.modelId ?? undefined);
        continue;
      }
      const observed = observedValue(observation, variable);
      if (observed == null || !coverageIsQualified(observation, variable)) {
        addIssue(observation.isQualified ? "insufficient_variable_coverage" : "no_qualified_physical_observation", variable, run.modelId ?? undefined);
        continue;
      }
      const stationEvidence = stationEvidenceForVariable(snapshots, variable, validDate, observation);
      if (stationEvidence.reason) {
        addIssue(stationEvidence.reason, variable, run.modelId ?? undefined);
        continue;
      }
      const observationWindowStartAt = Math.min(...stationEvidence.evidence.map((item) => item.observedAt));
      const observationWindowEndAt = Math.max(...stationEvidence.evidence.map((item) => item.observedAt));
      if (!(availableAt < observationWindowStartAt)) {
        addIssue("forecast_available_after_measurement", variable, run.modelId ?? undefined);
        continue;
      }
      const signedError = forecast - observed;
      const evidence = stationEvidence.evidence;
      pairs.push({
        comparisonKey: `${run.id}:${variable}`,
        forecastRunId: run.id,
        locationKey,
        validDate,
        serviceName: run.serviceName,
        provider: run.provider,
        modelId: run.modelId!,
        horizonBucket: horizon.bucket,
        leadTimeMinutes: horizon.leadTimeMinutes,
        variable,
        forecastValue: forecast,
        observedValue: observed,
        signedError,
        absoluteError: Math.abs(signedError),
        evidenceType: "physical_observation",
        observationIsQualified: 1,
        observationCoverageHours: variable === "temperature_max" || variable === "temperature_min"
          ? observation.coverageHours
          : variable === "precipitation_sum" ? observation.precipitationCoverageHours
            : variable === "wind_speed_max" ? observation.windSpeedCoverageHours : observation.windGustCoverageHours,
        forecastAvailableAt: availableAt,
        observationWindowStartAt,
        observationWindowEndAt,
        stationEvidence: evidence as any,
        forecastIssuedAt: issuedAt!,
      });
    }
  }

  const groups = aggregatePairs(pairs);
  const meteoaiPairs = pairs.filter((pair) => pair.modelId === METEOAI_DAILY_FUSION_MODEL_ID);
  const meteoaiGroups = aggregatePairs(meteoaiPairs);
  const meteoaiRuns = sameDayRuns.filter((run) => run.modelId === METEOAI_DAILY_FUSION_MODEL_ID);
  const hasStationTimestamp = snapshots.some((snapshot) => Array.isArray(snapshot.stationsUsed)
    && snapshot.stationsUsed.some((station: unknown) => isRecord(station)
      && (timestamp(station.observedAt) != null
        || (isRecord(station.measurementTimes) && Object.values(station.measurementTimes).some((value) => timestamp(value) != null)))));
  if (meteoaiRuns.length === 0) addIssue("meteoai_fusion_run_missing");

  let reason: string | null = null;
  if (pairs.length === 0) {
    if (snapshots.length === 0) reason = "Aucun snapshot d’observation physique qualifiée n’est archivé pour cette date.";
    else if (!observation.isQualified) reason = observation.reason;
    else if (!hasStationTimestamp) reason = "L’heure réelle de mesure par station n’est pas présente dans les snapshots archivés; seules les nouvelles observations horodatées peuvent être appariées.";
    else if (Array.from(issues.values()).some((issue) => issue.code === "forecast_available_after_measurement")) reason = "Aucune prévision admissible : les émissions archivées sont postérieures ou simultanées à au moins une mesure physique utilisée.";
    else if (sameDayRuns.length === 0) reason = "Aucune prévision immuable admissible n’est archivée pour cette date de validité.";
    else reason = "Aucune paire complète ne satisfait simultanément la variable, la couverture physique, l’horizon et l’antériorité de la prévision.";
  }
  const meteoaiHasLatePair = Array.from(issues.values()).some((issue) => issue.modelId === METEOAI_DAILY_FUSION_MODEL_ID && issue.code === "forecast_available_after_measurement");
  const meteoaiReason = meteoaiPairs.length > 0 ? null
    : meteoaiRuns.length === 0 ? "Aucune sortie fusionnée MeteoAI immuable n’est archivée pour cette date; aucun historique n’a été recréé."
      : !hasStationTimestamp ? "Horodatages individuels des mesures physiques absents; attente de nouveaux snapshots stationnels."
        : meteoaiHasLatePair ? "La sortie MeteoAI n’était pas disponible avant les mesures physiques comparées."
          : "La sortie fusionnée ou les observations qualifiées ne couvrent pas de variable comparable.";

  return {
    status: pairs.length > 0 ? "available" : "unavailable",
    reason,
    locationKey,
    validDate,
    validFromAt,
    validToAt,
    timezone: "Europe/Paris",
    availableAtRule: "max(issue time, immutable archive capture time)",
    observationSource: "qualified_physical_stations_only",
    forecastRunCount: sameDayRuns.length,
    qualifiedSnapshotHours: new Set(snapshots.filter((snapshot) => snapshot.date === validDate
      && snapshot.stationCount > 0 && Number.isInteger(snapshot.hour) && snapshot.hour >= 0 && snapshot.hour < 24).map((snapshot) => snapshot.hour)).size,
    pairs,
    groups,
    meteoai: {
      status: meteoaiPairs.length > 0 ? "available" : "unavailable",
      reason: meteoaiReason,
      pairCount: meteoaiPairs.length > 0 ? meteoaiPairs.length : null,
      groups: meteoaiGroups,
    },
    issues: Array.from(issues.values()),
  };
}
