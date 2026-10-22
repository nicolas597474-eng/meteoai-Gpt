import { getParisDateAndHour, parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";
import { HOURLY_FORECAST_VARIABLES } from "./forecastVariableCoverage";
import { normalizeHourlySourceValue, parseHourlyTimestampSeconds } from "./hourlyValueNormalization";
import { SINGLE_RUN_MODEL_IDS, COMPOSITE_METADATA_IDS, COMPOSITE_METADATA_LOCATION } from "./providerRunCapabilities";
import { resolveCompositeRunMetadata } from "./providerRunMetadata";
import {
  createHourlyComparisonDiagnostics,
  recordHourlyComparisonFirstRejection,
  type HourlyComparisonDiagnostic,
} from "./hourlyComparisonDiagnostics";

export { DIRECT_SINGLE_RUN_METADATA_MODEL_IDS } from "./providerRunCapabilities";

export const SINGLE_RUN_API_URL = "https://single-runs-api.open-meteo.com/v1/forecast";
export const OPEN_METEO_MODEL_METADATA_BASE = "https://api.open-meteo.com/data";
export const SINGLE_RUN_AVAILABILITY_SAFETY_DELAY_MS = 10 * 60_000;
export const SINGLE_RUN_CAPTURE_FORECAST_DAYS = 2;

const PROVIDER_RUN_VARIABLES = [
 ...HOURLY_FORECAST_VARIABLES.filter(variable=>["temperature","precipitation","wind_speed","wind_gust","humidity","surface_pressure","rain","showers","snowfall"].includes(variable.key)),
 {...HOURLY_FORECAST_VARIABLES.find(variable=>variable.key==='surface_pressure')!,key:'pressure_msl',apiKey:'pressure_msl',label:'Pression réduite au niveau de la mer'},
];

export type ProviderModelMetadata = {
  metadataPublicationBasis?: 'component_upper_bound';
  last_run_initialisation_time?: unknown;
  last_run_availability_time?: unknown;
  update_interval_seconds?: unknown;
  data_end_time?: unknown;
  components?: Array<{modelId: string; metadata: ProviderModelMetadata}>;
};

export type ProviderRunSelectionStatus =
  | "unmapped_model_id"
  | "metadata_invalid"
  | "metadata_stale"
  | "availability_wait"
  | "run_timestamp_not_minute_aligned"
  | "selected";

export type ProviderRunSelection = {
  metadataPublicationBasis?: 'component_upper_bound';
  status: ProviderRunSelectionStatus;
  providerRunAt: number | null;
  metadataAvailableAt: number | null;
  metadataUrl: string | null;
  runParameter: string | null;
  reasonCode: string | null;
};

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function metadataSecondsToMilliseconds(value: unknown): number | null {
  const seconds = positiveNumber(value);
  return seconds == null || !Number.isSafeInteger(seconds) ? null : seconds * 1000;
}
export function singleRunMetadataUrl(modelId: string): string {
  return `${OPEN_METEO_MODEL_METADATA_BASE}/${encodeURIComponent(modelId)}/static/meta.json`;
}
function selectedRunParameter(providerRunAt: number): string | null {
  if (!Number.isSafeInteger(providerRunAt) || providerRunAt % 60_000 !== 0) return null;
  return new Date(providerRunAt).toISOString().slice(0, 16);
}

/** Resolve only a recent provider cycle whose public availability is older than the documented safety delay. */
export function resolveProviderRunSelection(input: {
  modelName: string;
  modelId: string | null;
  metadata: ProviderModelMetadata | null;
  now: number;
  locationKey?: string;
}): ProviderRunSelection {
  const configuredModelId = SINGLE_RUN_MODEL_IDS[input.modelName as keyof typeof SINGLE_RUN_MODEL_IDS];
  if (!configuredModelId || configuredModelId !== input.modelId) {
    return { status: "unmapped_model_id", providerRunAt: null, metadataAvailableAt: null, metadataUrl: null, runParameter: null, reasonCode: "official_metadata_id_unmapped" };
  }
  const composite = COMPOSITE_METADATA_IDS[configuredModelId];
  if (composite && input.locationKey !== COMPOSITE_METADATA_LOCATION) {
    return {status: "unmapped_model_id", providerRunAt: null, metadataAvailableAt: null, metadataUrl: null, runParameter: null, reasonCode: "composite_location_not_verified"};
  }
  const resolved = composite ? resolveCompositeRunMetadata(configuredModelId, input.metadata, input.now) : null;
  if (resolved && !resolved.metadata) {
    return {status: "metadata_invalid", providerRunAt: null, metadataAvailableAt: null, metadataUrl: singleRunMetadataUrl(composite[0]), runParameter: null, reasonCode: resolved.reasonCode};
  }
  const metadata = resolved?.metadata ?? input.metadata;
  const providerRunAt = metadataSecondsToMilliseconds(metadata?.last_run_initialisation_time);
  const metadataAvailableAt = metadataSecondsToMilliseconds(metadata?.last_run_availability_time);
  const updateIntervalSeconds = positiveNumber(metadata?.update_interval_seconds);
  if (providerRunAt == null || metadataAvailableAt == null || updateIntervalSeconds == null
    || !Number.isSafeInteger(input.now) || providerRunAt > metadataAvailableAt || metadataAvailableAt > input.now) {
    return { status: "metadata_invalid", providerRunAt: null, metadataAvailableAt, metadataUrl: singleRunMetadataUrl(composite?.[0] ?? configuredModelId), runParameter: null, reasonCode: "official_metadata_missing_or_inconsistent" };
  }
  if (providerRunAt % 60_000 !== 0) {
    return { status: "run_timestamp_not_minute_aligned", providerRunAt: null, metadataAvailableAt, metadataUrl: singleRunMetadataUrl(composite?.[0] ?? configuredModelId), runParameter: null, reasonCode: "provider_run_not_minute_aligned" };
  }
  const maxAgeMs = updateIntervalSeconds * 2_000;
  if (input.now - metadataAvailableAt > maxAgeMs) {
    return { status: "metadata_stale", providerRunAt: null, metadataAvailableAt, metadataUrl: singleRunMetadataUrl(composite?.[0] ?? configuredModelId), runParameter: null, reasonCode: "official_metadata_older_than_two_update_intervals" };
  }
  if (input.now < metadataAvailableAt + SINGLE_RUN_AVAILABILITY_SAFETY_DELAY_MS) {
    return { status: "availability_wait", providerRunAt: null, metadataAvailableAt, metadataUrl: singleRunMetadataUrl(composite?.[0] ?? configuredModelId), runParameter: null, reasonCode: "documented_ten_minute_replication_wait" };
  }
  const runParameter = selectedRunParameter(providerRunAt);
  if (!runParameter || Date.parse(`${runParameter}:00.000Z`) !== providerRunAt) {
    return { status: "run_timestamp_not_minute_aligned", providerRunAt: null, metadataAvailableAt, metadataUrl: singleRunMetadataUrl(composite?.[0] ?? configuredModelId), runParameter: null, reasonCode: "provider_run_not_minute_aligned" };
  }
  return { status: "selected", providerRunAt, metadataAvailableAt, metadataUrl: singleRunMetadataUrl(composite?.[0] ?? configuredModelId), runParameter, reasonCode: null,
    ...(metadata?.metadataPublicationBasis ? {metadataPublicationBasis: metadata.metadataPublicationBasis} : {}) };
}

/** Exact request URL; `models` is the unchanged ID already used by Forecast. */
export function buildSingleRunRequestUrl(input: {
  modelName: string;
  modelId: string;
  latitude: number;
  longitude: number;
  providerRunAt: number;
}): string {
  const officialId = SINGLE_RUN_MODEL_IDS[input.modelName as keyof typeof SINGLE_RUN_MODEL_IDS];
  if (!officialId || officialId !== input.modelId) throw new Error("Single Runs is not enabled for this exact model ID.");
  if (COMPOSITE_METADATA_IDS[input.modelId] && (input.latitude !== 50.7567 || input.longitude !== 2.5204)) throw new Error("Composite Single Runs location is not verified.");
  const run = selectedRunParameter(input.providerRunAt);
  if (!run || !Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90
    || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw new Error("Single Runs request has invalid coordinates or run time.");
  }
  const url = new URL(SINGLE_RUN_API_URL);
  url.searchParams.set("latitude", String(input.latitude));
  url.searchParams.set("longitude", String(input.longitude));
  url.searchParams.set("hourly", PROVIDER_RUN_VARIABLES.map((variable) => variable.apiKey).join(","));
  url.searchParams.set("models", input.modelId);
  url.searchParams.set("run", run);
  url.searchParams.set("forecast_days", String(SINGLE_RUN_CAPTURE_FORECAST_DAYS));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("timeformat", "unixtime");
  return url.toString();
}

export type ProviderRunCaptureAttempt = {
  metadataPublicationBasis?: 'component_upper_bound';
  captureRunId: string;
  locationKey: string;
  targetDate: string;
  modelName: string;
  modelId: string;
  status: string;
  reasonCode: string | null;
  metadataHttpStatus: number | null;
  metadataUrl: string | null;
  metadataAvailableAt: number | null;
  providerRunAt: number | null;
  requestStartedAt: number | null;
  availableAt: number | null;
  collectionLatencyMilliseconds: number | null;
  requestUrl: string | null;
  responseStatus: number | null;
  responsePayload: unknown | null;
  valuesStored: number;
  minimumForecastLeadMilliseconds: number | null;
  maximumForecastLeadMilliseconds: number | null;
};

export type ProviderRunForecastValue = {
  metadataPublicationBasis?: 'component_upper_bound';
  id?: number;
  captureRunId: string;
  locationKey: string;
  targetDate: string;
  modelName: string;
  modelId: string;
  metadataAvailableAt: number;
  providerRunAt: number;
  requestStartedAt: number;
  availableAt: number;
  validTime: number;
  forecastLeadTimeMilliseconds: number;
  collectionLatencyMilliseconds: number;
  variable: string;
  value: number | null;
  unit: string | null;
};

/** Convert only future valid times; missing hourly values are archived as explicit nulls. */
export function parseProviderRunHourlyResponse(input: {
  metadataPublicationBasis?: 'component_upper_bound';
  responseData: unknown;
  captureRunId: string;
  locationKey: string;
  modelName: string;
  modelId: string;
  metadataAvailableAt: number;
  providerRunAt: number;
  requestStartedAt: number;
  availableAt: number;
}): { values: ProviderRunForecastValue[]; nonNullValueCount: number; responsePayload: unknown | null } {
  const data = input.responseData;
  if (!data || typeof data !== "object") return { values: [], nonNullValueCount: 0, responsePayload: null };
  const record = data as { hourly?: unknown; hourly_units?: unknown };
  if (!record.hourly || typeof record.hourly !== "object") return { values: [], nonNullValueCount: 0, responsePayload: null };
  const hourly = record.hourly as Record<string, unknown>;
  const units = record.hourly_units && typeof record.hourly_units === "object" ? record.hourly_units as Record<string, unknown> : {};
  const rawTimes = hourly.time;
  if (!Array.isArray(rawTimes)) return { values: [], nonNullValueCount: 0, responsePayload: null };
  const values: ProviderRunForecastValue[] = [];
  let nonNullValueCount = 0;
  const seenValidTimes = new Set<number>();
  const projectedHourly: Record<string, unknown> = { time: [] as unknown[] };
  for (const variable of PROVIDER_RUN_VARIABLES) {
    if (Array.isArray(hourly[variable.apiKey])) projectedHourly[variable.apiKey] = [] as unknown[];
  }
  for (let timeIndex = 0; timeIndex < rawTimes.length; timeIndex++) {
    const seconds = parseHourlyTimestampSeconds(rawTimes[timeIndex]);
    if (seconds == null) continue;
    const validTime = seconds * 1000;
    // Single Runs may return past portions of an old cycle; they are never archived as future forecasts.
    if (!Number.isSafeInteger(validTime) || validTime <= input.availableAt || validTime <= input.providerRunAt) continue;
    if (seenValidTimes.has(validTime)) continue;
    const parisTime = getParisDateAndHour(validTime);
    if (!parisTime) continue;
    seenValidTimes.add(validTime);
    (projectedHourly.time as unknown[]).push(rawTimes[timeIndex]);
    for (const variable of PROVIDER_RUN_VARIABLES) {
      const series = hourly[variable.apiKey];
      const rawValue = Array.isArray(series) && timeIndex < series.length ? series[timeIndex] : undefined;
      const projectedSeries = projectedHourly[variable.apiKey];
      if (Array.isArray(projectedSeries)) projectedSeries.push(rawValue ?? null);
      const normalized = normalizeHourlySourceValue({ variable: variable.key==='pressure_msl'?'surface_pressure':variable.key, value: rawValue, unit: units[variable.apiKey] });
      const scoringVariable = variable.key === "surface_pressure" ? "pressure" : variable.key;
      if (normalized.value != null) nonNullValueCount++;
      const collectionLatencyMilliseconds = input.availableAt - input.providerRunAt;
      values.push({
        ...(input.metadataPublicationBasis ? {metadataPublicationBasis: input.metadataPublicationBasis} : {}),
        captureRunId: input.captureRunId,
        locationKey: input.locationKey,
        targetDate: parisTime.date,
        modelName: input.modelName,
        modelId: input.modelId,
        metadataAvailableAt: input.metadataAvailableAt,
        providerRunAt: input.providerRunAt,
        requestStartedAt: input.requestStartedAt,
        availableAt: input.availableAt,
        validTime,
        forecastLeadTimeMilliseconds: validTime - input.providerRunAt,
        collectionLatencyMilliseconds,
        variable: scoringVariable,
        value: normalized.value,
        unit: normalized.canonicalUnit,
      });
    }
  }
  const responsePayload = { ...(data as Record<string, unknown>), hourly: projectedHourly };
  return { values, nonNullValueCount, responsePayload };
}

export type ProviderRunPhysicalSnapshot = {
  id?: number | null;
  locationKey: string;
  date: string;
  hour: number;
  stationCount: number;
  temperature: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  collectedAt?: Date | string | number | null;
  confidenceScore?: number | null;
  stationsUsed?: unknown;
};

export type ProviderRunComparison = {
  forecastRunValueId: number | null;
  observationSnapshotId: number | null;
  captureRunId: string;
  locationKey: string;
  modelName: string;
  modelId: string;
  leadBasis: "provider_run";
  variable: string;
  providerRunAt: number;
  metadataAvailableAt: number;
  requestStartedAt: number;
  availableAt: number;
  validTime: number;
  forecastLeadTimeMilliseconds: number;
  forecastLeadTimeMinutes: number;
  collectionLatencyMilliseconds: number;
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
export type ProviderRunScore = {
  locationKey: string;
  date: string;
  modelName: string;
  modelId: string;
  leadBasis: "provider_run";
  variable: string;
  forecastLeadTimeMilliseconds: number;
  forecastLeadTimeMinutes: number;
  observationCount: number;
  evaluableObservationCount: number;
  sampleSize: number;
  coverageRatio: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
};
export type ProviderRunEvaluation = {
  comparisons: ProviderRunComparison[];
  scores: ProviderRunScore[];
  diagnostics: HourlyComparisonDiagnostic[];
};

const PROVIDER_RUN_SCORING_VARIABLES = ["temperature", "precipitation", "wind_speed", "wind_gust", "humidity", "pressure"] as const;

function observedValue(snapshot: ProviderRunPhysicalSnapshot, variable: string): number | null {
  const value = ({
    temperature: snapshot.temperature,
    precipitation: snapshot.precipitation,
    wind_speed: snapshot.windSpeed,
    wind_gust: snapshot.windGust,
    humidity: snapshot.humidity,
    pressure: snapshot.pressure,
  } as Record<string, number | null | undefined>)[variable];
  return value != null && Number.isFinite(value) ? value : null;
}
function epochMilliseconds(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
export function structurallyValidProviderRunValue(value: ProviderRunForecastValue): boolean {
  const officialModelId = SINGLE_RUN_MODEL_IDS[value.modelName as keyof typeof SINGLE_RUN_MODEL_IDS];
  const supportedVariable = ["temperature", "precipitation", "wind_speed", "wind_gust", "humidity", "pressure", "pressure_msl", "rain", "showers", "snowfall"].includes(value.variable);
  return officialModelId === value.modelId && supportedVariable
    && (value.metadataPublicationBasis === undefined || value.metadataPublicationBasis === 'component_upper_bound' && value.modelName === 'UKMET')
    && (!(["GFS", "GEM"].includes(value.modelName)) || value.locationKey === COMPOSITE_METADATA_LOCATION)
    && Number.isSafeInteger(value.providerRunAt) && Number.isSafeInteger(value.metadataAvailableAt)
    && Number.isSafeInteger(value.requestStartedAt) && Number.isSafeInteger(value.availableAt)
    && Number.isSafeInteger(value.validTime) && Number.isSafeInteger(value.forecastLeadTimeMilliseconds)
    && Number.isSafeInteger(value.collectionLatencyMilliseconds)
    && value.providerRunAt <= value.metadataAvailableAt
    && value.metadataAvailableAt + SINGLE_RUN_AVAILABILITY_SAFETY_DELAY_MS <= value.requestStartedAt
    && value.providerRunAt <= value.requestStartedAt && value.requestStartedAt <= value.availableAt
    && value.validTime > value.availableAt
    && value.validTime > value.providerRunAt
    && value.forecastLeadTimeMilliseconds === value.validTime - value.providerRunAt
    && value.collectionLatencyMilliseconds === value.availableAt - value.providerRunAt;
}
function validProviderRunValue(value: ProviderRunForecastValue, observationAt: number): boolean {
  return structurallyValidProviderRunValue(value) && value.availableAt < observationAt;
}
function groupKey(value: ProviderRunForecastValue): string {
  return [value.locationKey, value.targetDate, value.modelName, value.modelId, value.validTime, value.variable, value.providerRunAt].join("|");
}
function identicalForecast(left: ProviderRunForecastValue, right: ProviderRunForecastValue): boolean {
  return left.value === right.value && left.unit === right.unit
    && left.metadataAvailableAt === right.metadataAvailableAt
    && left.forecastLeadTimeMilliseconds === right.forecastLeadTimeMilliseconds;
}
function deduplicateProviderRunValues(values: ProviderRunForecastValue[]): ProviderRunForecastValue[] {
  const groups = new Map<string, ProviderRunForecastValue[]>();
  for (const value of values) {
    if (!structurallyValidProviderRunValue(value)) continue;
    groups.set(groupKey(value), [...(groups.get(groupKey(value)) ?? []), value]);
  }
  const result: ProviderRunForecastValue[] = [];
  for (const group of Array.from(groups.values())) {
    const first = group[0];
    if (!group.every((candidate) => identicalForecast(first, candidate))) continue;
    group.sort((left, right) => left.availableAt - right.availableAt || left.requestStartedAt - right.requestStartedAt || left.captureRunId.localeCompare(right.captureRunId));
    result.push(group[0]);
  }
  return result;
}
function observationUnit(variable: string): string {
  switch (variable) {
    case "temperature": return "°C";
    case "precipitation": return "mm";
    case "wind_speed":
    case "wind_gust": return "km/h";
    case "humidity": return "%";
    default: return "hPa";
  }
}

/** Scores every unique, exact model run separately; availabilityAt remains the strict anti-leak cutoff. */
export function evaluateProviderRunForecasts(
  snapshotsInput: ProviderRunPhysicalSnapshot[],
  valuesInput: ProviderRunForecastValue[],
): ProviderRunEvaluation {
  const values = deduplicateProviderRunValues(valuesInput);
  const valuesByObservedSlot = new Map<string, ProviderRunForecastValue[]>();
  for (const value of values) {
    const key = [value.locationKey, value.targetDate, value.validTime, value.variable].join("|");
    valuesByObservedSlot.set(key, [...(valuesByObservedSlot.get(key) ?? []), value]);
  }
  const comparisons: ProviderRunComparison[] = [];
  const observationCounts = new Map<string, number>();
  const groups = new Map<string, {
    locationKey: string; date: string; modelName: string; modelId: string; variable: string;
    forecastLeadTimeMilliseconds: number; forecastLeadTimeMinutes: number;
    observationCount: number; evaluableObservationCount: number; errors: number[];
  }>();
  const snapshots = snapshotsInput.filter((snapshot) => snapshot.stationCount > 0);
  for (const snapshot of snapshots) {
    const validTime = parisLocalHourToUniqueEpochMs(snapshot.date, snapshot.hour);
    if (validTime == null) continue;
    for (const variable of ["temperature", "precipitation", "wind_speed", "wind_gust", "humidity", "pressure"]) {
      const observation = observedValue(snapshot, variable);
      if (observation == null) continue;
      const observationKey = [snapshot.locationKey, snapshot.date, variable].join("|");
      observationCounts.set(observationKey, (observationCounts.get(observationKey) ?? 0) + 1);
      const candidates = (valuesByObservedSlot.get([snapshot.locationKey, snapshot.date, validTime, variable].join("|")) ?? [])
        .filter((value) => validProviderRunValue(value, validTime));
      const byLead = new Map<string, ProviderRunForecastValue[]>();
      for (const candidate of candidates) {
        const groupKeyValue = [candidate.modelName, candidate.modelId, candidate.providerRunAt, candidate.forecastLeadTimeMilliseconds].join("|");
        byLead.set(groupKeyValue, [...(byLead.get(groupKeyValue) ?? []), candidate]);
      }
      for (const candidateGroup of Array.from(byLead.values())) {
        const candidate = candidateGroup[0];
        const scoreKey = [snapshot.locationKey, snapshot.date, candidate.modelName, candidate.modelId, variable, candidate.forecastLeadTimeMilliseconds].join("|");
        let score = groups.get(scoreKey);
        if (!score) {
          score = {
            locationKey: snapshot.locationKey,
            date: snapshot.date,
            modelName: candidate.modelName,
            modelId: candidate.modelId,
            variable,
            forecastLeadTimeMilliseconds: candidate.forecastLeadTimeMilliseconds,
            forecastLeadTimeMinutes: candidate.forecastLeadTimeMilliseconds / 60_000,
            observationCount: observationCounts.get([snapshot.locationKey, snapshot.date, variable].join("|")) ?? 0,
            evaluableObservationCount: 0,
            errors: [],
          };
          groups.set(scoreKey, score);
        }
        score.evaluableObservationCount++;
        if (candidate.value == null || !Number.isFinite(candidate.value)) continue;
        const signedError = candidate.value - observation;
        score.errors.push(signedError);
        comparisons.push({
          forecastRunValueId: Number.isSafeInteger(candidate.id) && candidate.id! > 0 ? candidate.id! : null,
          observationSnapshotId: Number.isSafeInteger(snapshot.id) && snapshot.id! > 0 ? snapshot.id! : null,
          captureRunId: candidate.captureRunId,
          locationKey: candidate.locationKey,
          modelName: candidate.modelName,
          modelId: candidate.modelId,
          leadBasis: "provider_run",
          variable,
          providerRunAt: candidate.providerRunAt,
          metadataAvailableAt: candidate.metadataAvailableAt,
          requestStartedAt: candidate.requestStartedAt,
          availableAt: candidate.availableAt,
          validTime,
          forecastLeadTimeMilliseconds: candidate.forecastLeadTimeMilliseconds,
          forecastLeadTimeMinutes: candidate.forecastLeadTimeMilliseconds / 60_000,
          collectionLatencyMilliseconds: candidate.collectionLatencyMilliseconds,
          forecastValue: candidate.value,
          forecastUnit: candidate.unit,
          observedValue: observation,
          observedUnit: observationUnit(variable),
          signedError,
          absoluteError: Math.abs(signedError),
          observationDate: snapshot.date,
          observationHour: snapshot.hour,
          observationReferenceAt: validTime,
          observationCollectedAt: epochMilliseconds(snapshot.collectedAt),
          stationCount: snapshot.stationCount,
          confidenceScore: snapshot.confidenceScore != null && Number.isFinite(snapshot.confidenceScore) ? snapshot.confidenceScore : null,
          stationsUsed: snapshot.stationsUsed ?? null,
        });
      }
    }
  }
  const scores: ProviderRunScore[] = Array.from(groups.values()).map((score) => {
    const errors = score.errors;
    const totalObserved = observationCounts.get([score.locationKey, score.date, score.variable].join("|")) ?? 0;
    return {
      locationKey: score.locationKey,
      date: score.date,
      modelName: score.modelName,
      modelId: score.modelId,
      leadBasis: "provider_run" as const,
      variable: score.variable,
      forecastLeadTimeMilliseconds: score.forecastLeadTimeMilliseconds,
      forecastLeadTimeMinutes: score.forecastLeadTimeMinutes,
      observationCount: totalObserved,
      evaluableObservationCount: score.evaluableObservationCount,
      sampleSize: errors.length,
      coverageRatio: score.evaluableObservationCount > 0 ? errors.length / score.evaluableObservationCount : 0,
      mae: errors.length > 0 ? errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length : null,
      rmse: errors.length > 0 ? Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length) : null,
      bias: errors.length > 0 ? errors.reduce((sum, error) => sum + error, 0) / errors.length : null,
    };
  }).sort((left, right) => left.modelName.localeCompare(right.modelName)
    || left.variable.localeCompare(right.variable)
    || left.forecastLeadTimeMilliseconds - right.forecastLeadTimeMilliseconds);
  comparisons.sort((left, right) => left.modelName.localeCompare(right.modelName)
    || left.variable.localeCompare(right.variable)
    || left.validTime - right.validTime
    || left.providerRunAt - right.providerRunAt);

  const diagnostics = createHourlyComparisonDiagnostics("single_runs", PROVIDER_RUN_SCORING_VARIABLES);
  const diagnosticsByVariable = new Map(diagnostics.map((diagnostic) => [diagnostic.variable, diagnostic]));
  const snapshotsBySlot = new Map<string, ProviderRunPhysicalSnapshot[]>();
  for (const snapshot of snapshots) {
    const validTime = parisLocalHourToUniqueEpochMs(snapshot.date, snapshot.hour);
    if (validTime == null) continue;
    const key = [snapshot.locationKey, snapshot.date, validTime].join("|");
    snapshotsBySlot.set(key, [...(snapshotsBySlot.get(key) ?? []), snapshot]);
  }
  const retainedComparisonKeys = new Set(comparisons.map((comparison) => [
    comparison.captureRunId,
    comparison.locationKey,
    comparison.modelName,
    comparison.modelId,
    comparison.variable,
    comparison.validTime,
    comparison.providerRunAt,
    comparison.observationDate,
    comparison.observationHour,
    comparison.observationSnapshotId ?? "",
  ].join("|")));
  const deduplicatedValues = new Set(values);

  // Single Runs carries provider-run, metadata-publication, request and receipt
  // times. It deliberately does not borrow the ordinary path's station-field cutoff.
  for (const forecast of valuesInput) {
    const diagnostic = diagnosticsByVariable.get(forecast.variable);
    if (!diagnostic) continue;
    diagnostic.archivedForecasts += 1;
    if (!structurallyValidProviderRunValue(forecast)) {
      const isLateForValidTime = Number.isSafeInteger(forecast.availableAt)
        && Number.isSafeInteger(forecast.validTime)
        && forecast.availableAt >= forecast.validTime;
      recordHourlyComparisonFirstRejection(
        diagnostic,
        isLateForValidTime ? "FORECAST_AVAILABLE_AT_OR_AFTER_VALID_TIME" : "FORECAST_METADATA_INVALID",
      );
      continue;
    }
    if (!deduplicatedValues.has(forecast)) {
      recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_REPLAY_OR_CONFLICTING_DUPLICATE");
      continue;
    }
    const matchingSnapshots = snapshotsBySlot.get([
      forecast.locationKey,
      forecast.targetDate,
      forecast.validTime,
    ].join("|")) ?? [];
    if (matchingSnapshots.length === 0) {
      recordHourlyComparisonFirstRejection(diagnostic, "NO_MATCHING_LOCATION_VALID_TIME_OBSERVATION");
      continue;
    }

    for (const snapshot of matchingSnapshots) {
      diagnostic.opportunitiesAtSameLocationAndValidTime += 1;
      const observation = observedValue(snapshot, forecast.variable);
      if (snapshot.stationCount <= 0 || observation == null) {
        recordHourlyComparisonFirstRejection(diagnostic, "NO_QUALIFIED_PHYSICAL_OBSERVATION");
        continue;
      }
      diagnostic.qualifiedPhysicalObservationsPresent += 1;
      if (!validProviderRunValue(forecast, forecast.validTime)) {
        recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_AVAILABLE_AT_OR_AFTER_VALID_TIME");
        continue;
      }
      diagnostic.temporallyAdmissible += 1;
      if (forecast.value == null || !Number.isFinite(forecast.value)) {
        recordHourlyComparisonFirstRejection(diagnostic, "FORECAST_VALUE_MISSING_OR_NONFINITE");
        continue;
      }
      diagnostic.admissiblePairs += 1;
      const retainedKey = [
        forecast.captureRunId,
        forecast.locationKey,
        forecast.modelName,
        forecast.modelId,
        forecast.variable,
        forecast.validTime,
        forecast.providerRunAt,
        snapshot.date,
        snapshot.hour,
        Number.isSafeInteger(snapshot.id) && snapshot.id! > 0 ? snapshot.id! : "",
      ].join("|");
      if (!retainedComparisonKeys.has(retainedKey)) {
        recordHourlyComparisonFirstRejection(diagnostic, "NOT_RETAINED_BY_CURRENT_SCORER");
        continue;
      }
      diagnostic.retainedComparisons += 1;
    }
  }

  return { comparisons, scores, diagnostics };
}
