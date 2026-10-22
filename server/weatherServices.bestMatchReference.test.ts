import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./weatherFetch", () => ({
  fetchWeather: vi.fn(),
  getWeatherResponseAttemptCount: vi.fn(() => 1),
}));

import { fetchWeather } from "./weatherFetch";
import { collect15DayForecast, collectCurrentWeatherSnapshot, collectHourlyForecast, OFFICIAL_HOURLY_MODELS } from "./weatherServices";
import { computeOfficialDailyForecastWithDiagnostics } from "./officialForecast";
import { DAILY_FUSION_METRICS, type DailyFusionHorizon, type ModelPerformanceEvidence } from "./fusionPerformance";

const mockedFetchWeather = vi.mocked(fetchWeather);

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("collectHourlyForecast auxiliaire", () => {
  beforeEach(() => mockedFetchWeather.mockReset());

  it("préserve les prévisions des échéances active et future sans demander ni injecter current", async () => {
    mockedFetchWeather.mockResolvedValue(response({
      current: {
        time: Date.parse("2026-10-01T09:45:00.000Z") / 1000,
        temperature_2m: 99,
      },
      hourly: {
        time: [
          Date.parse("2026-10-01T08:00:00.000Z") / 1000,
          Date.parse("2026-10-01T09:00:00.000Z") / 1000,
          Date.parse("2026-10-01T10:00:00.000Z") / 1000,
        ],
        temperature_2m: [9, 11, 12],
        apparent_temperature: [9, 11, 12],
        precipitation: [0, 0, 0],
        wind_speed_10m: [0, 0, 0],
        wind_gusts_10m: [0, 0, 0],
        wind_direction_10m: [0, 0, 0],
        cloud_cover: [0, 0, 0],
        relative_humidity_2m: [0, 0, 0],
        uv_index: [0, 0, 0],
        surface_pressure: [1013, 1013, 1013],
        dew_point_2m: [0, 0, 0],
        visibility: [0, 0, 0],
        shortwave_radiation: [0, 0, 0],
        weather_code: [0, 0, 0],
      },
    }));

    const hours = await collectHourlyForecast(
      "2026-10-01",
      { lat: 50.7567, lon: 2.5204 },
      1,
      { now: Date.parse("2026-10-01T09:30:00.000Z") },
    );

    expect(mockedFetchWeather).toHaveBeenCalledTimes(1);
    const request = new URL(String(mockedFetchWeather.mock.calls[0]?.[0]));
    expect(request.searchParams.has("current")).toBe(false);
    expect(request.searchParams.get("timeformat")).toBe("unixtime");
    expect(hours.map(({ hour, temp, validAt }) => [hour, temp, validAt])).toEqual([
      ["11:00", 11, Date.parse("2026-10-01T09:00:00.000Z")],
      ["12:00", 12, Date.parse("2026-10-01T10:00:00.000Z")],
    ]);
    expect(hours[0]?.multiModelMetrics).toBeUndefined();
  });

  it("ne convertit pas des quantités de précipitation null en zéros lors du calcul d’intensité", async () => {
    mockedFetchWeather.mockResolvedValue(response({
      hourly: {
        time: [
          Date.parse("2026-10-01T01:00:00.000Z") / 1000,
          Date.parse("2026-10-01T02:00:00.000Z") / 1000,
          Date.parse("2026-10-01T03:00:00.000Z") / 1000,
        ],
        temperature_2m: [10, 10, 10],
        precipitation: [null, 1, 0],
        snowfall: [null, null, 0],
        weather_code: [61, 61, 0],
      },
    }));

    const hours = await collectHourlyForecast(
      "2026-10-01",
      { lat: 50.7567, lon: 2.5204 },
      1,
      { now: Date.parse("2026-10-01T00:00:00.000Z") },
    );

    expect(hours.map(({ precipitation, precipType, precipIntensity }) => [precipitation, precipType, precipIntensity])).toEqual([
      [null, null, null],
      [1, "rain", null],
      [0, null, null],
    ]);
  });

  it("n’infère pas la pluie verglaçante depuis la température seule et conserve les phases WMO explicites", async () => {
    mockedFetchWeather.mockResolvedValue(response({
      hourly: {
        time: [1, 2, 3, 4, 5, 6].map((hour) => Date.parse(`2026-10-01T0${hour}:00:00.000Z`) / 1000),
        temperature_2m: [-2, -2, -2, 8, -2, -2],
        precipitation: [1, 1, 1, 1, 1, 1],
        snowfall: [0, 0, 0, 0, 0, 1],
        weather_code: [null, 61, 67, 71, null, null],
      },
    }));

    const hours = await collectHourlyForecast(
      "2026-10-01",
      { lat: 50.7567, lon: 2.5204 },
      1,
      { now: Date.parse("2026-10-01T00:00:00.000Z") },
    );

    expect(hours.map(({ precipitation, precipType }) => [precipitation, precipType])).toEqual([
      [1, null],
      [1, "rain"],
      [1, "freezing_rain"],
      [1, "snow"],
      [1, null],
      [1, "snow"],
    ]);
  });

  it("retourne le snapshot current avec une provenance modèle explicite", async () => {
    mockedFetchWeather.mockResolvedValue(response({
      current: {
        time: Date.parse("2026-10-01T09:45:00.000Z") / 1000,
        temperature_2m: 19,
        apparent_temperature: 18,
        precipitation: 0,
        wind_speed_10m: 6,
        wind_gusts_10m: 9,
        wind_direction_10m: 180,
        cloud_cover: 20,
        relative_humidity_2m: 60,
        weather_code: 1,
      },
    }));

    const snapshot = await collectCurrentWeatherSnapshot({ lat: 50.7567, lon: 2.5204 });
    const request = new URL(String(mockedFetchWeather.mock.calls[0]?.[0]));

    expect(request.searchParams.has("current")).toBe(true);
    expect(request.searchParams.has("hourly")).toBe(false);
    expect(snapshot).toMatchObject({
      sourceKind: "model_current_snapshot",
      source: "open-meteo",
      capturedAt: "2026-10-01T09:45:00.000Z",
      temp: 19,
      apparentTemp: 18,
    });
  });

  it("conserve les deux échéances 02:00 distinctes lors du retour à l’heure d’hiver", async () => {
    mockedFetchWeather.mockResolvedValue(response({
      hourly: {
        time: [
          Date.parse("2026-10-24T23:00:00.000Z") / 1000,
          Date.parse("2026-10-25T00:00:00.000Z") / 1000,
          Date.parse("2026-10-25T01:00:00.000Z") / 1000,
        ],
        temperature_2m: [9, 10, 11],
      },
    }));

    const hours = await collectHourlyForecast(
      "2026-10-25",
      { lat: 50.7567, lon: 2.5204 },
      1,
      { now: Date.parse("2026-10-25T00:30:00.000Z") },
    );

    expect(hours.map(({ date, hour, temp, validAt }) => [date, hour, temp, validAt])).toEqual([
      ["2026-10-25", "02:00", 10, Date.parse("2026-10-25T00:00:00.000Z")],
      ["2026-10-25", "02:00", 11, Date.parse("2026-10-25T01:00:00.000Z")],
    ]);
  });
});

describe("collect15DayForecast fusion officielle", () => {
  beforeEach(() => mockedFetchWeather.mockReset());

  it("fuse les preuves exactes, garde Best Match en référence et conserve une fusion à deux modèles", async () => {
    const issuedAt = Date.parse("2026-10-03T08:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(issuedAt + 60_000);
    const locationKey = "50.7567_2.5204";
    const datesByModel = [
      ["2026-10-03"],
      ["2026-10-03", "2026-10-04"],
      ["2026-10-03", "2026-10-04"],
      ["2026-10-03", "2026-10-04", "2026-10-05"],
      ["2026-10-03", "2026-10-04", "2026-10-05"],
      ["2026-10-03", "2026-10-04"],
      ["2026-10-03", "2026-10-04"],
      ["2026-10-03"],
    ];
    const dailyResponse = (modelIndex: number, dates: string[]) => response({
      daily: {
        time: dates,
        temperature_2m_max: dates.map(() => modelIndex === 7 ? 999 : 20 + modelIndex),
        temperature_2m_min: dates.map(() => modelIndex === 7 ? -999 : 10 + modelIndex),
        precipitation_sum: dates.map(() => modelIndex === 7 ? 999 : 0.2 + modelIndex),
        wind_speed_10m_max: dates.map(() => modelIndex === 7 ? 999 : 8 + modelIndex),
        wind_gusts_10m_max: dates.map(() => modelIndex === 7 ? 999 : 12 + modelIndex),
        wind_direction_10m_dominant: dates.map(() => modelIndex === 7 ? 225 : 90),
        uv_index_max: dates.map(() => modelIndex === 7 ? 0 : 9),
        apparent_temperature_max: dates.map(() => modelIndex === 7 ? 18.5 : 30),
        apparent_temperature_min: dates.map(() => modelIndex === 7 ? 8.5 : 20),
      },
    });
    datesByModel.forEach((dates, index) => mockedFetchWeather.mockResolvedValueOnce(dailyResponse(index, dates)));

    const evidence: ModelPerformanceEvidence[] = OFFICIAL_HOURLY_MODELS.flatMap((model, modelIndex) =>
      ( ["6-24h", "1-3d"] as DailyFusionHorizon[] ).flatMap((horizonBucket) => DAILY_FUSION_METRICS.map((variable) => ({
        locationKey,
        serviceName: model.name,
        modelId: model.modelId,
        variable,
        horizonBucket,
        comparisonCount: 500,
        sampleSize: 500,
        evaluatedDays: 500,
        mae: 0.4 + modelIndex * 0.1,
        rmse: 0.7 + modelIndex * 0.1,
        standardError: 0.02,
        signedBias: modelIndex - 3,
        latestScoreDate: "2026-10-02",
      }))),
    );
    const result = await collect15DayForecast(undefined, {
      issuedAt,
      resolveOfficialFusion: (targetDate, forecasts, collectionReferenceAt) => Promise.resolve(computeOfficialDailyForecastWithDiagnostics(forecasts, {
        locationKey,
        targetDate,
        issuedAt,
        referenceAt: collectionReferenceAt,
        evidenceStoreAvailable: true,
        evidence,
      })),
    });
    nowSpy.mockRestore();
    const [today, tomorrow, longRange] = result.days;

    expect(mockedFetchWeather).toHaveBeenCalledTimes(8);
    expect(mockedFetchWeather.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("forecast_days"))).toEqual(['2','4','5','15','16','10','7','16']);
    expect(result.modelsUsed).toContain("Open-Meteo");
    expect(result.modelsUsed).toHaveLength(8);
    expect(result.days.map(({ date }) => date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);

    expect(today).toMatchObject({
      tempMax: expect.any(Number),
      tempMin: expect.any(Number),
      precipitation: expect.any(Number),
      windSpeed: expect.any(Number),
      windGust: expect.any(Number),
      windDirection: 225,
      uvIndex: 0,
      feelsLikeMax: 18.5,
      feelsLikeMin: 8.5,
      officialFusion: { horizonBucket: "6-24h" },
      bestMatchReference: {
        source: "Open-Meteo Best Match",
        officialContributor: false,
        tempMax: 999,
        windDirection: 225,
        uvIndex: 0,
        feelsLikeMax: 18.5,
        feelsLikeMin: 8.5,
      },
    });
    expect(today!.tempMax).not.toBe(999);
    expect(today!.officialFusion.sourcesByVariable.tempMax).toHaveLength(7);
    expect(today!.officialFusion.diagnosticsByVariable?.tempMax).toMatchObject({
      status: "FUSED",
      availabilityStatus: "FUSED",
      calibrationStatus: "CALIBRATED",
      expectedModelCount: 7,
      availableValueModelCount: 7,
      evidenceEligibleModelCount: 7,
      contributingModelCount: 7,
    });
    expect(today!.officialFusion.sourcesByVariable.tempMin.every((source) => source.variable === "temperature_min" && source.horizonBucket === "6-24h")).toBe(true);
    expect(today!.officialFusion.sourcesByVariable.tempMax.every((source) => source.signedBias != null && source.latestScoreDate === "2026-10-02")).toBe(true);
    expect(today!.precipitationConsensus?.conditionalMeanMethod).toBe("historical_skill");
    expect(today!.modelAgreement.modelIssueTimeAvailable).toBe(false);
    expect(today!.modelAgreement.tempMax.range).not.toBeNull();
    expect(today!.modelAgreement.commonRunVerified).toBe(false);
    expect(today!.modelAgreement.tempMax.availableModelCount).toBe(7);

    expect(tomorrow!.officialFusion.horizonBucket).toBe("1-3d");
    expect(tomorrow!.tempMax).not.toBeNull();
    expect(tomorrow!.officialFusion.sourcesByVariable.tempMax.every((source) => source.horizonBucket === "1-3d")).toBe(true);
    expect(tomorrow!.bestMatchReference).toBeNull();
    expect(tomorrow).toMatchObject({ windDirection: null, uvIndex: null, feelsLikeMax: null, feelsLikeMin: null });

    expect(longRange!.officialFusion.horizonBucket).toBe("1-3d");
    expect(longRange!.modelAgreement.tempMax.availableModelCount).toBe(2);
    expect(longRange!.tempMax).not.toBeNull();
    expect(longRange!.precipitation).not.toBeNull();
    expect(longRange!.officialFusion.sourcesByVariable.tempMax).toHaveLength(2);
    expect(longRange!.officialFusion.diagnosticsByVariable?.tempMax).toMatchObject({
      status: "FUSED",
      availabilityStatus: "FUSED",
      calibrationStatus: "CALIBRATED",
      availableValueModelCount: 2,
      evidenceEligibleModelCount: 2,
      contributingModelCount: 2,
    });
    expect(longRange!.bestMatchReference).toBeNull();
  });

  it("collecte le code WMO au quotidien des seuls modèles officiels avec provenance et sans départager par Best Match", async () => {
    const issuedAt = Date.parse("2026-10-03T08:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(issuedAt + 60_000);
    const codesByModel = [null, 53, 53, 53, 61, 61, null, 0];
    let callIndex = 0;
    const requestedDailyFields: Array<{ modelId: string | null; dailyFields: string[]; hasRequestUrl: boolean }> = [];
    mockedFetchWeather.mockImplementation(async (input: RequestInfo | URL) => {
      const index = callIndex++;
      const requestUrl = input == null ? null : typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = requestUrl ? new URL(requestUrl, "https://api.open-meteo.com") : null;
      const modelId = url?.searchParams.get("models") ?? null;
      const dailyFields = url?.searchParams.get("daily")?.split(",") ?? [];
      requestedDailyFields.push({ modelId, dailyFields, hasRequestUrl: requestUrl != null });
      const code = codesByModel[index] ?? null;
      return response({
        daily: {
          time: ["2026-10-03"],
          temperature_2m_max: [20 + index], temperature_2m_min: [10 + index],
          precipitation_sum: [0], wind_speed_10m_max: [8], wind_gusts_10m_max: [12],
          weather_code: dailyFields.includes("weather_code") ? [code] : undefined,
        },
      });
    });

    const result = await collect15DayForecast(undefined, {
      issuedAt,
      resolveOfficialFusion: (targetDate, forecasts, collectionReferenceAt) => Promise.resolve(computeOfficialDailyForecastWithDiagnostics(forecasts, {
        locationKey: "50.7567_2.5204",
        targetDate,
        issuedAt,
        referenceAt: collectionReferenceAt,
        evidenceStoreAvailable: false,
        evidence: [],
      })),
    });
    expect(requestedDailyFields).toHaveLength(8);
    expect(requestedDailyFields.every(({ hasRequestUrl }) => hasRequestUrl)).toBe(true);
    expect(requestedDailyFields.map(({ modelId }) => modelId)).toEqual([...OFFICIAL_HOURLY_MODELS.map(({ modelId }) => modelId), null]);
    expect(requestedDailyFields.filter(({ modelId }) => modelId != null).every(({ dailyFields }) => dailyFields.includes("weather_code"))).toBe(true);
    expect(requestedDailyFields.find(({ modelId }) => modelId == null)?.dailyFields).not.toContain("weather_code");
    nowSpy.mockRestore();

    const day = result.days[0]!;
    expect(day).toMatchObject({ condition: "Bruine", weatherCode: 53 });
    expect(day).toMatchObject({ windDirection: null, uvIndex: null, feelsLikeMax: null, feelsLikeMin: null });
    expect(day.weatherCodeSummary).toMatchObject({
      validDate: "2026-10-03",
      timeZone: "Europe/Paris",
      expectedModelCount: 7,
      validModelCount: 5,
      supportingModelCount: 3,
      selectionMethod: "unique_plurality",
      calibrated: false,
    });
    expect(day.weatherCodeSummary!.modelCodes).toHaveLength(7);
    expect(day.weatherCodeSummary!.modelCodes[0]).toMatchObject({
      modelName: "AROME", valueStatus: "provider_null", sourceName: "open-meteo",
      runIdKind: "capture", validTime: expect.any(Number), availableAt: expect.any(Number),
    });
    expect(day.weatherCodeSummary!.modelCodes.some((source) => source.modelName === "Open-Meteo")).toBe(false);
  });
});
