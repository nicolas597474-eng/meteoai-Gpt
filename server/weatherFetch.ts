import {observeOpenMeteo} from './openMeteoTraffic';
import {defaultWeatherQuota,quotaProvider,quotaResponse,recordQuotaResponse,type WeatherQuotaStore} from './openMeteoQuota';
export const isTransientWeatherStatus = (status: number) => status === 408 || status === 429 || status >= 500;

export type WeatherFetchOptions = {
  timeoutMs?: number;
  attempts?: number;
  cacheTtlMs?: number;
  quotaStore?: WeatherQuotaStore;
};

type CachedWeatherResponse = {
  receivedAt: number;
  expiresAt: number;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: ArrayBuffer;
};

export type WeatherProviderDiagnostic = {
  provider: string;
  lastOutcome: "success" | "http_error" | "network_error" | "cache";
  lastObservedAt: string;
  lastNetworkAttemptAt: string | null;
  lastSuccessAt: string | null;
  freshnessMs: number | null;
  lastDurationMs: number;
  lastStatus: number | null;
  lastError: string | null;
  lastAttempts: number;
  lastRetries: number;
};

type ProviderDiagnosticState = Omit<WeatherProviderDiagnostic, "freshnessMs">;
type InFlightWeatherResponse = {
  response: CachedWeatherResponse;
  attempts: number;
};

/** Bound process-local state: public coordinate URLs must not grow these Maps indefinitely. */
export const WEATHER_FETCH_CACHE_MAX_ENTRIES = 128;
export const WEATHER_PROVIDER_DIAGNOSTICS_MAX_ENTRIES = 64;
const responseCache = new Map<string, CachedWeatherResponse>();
const providerDiagnostics = new Map<string, ProviderDiagnosticState>();
const inFlightGetRequests = new Map<string, Promise<InFlightWeatherResponse>>();
const responseAttemptCounts = new WeakMap<Response, number>();
const responseReceiptTimes = new WeakMap<Response, number>();
let cacheHits = 0;
let cacheMisses = 0;

/** Returns the network attempts for this exact response (zero for a cache hit). */
export function getWeatherResponseAttemptCount(response: Response): number {
  return responseAttemptCounts.get(response) ?? 0;
}

/** Receipt time of this response, unchanged when read again from the memory cache. */
export function getWeatherResponseReceivedAt(response: Response): number | null {
  return responseReceiptTimes.get(response) ?? null;
}

function cacheKey(input: RequestInfo | URL, init: RequestInit): string | null {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") return null;
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return `${method}:${url}`;
}

function providerName(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    return new URL(url).hostname;
  } catch {
    return "source-inconnue";
  }
}

function responseFromCache(cached: CachedWeatherResponse): Response {
  return new Response(cached.body.slice(0), {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

function touchLruEntry<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
}

function trimResponseCache(now = Date.now()): void {
  for (const [key, entry] of Array.from(responseCache.entries())) {
    if (entry.expiresAt <= now) responseCache.delete(key);
  }
  while (responseCache.size > WEATHER_FETCH_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value as string | undefined;
    if (!oldest) break;
    responseCache.delete(oldest);
  }
}

async function makeCachedWeatherResponse(response: Response, expiresAt: number, receivedAt: number): Promise<CachedWeatherResponse> {
  const snapshot = response.clone();
  return {
    receivedAt,
    expiresAt,
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: Array.from(snapshot.headers.entries()),
    body: await snapshot.arrayBuffer(),
  };
}

function recordProviderDiagnostic(diagnostic: ProviderDiagnosticState) {
  touchLruEntry(providerDiagnostics, diagnostic.provider, diagnostic);
  while (providerDiagnostics.size > WEATHER_PROVIDER_DIAGNOSTICS_MAX_ENTRIES) {
    const oldest = providerDiagnostics.keys().next().value as string | undefined;
    if (!oldest) break;
    providerDiagnostics.delete(oldest);
  }
}

export function getWeatherFetchCacheMetrics() {
  trimResponseCache();
  return { entries: responseCache.size, inFlight: inFlightGetRequests.size, hits: cacheHits, misses: cacheMisses };
}

export function getWeatherProviderDiagnostics(now = Date.now()): WeatherProviderDiagnostic[] {
  return Array.from(providerDiagnostics.values())
    .map((diagnostic) => ({
      ...diagnostic,
      freshnessMs: diagnostic.lastSuccessAt == null
        ? null
        : Math.max(0, now - new Date(diagnostic.lastSuccessAt).getTime()),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export function resetWeatherFetchCache() {
  responseCache.clear();
  inFlightGetRequests.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function resetWeatherProviderDiagnostics() {
  providerDiagnostics.clear();
}

function combinedAbortSignal(external: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function retryDelay(attempt: number, signal: AbortSignal | null | undefined): Promise<void> {
  const delayMs = Math.min(1_000, 200 * (2 ** Math.max(0, attempt - 1)));
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
    }, { once: true });
  });
}

async function executeWeatherRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  options: Required<Omit<WeatherFetchOptions,'quotaStore'>>&Pick<WeatherFetchOptions,'quotaStore'>,
  provider: string,
): Promise<InFlightWeatherResponse> {
  let lastError: unknown;
  let lastStatus: number | null = null;
  const startedAt = Date.now();
  const quotaKey=quotaProvider(input),quotaStore=options.quotaStore??defaultWeatherQuota();

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException("Request aborted", "AbortError");
    if(quotaKey&&quotaStore){const paused=await quotaResponse(quotaKey,quotaStore);if(paused)return {response:await makeCachedWeatherResponse(paused,Date.now(),Date.now()),attempts:0};}
    try {
      // The caller signal reaches the provider transport; the timeout remains per attempt.
      let response:Response;
      try {
        response = await fetch(input, { ...init, signal: combinedAbortSignal(init.signal, options.timeoutMs) });
      } catch(error) { observeOpenMeteo(input,'network',null,attempt>1); throw error; }
      observeOpenMeteo(input,'network',response.status,attempt>1);
      if(response.status===429&&quotaKey&&quotaStore)await recordQuotaResponse(response,quotaKey,quotaStore);
      const completedAt = Date.now();
      if (response.ok) {
        const snapshot = await makeCachedWeatherResponse(response, completedAt + options.cacheTtlMs, completedAt);
        recordProviderDiagnostic({
          provider,
          lastOutcome: "success",
          lastObservedAt: new Date(completedAt).toISOString(),
          lastNetworkAttemptAt: new Date(startedAt).toISOString(),
          lastSuccessAt: new Date(completedAt).toISOString(),
          lastDurationMs: completedAt - startedAt,
          lastStatus: response.status,
          lastError: null,
          lastAttempts: attempt,
          lastRetries: attempt - 1,
        });
        return { response: snapshot, attempts: attempt };
      }

      lastStatus = response.status;
      if ((response.status===429&&quotaKey!==null) || !isTransientWeatherStatus(response.status) || attempt === options.attempts) {
        const snapshot = await makeCachedWeatherResponse(response, completedAt, completedAt);
        const previous = providerDiagnostics.get(provider);
        recordProviderDiagnostic({
          provider,
          lastOutcome: "http_error",
          lastObservedAt: new Date(completedAt).toISOString(),
          lastNetworkAttemptAt: new Date(startedAt).toISOString(),
          lastSuccessAt: previous?.lastSuccessAt ?? null,
          lastDurationMs: completedAt - startedAt,
          lastStatus,
          lastError: `HTTP ${response.status}`,
          lastAttempts: attempt,
          lastRetries: attempt - 1,
        });
        return { response: snapshot, attempts: attempt };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      // A user/server-budget abort is definitive; never turn it into a retry.
      if (init.signal?.aborted) throw init.signal.reason ?? error;
      lastError = error;
    }

    if (attempt < options.attempts) await retryDelay(attempt, init.signal);
  }

  const completedAt = Date.now();
  const previous = providerDiagnostics.get(provider);
  recordProviderDiagnostic({
    provider,
    lastOutcome: "network_error",
    lastObservedAt: new Date(completedAt).toISOString(),
    lastNetworkAttemptAt: new Date(startedAt).toISOString(),
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastDurationMs: completedAt - startedAt,
    lastStatus,
    lastError: lastError instanceof Error ? lastError.message : "Source météo indisponible",
    lastAttempts: options.attempts,
    lastRetries: Math.max(0, options.attempts - 1),
  });
  throw lastError instanceof Error ? lastError : new Error("La source météo est indisponible.");
}

export async function fetchWeather(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: WeatherFetchOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const attempts = Math.max(1, Math.floor(options.attempts ?? 2));
  const cacheTtlMs = options.cacheTtlMs ?? 20_000;
  const key = cacheKey(input, init);
  const provider = providerName(input);
  const now = Date.now();
  trimResponseCache(now);
  const cached = key ? responseCache.get(key) : null;
  if (cached && cached.expiresAt > now) {
    observeOpenMeteo(input,'cache');
    cacheHits += 1;
    const previous = providerDiagnostics.get(provider);
    recordProviderDiagnostic({
      provider,
      lastOutcome: "cache",
      lastObservedAt: new Date(now).toISOString(),
      lastNetworkAttemptAt: previous?.lastNetworkAttemptAt ?? null,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastDurationMs: 0,
      lastStatus: previous?.lastStatus ?? null,
      lastError: null,
      lastAttempts: 0,
      lastRetries: 0,
    });
    touchLruEntry(responseCache, key!, cached);
    const cachedResponse = responseFromCache(cached);
    responseAttemptCounts.set(cachedResponse, 0);
    responseReceiptTimes.set(cachedResponse, cached.receivedAt);
    return cachedResponse;
  }
  if (key) {
    responseCache.delete(key);
  }

  const resolvedOptions = { timeoutMs, attempts, cacheTtlMs,quotaStore:options.quotaStore };
  // Signal-bearing work is not shared: cancelling one request must not abort an
  // unrelated reader. Ordinary cacheable GETs are single-flight.
  const shared = key && !init.signal ? inFlightGetRequests.get(key) : undefined;
  if(shared)observeOpenMeteo(input,'shared');
  if (!shared) cacheMisses += 1;
  const request = shared ?? executeWeatherRequest(input, init, resolvedOptions, provider);
  if (key && !init.signal && !shared) {
    inFlightGetRequests.set(key, request);
    void request.then((result) => {
      if (cacheTtlMs > 0) {
        touchLruEntry(responseCache, key, result.response);
        trimResponseCache();
      }
      if (inFlightGetRequests.get(key) === request) inFlightGetRequests.delete(key);
    },() => {
      if (inFlightGetRequests.get(key) === request) inFlightGetRequests.delete(key);
    });
  }
  const result = await request;
  const response = responseFromCache(result.response);
  responseAttemptCounts.set(response, result.attempts);
  responseReceiptTimes.set(response, result.response.receivedAt);
  return response;
}
