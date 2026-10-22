import { getDailyFusionPerformanceEvidence, getHourlyForecastEvaluationHistory, getHourlyForecastRunValues, makeLocationKey } from "./db";
import { getParisDate, getParisDateDaysAgo, getParisHour } from "./weatherTime";
import { collect15DayForecast, collectCurrentWeatherSnapshot, type CurrentWeatherSnapshot, type DayForecast, type HourlyPoint } from "./weatherServices";
import { findActiveHourlyForecastIndex, keepCurrentAndFutureHourlyForecasts } from "../shared/hourlyForecastTime";
import { collectOfficialHourlyForecast, computeOfficialHourlyForecast, OFFICIAL_HOURLY_HISTORY_DAYS, OFFICIAL_HOURLY_MODEL_NAMES, reconstructOfficialHourlyModelsFromArchive, type OfficialHourlyWeightingSummary } from "./officialHourlyForecast";
import { computeOfficialDailyForecastWithDiagnostics } from "./officialForecast";
import { waitForInteractiveRequest } from "./interactiveRequestCancellation";
import type { PrecipitationModelConsensus } from "../shared/precipitationConsensus";
import type { ManualHourlyOverride } from "../shared/hourlyModelMetrics";

export type OfficialWeatherSnapshot = {
  locationKey: string;
  weatherDate: string;
  validAt: string | null;
  computedAt: string;
  hourlyComputedAt: string;
  /** `stale` is returned only for a real prior archive/cache while a live refresh runs. */
  snapshotStatus: "live" | "stale";
  staleReason: "archived_hourly_run" | "refreshing_previous_snapshot" | null;
  /** An empty series is never a forecast of zero: it means the short interactive budget was exhausted or no model data exists. */
  hourlyStatus: "ready" | "not_ready";
  sourceKind: "official_forecast";
  source: "open-meteo";
  hourlyWeighting: OfficialHourlyWeightingSummary;
  hourlyOverride: ManualHourlyOverride | null;
  officialHourlyOriginal: HourlyPoint[] | null;
  currentSnapshot: CurrentWeatherSnapshot | null;
  hourly: HourlyPoint[];
  daily: DayForecast[];
  modelsUsed: string[];
};

export type DatedDailyFusionFallback = {
  kind: "daily_fusion";
  date: string;
  computedAt: string;
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  precipitationConsensus: PrecipitationModelConsensus | null;
  windSpeed: number | null;
  condition: string | null;
};

type DailyFusionSource = {
  date: string;
  computedAt: Date | string;
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  condition: string | null;
};

/**
 * Keeps a persisted daily fusion distinct from the live hourly forecast. The
 * caller must expose this object only when no hourly point is available.
 */
export function buildDatedDailyFusionFallback(
  source: DailyFusionSource | null | undefined,
  precipitationConsensus?: PrecipitationModelConsensus | null,
): DatedDailyFusionFallback | null {
  if (!source) return null;
  const computedAt = source.computedAt instanceof Date ? source.computedAt : new Date(source.computedAt);
  if (!Number.isFinite(computedAt.getTime())) return null;
  return {
    kind: "daily_fusion",
    date: source.date,
    computedAt: computedAt.toISOString(),
    tempMax: source.tempMax,
    tempMin: source.tempMin,
    precipitation: source.precipitation,
    precipitationConsensus: precipitationConsensus ?? null,
    windSpeed: source.windSpeed,
    condition: source.condition,
  };
}

type CacheEntry = {
  expiresAt: number;
  value: Promise<OfficialWeatherSnapshot>;
  /** A stale entry is returned immediately while this one refreshes in background. */
  refreshing?: Promise<OfficialWeatherSnapshot>;
};
export type OfficialDailyForecastSnapshot = {
  daily: DayForecast[];
  modelsUsed: string[];
  /** `not_ready` means a bounded daily load did not complete; it is not an empty weather forecast. */
  dailyStatus: "ready" | "not_ready";
};
type DailyCacheEntry = { expiresAt: number; value: Promise<OfficialDailyForecastSnapshot> };
type ManualHourlyForecast = { expiresAt: number; hours: HourlyPoint[]; computedAt: string; weighting?: OfficialHourlyWeightingSummary; reason: string };
const snapshotCache = new Map<string, CacheEntry>();
/** In-flight work is deliberately separate from the completed-value cache. */
const snapshotInFlight = new Map<string, Promise<OfficialWeatherSnapshot>>();
const dailySnapshotCache = new Map<string, DailyCacheEntry>();
const manualHourlyForecastCache = new Map<string, ManualHourlyForecast>();
export const OFFICIAL_SNAPSHOT_CACHE_MAX_ENTRIES = 48;
export const OFFICIAL_DAILY_SNAPSHOT_CACHE_MAX_ENTRIES = 48;
export const MANUAL_HOURLY_FORECAST_CACHE_MAX_ENTRIES = 48;
const SNAPSHOT_TTL_MS = 2 * 60_000;
const DAILY_SNAPSHOT_TTL_MS = 5 * 60_000;
const EMPTY_DAILY_SNAPSHOT_TTL_MS = 12_000;
const EMPTY_HOURLY_SNAPSHOT_TTL_MS = 12_000;
/** Entire cold interactive path, including the archive read before the live provider collection. */
export const OFFICIAL_SNAPSHOT_INTERACTIVE_BUDGET_MS = 7_000;
/** Current conditions are useful but must not block a short forecast response. */
export const INTERACTIVE_CURRENT_SNAPSHOT_DEADLINE_MS = 6_000;
const HOURLY_NUMERIC_COVERAGE_FIELDS = [
  "temp", "apparentTemp", "precipitation", "windSpeed", "windGust", "windDirection",
  "cloudCover", "humidity", "uvIndex", "weatherCode", "pressure", "dewPoint", "visibility",
  "solarRadiation", "cloudLow", "cloudMid", "cloudHigh",
] as const;

function hasHourlyValue(point: HourlyPoint): boolean {
  return HOURLY_NUMERIC_COVERAGE_FIELDS.some((field) => typeof point[field] === "number" && Number.isFinite(point[field]))
    || [point.condition, point.precipType, point.precipIntensity].some((value) => typeof value === "string" && value.trim() !== "");
}

/** A manual cache may update values, but must not erase a known exact-time field. */
export function isHourlyCoverageNonDecreasing(previous: readonly HourlyPoint[], next: readonly HourlyPoint[]): boolean {
  if (next.length === 0) return previous.length === 0;
  if (previous.length === 0) return next.some(hasHourlyValue);

  const nextByValidAt = new Map<number, HourlyPoint>();
  for (const point of next) {
    if (typeof point.validAt !== "number" || !Number.isFinite(point.validAt) || nextByValidAt.has(point.validAt)) return false;
    nextByValidAt.set(point.validAt, point);
  }
  for (const point of previous) {
    if (!hasHourlyValue(point)) continue;
    if (typeof point.validAt !== "number" || !Number.isFinite(point.validAt)) return false;
    const replacement = nextByValidAt.get(point.validAt);
    if (!replacement) return false;
    for (const field of HOURLY_NUMERIC_COVERAGE_FIELDS) {
      const previousValue = point[field];
      if (typeof previousValue === "number" && Number.isFinite(previousValue)
        && !(typeof replacement[field] === "number" && Number.isFinite(replacement[field]))) return false;
    }
    for (const field of ["condition", "precipType", "precipIntensity"] as const) {
      const previousValue = point[field];
      if (typeof previousValue === "string" && previousValue.trim() !== ""
        && !(typeof replacement[field] === "string" && replacement[field]!.trim() !== "")) return false;
    }
  }
  return true;
}

export function getOfficialSnapshotTtlMs(hourly: HourlyPoint[]): number {
  return hourly.length > 0 ? SNAPSHOT_TTL_MS : EMPTY_HOURLY_SNAPSHOT_TTL_MS;
}

export function buildOfficialWeatherSnapshot(input: {
  lat: number;
  lon: number;
  weatherDate: string;
  computedAt: Date;
  hourly: HourlyPoint[];
  currentSnapshot: CurrentWeatherSnapshot | null;
  hourlyWeighting: OfficialHourlyWeightingSummary;
  daily: DayForecast[];
  modelsUsed: string[];
  parisHour: string;
}): OfficialWeatherSnapshot {
  const hourly = keepCurrentAndFutureHourlyForecasts(input.hourly, input.computedAt.getTime());
  const currentForecast = hourly[findActiveHourlyForecastIndex(hourly, input.computedAt.getTime())]
    ?? hourly.find((hour) => hour.hour === `${input.parisHour}:00`)
    ?? hourly[0]
    ?? null;
  return {
    locationKey: makeLocationKey(input.lat, input.lon),
    weatherDate: input.weatherDate,
    validAt: currentForecast ? `${currentForecast.date ?? input.weatherDate}T${currentForecast.hour}` : null,
    computedAt: input.computedAt.toISOString(),
    hourlyComputedAt: input.computedAt.toISOString(),
    snapshotStatus: "live",
    staleReason: null,
    hourlyStatus: hourly.length > 0 ? "ready" : "not_ready",
    sourceKind: "official_forecast",
    source: "open-meteo",
    hourlyWeighting: input.hourlyWeighting,
    hourlyOverride: null,
    officialHourlyOriginal: null,
    currentSnapshot: input.currentSnapshot,
    hourly,
    daily: input.daily,
    modelsUsed: input.modelsUsed,
  };
}

export function refreshOfficialWeatherSnapshotForecastWindow(
  snapshot: OfficialWeatherSnapshot,
  nowMs = Date.now(),
): OfficialWeatherSnapshot {
  const hourly = keepCurrentAndFutureHourlyForecasts(snapshot.hourly, nowMs);
  const currentForecast = hourly[findActiveHourlyForecastIndex(hourly, nowMs)] ?? hourly[0] ?? null;
  return {
    ...snapshot,
    validAt: currentForecast ? `${currentForecast.date ?? snapshot.weatherDate}T${currentForecast.hour}` : null,
    hourly,
  };
}

/** Replace only forecast hours; the model current snapshot remains a separate object. */
export function mergeManualHourlyForecast(
  snapshot: OfficialWeatherSnapshot,
  hours: HourlyPoint[],
  computedAt: Date,
  weighting?: OfficialHourlyWeightingSummary,
  reason = "Relance manuelle explicite du moteur horaire officiel multi-modèles.",
): OfficialWeatherSnapshot {
  const currentHours = keepCurrentAndFutureHourlyForecasts(hours, computedAt.getTime());
  if (!isHourlyCoverageNonDecreasing(snapshot.hourly, currentHours)) return snapshot;
  const officialHourlyOriginal = snapshot.hourlyOverride
    ? snapshot.officialHourlyOriginal ?? snapshot.hourly
    : snapshot.hourly;
  const manualOverride: ManualHourlyOverride = {
    source: "manual_refresh",
    reason,
    computedAt: computedAt.toISOString(),
    officialOriginalComputedAt: snapshot.hourlyOverride?.officialOriginalComputedAt ?? snapshot.hourlyComputedAt,
    officialOriginalPreserved: true,
    officialOriginalPointCount: officialHourlyOriginal.length,
  };
  return {
    ...snapshot,
    hourly: currentHours,
    hourlyWeighting: { ...(weighting ?? snapshot.hourlyWeighting), manualOverride },
    hourlyOverride: manualOverride,
    officialHourlyOriginal,
    // The current snapshot has its own capturedAt; this timestamp belongs only to the hourly series.
    hourlyComputedAt: computedAt.toISOString(),
  };
}

function normalizedCacheLocationKey(coords: { lat: number; lon: number }) {
  return `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`;
}

export function getOfficialWeatherSnapshotCacheKey(
  coords: { lat: number; lon: number },
  weatherDate: string,
  _hourBucket: number,
  hourlyForecastDays = 2,
): string {
  // Current/future-window filtering happens on every read. Tying the cache to
  // the current hour forced an unnecessary cold multi-model collection at each
  // hour boundary, even when an otherwise valid snapshot was already present.
  return `${normalizedCacheLocationKey(coords)}:${weatherDate}:${hourlyForecastDays}`;
}

function manualForecastCacheKey(cacheLocationKey: string, weatherDate: string) {
  return `${cacheLocationKey}:${weatherDate}`;
}

function touchLruEntry<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
}

function trimExpiringLru<T extends { expiresAt: number }>(cache: Map<string, T>, maxEntries: number, now = Date.now()): void {
  for (const [key, entry] of Array.from(cache.entries())) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function markSnapshotStale(
  snapshot: OfficialWeatherSnapshot,
  staleReason: NonNullable<OfficialWeatherSnapshot["staleReason"]>,
): OfficialWeatherSnapshot {
  return { ...snapshot, snapshotStatus: "stale", staleReason };
}

export function getOfficialWeatherSnapshotCacheMetrics() {
  trimExpiringLru(snapshotCache, OFFICIAL_SNAPSHOT_CACHE_MAX_ENTRIES);
  trimExpiringLru(dailySnapshotCache, OFFICIAL_DAILY_SNAPSHOT_CACHE_MAX_ENTRIES);
  trimExpiringLru(manualHourlyForecastCache, MANUAL_HOURLY_FORECAST_CACHE_MAX_ENTRIES);
  return {
    snapshots: snapshotCache.size,
    dailySnapshots: dailySnapshotCache.size,
    manualHourlyForecasts: manualHourlyForecastCache.size,
  };
}

async function collectOfficialDailyForecastSnapshot(coords: { lat: number; lon: number }): Promise<OfficialDailyForecastSnapshot> {
  const issuedAt = Date.now();
  const locationKey = makeLocationKey(coords.lat, coords.lon);
  const result = await withDeadline(collect15DayForecast(coords, {
    issuedAt,
    resolveOfficialFusion: async (targetDate, forecasts, referenceAt, availabilityReasonByModel) => {
      const fusionEvidence = await getDailyFusionPerformanceEvidence(
        locationKey,
        targetDate,
        forecasts.flatMap((forecast) => forecast.availableAt == null ? [] : [forecast.availableAt]),
      );
      return computeOfficialDailyForecastWithDiagnostics(forecasts, {
        locationKey,
        targetDate,
        issuedAt: referenceAt,
        referenceAt,
        evidenceStoreAvailable: fusionEvidence.available,
        evidence: fusionEvidence.evidence,
        availabilityReasonByModel,
      });
    },
  }), 60_000, null);
  if (!result) return { daily: [], modelsUsed: [], dailyStatus: "not_ready" };
  return { daily: result.days, modelsUsed: result.modelsUsed, dailyStatus: "ready" };
}

/** The daily horizon is independent from the current-hour response and caches separately. */
export function resolveOfficialDailyForecastSnapshot(
  coords: { lat: number; lon: number },
  options: { signal?: AbortSignal } = {},
): Promise<OfficialDailyForecastSnapshot> {
  const cacheKey = `${normalizedCacheLocationKey(coords)}:${getParisDate()}`;
  trimExpiringLru(dailySnapshotCache, OFFICIAL_DAILY_SNAPSHOT_CACHE_MAX_ENTRIES);
  const cached = dailySnapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    touchLruEntry(dailySnapshotCache, cacheKey, cached);
    return waitForInteractiveRequest(withDeadline(cached.value, OFFICIAL_SNAPSHOT_INTERACTIVE_BUDGET_MS, { daily: [], modelsUsed: [], dailyStatus: "not_ready" } as OfficialDailyForecastSnapshot), options.signal);
  }

  const value = collectOfficialDailyForecastSnapshot(coords);
  const entry: DailyCacheEntry = { expiresAt: Date.now() + DAILY_SNAPSHOT_TTL_MS, value };
  touchLruEntry(dailySnapshotCache, cacheKey, entry);
  trimExpiringLru(dailySnapshotCache, OFFICIAL_DAILY_SNAPSHOT_CACHE_MAX_ENTRIES);
  void value.then((snapshot) => {
    if (dailySnapshotCache.get(cacheKey)?.value === value) {
      entry.expiresAt = Date.now() + (snapshot.dailyStatus === "ready" ? DAILY_SNAPSHOT_TTL_MS : EMPTY_DAILY_SNAPSHOT_TTL_MS);
    }
  }).catch(() => {
    if (dailySnapshotCache.get(cacheKey)?.value === value) dailySnapshotCache.delete(cacheKey);
  });
  return waitForInteractiveRequest(withDeadline(value, OFFICIAL_SNAPSHOT_INTERACTIVE_BUDGET_MS, { daily: [], modelsUsed: [], dailyStatus: "not_ready" } as OfficialDailyForecastSnapshot), options.signal);
}

/**
 * Reads the latest real scheduled projection before a cold live refresh. This
 * is limited to the short Dashboard path: the archived receipt time remains
 * visible, no value is invented, and a new live collection is started after it.
 */
/**
 * Délai maximal d'attente de l'état actuel en direct sur le chemin archive.
 * Au-delà, la réponse part sans état actuel : l'interface retombe alors sur
 * la requête dédiée `getCurrentModelSnapshot`, puis affiche « indisponible ».
 */
export const ARCHIVE_CURRENT_SNAPSHOT_DEADLINE_MS = 2_000;

/** Resolves with `fallback` if `promise` is still pending after `ms` or rejects. */
export function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), deadline]).finally(() => clearTimeout(timer));
}

async function readArchivedOfficialHourlySnapshot(
  coords: { lat: number; lon: number },
  weatherDate: string,
  deadlineAt: number,
): Promise<OfficialWeatherSnapshot | null> {
  const remainingBudgetMs = Math.max(0, deadlineAt - Date.now());
  if (remainingBudgetMs === 0) return null;
  const locationKey = makeLocationKey(coords.lat, coords.lon);
  const archive = Promise.all([
    getHourlyForecastRunValues(locationKey, weatherDate),
    getHourlyForecastEvaluationHistory(
      locationKey,
      getParisDateDaysAgo(OFFICIAL_HOURLY_HISTORY_DAYS),
      getParisDateDaysAgo(1),
    ),
    // This wait is consumer-local: the unsigned current singleflight remains
    // available to another reader after the archive path gives up.
    withDeadline(collectCurrentWeatherSnapshot(coords), Math.min(ARCHIVE_CURRENT_SNAPSHOT_DEADLINE_MS, remainingBudgetMs), null),
  ]);
  const archived = await withDeadline(archive, remainingBudgetMs, null);
  if (!archived) return null;
  const [rows, history, currentSnapshot] = archived;
  const modelForecasts = reconstructOfficialHourlyModelsFromArchive(rows, weatherDate);
  if (modelForecasts.length === 0) return null;
  const computed = computeOfficialHourlyForecast(modelForecasts, history.rows, {
    historyAvailable: history.available,
    exactHistoryAvailable: history.exactAvailable,
    exactHistoryScores: history.exactRows,
  });
  if (computed.hours.length === 0) return null;

  const receiptTimes = modelForecasts
    .map((forecast) => forecast.availableAt)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (receiptTimes.length === 0) return null;
  const receivedAt = Math.max(...receiptTimes);
  return markSnapshotStale(buildOfficialWeatherSnapshot({
    lat: coords.lat,
    lon: coords.lon,
    weatherDate,
    computedAt: new Date(receivedAt),
    hourly: computed.hours,
    currentSnapshot,
    hourlyWeighting: computed.weighting,
    daily: [],
    modelsUsed: modelForecasts.map((forecast) => forecast.modelName),
    parisHour: String(getParisHour()).padStart(2, "0"),
  }), "archived_hourly_run");
}

function applyManualHourlyForecast(snapshot: OfficialWeatherSnapshot, coords: { lat: number; lon: number }): OfficialWeatherSnapshot {
  const key = manualForecastCacheKey(normalizedCacheLocationKey(coords), snapshot.weatherDate);
  const cached = manualHourlyForecastCache.get(key);
  if (!cached) return snapshot;
  if (cached.expiresAt <= Date.now()) {
    manualHourlyForecastCache.delete(key);
    return snapshot;
  }
  touchLruEntry(manualHourlyForecastCache, key, cached);
  return mergeManualHourlyForecast(snapshot, cached.hours, new Date(cached.computedAt), cached.weighting, cached.reason);
}

function unavailableSnapshotHourlyResult(reason: string) {
  return computeOfficialHourlyForecast([], [], {
    historyAvailable: false,
    exactHistoryAvailable: false,
    availabilityReasonByModel: Object.fromEntries(
      OFFICIAL_HOURLY_MODEL_NAMES.map((model) => [model, reason]),
    ),
  });
}

/** Cache a completed manual forecast refresh while preserving the official current snapshot. */
export function cacheManualHourlyForecast(
  coords: { lat: number; lon: number },
  weatherDate: string,
  hours: HourlyPoint[],
  computedAt: Date,
  weighting?: OfficialHourlyWeightingSummary,
  reason = "Relance manuelle explicite du moteur horaire officiel multi-modèles.",
): void {
  if (hours.length === 0 || hours.some((hour) => typeof hour.validAt !== "number" || !Number.isFinite(hour.validAt))) return;
  const cacheLocationKey = normalizedCacheLocationKey(coords);
  const manualKey = manualForecastCacheKey(cacheLocationKey, weatherDate);
  const expiresAt = Date.now() + getOfficialSnapshotTtlMs(hours);
  touchLruEntry(manualHourlyForecastCache, manualKey, { expiresAt, hours, computedAt: computedAt.toISOString(), weighting, reason });
  trimExpiringLru(manualHourlyForecastCache, MANUAL_HOURLY_FORECAST_CACHE_MAX_ENTRIES);

  const snapshotPrefix = `${cacheLocationKey}:${weatherDate}:`;
  snapshotCache.forEach((cached, cacheKey) => {
    if (!cacheKey.startsWith(snapshotPrefix)) return;
    if (cached.expiresAt <= Date.now()) {
      snapshotCache.delete(cacheKey);
      return;
    }
    const value = cached.value.then((snapshot: OfficialWeatherSnapshot) => mergeManualHourlyForecast(snapshot, hours, computedAt, weighting, reason));
    snapshotCache.set(cacheKey, { expiresAt, value });
    void value.catch(() => {
      if (snapshotCache.get(cacheKey)?.value === value) snapshotCache.delete(cacheKey);
    });
  });
  manualHourlyForecastCache.forEach((value, key) => {
    if (value.expiresAt <= Date.now()) manualHourlyForecastCache.delete(key);
  });
}

/**
 * Returns the authoritative live forecast snapshot for a location. Calls made
 * within one minute share one payload, preventing presentation-level drift.
 */
export function resolveOfficialWeatherSnapshot(
  coords: { lat: number; lon: number },
  options: { hourlyForecastDays?: number; includeDaily?: boolean; signal?: AbortSignal } = {},
): Promise<OfficialWeatherSnapshot> {
  const weatherDate = getParisDate();
  const requestedDays = Number.isFinite(options.hourlyForecastDays) ? Math.floor(options.hourlyForecastDays!) : 2;
  const hourlyForecastDays = Math.min(16, Math.max(2, requestedDays));
  // The 15-day horizon is an independent request. Do not make current weather
  // wait for it; callers needing it use resolveOfficialDailyForecastSnapshot.
  const cacheKey = `${getOfficialWeatherSnapshotCacheKey(coords, weatherDate, Math.floor(Date.now() / (60 * 60_000)), hourlyForecastDays)}:hourly`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    touchLruEntry(snapshotCache, cacheKey, cached);
    return waitForInteractiveRequest(
      cached.value.then((snapshot) => refreshOfficialWeatherSnapshotForecastWindow(snapshot, Date.now())),
      options.signal,
    );
  }

  const createSnapshot = (deadlineAt: number) => (async () => {
    const currentWaitMs = Math.max(0, Math.min(INTERACTIVE_CURRENT_SNAPSHOT_DEADLINE_MS, deadlineAt - Date.now()));
    const hourlyWaitMs = Math.max(0, deadlineAt - Date.now());
    const [hourlyResult, currentSnapshot] = await Promise.all([
      // Do not pass the request signal: this is shared work and has its own
      // bounded provider AbortController. Consumer cancellation only stops its wait.
      withDeadline(
        collectOfficialHourlyForecast(weatherDate, coords, { forecastDays: hourlyForecastDays, interactive: true, deadlineAt }),
        hourlyWaitMs,
        unavailableSnapshotHourlyResult("Le budget global de la réponse interactive est expiré; aucune valeur horaire n’est publiée."),
      ),
      withDeadline(collectCurrentWeatherSnapshot(coords), currentWaitMs, null),
    ]);
    return applyManualHourlyForecast(buildOfficialWeatherSnapshot({
      lat: coords.lat,
      lon: coords.lon,
      weatherDate,
      computedAt: new Date(),
      hourly: hourlyResult.hours,
      currentSnapshot,
      hourlyWeighting: hourlyResult.weighting,
      daily: [],
      modelsUsed: [],
      parisHour: String(getParisHour()).padStart(2, "0"),
    }), coords);
  })().then((snapshot) => refreshOfficialWeatherSnapshotForecastWindow(snapshot, Date.now()));

  // Keep the last qualified result visible rather than making visitors wait on
  // a new seven-model request. The refresh never alters a response already
  // sent, and a failed refresh retains the proven previous snapshot.
  if (cached) {
    if (!cached.refreshing) {
      const refresh = createSnapshot(Date.now() + OFFICIAL_SNAPSHOT_INTERACTIVE_BUDGET_MS);
      cached.refreshing = refresh;
      void refresh.then((snapshot) => {
        if (snapshotCache.get(cacheKey) !== cached) return;
        if (snapshot.hourlyStatus !== "ready") { cached.refreshing = undefined; return; }
        snapshotCache.set(cacheKey, {
          expiresAt: Date.now() + getOfficialSnapshotTtlMs(snapshot.hourly),
          value: Promise.resolve(snapshot),
        });
      }).catch(() => {
        if (snapshotCache.get(cacheKey) === cached) cached.refreshing = undefined;
      });
    }
    return waitForInteractiveRequest(cached.value.then((snapshot) => refreshOfficialWeatherSnapshotForecastWindow(
      markSnapshotStale(snapshot, "refreshing_previous_snapshot"), Date.now(),
    )), options.signal);
  }

  const existingFlight = snapshotInFlight.get(cacheKey);
  if (existingFlight) return waitForInteractiveRequest(existingFlight, options.signal);

  const deadlineAt = Date.now() + OFFICIAL_SNAPSHOT_INTERACTIVE_BUDGET_MS;
  // Live models must not lose their budget waiting for a slow historical DB.
  let completedLive: OfficialWeatherSnapshot | undefined;
  const liveSnapshot = createSnapshot(deadlineAt).then(snapshot => { completedLive = snapshot; return snapshot; });
  const archiveOrLive = readArchivedOfficialHourlySnapshot(coords, weatherDate, deadlineAt).then((archivedSnapshot) => {
    if (!archivedSnapshot || completedLive?.hourlyStatus === "ready") return liveSnapshot;

    // A proven archive is immediately useful. Refresh it in the background;
    // the stale value in the completed cache remains honest until replacement.
    const entry: CacheEntry = {
      expiresAt: Date.now() + getOfficialSnapshotTtlMs(archivedSnapshot.hourly),
      value: Promise.resolve(archivedSnapshot),
    };
    touchLruEntry(snapshotCache, cacheKey, entry);
    trimExpiringLru(snapshotCache, OFFICIAL_SNAPSHOT_CACHE_MAX_ENTRIES);
    const refresh = liveSnapshot;
    entry.refreshing = refresh;
    void refresh.then((snapshot) => {
      if (snapshotCache.get(cacheKey) === entry) {
        if (snapshot.hourlyStatus !== "ready") { entry.refreshing = undefined; return; }
        snapshotCache.set(cacheKey, {
          expiresAt: Date.now() + getOfficialSnapshotTtlMs(snapshot.hourly),
          value: Promise.resolve(snapshot),
        });
      }
    }).catch(() => {
      if (snapshotCache.get(cacheKey) === entry) entry.refreshing = undefined;
    });
    return archivedSnapshot;
  });
  const value = Promise.race([archiveOrLive, liveSnapshot.then(snapshot => snapshot.hourlyStatus === "ready" ? snapshot : archiveOrLive)]);
  snapshotInFlight.set(cacheKey, value);
  void value.then((snapshot) => {
    if (snapshotInFlight.get(cacheKey) === value) snapshotInFlight.delete(cacheKey);
    // Archive results already own their cache entry. A cold live result is only
    // cached after it completed, never as a potentially stuck promise.
    if (!snapshotCache.has(cacheKey) || snapshotCache.get(cacheKey)!.expiresAt <= Date.now()) {
      touchLruEntry(snapshotCache, cacheKey, {
        expiresAt: Date.now() + getOfficialSnapshotTtlMs(snapshot.hourly),
        value: Promise.resolve(snapshot),
      });
      trimExpiringLru(snapshotCache, OFFICIAL_SNAPSHOT_CACHE_MAX_ENTRIES);
    }
  }).catch(() => {
    if (snapshotInFlight.get(cacheKey) === value) snapshotInFlight.delete(cacheKey);
  });
  return waitForInteractiveRequest(value, options.signal);
}
