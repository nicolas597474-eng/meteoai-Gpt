import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./weatherFetch", () => ({
  fetchWeather: vi.fn(),
  getWeatherResponseAttemptCount: vi.fn(() => 1),
}));

import { fetchWeather } from "./weatherFetch";
import { collectHourlyForecastAllModels, collectHourlyForecastAllModelsWithDiagnostics, OFFICIAL_HOURLY_MODELS } from "./weatherServices";
import { getParisHourlyTimestamps } from "./weatherTime";

const mockedFetchWeather = vi.mocked(fetchWeather);
const unixTimes = getParisHourlyTimestamps("2026-10-25").map((validAt) => validAt / 1000);
const completeHourly = {
  time: unixTimes,
  temperature_2m: unixTimes.map((_, index) => 10 + index),
  apparent_temperature: unixTimes.map((_, index) => 9 + index),
  precipitation: unixTimes.map((_, index) => index % 2 === 0 ? 0 : 0.1),
  rain: unixTimes.map((_, index) => index % 2 === 0 ? 0 : 0.1),
  showers: unixTimes.map(() => 0),
  snowfall: unixTimes.map(() => 0),
  wind_speed_10m: unixTimes.map((_, index) => 5 + index),
  wind_gusts_10m: unixTimes.map((_, index) => 9 + index),
  wind_direction_10m: unixTimes.map((_, index) => 180 + index),
  relative_humidity_2m: unixTimes.map((_, index) => 80 + index),
  surface_pressure: unixTimes.map((_, index) => 1012 - index),
  cloud_cover: unixTimes.map((_, index) => 50 + index),
  cloud_cover_low: unixTimes.map((_, index) => 10 + index),
  cloud_cover_mid: unixTimes.map((_, index) => 20 + index),
  cloud_cover_high: unixTimes.map((_, index) => 20 + index),
  weather_code: unixTimes.map((_, index) => index % 4),
  uv_index: unixTimes.map((_, index) => index % 8),
  dew_point_2m: unixTimes.map((_, index) => 5 + index),
  visibility: unixTimes.map(() => 24000),
  shortwave_radiation: unixTimes.map((_, index) => index * 100),
};
const completeResponse = () => ({
  timezone: "Europe/Paris",
  utc_offset_seconds: 3600,
  hourly_units: {
    temperature_2m: "°C", apparent_temperature: "°C", precipitation: "mm", rain: "mm", showers: "mm", snowfall: "cm",
    wind_speed_10m: "km/h", wind_gusts_10m: "km/h", wind_direction_10m: "°",
    relative_humidity_2m: "%", surface_pressure: "hPa", cloud_cover: "%", cloud_cover_low: "%", cloud_cover_mid: "%", cloud_cover_high: "%", weather_code: "wmo code",
    uv_index: "", dew_point_2m: "°C", visibility: "m", shortwave_radiation: "W/m²",
  },
  hourly: structuredClone(completeHourly),
});
const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

describe("collectHourlyForecastAllModels immutable run metadata", () => {
  beforeEach(() => {
    mockedFetchWeather.mockReset();
  });

  it("uses Unix valid times and preserves both repeated Paris 02:00 instants", async () => {
    mockedFetchWeather.mockResolvedValue(response(completeResponse()));

    const result = await collectHourlyForecastAllModelsWithDiagnostics(
      "2026-10-25",
      { lat: 50.7567, lon: 2.5204 },
      { includeBestMatch: false },
    );
    const forecasts = result.forecasts;

    expect(forecasts).toHaveLength(7);
    expect(result.diagnostics).toHaveLength(7);
    expect(result.diagnostics.every((item) => item.status === "succeeded" && item.hoursReceived === 25 && item.valuesReceived === 500 && item.expectedValueCount === 500 && item.expectedHoursCount === 25 && item.projectionReady)).toBe(true);
    expect(forecasts[0].hours[0]).toMatchObject({ rain: 0, showers: 0 });
    expect(forecasts[0].hours[0].visibility).toBe(24);
    expect(forecasts[0].sourceMetadata?.units).toMatchObject({ rain: "mm", showers: "mm", visibility: "km" });
    expect(forecasts[0].hours.map((hour) => hour.hour).slice(0, 5)).toEqual([0, 1, 2, 2, 3]);
    expect(forecasts[0].hours.map((hour) => hour.validAt)).toEqual(unixTimes.map((value) => value * 1000));
    expect(new Set(forecasts.map((forecast) => forecast.captureRunId)).size).toBe(7);
    expect(forecasts.every((forecast) => forecast.sourceName === "open-meteo" && forecast.availableAt! >= forecast.requestStartedAt!)).toBe(true);
    expect(forecasts.every((forecast) => forecast.providerRunAt === null)).toBe(true);

    const requestUrls = mockedFetchWeather.mock.calls.map(([input]) => new URL(String(input)));
    expect(requestUrls).toHaveLength(7);
    expect(requestUrls.map((url) => url.searchParams.get("models")).sort()).toEqual(OFFICIAL_HOURLY_MODELS.map(({ modelId }) => modelId).sort());
    expect(requestUrls.every((url) => url.searchParams.get("timeformat") === "unixtime")).toBe(true);
    expect(requestUrls.every((url) => url.searchParams.get("timezone") === "Europe/Paris")).toBe(true);
    expect(requestUrls.every((url) => url.searchParams.get("hourly")?.split(",").length === 20)).toBe(true);
    expect(requestUrls.every((url) => url.searchParams.get("hourly")?.includes("rain") && url.searchParams.get("hourly")?.includes("showers"))).toBe(true);
  });

  it("retries only incomplete providers and preserves successful sources when another returns HTTP errors", async () => {
    const modelIds = OFFICIAL_HOURLY_MODELS.map(({ modelId }) => modelId);
    const callsByModel = new Map<string, number>();
    mockedFetchWeather.mockImplementation(async (input) => {
      const modelId = new URL(String(input)).searchParams.get("models")!;
      const count = (callsByModel.get(modelId) ?? 0) + 1;
      callsByModel.set(modelId, count);
      if (modelId === modelIds[0] && count === 1) {
        return response({ hourly: { time: unixTimes, temperature_2m: [10, 11, 12] } });
      }
      if (modelId === modelIds[1]) return response({ error: "private/raw upstream body must not be stored" }, 503);
      return response(completeResponse());
    });

    const result = await collectHourlyForecastAllModelsWithDiagnostics(
      "2026-10-25",
      { lat: 50.7567, lon: 2.5204 },
      { includeBestMatch: false },
    );

    expect(result.diagnostics).toHaveLength(7);
    expect(result.forecasts).toHaveLength(6);
    expect(result.diagnostics.find((item) => item.modelId === modelIds[0])).toMatchObject({ status: "succeeded", attemptCount: 2, expectedHoursCount: 25, projectionReady: true });
    expect(result.diagnostics.find((item) => item.modelId === modelIds[1])).toMatchObject({ status: "failed", errorCode: "provider_http_5xx", attemptCount: 2, expectedValueCount: 500, projectionReady: false });
    expect(result.diagnostics.filter((item) => item.status === "succeeded")).toHaveLength(6);
    expect(mockedFetchWeather).toHaveBeenCalledTimes(9);
    expect(JSON.stringify(result.diagnostics)).not.toContain("private/raw upstream body");
  });

  it("classifies provider timeouts and malformed JSON without stopping other sources or leaking raw errors", async () => {
    const modelIds = OFFICIAL_HOURLY_MODELS.map(({ modelId }) => modelId);
    mockedFetchWeather.mockImplementation(async (input) => {
      const modelId = new URL(String(input)).searchParams.get("models")!;
      if (modelId === modelIds[0]) {
        const timeout = new Error("secret upstream timeout detail");
        timeout.name = "TimeoutError";
        throw timeout;
      }
      if (modelId === modelIds[1]) {
        return {
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError("raw malformed provider body"); },
        } as Response;
      }
      return response(completeResponse());
    });

    const result = await collectHourlyForecastAllModelsWithDiagnostics(
      "2026-10-25",
      { lat: 50.7567, lon: 2.5204 },
      { includeBestMatch: false },
    );

    expect(result.forecasts).toHaveLength(5);
    expect(result.diagnostics.find((item) => item.modelId === modelIds[0])).toMatchObject({ status: "safe_error", errorCode: "timeout", attemptCount: 3 });
    expect(result.diagnostics.find((item) => item.modelId === modelIds[1])).toMatchObject({ status: "failed", errorCode: "invalid_response", attemptCount: 2 });
    expect(result.diagnostics.filter((item) => item.status === "succeeded")).toHaveLength(5);
    expect(JSON.stringify(result.diagnostics)).not.toContain("secret upstream timeout detail");
    expect(JSON.stringify(result.diagnostics)).not.toContain("raw malformed provider body");
  });

  it("archives Best Match as a separate reference diagnostic, never as one of the seven official models", async () => {
    mockedFetchWeather.mockResolvedValue(response(completeResponse()));
    const result = await collectHourlyForecastAllModelsWithDiagnostics("2026-10-25", { lat: 50.7567, lon: 2.5204 });

    expect(result.forecasts).toHaveLength(8);
    expect(result.diagnostics.filter(({ modelId }) => modelId != null)).toHaveLength(7);
    expect(result.diagnostics.find(({ modelName }) => modelName === "best_match")).toMatchObject({ modelId: null, status: "succeeded" });
    const bestMatchRequest = mockedFetchWeather.mock.calls.map(([input]) => new URL(String(input))).find((url) => !url.searchParams.has("models"));
    expect(bestMatchRequest).toBeDefined();
  });

  it("normalise les nombres textuels et les unités reconnues avant persistance", async () => {
    const alternateUnits = completeResponse();
    alternateUnits.hourly.temperature_2m = unixTimes.map(() => "68" as unknown as number);
    alternateUnits.hourly.precipitation = unixTimes.map(() => 0.1);
    alternateUnits.hourly.rain = unixTimes.map(() => 0.1);
    alternateUnits.hourly.showers = unixTimes.map(() => 0.1);
    alternateUnits.hourly.wind_speed_10m = unixTimes.map(() => 10);
    alternateUnits.hourly_units.temperature_2m = "°F";
    alternateUnits.hourly_units.precipitation = "inch";
    alternateUnits.hourly_units.rain = "inch";
    alternateUnits.hourly_units.showers = "inch";
    alternateUnits.hourly_units.wind_speed_10m = "m/s";
    mockedFetchWeather.mockResolvedValue(response(alternateUnits));

    const result = await collectHourlyForecastAllModelsWithDiagnostics(
      "2026-10-25",
      { lat: 50.7567, lon: 2.5204 },
      { includeBestMatch: false },
    );

    expect(result.forecasts[0].hours[0]).toMatchObject({ temperature: 20, precipitation: 2.54, windSpeed: 36, visibility: 24 });
    expect(result.forecasts[0].sourceMetadata?.units).toMatchObject({ temperature: "°C", precipitation: "mm", windSpeed: "km/h", visibility: "km" });
    expect(result.diagnostics.every((item) => item.status === "succeeded" && item.projectionReady)).toBe(true);
    expect(result.diagnostics[0].variableDiagnostics?.find((variable) => variable.key === "temperature")?.slots[0])
      .toMatchObject({ status: "normalized", rawType: "string", rawValue: "68", rawUnit: "°F" });
  });

  it("conserve la grille complète quand les timestamps sont des chaînes Unix ou ISO explicitement zonées", async () => {
    for (const time of [
      unixTimes.map(String),
      unixTimes.map((seconds) => new Date(seconds * 1000).toISOString()),
    ]) {
      const stringTimes = completeResponse();
      stringTimes.hourly.time = time as unknown as number[];
      mockedFetchWeather.mockResolvedValue(response(stringTimes));

      const result = await collectHourlyForecastAllModelsWithDiagnostics(
        "2026-10-25",
        { lat: 50.7567, lon: 2.5204 },
        { includeBestMatch: false },
      );

      expect(result.forecasts).toHaveLength(7);
      expect(result.diagnostics.every((item) => item.status === "succeeded" && item.projectionReady && item.hoursReceived === 25)).toBe(true);
      expect(result.forecasts[0].hours.map((hour) => hour.validAt)).toEqual(unixTimes.map((seconds) => seconds * 1000));
    }
  });

  it("distingue une température fournisseur absente d’une chaîne numérique normalisée ou invalide", async () => {
    const mixedValues = completeResponse();
    mixedValues.hourly.temperature_2m[0] = "12.5" as unknown as number;
    mixedValues.hourly.temperature_2m[1] = null as unknown as number;
    mixedValues.hourly.temperature_2m[2] = "Infinity" as unknown as number;
    mockedFetchWeather.mockResolvedValue(response(mixedValues));

    const result = await collectHourlyForecastAllModelsWithDiagnostics(
      "2026-10-25",
      { lat: 50.7567, lon: 2.5204 },
      { includeBestMatch: false },
    );
    const forecast = result.forecasts.find((item) => item.modelName === "AROME")!;
    const diagnostic = result.diagnostics.find((item) => item.modelName === "AROME")!;
    const temperature = diagnostic.variableDiagnostics?.find((variable) => variable.key === "temperature")!;

    expect(forecast.hours.slice(0, 3).map((hour) => hour.temperature)).toEqual([12.5, null, null]);
    expect(temperature.slots.slice(0, 3).map((slot) => slot.status)).toEqual(["normalized", "provider_null", "invalid_value"]);
    expect(temperature.slots[2]).toMatchObject({ rawType: "string", rawValue: "Infinity", rawUnit: "°C" });
    expect(diagnostic).toMatchObject({ status: "partial", valuesReceived: 498, expectedValueCount: 500, projectionReady: false });
  });

  it("ne bloque plus la complétude du lot sur les champs d’archive secondaires nuls d’une projection complète", async () => {
    const partialArchive = completeResponse();
    for (const key of ["rain", "showers", "snowfall", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "uv_index", "dew_point_2m", "visibility", "shortwave_radiation"]) {
      partialArchive.hourly[key as keyof typeof partialArchive.hourly] = unixTimes.map(() => null) as never;
    }
    mockedFetchWeather.mockResolvedValue(response(partialArchive));

    const result = await collectHourlyForecastAllModelsWithDiagnostics("2026-10-25", { lat: 50.7567, lon: 2.5204 }, { includeBestMatch: false });

    expect(result.forecasts).toHaveLength(7);
    expect(result.diagnostics.every((item) => item.status === "succeeded" && item.projectionReady && item.valuesReceived === 250 && item.expectedValueCount === 500)).toBe(true);
    // Les nulls secondaires restent tracés dans les diagnostics par variable.
    const uv = result.diagnostics[0].variableDiagnostics?.find((variable) => variable.key === "uv_index")!;
    expect(uv.slots.every((slot) => slot.status === "provider_null")).toBe(true);
    expect(mockedFetchWeather).toHaveBeenCalledTimes(7);
  });

  it("retient une réponse exploitable à l’archive mais interdit sa projection si un champ actif manque", async () => {
    const missingProjectedField = completeResponse();
    missingProjectedField.hourly.surface_pressure = unixTimes.map(() => null);
    mockedFetchWeather.mockResolvedValue(response(missingProjectedField));

    const result = await collectHourlyForecastAllModelsWithDiagnostics("2026-10-25", { lat: 50.7567, lon: 2.5204 }, { includeBestMatch: false });

    expect(result.forecasts).toHaveLength(7);
    expect(result.diagnostics.every((item) => item.status === "partial" && !item.projectionReady && item.valuesReceived === 475 && item.expectedValueCount === 500)).toBe(true);
  });

  it("can return the target and next Paris day for the official 48-hour composite", async () => {
    const nextDayUnixTimes = [
      Date.parse("2026-10-01T22:00:00Z") / 1000,
      Date.parse("2026-10-02T22:00:00Z") / 1000,
    ];
    mockedFetchWeather.mockResolvedValue(response({ hourly: { time: nextDayUnixTimes, temperature_2m: [8, 9] } }));

    const forecasts = await collectHourlyForecastAllModels(
      "2026-10-02",
      { lat: 50.7567, lon: 2.5204 },
      { includeBestMatch: false, includeNextDay: true },
    );

    expect(forecasts).toHaveLength(7);
    expect(forecasts[0].hours.map((hour) => hour.validAt)).toEqual(nextDayUnixTimes.map((value) => value * 1000));
    expect(forecasts[0].hours.map((hour) => hour.hour)).toEqual([0, 0]);
    expect(mockedFetchWeather.mock.calls.map(([input]) => new URL(String(input))).every((url) => url.searchParams.get("hourly")?.includes("uv_index"))).toBe(true);
  });

  it("collects real official hours across an extended horizon without widening 48-hour completeness diagnostics", async () => {
    const coreUnixTimes = [
      ...getParisHourlyTimestamps("2026-10-02"),
      ...getParisHourlyTimestamps("2026-10-03"),
    ].map((validAt) => validAt / 1000);
    const laterValidAt = Date.parse("2026-10-04T10:00:00.000Z");
    const allUnixTimes = [...coreUnixTimes, laterValidAt / 1000];
    const extendedResponse = completeResponse();
    const hourly = extendedResponse.hourly as unknown as Record<string, unknown[]>;
    hourly.time = allUnixTimes;
    for (const [key, values] of Object.entries(completeHourly)) {
      if (key === "time") continue;
      hourly[key] = allUnixTimes.map((_, index) => values[index % values.length]);
    }
    mockedFetchWeather.mockResolvedValue(response(extendedResponse));

    const result = await collectHourlyForecastAllModelsWithDiagnostics(
      "2026-10-02",
      { lat: 50.7567, lon: 2.5204 },
      { includeBestMatch: false, includeNextDay: true, forecastDays: 16 },
    );

    expect(result.forecasts).toHaveLength(7);
    expect(result.forecasts[0]?.hours.map(({ validAt }) => validAt)).toContain(laterValidAt);
    const requestedHorizonByModel = new Map(mockedFetchWeather.mock.calls.map(([input]) => {
      const url = new URL(String(input));
      return [url.searchParams.get("models"), url.searchParams.get("forecast_days")] as const;
    }));
    expect(requestedHorizonByModel.get("meteofrance_arome_france_hd")).toBe("2");
    expect(requestedHorizonByModel.get("meteofrance_arpege_europe")).toBe("4");
    expect(requestedHorizonByModel.get("dwd_icon_eu")).toBe("5");
    expect(requestedHorizonByModel.get("ecmwf_ifs025")).toBe("15");
    expect(requestedHorizonByModel.get("gfs_seamless")).toBe("16");
    expect(requestedHorizonByModel.get("gem_seamless")).toBe("10");
    expect(requestedHorizonByModel.get("ukmo_seamless")).toBe("7");
    expect(result.diagnostics.every((diagnostic) => diagnostic.status === "succeeded"
      && diagnostic.hoursReceived === 48
      && diagnostic.valuesReceived === 960
      && diagnostic.expectedValueCount === 960
      && diagnostic.expectedHoursCount === 48
      && diagnostic.projectionReady)).toBe(true);
  });
});

describe("collectHourlyForecastAllModels latency budget (chemin interactif)", () => {
  beforeEach(() => {
    mockedFetchWeather.mockReset();
  });

  const partialResponse = () => ({
    ...completeResponse(),
    hourly: { time: unixTimes.slice(0, 3), temperature_2m: [10, 11, 12] },
  });
  const coords = { lat: 50.7567, lon: 2.5204 };

  it("transmet le délai par tentative demandé à chaque appel fournisseur", async () => {
    mockedFetchWeather.mockResolvedValue(response(completeResponse()));

    await collectHourlyForecastAllModelsWithDiagnostics("2026-10-25", coords, { includeBestMatch: false, timeoutMs: 10_000 });

    expect(mockedFetchWeather).toHaveBeenCalledTimes(OFFICIAL_HOURLY_MODELS.length);
    expect(mockedFetchWeather.mock.calls.every(([, , options]) => options?.timeoutMs === 10_000)).toBe(true);
  });

  it("ne relance pas les modèles incomplets quand le budget de latence est épuisé", async () => {
    mockedFetchWeather.mockResolvedValue(response(partialResponse()));

    const result = await collectHourlyForecastAllModelsWithDiagnostics("2026-10-25", coords, { includeBestMatch: false, retryBudgetMs: 0 });

    expect(mockedFetchWeather).toHaveBeenCalledTimes(OFFICIAL_HOURLY_MODELS.length);
    expect(result.diagnostics.every((item) => item.status !== "succeeded" && item.projectionReady === false)).toBe(true);
  });

  it("relance les modèles incomplets lorsqu'aucun budget n'est fixé (collecte planifiée inchangée)", async () => {
    mockedFetchWeather.mockResolvedValue(response(partialResponse()));

    await collectHourlyForecastAllModelsWithDiagnostics("2026-10-25", coords, { includeBestMatch: false });

    expect(mockedFetchWeather).toHaveBeenCalledTimes(OFFICIAL_HOURLY_MODELS.length * 2);
  });
});
