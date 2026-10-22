import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  expertServices: [
    "AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET", "Open-Meteo",
  ].map((name) => ({ name, modelId: name === "Open-Meteo" ? "best_match" : name.toLowerCase(), category: "expert" as const })),
  collectExpertForecasts: vi.fn(),
  collectExpertForecastsWithDiagnostics: vi.fn(),
  collectOfficialHourlyForecast: vi.fn(),
  acquireForecastRefreshLock: vi.fn(),
  releaseForecastRefreshLock: vi.fn(),
  getMeteoAIForecastByDate: vi.fn(),
  getQualifiedCumulativeRankingForLocation: vi.fn(),
  getQualifiedLeadTimeScoresForLocation: vi.fn(),
  getDailyFusionPerformanceEvidence: vi.fn(),
  getStoredHourlyForecasts: vi.fn(),
  insertForecastRuns: vi.fn(),
  insertForecasts: vi.fn(),
  insertHourlyForecasts: vi.fn(),
  upsertLocationForecast: vi.fn(),
  upsertMeteoAIForecast: vi.fn(),
  computeOfficialDailyForecast: vi.fn(),
  applyBiasCorrection: vi.fn(),
  cacheManualHourlyForecast: vi.fn(),
  persistedDailySnapshot: null as any,
  storedHourlyRows: [] as any[],
  failingHourlyModels: new Set<string>(),
}));

vi.mock("./weatherServices", () => ({
  WEATHER_SERVICES: { expert: mocks.expertServices },
  OFFICIAL_HOURLY_MODELS: mocks.expertServices
    .filter((service) => service.modelId !== "best_match")
    .map(({ name, modelId }) => ({ name, modelId })),
  collectExpertForecasts: mocks.collectExpertForecasts,
  collectExpertForecastsWithDiagnostics: mocks.collectExpertForecastsWithDiagnostics,
}));
vi.mock("./officialHourlyForecast", () => ({
  OFFICIAL_HOURLY_MODEL_NAMES: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"],
  collectOfficialHourlyForecast: mocks.collectOfficialHourlyForecast,
}));
vi.mock("./db", () => ({
  acquireForecastRefreshLock: mocks.acquireForecastRefreshLock,
  releaseForecastRefreshLock: mocks.releaseForecastRefreshLock,
  getMeteoAIForecastByDate: mocks.getMeteoAIForecastByDate,
  getQualifiedCumulativeRankingForLocation: mocks.getQualifiedCumulativeRankingForLocation,
  getQualifiedLeadTimeScoresForLocation: mocks.getQualifiedLeadTimeScoresForLocation,
  getDailyFusionPerformanceEvidence: mocks.getDailyFusionPerformanceEvidence,
  getStoredHourlyForecasts: mocks.getStoredHourlyForecasts,
  insertForecastRuns: mocks.insertForecastRuns,
  insertForecasts: mocks.insertForecasts,
  insertHourlyForecasts: mocks.insertHourlyForecasts,
  makeLocationKey: (lat: number, lon: number) => `${Math.round(lat * 1000) / 1000}_${Math.round(lon * 1000) / 1000}`,
  upsertLocationForecast: mocks.upsertLocationForecast,
  upsertMeteoAIForecast: mocks.upsertMeteoAIForecast,
}));
vi.mock("./officialWeatherSnapshot", () => ({ cacheManualHourlyForecast: mocks.cacheManualHourlyForecast }));
vi.mock("./weatherTime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./weatherTime")>();
  return { ...actual, getParisDate: () => "2026-09-30" };
});
vi.mock("./weatherConditionLabels", () => ({ conditionFromWeatherValues: () => "Nuageux" }));
vi.mock("./officialForecast", () => ({
  computeOfficialDailyForecast: mocks.computeOfficialDailyForecast,
}));
vi.mock("./fusionEngine", () => ({
  applyBiasCorrection: mocks.applyBiasCorrection,
  getLeadTimeWeights: () => ({}),
  isEligibleGlobalReliabilityScore: () => false,
}));

import { getParisHourlyTimestamps } from "./weatherTime";
import { isManualFusionCoolingDown, MANUAL_FUSION_COOLDOWN_MS, refreshManualFusionForFavorite } from "./manualFusion";

const favorite = { id: 9, userId: 4, lat: 50.7567, lon: 2.5204, name: "Hondeghem", customName: null };
const serviceNames = mocks.expertServices.map((service) => service.name);

function dailyModels(names = serviceNames) {
  const availableAt = Date.parse("2026-09-30T10:00:00.000Z");
  const validTime = Date.parse("2026-09-30T22:00:00.000Z");
  return names.map((serviceName) => ({
    serviceName,
    serviceCategory: "expert" as const,
    modelId: mocks.expertServices.find((service) => service.name === serviceName)?.modelId ?? null,
    sourceName: "open-meteo",
    runId: `${serviceName}-capture-20260930T1000Z`,
    runIdKind: "capture" as const,
    requestStartedAt: availableAt - 30_000,
    availableAt,
    validTime,
    tempMax: 23,
    tempMin: 12,
    precipitation: 0.4,
    windSpeed: 12,
    windGust: 20,
    humidity: 70,
    cloudCover: 60,
    condition: "Nuageux",
    rawData: { serviceName },
  }));
}

function displayHours(date = "2026-09-30") {
  return [14, 15].map((hour) => ({
    date,
    hour: `${String(hour).padStart(2, "0")}:00`,
    validAt: Date.parse(`${date}T${String(hour - 2).padStart(2, "0")}:00:00.000Z`),
    temp: 20 + hour / 10,
    apparentTemp: 20,
    precipitation: 0,
    windSpeed: 12,
    windGust: 18,
    windDirection: 190,
    cloudCover: 40,
    humidity: 60,
    uvIndex: 3,
    condition: "Nuageux",
    weatherCode: 3,
    pressure: 1012,
  }));
}

function hourlyModels(names = serviceNames.filter((name) => name !== "Open-Meteo")) {
  const validTimes = getParisHourlyTimestamps("2026-09-30");
  return names.map((modelName) => ({
    modelName,
    hours: validTimes.map((validAt, hour) => ({
      hour,
      validAt,
      temperature: 20 + hour / 10,
      apparentTemperature: 20,
      precipitation: 0,
      windSpeed: 12,
      windGusts: 18,
      windDirection: 190,
      humidity: 60,
      pressure: 1012,
      cloudCover: 40,
      weatherCode: 3,
    })),
  }));
}

const unavailableWeighting = {
  status: "unavailable" as const,
  historyStatus: "available" as const,
  historyWindowDays: 365,
  minimumComparisons: 30,
  minimumComparableDays: 7,
  bestMatchIncluded: false as const,
  modelsConsidered: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"] as const,
  modelsWithData: [],
  horizons: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.persistedDailySnapshot = null;
  mocks.storedHourlyRows = [];
  mocks.failingHourlyModels.clear();
  mocks.collectExpertForecasts.mockResolvedValue(dailyModels());
  mocks.collectExpertForecastsWithDiagnostics.mockResolvedValue({ forecasts: dailyModels(), availabilityReasonByModel: {} });
  mocks.collectOfficialHourlyForecast.mockResolvedValue({ modelForecasts: hourlyModels(), hours: displayHours(), weighting: unavailableWeighting });
  mocks.acquireForecastRefreshLock.mockResolvedValue(true);
  mocks.releaseForecastRefreshLock.mockResolvedValue(undefined);
  mocks.getMeteoAIForecastByDate.mockImplementation(async () => mocks.persistedDailySnapshot);
  mocks.getQualifiedCumulativeRankingForLocation.mockResolvedValue([]);
  mocks.getQualifiedLeadTimeScoresForLocation.mockResolvedValue([]);
  mocks.getDailyFusionPerformanceEvidence.mockResolvedValue({ available: true, evidence: [], horizonBucket: "6-24h" });
  mocks.computeOfficialDailyForecast.mockReturnValue({ tempMax: 23, tempMin: 12, precipitation: 0.4, windSpeed: 12, confidenceScore: 84, coreCalibrationComplete: true, methodNote: "Fusion calibrée", weights: {}, trace: {} });
  mocks.applyBiasCorrection.mockImplementation((forecasts: any[]) => forecasts.map((forecast) => ({
    ...forecast,
    tempMax: forecast.tempMax == null ? null : forecast.tempMax + 100,
    tempMin: forecast.tempMin == null ? null : forecast.tempMin + 100,
    precipitation: forecast.precipitation == null ? null : forecast.precipitation + 100,
  })));
  mocks.getStoredHourlyForecasts.mockImplementation(async () => mocks.storedHourlyRows.slice());
  mocks.insertForecasts.mockResolvedValue(undefined);
  mocks.insertForecastRuns.mockResolvedValue(undefined);
  mocks.upsertLocationForecast.mockResolvedValue(undefined);
  mocks.upsertMeteoAIForecast.mockImplementation(async (data: any) => {
    mocks.persistedDailySnapshot = { computedAt: data.computedAt, weights: data.weights };
  });
  mocks.insertHourlyForecasts.mockImplementation(async (rows: any[], options?: { refreshProjection?: boolean }) => {
    const first = rows[0];
    if (mocks.failingHourlyModels.has(first.modelName)) throw new Error("simulated write failure");
    if (options?.refreshProjection === false) return;
    mocks.storedHourlyRows = mocks.storedHourlyRows.filter((row) => !(row.locationKey === first.locationKey && row.date === first.date && row.modelName === first.modelName));
    mocks.storedHourlyRows.push(...rows.map((row) => ({ ...row })));
  });
});

describe("relance manuelle des prévisions", () => {
  it("bloque seulement les relances trop rapprochées", () => {
    const now = Date.parse("2026-08-16T15:00:00.000Z");
    expect(isManualFusionCoolingDown(new Date(now - MANUAL_FUSION_COOLDOWN_MS + 1), now)).toBe(true);
    expect(isManualFusionCoolingDown(new Date(now - MANUAL_FUSION_COOLDOWN_MS), now)).toBe(false);
    expect(isManualFusionCoolingDown(null, now)).toBe(false);
  });

  it("confirme les deux granularités, les timestamps et des lignes horaires uniques au bon lieu/date", async () => {
    const result = await refreshManualFusionForFavorite(favorite);

    expect(result.status).toBe("refreshed");
    if (result.status === "cooldown" || result.status === "in_progress") throw new Error("Unexpected status");
    expect(result.location).toEqual({ lat: favorite.lat, lon: favorite.lon });
    expect(result.daily).toMatchObject({ status: "succeeded", modelCount: 7, expectedModelCount: 7 });
    expect(result.hourly).toMatchObject({ status: "succeeded", modelCount: 7, expectedModelCount: 7 });
    expect(result.daily.updatedAt).toBeTruthy();
    expect(result.hourly.updatedAt).toBeTruthy();
    expect(mocks.collectExpertForecastsWithDiagnostics).toHaveBeenCalledTimes(1);
    expect(mocks.collectExpertForecastsWithDiagnostics).toHaveBeenCalledWith("2026-09-30", { lat: favorite.lat, lon: favorite.lon });
    expect(mocks.collectOfficialHourlyForecast).toHaveBeenCalledWith("2026-09-30", { lat: favorite.lat, lon: favorite.lon });
    expect(mocks.insertForecasts).toHaveBeenCalledTimes(1);
    expect(mocks.insertForecastRuns).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLocationForecast).toHaveBeenCalledTimes(1);
    expect(mocks.upsertLocationForecast.mock.calls[0][0]).not.toHaveProperty("tempCurrent");
    expect(mocks.upsertMeteoAIForecast).toHaveBeenCalledTimes(1);
    expect(mocks.upsertMeteoAIForecast.mock.calls[0][1]).toEqual({ refreshComputedAt: true });
    expect(mocks.insertHourlyForecasts).toHaveBeenCalledTimes(7);
    expect(mocks.storedHourlyRows).toHaveLength(168);
    expect(new Set(mocks.storedHourlyRows.map((row) => row.modelName)).size).toBe(7);
    expect(mocks.storedHourlyRows.some((row) => row.modelName === "best_match")).toBe(false);
    expect(mocks.storedHourlyRows.every((row) => row.locationKey === "50.757_2.52" && row.date === "2026-09-30")).toBe(true);
    expect(mocks.cacheManualHourlyForecast).toHaveBeenCalledTimes(1);
    expect(mocks.cacheManualHourlyForecast).toHaveBeenCalledWith(
      { lat: favorite.lat, lon: favorite.lon },
      "2026-09-30",
      displayHours(),
      expect.any(Date),
      unavailableWeighting,
      "Relance manuelle demandée explicitement; série recalculée par le moteur officiel avec les seuls runs horaires disponibles.",
    );
    expect(mocks.acquireForecastRefreshLock).toHaveBeenCalledWith("forecast-location:50.757_2.52", expect.any(String));
    expect(mocks.releaseForecastRefreshLock).toHaveBeenCalledWith("forecast-location:50.757_2.52", expect.any(String));

    const repeated = await refreshManualFusionForFavorite(favorite);
    expect(repeated.status).toBe("cooldown");
    expect(mocks.collectExpertForecastsWithDiagnostics).toHaveBeenCalledTimes(1);
    expect(mocks.insertHourlyForecasts).toHaveBeenCalledTimes(7);
  });

  it("archive un lot manuel incomplet sans remplacer la projection antérieure et mesure son âge", async () => {
    const oldCollectedAt = new Date("2026-09-29T22:00:00.000Z");
    const oldProjectionRows = hourlyModels(["AROME"])[0].hours.map((hour) => ({
      locationKey: "50.757_2.52",
      date: "2026-09-30",
      modelName: "AROME",
      hour: hour.hour,
      temperature: hour.temperature,
      apparentTemperature: hour.apparentTemperature,
      precipitation: hour.precipitation,
      windSpeed: hour.windSpeed,
      windGusts: hour.windGusts,
      windDirection: hour.windDirection,
      humidity: hour.humidity,
      pressure: hour.pressure,
      cloudCover: hour.cloudCover,
      weatherCode: hour.weatherCode,
      collectedAt: oldCollectedAt,
    }));
    mocks.storedHourlyRows = oldProjectionRows;
    const partialModels = hourlyModels();
    partialModels.find((model) => model.modelName === "AROME")!.hours[0].temperature = null;
    mocks.collectOfficialHourlyForecast.mockResolvedValue({ modelForecasts: partialModels, hours: displayHours(), weighting: unavailableWeighting });

    const result = await refreshManualFusionForFavorite(favorite);

    expect(result.status).toBe("partial");
    expect(result.hourly).toMatchObject({ status: "partial", modelCount: 6, expectedModelCount: 7, projectionRetainedModelCount: 1 });
    expect(result.hourly.retainedProjectionAgeMs).toBeGreaterThan(0);
    expect(result.hourly.error).toContain("projections précédentes existantes");
    expect(mocks.storedHourlyRows.filter((row) => row.modelName === "AROME")).toEqual(oldProjectionRows);
    const aromeWrite = mocks.insertHourlyForecasts.mock.calls.find(([rows]) => rows[0]?.modelName === "AROME");
    expect(aromeWrite?.[1]).toEqual({ refreshProjection: false });
  });

  it("n’applique pas un biais physique disponible à la fusion officielle ni aux nouvelles archives", async () => {
    mocks.getQualifiedCumulativeRankingForLocation.mockResolvedValue([
      { serviceName: "AROME", avgBiasTemp: 2, avgBiasPrecip: 3 },
    ]);

    await refreshManualFusionForFavorite(favorite);

    expect(mocks.getQualifiedCumulativeRankingForLocation).not.toHaveBeenCalled();
    expect(mocks.applyBiasCorrection).not.toHaveBeenCalled();
    const officialForecasts = mocks.computeOfficialDailyForecast.mock.calls[0]?.[0] as any[];
    expect(officialForecasts.find((forecast) => forecast.serviceName === "AROME")).toMatchObject({
      tempMax: 23,
      tempMin: 12,
      precipitation: 0.4,
    });
    const archivedRows = mocks.insertForecastRuns.mock.calls[0]?.[0] as any[];
    expect(archivedRows.find((row) => row.serviceName === "AROME")).toMatchObject({
      tempMax: 23,
      tempMin: 12,
      precipitation: 0.4,
    });
  });

  it("rapporte un succès partiel sans horodatage pour la granularité échouée", async () => {
    mocks.collectExpertForecastsWithDiagnostics.mockResolvedValue({ forecasts: [], availabilityReasonByModel: {} });
    mocks.collectOfficialHourlyForecast.mockResolvedValue({ modelForecasts: hourlyModels(), hours: displayHours(), weighting: unavailableWeighting });

    const result = await refreshManualFusionForFavorite(favorite);

    expect(result.status).toBe("partial");
    if (result.status !== "partial") throw new Error("Expected partial status");
    expect(result.daily).toMatchObject({ status: "failed", modelCount: 0, updatedAt: null });
    expect(result.hourly).toMatchObject({ status: "succeeded", modelCount: 7, expectedModelCount: 7 });
    expect(result.hourly.updatedAt).toBeTruthy();
    expect(result.daily.error).toBeTruthy();
    expect(mocks.cacheManualHourlyForecast).toHaveBeenCalledTimes(1);
  });

  it("rapporte l’âge de la projection complète conservée quand aucun nouveau modèle n’est exploitable", async () => {
    mocks.collectExpertForecastsWithDiagnostics.mockResolvedValue({ forecasts: [], availabilityReasonByModel: {} });
    mocks.collectOfficialHourlyForecast.mockResolvedValue({ modelForecasts: [], hours: [], weighting: unavailableWeighting });
    const oldCollectedAt = new Date("2026-09-29T22:00:00.000Z");
    mocks.storedHourlyRows = hourlyModels(["AROME"])[0].hours.map((hour) => ({
      locationKey: "50.757_2.52",
      date: "2026-09-30",
      modelName: "AROME",
      hour: hour.hour,
      temperature: hour.temperature,
      apparentTemperature: hour.apparentTemperature,
      precipitation: hour.precipitation,
      windSpeed: hour.windSpeed,
      windGusts: hour.windGusts,
      windDirection: hour.windDirection,
      humidity: hour.humidity,
      pressure: hour.pressure,
      cloudCover: hour.cloudCover,
      weatherCode: hour.weatherCode,
      collectedAt: oldCollectedAt,
    }));

    const result = await refreshManualFusionForFavorite(favorite);

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("Expected failure status");
    expect(result.daily).toMatchObject({ status: "failed", updatedAt: null });
    expect(result.hourly).toMatchObject({ status: "failed", updatedAt: null, projectionRetainedModelCount: 1 });
    expect(result.hourly.retainedProjectionAgeMs).toBeGreaterThan(0);
    expect(result.hourly.error).toContain("projections précédentes existantes");
    expect(mocks.insertForecasts).not.toHaveBeenCalled();
    expect(mocks.insertHourlyForecasts).not.toHaveBeenCalled();
  });

  it("ne lance pas de seconde collecte concurrente pour le même lieu", async () => {
    let releaseDaily!: (result: { forecasts: ReturnType<typeof dailyModels>; availabilityReasonByModel: Record<string, string> }) => void;
    mocks.collectExpertForecastsWithDiagnostics.mockImplementationOnce(() => new Promise((resolve) => { releaseDaily = resolve; }));

    const firstRun = refreshManualFusionForFavorite(favorite);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const concurrentRun = await refreshManualFusionForFavorite(favorite);
    expect(concurrentRun.status).toBe("in_progress");
    expect(mocks.collectExpertForecastsWithDiagnostics).toHaveBeenCalledTimes(1);
    expect(mocks.collectOfficialHourlyForecast).toHaveBeenCalledTimes(1);

    releaseDaily({ forecasts: dailyModels(), availabilityReasonByModel: {} });
    const completed = await firstRun;
    expect(completed.status).toBe("refreshed");
    expect(mocks.insertHourlyForecasts).toHaveBeenCalledTimes(7);
  });

  it("respecte un lease déjà pris par une collecte programmée sur le lieu", async () => {
    mocks.acquireForecastRefreshLock.mockResolvedValue(false);

    const result = await refreshManualFusionForFavorite(favorite);

    expect(result.status).toBe("in_progress");
    expect(mocks.collectExpertForecastsWithDiagnostics).not.toHaveBeenCalled();
    expect(mocks.collectOfficialHourlyForecast).not.toHaveBeenCalled();
    expect(mocks.releaseForecastRefreshLock).not.toHaveBeenCalled();
  });

  it("marque une écriture horaire en erreur comme partielle sans annoncer 7/7", async () => {
    mocks.failingHourlyModels.add("AROME");

    const result = await refreshManualFusionForFavorite(favorite);

    expect(result.status).toBe("partial");
    if (result.status !== "partial") throw new Error("Expected partial status");
    expect(result.daily.status).toBe("succeeded");
    expect(result.hourly).toMatchObject({ status: "partial", modelCount: 6, expectedModelCount: 7 });
    expect(result.hourly.updatedAt).toBeTruthy();
    expect(result.hourly.error).toBeTruthy();
    expect(mocks.cacheManualHourlyForecast).toHaveBeenCalledTimes(1);
  });
});
