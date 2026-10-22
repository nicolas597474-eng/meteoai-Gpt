import { detectExtendedRegime, detectMultiRegime, EXTENDED_REGIME_INFO } from "./fusionEngine";
import {
  OFFICIAL_REGIME_INPUTS,
  type OfficialRegimeInputDiagnostic,
  type RegimeInputKey,
  type RegimeInputSource,
} from "../shared/regimeInputDiagnostics";

type RegimeParameters = {
  temperature: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  humidity: number | null;
  cloudCover: number | null;
  visibilityKm: number | null;
  pressure: number | null;
};

type RegimeDetectionParameters = {
  temperature: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  humidity: number | null;
  cloudCover: number | null;
  visibility: number | null;
};

export type OfficialSnapshot = {
  tempMax?: number | null;
  tempMin?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  humidity?: number | null;
  cloudCover?: number | null;
  visibilityKm?: number | null;
  pressure?: number | null;
  computedAt?: Date | string | null;
} | null | undefined;

export type FreshRegimeObservation = {
  tempMax?: number | null;
  tempMin?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  humidity?: number | null;
  cloudCover?: number | null;
  visibilityKm?: number | null;
  collectedAt?: Date | string | null;
} | null | undefined;

export type CurrentHourlyRegimeForecast = {
  temp?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  humidity?: number | null;
  cloudCover?: number | null;
  /** Open-Meteo HourlyPoint visibility, in km. */
  visibilityKm?: number | null;
  /** Timestamp used by the current regime selector's freshness window. */
  updatedAt?: Date | string | null;
  /** Actual computation time of the hourly source, for diagnostics only. */
  sourceUpdatedAt?: Date | string | null;
  /** Exact HourlyPoint validity instant (Unix milliseconds). */
  validAt?: number | null;
  /** Supplied by the route that knows which hourly read-model produced the point. */
  sourceLabel?: string | null;
} | null | undefined;

export type HourlyRegimePoint = {
  hour: string;
  validAt?: number | null;
  temp?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  humidity?: number | null;
  cloudCover?: number | null;
  /** Open-Meteo HourlyPoint visibility, in km. */
  visibilityKm?: number | null;
};

type DiagnosticSource = {
  source: RegimeInputSource | null;
  sourceLabel: string | null;
  sourceUpdatedAt: Date | string | null | undefined;
  validAt?: Date | string | number | null;
  staleAfterMs?: number | null;
};

type RawRegimeInputValues = Record<RegimeInputKey, unknown | unknown[]>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function toTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function toIsoTimestamp(value: Date | string | null | undefined) {
  const timestamp = toTimestamp(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function toIsoEpochMilliseconds(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function averageTemperature(data: { tempMax?: number | null; tempMin?: number | null }) {
  return isFiniteNumber(data.tempMax) && isFiniteNumber(data.tempMin)
    ? (data.tempMax + data.tempMin) / 2
    : null;
}

function hourToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? hour * 60 + minute
    : null;
}

function snapshotParameters(snapshot: OfficialSnapshot): RegimeParameters {
  return {
    temperature: averageTemperature(snapshot ?? {}),
    precipitation: finiteOrNull(snapshot?.precipitation),
    windSpeed: finiteOrNull(snapshot?.windSpeed),
    humidity: finiteOrNull(snapshot?.humidity),
    cloudCover: finiteOrNull(snapshot?.cloudCover),
    visibilityKm: finiteOrNull(snapshot?.visibilityKm),
    pressure: finiteOrNull(snapshot?.pressure),
  };
}

function observationParameters(observation: FreshRegimeObservation): RegimeParameters {
  return {
    temperature: averageTemperature(observation ?? {}),
    precipitation: finiteOrNull(observation?.precipitation),
    windSpeed: finiteOrNull(observation?.windSpeed),
    humidity: finiteOrNull(observation?.humidity),
    cloudCover: finiteOrNull(observation?.cloudCover),
    visibilityKm: finiteOrNull(observation?.visibilityKm),
    pressure: null,
  };
}

function hourlyParameters(hourly: CurrentHourlyRegimeForecast): RegimeParameters {
  return {
    temperature: finiteOrNull(hourly?.temp),
    precipitation: finiteOrNull(hourly?.precipitation),
    windSpeed: finiteOrNull(hourly?.windSpeed),
    humidity: finiteOrNull(hourly?.humidity),
    cloudCover: finiteOrNull(hourly?.cloudCover),
    visibilityKm: finiteOrNull(hourly?.visibilityKm),
    pressure: null,
  };
}

function detectionParameters(params: RegimeParameters): RegimeDetectionParameters {
  return {
    temperature: params.temperature,
    precipitation: params.precipitation,
    windSpeed: params.windSpeed,
    humidity: params.humidity,
    cloudCover: params.cloudCover,
    visibility: params.visibilityKm == null ? null : params.visibilityKm * 1000,
  };
}

function dataCoverage(params: RegimeParameters) {
  return [params.temperature, params.precipitation, params.windSpeed, params.humidity, params.cloudCover, params.visibilityKm]
    .filter(isFiniteNumber).length;
}

function rawSnapshotValues(snapshot: OfficialSnapshot): RawRegimeInputValues {
  return {
    temperature: [snapshot?.tempMax, snapshot?.tempMin],
    precipitation: snapshot?.precipitation,
    windSpeed: snapshot?.windSpeed,
    humidity: snapshot?.humidity,
    cloudCover: snapshot?.cloudCover,
    visibilityKm: snapshot?.visibilityKm,
  };
}

function rawObservationValues(observation: FreshRegimeObservation): RawRegimeInputValues {
  return {
    temperature: [observation?.tempMax, observation?.tempMin],
    precipitation: observation?.precipitation,
    windSpeed: observation?.windSpeed,
    humidity: observation?.humidity,
    cloudCover: observation?.cloudCover,
    visibilityKm: observation?.visibilityKm,
  };
}

function rawHourlyValues(hourly: CurrentHourlyRegimeForecast): RawRegimeInputValues {
  return {
    temperature: hourly?.temp,
    precipitation: hourly?.precipitation,
    windSpeed: hourly?.windSpeed,
    humidity: hourly?.humidity,
    cloudCover: hourly?.cloudCover,
    visibilityKm: hourly?.visibilityKm,
  };
}

function rawValuesList(value: unknown | unknown[]): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function fieldStatus(
  rawValue: unknown | unknown[],
  selectedValue: number | null,
  sourceAgeMs: number | null,
  staleAfterMs: number | null | undefined,
): OfficialRegimeInputDiagnostic["status"] {
  const rawValues = rawValuesList(rawValue);
  const containsInvalidValue = rawValues.some((value) => value != null && !isFiniteNumber(value));
  if (selectedValue == null) return containsInvalidValue ? "invalid" : "missing";
  if (staleAfterMs != null && sourceAgeMs != null && sourceAgeMs > staleAfterMs) return "stale";
  return "available";
}

function buildInputDiagnostics(
  params: RegimeParameters,
  rawValues: RawRegimeInputValues,
  source: DiagnosticSource,
  nowMs: number,
): OfficialRegimeInputDiagnostic[] {
  const sourceTimestamp = toTimestamp(source.sourceUpdatedAt);
  const sourceAgeMs = sourceTimestamp == null || sourceTimestamp > nowMs ? null : nowMs - sourceTimestamp;
  const sourceUpdatedAt = toIsoTimestamp(source.sourceUpdatedAt);
  const validAt = typeof source.validAt === "number"
    ? toIsoEpochMilliseconds(source.validAt)
    : toIsoTimestamp(source.validAt);
  const selectedValues: Record<RegimeInputKey, number | null> = {
    temperature: params.temperature,
    precipitation: params.precipitation,
    windSpeed: params.windSpeed,
    humidity: params.humidity,
    cloudCover: params.cloudCover,
    visibilityKm: params.visibilityKm,
  };

  return OFFICIAL_REGIME_INPUTS.map(({ key, label, unit }) => ({
    key,
    label,
    unit,
    value: selectedValues[key],
    status: fieldStatus(rawValues[key], selectedValues[key], sourceAgeMs, source.staleAfterMs),
    source: source.source,
    sourceLabel: source.sourceLabel,
    sourceUpdatedAt,
    validAt,
    sourceAgeMinutes: sourceAgeMs == null ? null : Math.max(0, Math.round(sourceAgeMs / 60_000)),
  }));
}

function unavailableRegime(
  params: RegimeParameters,
  snapshotComputedAt: string | null,
  inputDiagnostics: OfficialRegimeInputDiagnostic[],
) {
  return {
    status: "unknown" as const,
    primary: null,
    active: [],
    confidence: null,
    blendedWeights: null,
    description: "Régime indisponible : une ou plusieurs données météorologiques requises sont absentes ou invalides.",
    params,
    snapshotComputedAt,
    inputDiagnostics,
  };
}

/**
 * Persisted daily multi-model snapshot. The diagnostic mirrors the six values
 * passed to the detector; no current-condition or station stream is substituted.
 */
export function buildOfficialRegime(snapshot: OfficialSnapshot, nowMs = Date.now()) {
  const params = snapshotParameters(snapshot);
  const snapshotComputedAt = toIsoTimestamp(snapshot?.computedAt);
  const inputDiagnostics = buildInputDiagnostics(params, rawSnapshotValues(snapshot), {
    source: snapshot == null ? null : "official_snapshot",
    sourceLabel: snapshot == null ? "Aucun snapshot quotidien disponible" : "Fusion quotidienne multi-modèles",
    sourceUpdatedAt: snapshot?.computedAt,
  }, nowMs);
  const multiRegime = detectMultiRegime(detectionParameters(params));
  if (!multiRegime) return unavailableRegime(params, snapshotComputedAt, inputDiagnostics);

  return {
    status: "available" as const,
    primary: multiRegime.primaryRegime,
    active: multiRegime.activeRegimes,
    confidence: multiRegime.confidenceScore,
    blendedWeights: multiRegime.blendedWeights,
    description: multiRegime.description,
    params,
    snapshotComputedAt,
    inputDiagnostics,
  };
}

/**
 * Chooses a regime using measurable freshness rules. An observation or hourly
 * forecast is used only when every input consumed by the classifier is present
 * and finite; otherwise the real, possibly unknown, official snapshot is kept.
 */
export function buildOperationalRegime(
  snapshot: OfficialSnapshot,
  observation: FreshRegimeObservation,
  currentHourly?: CurrentHourlyRegimeForecast,
  nowMs = Date.now(),
) {
  const official = buildOfficialRegime(snapshot, nowMs);
  const snapshotAt = toTimestamp(snapshot?.computedAt);
  const observationAt = toTimestamp(observation?.collectedAt);
  const observationParams = observationParameters(observation);
  const observationCoverage = dataCoverage(observationParams);
  const observationIsFresh = observationAt != null && nowMs - observationAt >= 0 && nowMs - observationAt <= 3 * 60 * 60 * 1000;
  const observationIsNewer = observationAt != null && (snapshotAt == null || observationAt > snapshotAt);
  const observationRegime = observationIsFresh && observationIsNewer
    ? detectExtendedRegime(detectionParameters(observationParams))
    : null;

  if (observationRegime) {
    const info = EXTENDED_REGIME_INFO[observationRegime];
    const inputDiagnostics = buildInputDiagnostics(observationParams, rawObservationValues(observation), {
      source: "fresh_observation",
      sourceLabel: "Observation physique qualifiée récente",
      sourceUpdatedAt: observation?.collectedAt,
      validAt: observation?.collectedAt,
      staleAfterMs: 3 * 60 * 60 * 1000,
    }, nowMs);
    return {
      status: "available" as const,
      primary: { id: observationRegime, ...info },
      active: [{ id: observationRegime, label: info.label, emoji: info.emoji, influence: 100 }],
      confidence: Math.min(95, 65 + observationCoverage * 7),
      blendedWeights: info.weights,
      description: `${info.description} Déterminé par une observation récente et suffisamment couverte.`,
      params: observationParams,
      snapshotComputedAt: official.snapshotComputedAt,
      source: "fresh_observation" as const,
      sourceUpdatedAt: new Date(observationAt!).toISOString(),
      sourceLabel: "Observation récente validée",
      sourceAgeMinutes: Math.max(0, Math.round((nowMs - observationAt!) / 60000)),
      dataCoverage: observationCoverage,
      inputDiagnostics,
    };
  }

  const hourlyAt = toTimestamp(currentHourly?.updatedAt);
  const hourlySourceAt = toTimestamp(currentHourly?.sourceUpdatedAt);
  const hourlySourceAgeMinutes = hourlySourceAt == null || hourlySourceAt > nowMs
    ? null
    : Math.max(0, Math.round((nowMs - hourlySourceAt) / 60000));
  const hourlySourceLabel = currentHourly?.sourceLabel?.trim() || "Prévision horaire actualisée";
  const hourlyParams = hourlyParameters(currentHourly);
  const hourlyCoverage = dataCoverage(hourlyParams);
  const hourlyIsFresh = hourlyAt != null && nowMs - hourlyAt >= 0 && nowMs - hourlyAt <= 20 * 60 * 1000;
  const hourlyRegime = hourlyIsFresh
    ? detectExtendedRegime(detectionParameters(hourlyParams))
    : null;

  // A complete hourly forecast is explicitly a forecast, never a physical observation.
  if (hourlyRegime) {
    const info = EXTENDED_REGIME_INFO[hourlyRegime];
    const inputDiagnostics = buildInputDiagnostics(hourlyParams, rawHourlyValues(currentHourly), {
      source: "hourly_forecast",
      sourceLabel: hourlySourceLabel,
      sourceUpdatedAt: currentHourly?.sourceUpdatedAt,
      validAt: currentHourly?.validAt,
      staleAfterMs: 20 * 60 * 1000,
    }, nowMs);
    return {
      status: "available" as const,
      primary: { id: hourlyRegime, ...info },
      active: [{ id: hourlyRegime, label: info.label, emoji: info.emoji, influence: 100 }],
      confidence: Math.min(90, 55 + hourlyCoverage * 7),
      blendedWeights: info.weights,
      description: `${info.description} Déterminé par la prévision horaire actualisée.`,
      params: hourlyParams,
      snapshotComputedAt: official.snapshotComputedAt,
      source: "hourly_forecast" as const,
      sourceUpdatedAt: toIsoTimestamp(currentHourly?.sourceUpdatedAt),
      sourceLabel: hourlySourceLabel,
      sourceAgeMinutes: hourlySourceAgeMinutes,
      dataCoverage: hourlyCoverage,
      inputDiagnostics,
    };
  }

  const officialCoverage = dataCoverage(official.params);
  if (officialCoverage === 0 && hourlyIsFresh && hourlyCoverage > 0) {
    const inputDiagnostics = buildInputDiagnostics(hourlyParams, rawHourlyValues(currentHourly), {
      source: "hourly_forecast_partial",
      sourceLabel: `${hourlySourceLabel} — régime non calculé`,
      sourceUpdatedAt: currentHourly?.sourceUpdatedAt,
      validAt: currentHourly?.validAt,
      staleAfterMs: 20 * 60 * 1000,
    }, nowMs);
    return {
      ...unavailableRegime(hourlyParams, official.snapshotComputedAt, inputDiagnostics),
      source: "hourly_forecast_partial" as const,
      sourceUpdatedAt: toIsoTimestamp(currentHourly?.sourceUpdatedAt),
      sourceLabel: `${hourlySourceLabel} — régime non calculé`,
      sourceAgeMinutes: hourlySourceAgeMinutes,
      dataCoverage: hourlyCoverage,
    };
  }
  return {
    ...official,
    source: "official_snapshot" as const,
    sourceUpdatedAt: official.snapshotComputedAt,
    sourceLabel: snapshot == null ? "Aucun snapshot quotidien disponible" : "Fusion quotidienne multi-modèles",
    sourceAgeMinutes: snapshotAt == null ? null : Math.max(0, Math.round((nowMs - snapshotAt) / 60000)),
    dataCoverage: officialCoverage,
  };
}

/** Retourne le premier créneau futur complet dont le régime diffère du régime courant. */
export function findNextHourlyRegimeChange(
  hours: HourlyRegimePoint[],
  currentHour: string,
  currentRegimeId: string,
  currentValidAt?: number | null,
) {
  if (!currentRegimeId) return null;
  const currentMinutes = hourToMinutes(currentHour);
  const validAtIndex = currentValidAt != null && Number.isFinite(currentValidAt)
    ? hours.findIndex((point) => point.validAt === currentValidAt)
    : -1;
  const currentIndex = validAtIndex >= 0
    ? validAtIndex
    : currentMinutes == null
      ? -1
      : hours.findIndex((point) => hourToMinutes(point.hour) === currentMinutes);
  const startIndex = currentIndex >= 0
    ? currentIndex
    : currentMinutes == null
      ? -1
      : hours.findIndex((point) => {
        const pointMinutes = hourToMinutes(point.hour);
        return pointMinutes != null && pointMinutes >= currentMinutes;
      });
  if (startIndex < 0) return null;

  for (let index = startIndex + 1; index < hours.length; index += 1) {
    const point = hours[index];
    const id = detectExtendedRegime({
      temperature: finiteOrNull(point.temp),
      precipitation: finiteOrNull(point.precipitation),
      windSpeed: finiteOrNull(point.windSpeed),
      humidity: finiteOrNull(point.humidity),
      cloudCover: finiteOrNull(point.cloudCover),
      visibility: finiteOrNull(point.visibilityKm) == null ? null : point.visibilityKm! * 1000,
    });
    if (!id || id === currentRegimeId) continue;
    const info = EXTENDED_REGIME_INFO[id];
    return { hour: point.hour, id, label: info.label, emoji: info.emoji, cloudCover: finiteOrNull(point.cloudCover) };
  }
  return null;
}
