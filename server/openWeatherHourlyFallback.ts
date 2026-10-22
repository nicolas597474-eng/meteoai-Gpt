import {
  buildOpenWeatherForecastUrl,
  OPENWEATHER_FORECAST_ENDPOINT,
} from "./openWeatherApi";
import { fetchWeather } from "./weatherFetch";
import type { HourlyPoint } from "./weatherServices";
import type {
  HourlyFallbackProvenance,
  OpenWeatherFallbackField,
} from "../shared/hourlyFallbackProvenance";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;
type OpenWeatherValueSet = Record<OpenWeatherFallbackField, number | null>;
type ParsedOpenWeatherPoint = { validAt: number; values: OpenWeatherValueSet };

export type OpenWeatherHourlyFallbackStatus =
  | "not-needed"
  | "missing-key"
  | "filled"
  | "partial"
  | "no-exact-values"
  | "request-impossible";

export type OpenWeatherHourlyFallbackDiagnostics = {
  provider: "OpenWeatherMap";
  endpoint: typeof OPENWEATHER_FORECAST_ENDPOINT;
  product: "Forecast 5 jours / 3 heures";
  role: "repli ponctuel par champ, jamais un modèle indépendant ni un vote";
  status: OpenWeatherHourlyFallbackStatus;
  attempted: boolean;
  requestedMissingValueCount: number;
  filledValueCount: number;
  ignoredDuplicateOfficialValidTimeCount: number;
  duplicateOpenWeatherValidTimeCount: number;
  invalidOpenWeatherPointCount: number;
  requestStartedAt: string | null;
  retrievedAt: string | null;
  providerRunAt: null;
  upstreamFreshness: "unknown";
  errorCode: string | null;
};

export type OpenWeatherHourlyFallbackResult = {
  hours: HourlyPoint[];
  diagnostics: OpenWeatherHourlyFallbackDiagnostics;
};

type MissingCell = {
  index: number;
  validAt: number;
  field: OpenWeatherFallbackField;
};

const FIELD_TO_POINT_KEY = {
  temperature: "temp",
  windSpeed: "windSpeed",
  windDirection: "windDirection",
  humidity: "humidity",
  cloudCover: "cloudCover",
} as const satisfies Record<OpenWeatherFallbackField, keyof HourlyPoint>;

const inFlightRequests = new Map<string, Promise<Response>>();

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDirection(value: number): number {
  return Math.round((((value % 360) + 360) % 360) * 100) / 100;
}

function asPercentage(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}

function blankDiagnostics(input: {
  status: OpenWeatherHourlyFallbackStatus;
  attempted: boolean;
  requestedMissingValueCount: number;
  ignoredDuplicateOfficialValidTimeCount: number;
  duplicateOpenWeatherValidTimeCount?: number;
  invalidOpenWeatherPointCount?: number;
  requestStartedAt?: string | null;
  retrievedAt?: string | null;
  filledValueCount?: number;
  errorCode?: string | null;
}): OpenWeatherHourlyFallbackDiagnostics {
  return {
    provider: "OpenWeatherMap",
    endpoint: OPENWEATHER_FORECAST_ENDPOINT,
    product: "Forecast 5 jours / 3 heures",
    role: "repli ponctuel par champ, jamais un modèle indépendant ni un vote",
    status: input.status,
    attempted: input.attempted,
    requestedMissingValueCount: input.requestedMissingValueCount,
    filledValueCount: input.filledValueCount ?? 0,
    ignoredDuplicateOfficialValidTimeCount:
      input.ignoredDuplicateOfficialValidTimeCount,
    duplicateOpenWeatherValidTimeCount:
      input.duplicateOpenWeatherValidTimeCount ?? 0,
    invalidOpenWeatherPointCount: input.invalidOpenWeatherPointCount ?? 0,
    requestStartedAt: input.requestStartedAt ?? null,
    retrievedAt: input.retrievedAt ?? null,
    providerRunAt: null,
    upstreamFreshness: "unknown",
    errorCode: input.errorCode ?? null,
  };
}

function getDuplicateOfficialTimes(hours: readonly HourlyPoint[]): Set<number> {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const hour of hours) {
    const validAt = hour.validAt;
    if (
      typeof validAt !== "number" ||
      !Number.isSafeInteger(validAt) ||
      !Number.isFinite(new Date(validAt).getTime())
    )
      continue;
    if (seen.has(validAt)) duplicates.add(validAt);
    else seen.add(validAt);
  }
  return duplicates;
}

function missingCells(
  hours: readonly HourlyPoint[],
  duplicateOfficialTimes: ReadonlySet<number>
): MissingCell[] {
  const cells: MissingCell[] = [];
  for (let index = 0; index < hours.length; index += 1) {
    const hour = hours[index]!;
    const validAt = hour.validAt;
    if (
      typeof validAt !== "number" ||
      !Number.isSafeInteger(validAt) ||
      !Number.isFinite(new Date(validAt).getTime())
    )
      continue;
    if (duplicateOfficialTimes.has(validAt)) continue;
    for (const field of Object.keys(
      FIELD_TO_POINT_KEY
    ) as OpenWeatherFallbackField[]) {
      const pointKey = FIELD_TO_POINT_KEY[field];
      const current = hour[pointKey];
      if (typeof current !== "number" || !Number.isFinite(current))
        cells.push({ index, validAt, field });
    }
  }
  return cells;
}

function parseOpenWeatherPoints(list: readonly unknown[]): {
  byValidAt: Map<number, ParsedOpenWeatherPoint>;
  duplicateTimes: Set<number>;
  invalidCount: number;
} {
  const byValidAt = new Map<number, ParsedOpenWeatherPoint>();
  const duplicateTimes = new Set<number>();
  let invalidCount = 0;
  for (const raw of list) {
    const item = asRecord(raw);
    const seconds = finiteNumber(item.dt);
    if (
      seconds === null ||
      !Number.isSafeInteger(seconds) ||
      Math.abs(seconds) > Number.MAX_SAFE_INTEGER / 1000
    ) {
      invalidCount += 1;
      continue;
    }
    const validAt = seconds * 1000;
    if (
      !Number.isSafeInteger(validAt) ||
      !Number.isFinite(new Date(validAt).getTime())
    ) {
      invalidCount += 1;
      continue;
    }
    if (byValidAt.has(validAt) || duplicateTimes.has(validAt)) {
      byValidAt.delete(validAt);
      duplicateTimes.add(validAt);
      continue;
    }

    const main = asRecord(item.main);
    const wind = asRecord(item.wind);
    const clouds = asRecord(item.clouds);
    const speedMs = finiteNumber(wind.speed);
    const direction = finiteNumber(wind.deg);
    byValidAt.set(validAt, {
      validAt,
      values: {
        temperature: finiteNumber(main.temp),
        windSpeed:
          speedMs !== null && speedMs >= 0
            ? Math.round(speedMs * 3.6 * 100) / 100
            : null,
        windDirection:
          direction !== null && direction >= 0 && direction <= 360
            ? normalizeDirection(direction)
            : null,
        humidity: asPercentage(main.humidity),
        cloudCover: asPercentage(clouds.all),
      },
    });
  }
  return { byValidAt, duplicateTimes, invalidCount };
}

async function requestOpenWeather(
  url: URL,
  fetchImpl?: FetchLike
): Promise<Response> {
  if (fetchImpl) return fetchImpl(url);
  const key = url.toString();
  let pending = inFlightRequests.get(key);
  if (!pending) {
    pending = fetchWeather(
      url,
      {},
      { timeoutMs: 4_000, attempts: 1, cacheTtlMs: 60_000 }
    );
    inFlightRequests.set(key, pending);
    void pending.then(
      () => {
        if (inFlightRequests.get(key) === pending) inFlightRequests.delete(key);
      },
      () => {
        if (inFlightRequests.get(key) === pending) inFlightRequests.delete(key);
      }
    );
  }
  return (await pending).clone();
}

/**
 * Fills only null/non-finite official hourly cells using an exact OpenWeather
 * validTime. It never changes stored runs, weights, model counts, observations,
 * or unsupported fields. Provider run time is not exposed by Forecast 5j/3h.
 */
export async function fillOpenWeatherHourlyGaps(input: {
  apiKey: string | null | undefined;
  lat: number;
  lon: number;
  hours: readonly HourlyPoint[];
  now?: () => number;
  fetchImpl?: FetchLike;
}): Promise<OpenWeatherHourlyFallbackResult> {
  const now = input.now ?? Date.now;
  const duplicateOfficialTimes = getDuplicateOfficialTimes(input.hours);
  const gaps = missingCells(input.hours, duplicateOfficialTimes);
  if (gaps.length === 0) {
    return {
      hours: [...input.hours],
      diagnostics: blankDiagnostics({
        status: "not-needed",
        attempted: false,
        requestedMissingValueCount: 0,
        ignoredDuplicateOfficialValidTimeCount: duplicateOfficialTimes.size,
      }),
    };
  }
  if (!input.apiKey?.trim()) {
    return {
      hours: [...input.hours],
      diagnostics: blankDiagnostics({
        status: "missing-key",
        attempted: false,
        requestedMissingValueCount: gaps.length,
        ignoredDuplicateOfficialValidTimeCount: duplicateOfficialTimes.size,
        errorCode: "missing-key",
      }),
    };
  }

  const requestStartedAt = new Date(now()).toISOString();
  const url = buildOpenWeatherForecastUrl({
    apiKey: input.apiKey,
    lat: input.lat,
    lon: input.lon,
  });
  let response: Response;
  try {
    response = await requestOpenWeather(url, input.fetchImpl);
  } catch {
    return {
      hours: [...input.hours],
      diagnostics: blankDiagnostics({
        status: "request-impossible",
        attempted: true,
        requestedMissingValueCount: gaps.length,
        ignoredDuplicateOfficialValidTimeCount: duplicateOfficialTimes.size,
        requestStartedAt,
        errorCode: "network-error",
      }),
    };
  }
  if (!response.ok) {
    return {
      hours: [...input.hours],
      diagnostics: blankDiagnostics({
        status: "request-impossible",
        attempted: true,
        requestedMissingValueCount: gaps.length,
        ignoredDuplicateOfficialValidTimeCount: duplicateOfficialTimes.size,
        requestStartedAt,
        errorCode: `http-${response.status}`,
      }),
    };
  }

  let payload: Record<string, unknown>;
  try {
    payload = asRecord(await response.json());
  } catch {
    return {
      hours: [...input.hours],
      diagnostics: blankDiagnostics({
        status: "request-impossible",
        attempted: true,
        requestedMissingValueCount: gaps.length,
        ignoredDuplicateOfficialValidTimeCount: duplicateOfficialTimes.size,
        requestStartedAt,
        errorCode: "invalid-json",
      }),
    };
  }
  if (!Array.isArray(payload.list)) {
    return {
      hours: [...input.hours],
      diagnostics: blankDiagnostics({
        status: "request-impossible",
        attempted: true,
        requestedMissingValueCount: gaps.length,
        ignoredDuplicateOfficialValidTimeCount: duplicateOfficialTimes.size,
        requestStartedAt,
        errorCode: "invalid-response",
      }),
    };
  }

  const retrievedAt = new Date(now()).toISOString();
  const parsed = parseOpenWeatherPoints(payload.list);
  const resultHours = [...input.hours];
  const provenance: Array<HourlyFallbackProvenance | undefined> = Array.from(
    { length: input.hours.length },
    () => undefined
  );
  let filledValueCount = 0;
  for (const gap of gaps) {
    if (parsed.duplicateTimes.has(gap.validAt)) continue;
    const point = parsed.byValidAt.get(gap.validAt);
    const value = point?.values[gap.field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    const base = resultHours[gap.index]!;
    const existing = provenance[gap.index] ?? base.fallbackProvenance ?? {};
    const source = {
      provider: "OpenWeatherMap" as const,
      endpoint: OPENWEATHER_FORECAST_ENDPOINT,
      product: "Forecast 5 jours / 3 heures" as const,
      validAt: gap.validAt,
      retrievedAt,
      providerRunAt: null,
      upstreamFreshness: "unknown" as const,
    };
    resultHours[gap.index] = {
      ...base,
      [FIELD_TO_POINT_KEY[gap.field]]: value,
      fallbackProvenance: { ...existing, [gap.field]: source },
    };
    provenance[gap.index] = { ...existing, [gap.field]: source };
    filledValueCount += 1;
  }

  const status: OpenWeatherHourlyFallbackStatus =
    filledValueCount === 0
      ? "no-exact-values"
      : filledValueCount === gaps.length
        ? "filled"
        : "partial";
  return {
    hours: resultHours,
    diagnostics: blankDiagnostics({
      status,
      attempted: true,
      requestedMissingValueCount: gaps.length,
      ignoredDuplicateOfficialValidTimeCount: duplicateOfficialTimes.size,
      duplicateOpenWeatherValidTimeCount: parsed.duplicateTimes.size,
      invalidOpenWeatherPointCount: parsed.invalidCount,
      requestStartedAt,
      retrievedAt,
      filledValueCount,
      errorCode: null,
    }),
  };
}
