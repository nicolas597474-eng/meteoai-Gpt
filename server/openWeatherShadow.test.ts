import { describe, expect, it, vi } from "vitest";
import {
  compareOpenWeatherForecastWithOfficial,
  type OpenWeatherShadowOfficialHour,
} from "./openWeatherShadow";
import { OPENWEATHER_FORECAST_ENDPOINT } from "./openWeatherApi";

const VALID_AT = Date.parse("2026-10-06T12:00:00.000Z");
const officialHour = (
  overrides: Partial<OpenWeatherShadowOfficialHour> = {}
): OpenWeatherShadowOfficialHour => ({
  validAt: VALID_AT,
  temp: 20,
  windSpeed: 36,
  windDirection: 358,
  humidity: 50,
  cloudCover: 75,
  ...overrides,
});
const forecastResponse = (list: unknown[], status = 200) =>
  new Response(JSON.stringify({ list }), { status });
const point = (overrides: Record<string, unknown> = {}) => ({
  dt: VALID_AT / 1000,
  main: { temp: 22.5, humidity: 55, pressure: 1000 },
  wind: { speed: 10, deg: 2, gust: 13 },
  clouds: { all: 60 },
  rain: { "3h": 3 },
  ...overrides,
});

describe("comparaison OpenWeather strictement shadow", () => {
  it("ne fait aucune requête si la clé n’existe pas", async () => {
    const fetchImpl = vi.fn();
    const result = await compareOpenWeatherForecastWithOfficial({
      apiKey: "",
      lat: 50,
      lon: 2,
      officialHours: [officialHour()],
      fetchImpl,
    });
    expect(result.status).toBe("missing-key");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.comparisonRows).toEqual([]);
  });

  it("utilise seulement Forecast 5j/3h et apparie les cinq champs aux timestamps UTC exacts", async () => {
    const fetchImpl = vi.fn(async () => forecastResponse([point()]));
    const result = await compareOpenWeatherForecastWithOfficial({
      apiKey: "synthetic-test-key",
      lat: 50.7567,
      lon: 2.5204,
      officialHours: [officialHour()],
      fetchImpl,
      now: () => new Date("2026-10-06T13:00:00.000Z"),
    });

    expect(result.status).toBe("ok");
    expect(result.provenance.endpoint).toBe(OPENWEATHER_FORECAST_ENDPOINT);
    expect(result.provenance.role).toContain("ni modèle indépendant ni vote");
    expect(result.provenance.modelRunIdentifierAvailable).toBe(false);
    expect(result.exactCommonTimeCount).toBe(1);
    expect(result.comparisonRows).toHaveLength(5);
    expect(result.comparisonRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "temperature",
          openWeatherValue: 22.5,
          officialValue: 20,
          difference: 2.5,
        }),
        expect.objectContaining({
          field: "windSpeed",
          openWeatherValue: 36,
          officialValue: 36,
          difference: 0,
        }),
        expect.objectContaining({
          field: "windDirection",
          openWeatherValue: 2,
          officialValue: 358,
          difference: 4,
        }),
      ])
    );
    const [url] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("/data/2.5/forecast?");
    expect(url.searchParams.get("cnt")).toBe("40");
    expect(url.searchParams.get("units")).toBe("metric");
    expect(url.searchParams.get("appid")).toBe("synthetic-test-key");
    expect(JSON.stringify(result)).not.toContain("synthetic-test-key");
    expect(result.unsupportedFields.map(item => item.field)).toContain(
      "precipitation"
    );
    expect(
      result.unsupportedFields.find(item => item.field === "precipitation")
        ?.reason
    ).toContain("trois heures");
  });

  it("refuse tout appariement avec une échéance voisine, même à une minute près", async () => {
    const fetchImpl = vi.fn(async () => forecastResponse([point()]));
    const result = await compareOpenWeatherForecastWithOfficial({
      apiKey: "synthetic-test-key",
      lat: 50,
      lon: 2,
      officialHours: [officialHour({ validAt: VALID_AT + 60_000 })],
      fetchImpl,
    });
    expect(result.status).toBe("no-common-times");
    expect(result.comparisonRows).toEqual([]);
    expect(result.exactCommonTimeCount).toBe(0);
    expect(
      result.coverage.find(item => item.field === "temperature")
    ).toMatchObject({
      exactPairCount: 0,
      openWeatherOnlyTimes: [new Date(VALID_AT).toISOString()],
      officialOnlyTimes: [new Date(VALID_AT + 60_000).toISOString()],
    });
  });

  it("signale les valeurs et champs absents sans les remplir ni interpoler", async () => {
    const fetchImpl = vi.fn(async () =>
      forecastResponse([point({ wind: {}, clouds: {} })])
    );
    const result = await compareOpenWeatherForecastWithOfficial({
      apiKey: "synthetic-test-key",
      lat: 50,
      lon: 2,
      officialHours: [officialHour()],
      fetchImpl,
    });
    expect(result.status).toBe("partial");
    expect(result.comparisonRows.map(row => row.field)).not.toContain(
      "windSpeed"
    );
    expect(
      result.coverage.find(item => item.field === "windSpeed")
    ).toMatchObject({
      openWeatherValueCount: 0,
      officialValueCount: 1,
      exactPairCount: 0,
      officialOnlyTimes: [new Date(VALID_AT).toISOString()],
    });
  });

  it("ne retourne ni la clé ni le corps d’erreur lorsque l’API refuse la requête", async () => {
    const fetchImpl = vi.fn(async () => forecastResponse([], 401));
    const result = await compareOpenWeatherForecastWithOfficial({
      apiKey: "synthetic-test-key",
      lat: 50,
      lon: 2,
      officialHours: [officialHour()],
      fetchImpl,
    });
    expect(result.status).toBe("request-impossible");
    expect(JSON.stringify(result)).not.toContain("synthetic-test-key");
    expect(result.message).toContain("HTTP 401");
  });
});
