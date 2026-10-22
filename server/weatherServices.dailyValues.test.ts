import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWeatherMock } = vi.hoisted(() => ({ fetchWeatherMock: vi.fn() }));

vi.mock("./weatherFetch", () => ({
  fetchWeather: fetchWeatherMock,
  getWeatherResponseAttemptCount: vi.fn(() => 1),
}));

import { DAILY_FORECAST_REQUEST_KEYS } from "./forecastVariableCoverage";
import { collectExpertForecastsWithDiagnostics, getModelRequestedForecastDays } from "./weatherServices";

const targetDate = "2026-10-02";
const days = Array.from({ length: 16 }, (_, index) => {
  const date = new Date(`${targetDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

function responseForDaily(daily: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ daily }),
  } as Response;
}

function completeDaily(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    time: days,
    temperature_2m_max: days.map(() => 12),
    temperature_2m_min: days.map(() => 4),
    precipitation_sum: days.map(() => 0),
    wind_speed_10m_max: days.map(() => 10),
    wind_gusts_10m_max: days.map(() => 20),
    relative_humidity_2m_mean: days.map(() => 50),
    cloud_cover_mean: days.map(() => 30),
    ...overrides,
  };
}

describe("collectExpertForecasts — collecte quotidienne par variable", () => {
  beforeEach(() => fetchWeatherMock.mockReset());

  it("continue à demander les deux moyennes non documentées et distingue leur disponibilité par modèle", async () => {
    fetchWeatherMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://api.open-meteo.com");
      const isArome = url.searchParams.get("models") === "meteofrance_arome_france_hd";
      return responseForDaily(completeDaily({
        precipitation_sum: days.map(() => 0),
        cloud_cover_mean: days.map(() => isArome ? null : 30),
      }));
    });

    const result = await collectExpertForecastsWithDiagnostics(targetDate);

    expect(result.forecasts).toHaveLength(8);
    expect(fetchWeatherMock).toHaveBeenCalledTimes(8);
    const requested = new URL(String(fetchWeatherMock.mock.calls[0][0]), "https://api.open-meteo.com").searchParams.get("daily")!.split(",");
    expect(requested).toEqual(DAILY_FORECAST_REQUEST_KEYS);
    expect(requested).toContain("relative_humidity_2m_mean");
    expect(requested).toContain("cloud_cover_mean");

    const aromeCoverage = result.diagnostics.find((model) => model.modelName === "AROME")!;
    expect(aromeCoverage.status).toBe("partial");
    expect(aromeCoverage.variables.find((variable) => variable.key === "relative_humidity_2m_mean"))
      .toMatchObject({ requested: true, documentationStatus: "unconfirmed", status: "available", receivedCount: 2 });
    expect(aromeCoverage.variables.find((variable) => variable.key === "cloud_cover_mean"))
      .toMatchObject({ requested: true, documentationStatus: "unconfirmed", status: "missing", receivedCount: 0, missingCount: 2 });
    expect(result.forecasts.find((model) => model.serviceName === "AROME"))
      .toMatchObject({ precipitation: 0, humidity: 50, cloudCover: null });
    expect(result.diagnostics.find((model) => model.modelName === "ARPEGE")?.variables.find((variable) => variable.key === "cloud_cover_mean"))
      .toMatchObject({ status: "available", receivedCount: 4 });
  });

  it("borne l’horizon demandé par modèle sans retirer les variables possibles", async () => {
    fetchWeatherMock.mockResolvedValue(responseForDaily(completeDaily()));

    await collectExpertForecastsWithDiagnostics(targetDate);

    const requestByModel = new Map(fetchWeatherMock.mock.calls.map(([input]) => {
      const url = new URL(String(input), "https://api.open-meteo.com");
      return [url.searchParams.get("models") ?? "best_match", url] as const;
    }));
    expect(requestByModel.get("meteofrance_arome_france_hd")?.searchParams.get("forecast_days")).toBe("2");
    expect(requestByModel.get("meteofrance_arpege_europe")?.searchParams.get("forecast_days")).toBe("4");
    expect(requestByModel.get("dwd_icon_eu")?.searchParams.get("forecast_days")).toBe("5");
    expect(requestByModel.get("ecmwf_ifs025")?.searchParams.get("forecast_days")).toBe("15");
    expect(requestByModel.get("gfs_seamless")?.searchParams.get("forecast_days")).toBe("16");
    expect(requestByModel.get("gem_seamless")?.searchParams.get("forecast_days")).toBe("10");
    expect(requestByModel.get("ukmo_seamless")?.searchParams.get("forecast_days")).toBe("7");
    expect(requestByModel.get("meteofrance_arome_france_hd")?.searchParams.get("daily")?.split(","))
      .toEqual(DAILY_FORECAST_REQUEST_KEYS);
    expect(getModelRequestedForecastDays("AROME")).toBe(2);
    expect(getModelRequestedForecastDays("Open-Meteo")).toBe(16);
  });

  it("ne transforme pas une réponse datée mais vide en forecast ou en succès artificiel", async () => {
    fetchWeatherMock.mockResolvedValue(responseForDaily({
      time: [targetDate],
      temperature_2m_max: [null], temperature_2m_min: [null], precipitation_sum: [null],
      wind_speed_10m_max: [null], wind_gusts_10m_max: [null],
      relative_humidity_2m_mean: [null], cloud_cover_mean: [null],
    }));

    const result = await collectExpertForecastsWithDiagnostics(targetDate);

    expect(result.forecasts).toEqual([]);
    expect(result.diagnostics).toHaveLength(8);
    expect(result.diagnostics.every((model) => model.status === "partial" && model.errorCode === "no_usable_data")).toBe(true);
    expect(result.diagnostics[0].variables.find((variable) => variable.key === "relative_humidity_2m_mean"))
      .toMatchObject({ requested: true, status: "out_of_horizon", receivedCount: 0 });
  });

  it("conserve zéro millimètre comme valeur valide et archive les deux moyennes réellement reçues", async () => {
    fetchWeatherMock.mockResolvedValue(responseForDaily(completeDaily({
      precipitation_sum: days.map(() => 0),
      relative_humidity_2m_mean: days.map(() => 48),
      cloud_cover_mean: days.map(() => 22),
    })));

    const result = await collectExpertForecastsWithDiagnostics(targetDate);
    expect(result.forecasts).toHaveLength(8);
    expect(result.forecasts[0]).toMatchObject({ precipitation: 0, humidity: 48, cloudCover: 22 });
  });

  it("classe un refus fournisseur comme échec plutôt que champ absent dans une réponse valide", async () => {
    fetchWeatherMock.mockImplementation(async (input: RequestInfo | URL) => {
      const modelId = new URL(String(input), "https://api.open-meteo.com").searchParams.get("models");
      return modelId === "meteofrance_arome_france_hd"
        ? responseForDaily({}, 400)
        : responseForDaily(completeDaily());
    });

    const result = await collectExpertForecastsWithDiagnostics(targetDate);
    expect(result.diagnostics.find((model) => model.modelName === "AROME"))
      .toMatchObject({ status: "failed", errorCode: "provider_http_4xx" });
    expect(result.diagnostics.find((model) => model.modelName === "ARPEGE")?.status).toBe("succeeded");
  });
});
