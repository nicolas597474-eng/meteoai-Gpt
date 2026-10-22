import { evaluateSpatialQuality, type SpatialFusionSource, type SpatialQcOptions, type SpatialQualityCheck } from "./spatialFusionCore";

export const STATION_MEASUREMENT_FIELDS = [
  "temperature",
  "humidity",
  "pressure",
  "windSpeed",
  "windGust",
  "windDirection",
  "precipitation",
] as const;

export type StationMeasurementField = (typeof STATION_MEASUREMENT_FIELDS)[number];
export type StationMeasurementTimes = Partial<Record<StationMeasurementField, string | null>>;

export type StationMeasurementAgeState = {
  /** Provider timestamp for this field only; invalid raw strings remain inspectable. */
  observedAt: string | null;
  /** Whole elapsed minutes, or null when the field's own timestamp is unknown. */
  ageMinutes: number | null;
  status: "known" | "unknown";
};

export type StationFieldQualityResult<T extends SpatialFusionSource> = {
  source: T;
  passed: boolean;
  checks: SpatialQualityCheck[];
  altitudeAdjustmentC: number;
};

export function getStationMeasurementAgeState(
  measurementTimes: StationMeasurementTimes | null | undefined,
  field: StationMeasurementField,
  nowMs = Date.now(),
): StationMeasurementAgeState {
  const raw = measurementTimes?.[field];
  const observedAt = typeof raw === "string" ? raw : null;
  if (observedAt == null) return { observedAt: null, ageMinutes: null, status: "unknown" };

  const timestampMs = Date.parse(observedAt);
  if (!Number.isFinite(timestampMs) || timestampMs > nowMs) {
    return { observedAt, ageMinutes: null, status: "unknown" };
  }

  return {
    observedAt,
    ageMinutes: Math.floor((nowMs - timestampMs) / 60_000),
    status: "known",
  };
}

/** Returns the canonical provider time only when this field has a valid, non-future timestamp. */
export function getValidStationMeasurementTimestamp(
  measurementTimes: StationMeasurementTimes | null | undefined,
  field: StationMeasurementField,
  nowMs = Date.now(),
): string | null {
  const state = getStationMeasurementAgeState(measurementTimes, field, nowMs);
  if (state.status !== "known" || state.observedAt == null) return null;
  return new Date(state.observedAt).toISOString();
}

/** Freshness is evaluated from the field's own timestamp, never from updatedAt. */
export function hasFreshStationMeasurement(
  measurementTimes: StationMeasurementTimes | null | undefined,
  field: StationMeasurementField,
  maxAgeMinutes: number,
  nowMs = Date.now(),
): boolean {
  const observedAt = getValidStationMeasurementTimestamp(measurementTimes, field, nowMs);
  if (observedAt == null) return false;
  return (nowMs - Date.parse(observedAt)) / 60_000 <= maxAgeMinutes;
}

export function getStationMeasurementAgeStates(
  measurementTimes: StationMeasurementTimes | null | undefined,
  nowMs = Date.now(),
): Record<StationMeasurementField, StationMeasurementAgeState> {
  return Object.fromEntries(
    STATION_MEASUREMENT_FIELDS.map((field) => [field, getStationMeasurementAgeState(measurementTimes, field, nowMs)]),
  ) as Record<StationMeasurementField, StationMeasurementAgeState>;
}

/**
 * Run the existing spatial QC independently for one station variable. The QC
 * sees that variable's provider timestamp; a different field or updatedAt is
 * never used as a freshness substitute. Temperature coherence is evaluated
 * only for temperature. The shared "temperature or wind" data-presence check
 * remains unchanged for other fields; precipitation QC may additionally use
 * its own finite measurement as data presence, without projecting it into
 * temperature or wind. For a humidity or pressure candidate, a present primary
 * value is still projected only into the temporary QC view. The original source
 * is returned unchanged.
 */
export function evaluateStationFieldQuality<T extends SpatialFusionSource & { measurementTimes?: StationMeasurementTimes }>(
  sources: readonly T[],
  field: StationMeasurementField,
  options: SpatialQcOptions,
): StationFieldQualityResult<T>[] {
  const now = options.now ?? Date.now();
  const candidates = sources.flatMap((source) => {
    const value = (source as unknown as Record<string, unknown>)[field];
    const observedAt = getValidStationMeasurementTimestamp(source.measurementTimes, field, now);
    if (typeof value !== "number" || !Number.isFinite(value) || observedAt == null) return [];
    return [{ source, value, observedAt }];
  });
  if (candidates.length === 0) return [];

  const originalById = new Map(candidates.map(({ source }) => [source.id, source]));
  const qcSources = candidates.map(({ source, value, observedAt }) => ({
    ...source,
    updatedAt: observedAt,
    temperature: field === "temperature" ? source.temperature : null,
    windSpeed: field === "temperature"
      ? null
      : Number.isFinite(source.windSpeed)
        ? source.windSpeed
        : Number.isFinite(source.temperature)
          ? source.temperature
          : null,
  }));
  const fieldOptions = field === "precipitation"
    ? { ...options, dataField: "precipitation" as const }
    : options;
  return evaluateSpatialQuality(qcSources, fieldOptions).map((result) => ({
    source: originalById.get(result.source.id)!,
    passed: result.passed,
    checks: result.checks,
    altitudeAdjustmentC: result.altitudeAdjustmentC,
  }));
}
