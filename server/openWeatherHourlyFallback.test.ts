import { describe, expect, it, vi } from "vitest";
import type { HourlyPoint } from "./weatherServices";
import { OPENWEATHER_FORECAST_ENDPOINT } from "./openWeatherApi";
import { fillOpenWeatherHourlyGaps } from "./openWeatherHourlyFallback";

const VALID_AT = Date.parse("2026-10-06T12:00:00.000Z");
const API_KEY = "synthetic-test-key";

function officialHour(overrides: Partial<HourlyPoint> = {}): HourlyPoint {
  return {
    date: "2026-10-06",
    hour: "14:00",
    validAt: VALID_AT,
    temp: null,
    apparentTemp: null,
    precipitation: null,
    windSpeed: null,
    windGust: null,
    windDirection: null,
    cloudCover: null,
    humidity: null,
    uvIndex: null,
    condition: null,
    pressure: null,
    dewPoint: null,
    visibility: null,
    solarRadiation: null,
    cloudLow: null,
    cloudMid: null,
    cloudHigh: null,
    precipType: null,
    precipIntensity: null,
    multiModelMetrics: {
      source: "official_seven_models",
      bestMatchIncluded: false,
      expectedModelCount: 7,
      modelsExpected: [
        "AROME",
        "ARPEGE",
        "ICON",
        "ECMWF",
        "GFS",
        "GEM",
        "UKMET",
      ],
      configuredModelCount: 7,
      modelsConfigured: [
        "AROME",
        "ARPEGE",
        "ICON",
        "ECMWF",
        "GFS",
        "GEM",
        "UKMET",
      ],
      temperature: {
        mean: null,
        min: null,
        max: null,
        range: null,
        standardDeviation: null,
        availableModelCount: 0,
        weightedMean: null,
        modelsWithData: [],
        minModel: null,
        maxModel: null,
      },
      precipitation: null,
      dispersion: {
        windSpeed: {
          range: null,
          standardDeviation: null,
          availableModelCount: 0,
        },
        windGust: {
          range: null,
          standardDeviation: null,
          availableModelCount: 0,
        },
        windDirection: {
          range: null,
          standardDeviation: null,
          availableModelCount: 0,
        },
        humidity: {
          range: null,
          standardDeviation: null,
          availableModelCount: 0,
        },
        cloudCover: {
          range: null,
          standardDeviation: null,
          availableModelCount: 0,
        },
      },
    },
    ...overrides,
  };
}

function point(overrides: Record<string, unknown> = {}) {
  return {
    dt: VALID_AT / 1000,
    main: { temp: 22.5, humidity: 55 },
    wind: { speed: 10, deg: 2 },
    clouds: { all: 60 },
    ...overrides,
  };
}

function forecastResponse(list: unknown[], status = 200) {
  return new Response(JSON.stringify({ list }), { status });
}

const fixedNow = () => Date.parse("2026-10-06T12:05:00.000Z");

describe("repli horaire OpenWeather champ par champ", () => {
  it("ne fait aucune requête sans clé et laisse les valeurs manquantes inconnues", async () => {
    const fetchImpl = vi.fn();
    const original = officialHour();
    const result = await fillOpenWeatherHourlyGaps({
      apiKey: "",
      lat: 50,
      lon: 2,
      hours: [original],
      fetchImpl,
      now: fixedNow,
    });

    expect(result.hours[0]).toEqual(original);
    expect(result.diagnostics).toMatchObject({
      status: "missing-key",
      attempted: false,
      requestedMissingValueCount: 5,
      filledValueCount: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ne consulte pas OpenWeather si aucun trou exact n’existe, et préserve les zéros", async () => {
    const fetchImpl = vi.fn();
    const original = officialHour({
      temp: 0,
      windSpeed: 0,
      windDirection: 0,
      humidity: 0,
      cloudCover: 0,
    });
    const result = await fillOpenWeatherHourlyGaps({
      apiKey: API_KEY,
      lat: 50,
      lon: 2,
      hours: [original],
      fetchImpl,
      now: fixedNow,
    });

    expect(result.hours[0]).toEqual(original);
    expect(result.diagnostics.status).toBe("not-needed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("complète uniquement les champs nuls à validTime égal et garde poids, autres champs et provenance officielle intacts", async () => {
    const official = officialHour({
      temp: 0,
      windSpeed: 12,
      windDirection: null,
      humidity: null,
      cloudCover: 80,
    });
    const fetchImpl = vi.fn(async () => forecastResponse([point()]));
    const result = await fillOpenWeatherHourlyGaps({
      apiKey: API_KEY,
      lat: 50.7567,
      lon: 2.5204,
      hours: [official, officialHour({ validAt: VALID_AT + 60_000 })],
      fetchImpl,
      now: fixedNow,
    });

    expect(result.diagnostics).toMatchObject({
      status: "partial",
      attempted: true,
      requestedMissingValueCount: 7,
      filledValueCount: 2,
      retrievedAt: "2026-10-06T12:05:00.000Z",
      providerRunAt: null,
      upstreamFreshness: "unknown",
    });
    expect(result.hours[0]).toMatchObject({
      temp: 0,
      windSpeed: 12,
      windDirection: 2,
      humidity: 55,
      cloudCover: 80,
      precipitation: null,
      windGust: null,
    });
    expect(result.hours[0]?.fallbackProvenance).toMatchObject({
      windDirection: {
        provider: "OpenWeatherMap",
        validAt: VALID_AT,
        retrievedAt: "2026-10-06T12:05:00.000Z",
        providerRunAt: null,
        upstreamFreshness: "unknown",
      },
      humidity: { provider: "OpenWeatherMap" },
    });
    expect(result.hours[0]?.fallbackProvenance).not.toHaveProperty(
      "temperature"
    );
    expect(result.hours[0]?.multiModelMetrics).toBe(official.multiModelMetrics);
    expect(result.hours[1]?.fallbackProvenance).toBeUndefined();
    expect(result.hours[1]?.humidity).toBeNull();

    const [url] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain(`${OPENWEATHER_FORECAST_ENDPOINT}?`);
    expect(url.searchParams.get("cnt")).toBe("40");
    expect(url.searchParams.get("units")).toBe("metric");
    expect(url.searchParams.get("appid")).toBe(API_KEY);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("refuse les timestamps proches, les heures officielles dupliquées et les timestamps OpenWeather dupliqués", async () => {
    const fetchImpl = vi.fn(async () =>
      forecastResponse([
        point(),
        point(),
        { ...point(), dt: VALID_AT / 1000 + 120 },
      ])
    );
    const duplicateOfficial = officialHour({ validAt: VALID_AT });
    const result = await fillOpenWeatherHourlyGaps({
      apiKey: API_KEY,
      lat: 50,
      lon: 2,
      hours: [
        duplicateOfficial,
        { ...duplicateOfficial },
        officialHour({ validAt: VALID_AT + 60_000 }),
      ],
      fetchImpl,
      now: fixedNow,
    });

    expect(result.diagnostics).toMatchObject({
      status: "no-exact-values",
      requestedMissingValueCount: 5,
      filledValueCount: 0,
      ignoredDuplicateOfficialValidTimeCount: 1,
      duplicateOpenWeatherValidTimeCount: 1,
    });
    expect(result.hours[0]?.temp).toBeNull();
    expect(result.hours[1]?.humidity).toBeNull();
    expect(result.hours[2]?.temp).toBeNull();
    expect(
      result.hours.every(hour => hour.fallbackProvenance === undefined)
    ).toBe(true);
  });

  it("conserve les données officielles si OpenWeather renvoie une erreur et n’expose ni clé ni payload d’erreur", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: API_KEY }), { status: 401 })
    );
    const original = officialHour();
    const result = await fillOpenWeatherHourlyGaps({
      apiKey: API_KEY,
      lat: 50,
      lon: 2,
      hours: [original],
      fetchImpl,
      now: fixedNow,
    });

    expect(result.hours[0]).toEqual(original);
    expect(result.diagnostics).toMatchObject({
      status: "request-impossible",
      attempted: true,
      errorCode: "http-401",
      filledValueCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(JSON.stringify(result)).not.toContain("message");
  });

  it("écarte les valeurs hors domaine et les réponses mal formées sans créer de valeur", async () => {
    const fetchImpl = vi.fn(async () =>
      forecastResponse([
        point({
          main: { temp: null, humidity: 101 },
          wind: { speed: -1, deg: 361 },
          clouds: { all: -2 },
        }),
        { dt: "invalid", main: {}, wind: {}, clouds: {} },
      ])
    );
    const result = await fillOpenWeatherHourlyGaps({
      apiKey: API_KEY,
      lat: 50,
      lon: 2,
      hours: [officialHour()],
      fetchImpl,
      now: fixedNow,
    });

    expect(result.diagnostics).toMatchObject({
      status: "no-exact-values",
      filledValueCount: 0,
      invalidOpenWeatherPointCount: 1,
    });
    expect(result.hours[0]).toMatchObject({
      temp: null,
      windSpeed: null,
      windDirection: null,
      humidity: null,
      cloudCover: null,
    });

    const malformed = await fillOpenWeatherHourlyGaps({
      apiKey: API_KEY,
      lat: 50,
      lon: 2,
      hours: [officialHour()],
      fetchImpl: vi.fn(
        async () =>
          new Response(JSON.stringify({ cod: "200", list: null }), {
            status: 200,
          })
      ),
      now: fixedNow,
    });
    expect(malformed.diagnostics).toMatchObject({
      status: "request-impossible",
      errorCode: "invalid-response",
      filledValueCount: 0,
    });
    expect(malformed.hours[0]?.temp).toBeNull();
  });
});
