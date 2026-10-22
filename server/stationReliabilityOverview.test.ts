import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPhysicalStationHistory: vi.fn(),
  getHourlyForecastRunValues: vi.fn(),
  getStationCollectionSnapshots: vi.fn(),
  getStationQualityProfiles: vi.fn(),
  getHourlyForecastEvaluationHistory: vi.fn(),
  getLatestMeteoAIForecasts: vi.fn(),
  makeLocationKey: vi.fn((lat: number, lon: number) =>
    `${Math.round(lat * 1000) / 1000}_${Math.round(lon * 1000) / 1000}`),
  deriveStationPerformanceProfiles: vi.fn(),
  computeOfficialHourlyForecast: vi.fn(),
  reconstructOfficialHourlyModelsFromArchive: vi.fn(),
  qualifyStationForecastReadings: vi.fn(),
  buildStationForecastComparison24h: vi.fn(),
  reconstructHistoricalOfficialHours: vi.fn(),
}));

vi.mock("./db", () => ({
  getPhysicalStationHistory: mocks.getPhysicalStationHistory,
  getHourlyForecastRunValues: mocks.getHourlyForecastRunValues,
  getStationCollectionSnapshots: mocks.getStationCollectionSnapshots,
  getStationQualityProfiles: mocks.getStationQualityProfiles,
  getHourlyForecastEvaluationHistory: mocks.getHourlyForecastEvaluationHistory,
  getLatestMeteoAIForecasts: mocks.getLatestMeteoAIForecasts,
  makeLocationKey: mocks.makeLocationKey,
}));
vi.mock("./stationPerformanceService", () => ({
  deriveStationPerformanceProfiles: mocks.deriveStationPerformanceProfiles,
}));
vi.mock("./officialHourlyForecast", () => ({
  computeOfficialHourlyForecast: mocks.computeOfficialHourlyForecast,
  OFFICIAL_HOURLY_HISTORY_DAYS: 60,
  reconstructOfficialHourlyModelsFromArchive: mocks.reconstructOfficialHourlyModelsFromArchive,
}));
vi.mock("./stationForecastComparison", () => ({
  buildStationForecastComparison24h: mocks.buildStationForecastComparison24h,
  qualifyStationForecastReadings: mocks.qualifyStationForecastReadings,
}));
vi.mock("./historicalOfficialForecast", () => ({
  reconstructHistoricalOfficialHours: mocks.reconstructHistoricalOfficialHours,
}));

import {
  buildStationReliabilityOverviewCached,
  clearStationReliabilityOverviewCache,
  stationReliabilityOverviewCacheKey,
} from "./stationReliabilityOverview";

const INPUT = { lat: 50.7567, lon: 2.5204, periodDays: 7 as const };

function mockReadableDependencies() {
  mocks.getPhysicalStationHistory.mockResolvedValue({
    stations: [],
    latestGroundTruth: { radiusKm: 20, computedAt: new Date(0) },
  });
  mocks.getHourlyForecastRunValues.mockResolvedValue([]);
  mocks.getStationCollectionSnapshots.mockResolvedValue([]);
  mocks.getStationQualityProfiles.mockResolvedValue([]);
  mocks.getHourlyForecastEvaluationHistory.mockResolvedValue({
    available: true,
    rows: [],
    legacyRows: [],
    exactAvailable: false,
    exactRows: [],
  });
  mocks.getLatestMeteoAIForecasts.mockResolvedValue([]);
  mocks.deriveStationPerformanceProfiles.mockReturnValue(new Map());
  mocks.computeOfficialHourlyForecast.mockReturnValue({ weighting: {} });
  mocks.reconstructOfficialHourlyModelsFromArchive.mockReturnValue([]);
  mocks.qualifyStationForecastReadings.mockReturnValue([]);
  mocks.reconstructHistoricalOfficialHours.mockReturnValue([]);
  mocks.buildStationForecastComparison24h.mockReturnValue([]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00.000Z"));
  vi.clearAllMocks();
  clearStationReliabilityOverviewCache();
  mockReadableDependencies();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Aperçu de fiabilité des stations — cache de lecture", () => {
  it("ne recalcule pas une même maille lieu × période × rayon pendant cinq minutes", async () => {
    const first = await buildStationReliabilityOverviewCached(INPUT);
    const second = await buildStationReliabilityOverviewCached(INPUT);

    expect(mocks.getPhysicalStationHistory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.locationKey).toBe("50.757_2.52");
    expect(first.periodDays).toBe(7);
    expect(first.radiusKm).toBe(20);
    expect(first.performanceWindowDays).toBe(30);
    expect(first.comparison7d).toHaveLength(7);

    vi.setSystemTime(new Date("2026-10-13T12:05:01.000Z"));
    const third = await buildStationReliabilityOverviewCached(INPUT);
    expect(mocks.getPhysicalStationHistory).toHaveBeenCalledTimes(2);
    expect(third).not.toBe(first);
  });

  it("distingue les mailles lieu, période et rayon demandé", async () => {
    await buildStationReliabilityOverviewCached(INPUT);
    await buildStationReliabilityOverviewCached({ ...INPUT, periodDays: 1 });
    await buildStationReliabilityOverviewCached({ ...INPUT, radiusKm: 25 });
    await buildStationReliabilityOverviewCached(INPUT);

    expect(mocks.getPhysicalStationHistory).toHaveBeenCalledTimes(3);
    expect(stationReliabilityOverviewCacheKey(INPUT)).toBe("50.757_2.52:7:auto");
    expect(stationReliabilityOverviewCacheKey({ ...INPUT, radiusKm: 25 })).toBe("50.757_2.52:7:25");
    expect(stationReliabilityOverviewCacheKey({ ...INPUT, periodDays: 1 })).toBe("50.757_2.52:1:auto");
  });

  it("ne met jamais en cache un aperçu construit pendant une lecture illisible", async () => {
    mocks.getHourlyForecastEvaluationHistory.mockResolvedValue({
      available: false,
      rows: [],
      legacyRows: [],
      exactAvailable: false,
      exactRows: [],
    });

    const first = await buildStationReliabilityOverviewCached(INPUT);
    const second = await buildStationReliabilityOverviewCached(INPUT);

    expect(first.locationKey).toBe("50.757_2.52");
    expect(second).not.toBe(first);
    expect(mocks.getPhysicalStationHistory).toHaveBeenCalledTimes(2);
  });

  it("force le recalcul après un nettoyage explicite du cache", async () => {
    const first = await buildStationReliabilityOverviewCached(INPUT);
    clearStationReliabilityOverviewCache();
    const second = await buildStationReliabilityOverviewCached(INPUT);

    expect(second).not.toBe(first);
    expect(mocks.getPhysicalStationHistory).toHaveBeenCalledTimes(2);
  });
});
