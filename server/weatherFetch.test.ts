import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeather, getWeatherFetchCacheMetrics, getWeatherProviderDiagnostics, getWeatherResponseAttemptCount, getWeatherResponseReceivedAt, isTransientWeatherStatus, resetWeatherFetchCache, resetWeatherProviderDiagnostics, WEATHER_FETCH_CACHE_MAX_ENTRIES } from "./weatherFetch";

afterEach(() => {
  resetWeatherFetchCache();
  resetWeatherProviderDiagnostics();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reprises des sources météo", () => {
  it('conserve la vraie réception lors d’une relecture mémoire pour ne pas prolonger un autre cache',async()=>{
    vi.useFakeTimers({toFake:['Date']});const start=Date.parse('2026-10-21T08:00Z');vi.setSystemTime(start);
    const fetcher=vi.fn(async()=>Response.json({current:{european_aqi:0}}));vi.stubGlobal('fetch',fetcher);
    const first=await fetchWeather('https://air-quality-api.open-meteo.com/v1/receipt',{}, {cacheTtlMs:20*60000});
    vi.setSystemTime(start+11*60000);const cached=await fetchWeather('https://air-quality-api.open-meteo.com/v1/receipt',{}, {cacheTtlMs:20*60000});
    expect(getWeatherResponseReceivedAt(first)).toBe(start);expect(getWeatherResponseReceivedAt(cached)).toBe(start);
    expect(getWeatherResponseAttemptCount(cached)).toBe(0);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("ne retente que les statuts transitoires documentés", () => {
    expect(isTransientWeatherStatus(408)).toBe(true);
    expect(isTransientWeatherStatus(429)).toBe(true);
    expect(isTransientWeatherStatus(500)).toBe(true);
    expect(isTransientWeatherStatus(404)).toBe(false);
  });

  it("réutilise une réponse GET récente et expose les métriques de cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchWeather("https://api.example.test/weather", {}, { cacheTtlMs: 10_000 });
    const second = await fetchWeather("https://api.example.test/weather", {}, { cacheTtlMs: 10_000 });

    expect(getWeatherResponseAttemptCount(first)).toBe(1);
    expect(getWeatherResponseAttemptCount(second)).toBe(0);
    expect(await second.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getWeatherFetchCacheMetrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
  });

  it("reconstruit une réponse distincte à chaque lecture du cache après consommation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ hourly: [1, 2] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchWeather("https://api.example.test/hourly", {}, { cacheTtlMs: 10_000 });
    expect(await first.json()).toEqual({ hourly: [1, 2] });
    const cached = await fetchWeather("https://api.example.test/hourly", {}, { cacheTtlMs: 10_000 });
    expect(await cached.json()).toEqual({ hourly: [1, 2] });
    const cachedAgain = await fetchWeather("https://api.example.test/hourly", {}, { cacheTtlMs: 10_000 });

    expect(await cachedAgain.json()).toEqual({ hourly: [1, 2] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getWeatherFetchCacheMetrics()).toMatchObject({ entries: 1, hits: 2, misses: 1 });
  });

  it("mesure un succès fournisseur avec le nombre réel de reprises", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporaire", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWeather("https://api.example.test/hourly", {}, { attempts: 2, cacheTtlMs: 0 });

    expect(getWeatherResponseAttemptCount(response)).toBe(2);
    expect(getWeatherProviderDiagnostics()).toMatchObject([{
      provider: "api.example.test",
      lastOutcome: "success",
      lastStatus: 200,
      lastAttempts: 2,
      lastRetries: 1,
      lastError: null,
    }]);
  });

  it("reprend un délai réseau puis conserve le succès réel sans réponse fictive", async () => {
    const timeoutError = new DOMException("La requête a dépassé le délai", "TimeoutError");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(new Response(JSON.stringify({ recovered: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWeather("https://api.example.test/retry", {}, { attempts: 2, cacheTtlMs: 0 });

    expect(await response.json()).toEqual({ recovered: true });
    expect(getWeatherProviderDiagnostics()).toMatchObject([{
      provider: "api.example.test",
      lastOutcome: "success",
      lastStatus: 200,
      lastAttempts: 2,
      lastRetries: 1,
      lastError: null,
    }]);
  });

  it("garde un compteur exact par réponse lorsque deux appels parallèles partagent le fournisseur", async () => {
    let retryCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/once")) return new Response("not found", { status: 404 });
      retryCallCount += 1;
      if (retryCallCount === 1) return new Response("temporary", { status: 503 });
      return new Response(JSON.stringify({ recovered: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [singleAttempt, retried] = await Promise.all([
      fetchWeather("https://api.example.test/once", {}, { attempts: 2, cacheTtlMs: 0 }),
      fetchWeather("https://api.example.test/retry", {}, { attempts: 2, cacheTtlMs: 0 }),
    ]);

    expect(singleAttempt.status).toBe(404);
    expect(getWeatherResponseAttemptCount(singleAttempt)).toBe(1);
    expect(retried.status).toBe(200);
    expect(getWeatherResponseAttemptCount(retried)).toBe(2);
  });

  it("expose une erreur HTTP réelle sans fraîcheur ni statut fictifs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("indisponible", { status: 404 })));

    const response = await fetchWeather("https://meteo.example.test/daily", {}, { cacheTtlMs: 0 });

    expect(response.status).toBe(404);
    expect(getWeatherProviderDiagnostics()).toMatchObject([{
      provider: "meteo.example.test",
      lastOutcome: "http_error",
      lastStatus: 404,
      lastAttempts: 1,
      lastRetries: 0,
      freshnessMs: null,
    }]);
  });

  it("ne réitère jamais un 4xx non transitoire, mais réitère 429 et 5xx dans la borne demandée", async () => {
    const forbidden = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", forbidden);
    const response403 = await fetchWeather("https://api.example.test/forbidden", {}, { attempts: 3, cacheTtlMs: 0 });
    expect(response403.status).toBe(403);
    expect(forbidden).toHaveBeenCalledTimes(1);

    const transient = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", transient);
    const recovered = await fetchWeather("https://api.example.test/transient", {}, { attempts: 3, cacheTtlMs: 0 });
    expect(recovered.status).toBe(200);
    expect(transient).toHaveBeenCalledTimes(3);
    expect(getWeatherResponseAttemptCount(recovered)).toBe(3);
  });

  it("coalesce deux GET froids identiques en un seul appel fournisseur et rend deux corps lisibles", async () => {
    let resolveNetwork!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveNetwork = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const first = fetchWeather("https://api.example.test/coalesced", {}, { cacheTtlMs: 10_000 });
    const second = fetchWeather("https://api.example.test/coalesced", {}, { cacheTtlMs: 10_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getWeatherFetchCacheMetrics()).toMatchObject({ inFlight: 1, misses: 1 });
    resolveNetwork(new Response(JSON.stringify({ shared: true }), { status: 200 }));

    const [one, two] = await Promise.all([first, second]);
    expect(await one.json()).toEqual({ shared: true });
    expect(await two.json()).toEqual({ shared: true });
    expect(getWeatherResponseAttemptCount(one)).toBe(1);
    expect(getWeatherResponseAttemptCount(two)).toBe(1);
  });

  it("propage un AbortSignal appelant au fournisseur et ne relance pas l’abandon", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = fetchWeather("https://api.example.test/cancel", { signal: controller.signal }, { attempts: 3, timeoutMs: 5_000, cacheTtlMs: 0 });
    controller.abort(new DOMException("interactive budget", "AbortError"));

    await expect(pending).rejects.toThrow("interactive budget");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("évince en LRU le cache de réponses borné", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => new Response(JSON.stringify({ url: String(input) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 0; index < WEATHER_FETCH_CACHE_MAX_ENTRIES + 2; index += 1) {
      await fetchWeather(`https://api.example.test/lru/${index}`, {}, { cacheTtlMs: 10_000 });
    }
    expect(getWeatherFetchCacheMetrics().entries).toBe(WEATHER_FETCH_CACHE_MAX_ENTRIES);
  });
});
