import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectNearbyStations: vi.fn(),
  getPhysicalActiveStations: vi.fn(),
  calculateGroundTruth: vi.fn(),
  getTodayParis: vi.fn(),
  getParisHour: vi.fn(),
  makeLocationKey: vi.fn(),
  upsertWeatherStation: vi.fn(),
  upsertStationObservation: vi.fn(),
  insertStationObservationIfMissing: vi.fn(),
  refreshStationQualityProfiles: vi.fn(),
  upsertQualifiedObservationSnapshot: vi.fn(),
  insertQualifiedObservationSnapshotIfMissing: vi.fn(),
  getQualifiedObservationSnapshotsForDate: vi.fn(),
  getPhysicalSnapshotCollectionTracesByDateRange: vi.fn(),
  upsertPhysicalSnapshotCollectionTrace: vi.fn(),
  insertPhysicalSnapshotCollectionTraceIfMissing: vi.fn(),
  acquireForecastRefreshLock: vi.fn(),
  renewForecastRefreshLock: vi.fn(),
  releaseForecastRefreshLock: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("./stationService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stationService")>()),
  collectNearbyStations: mocks.collectNearbyStations,
  getPhysicalActiveStations: mocks.getPhysicalActiveStations,
  calculateGroundTruth: mocks.calculateGroundTruth,
}));

vi.mock("./weatherTime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./weatherTime")>()),
  getParisDate: mocks.getTodayParis,
  getParisHour: mocks.getParisHour,
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  makeLocationKey: mocks.makeLocationKey,
  upsertWeatherStation: mocks.upsertWeatherStation,
  upsertStationObservation: mocks.upsertStationObservation,
  insertStationObservationIfMissing: mocks.insertStationObservationIfMissing,
  refreshStationQualityProfiles: mocks.refreshStationQualityProfiles,
  upsertQualifiedObservationSnapshot: mocks.upsertQualifiedObservationSnapshot,
  insertQualifiedObservationSnapshotIfMissing: mocks.insertQualifiedObservationSnapshotIfMissing,
  getQualifiedObservationSnapshotsForDate: mocks.getQualifiedObservationSnapshotsForDate,
  getPhysicalSnapshotCollectionTracesByDateRange: mocks.getPhysicalSnapshotCollectionTracesByDateRange,
  upsertPhysicalSnapshotCollectionTrace: mocks.upsertPhysicalSnapshotCollectionTrace,
  insertPhysicalSnapshotCollectionTraceIfMissing: mocks.insertPhysicalSnapshotCollectionTraceIfMissing,
  acquireForecastRefreshLock: mocks.acquireForecastRefreshLock,
  renewForecastRefreshLock: mocks.renewForecastRefreshLock,
  releaseForecastRefreshLock: mocks.releaseForecastRefreshLock,
}));

vi.mock("./_core/notification", () => ({ notifyOwner: mocks.notifyOwner }));

import {
  collectPhysicalObservationSnapshotsForFavorites,
  HOURLY_SNAPSHOT_MAX_ATTEMPTS,
  HOURLY_SNAPSHOT_RETRY_DELAY_MS,
} from "./scheduledHandlers";

const emptySynthesis = {
  stationCount: 0,
  confidenceScore: 0,
  temperature: null,
  humidity: null,
  pressure: null,
  windSpeed: null,
  windGust: null,
  precipitation: null,
  stationsUsed: [],
};

const qualifiedSynthesis = {
  stationCount: 2,
  confidenceScore: 0.92,
  temperature: 18.4,
  humidity: 71,
  pressure: 1016,
  windSpeed: 12,
  windGust: 20,
  precipitation: 0,
  stationsUsed: [],
};

const favorite = (lat: number, lon: number) => ({
  id: lat,
  userId: 1,
  name: `Lieu ${lat}`,
  customName: null,
  lat,
  lon,
  radiusKm: 20,
});

async function settleWithRetries<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(HOURLY_SNAPSHOT_RETRY_DELAY_MS * HOURLY_SNAPSHOT_MAX_ATTEMPTS);
  return pending;
}

describe("comportement des cinq tentatives de snapshots physiques", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getTodayParis.mockReturnValue("2026-08-27");
    mocks.getParisHour.mockReturnValue(16);
    mocks.makeLocationKey.mockImplementation((lat: number, lon: number) => `${lat}_${lon}`);
    mocks.collectNearbyStations.mockResolvedValue([]);
    mocks.getPhysicalActiveStations.mockImplementation((stations: unknown[]) => stations);
    mocks.calculateGroundTruth.mockReturnValue(emptySynthesis);
    mocks.getQualifiedObservationSnapshotsForDate.mockResolvedValue([]);
    mocks.getPhysicalSnapshotCollectionTracesByDateRange.mockResolvedValue([]);
    mocks.upsertWeatherStation.mockResolvedValue(undefined);
    mocks.upsertStationObservation.mockResolvedValue(undefined);
    mocks.insertStationObservationIfMissing.mockResolvedValue(true);
    mocks.refreshStationQualityProfiles.mockResolvedValue(undefined);
    mocks.upsertQualifiedObservationSnapshot.mockResolvedValue(undefined);
    mocks.insertQualifiedObservationSnapshotIfMissing.mockResolvedValue(true);
    mocks.upsertPhysicalSnapshotCollectionTrace.mockResolvedValue(undefined);
    mocks.insertPhysicalSnapshotCollectionTraceIfMissing.mockResolvedValue(true);
    mocks.acquireForecastRefreshLock.mockResolvedValue(true);
    mocks.renewForecastRefreshLock.mockResolvedValue(true);
    mocks.releaseForecastRefreshLock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("effectue cinq essais au plus et enregistre le snapshot lorsque le cinquième réussit", async () => {
    mocks.calculateGroundTruth
      .mockReturnValueOnce(emptySynthesis)
      .mockReturnValueOnce(emptySynthesis)
      .mockReturnValueOnce(emptySynthesis)
      .mockReturnValueOnce(emptySynthesis)
      .mockReturnValueOnce(qualifiedSynthesis);

    const result = await settleWithRetries(
      collectPhysicalObservationSnapshotsForFavorites([favorite(50.756, 2.521)] as any, "scheduled"),
    );

    expect(mocks.collectNearbyStations).toHaveBeenCalledTimes(5);
    expect(result.status).toBe("completed");
    expect(result.locations).toEqual([expect.objectContaining({ stored: true, attempts: 5, stationCount: 2 })]);
    expect(mocks.insertPhysicalSnapshotCollectionTraceIfMissing).toHaveBeenCalledWith(expect.objectContaining({ status: "stored", attempts: 5 }));
    expect(mocks.acquireForecastRefreshLock).toHaveBeenCalledWith("physical-snapshot:50.756_2.521:2026-08-27:16", expect.any(String));
    expect(mocks.renewForecastRefreshLock).toHaveBeenCalledTimes(4);
    expect(mocks.releaseForecastRefreshLock).toHaveBeenCalledWith("physical-snapshot:50.756_2.521:2026-08-27:16", expect.any(String));
  });

  it("s’arrête dès le premier succès sans consommer de relance inutile", async () => {
    mocks.calculateGroundTruth.mockReturnValue(qualifiedSynthesis);

    const result = await collectPhysicalObservationSnapshotsForFavorites([favorite(50.756, 2.521)] as any, "scheduled");

    expect(mocks.collectNearbyStations).toHaveBeenCalledTimes(1);
    expect(result.locations).toEqual([expect.objectContaining({ stored: true, attempts: 1 })]);
  });

  it("archive les timestamps exacts par champ et conserve null sans substituer updatedAt", async () => {
    const measurementTimes = {
      temperature: "2026-08-27T15:41:00.000Z",
      humidity: null,
      windSpeed: "timestamp-fourni-invalide",
    };
    mocks.collectNearbyStations.mockResolvedValue([{
      stationId: "netatmo-field-times",
      source: "netatmo",
      name: "Station témoin",
      lat: 50.75,
      lon: 2.5,
      altitude: null,
      distanceKm: 1,
      temperature: 18,
      humidity: 61,
      pressure: null,
      windSpeed: 10,
      windGust: null,
      windDirection: null,
      precipitation: null,
      updatedAt: "2026-08-27T15:45:00.000Z",
      measurementTimes,
      reliabilityScore: 90,
      updateFrequencyMin: 5,
      dataAvailability: 1,
      isActive: true,
    }]);
    mocks.calculateGroundTruth.mockReturnValue({
      ...qualifiedSynthesis,
      stationsUsed: [{ stationId: "netatmo-field-times", measurementTimes }],
    });

    await collectPhysicalObservationSnapshotsForFavorites([favorite(50.756, 2.521)] as any, "scheduled");

    expect(mocks.insertStationObservationIfMissing).toHaveBeenCalledWith(expect.objectContaining({
      stationId: "netatmo-field-times",
      observedAt: Date.parse("2026-08-27T15:45:00.000Z"),
      measurementTimes,
    }));
  });

  it("classe l’absence persistante de station comme no_station après cinq essais, sans alerte technique", async () => {
    const result = await settleWithRetries(
      collectPhysicalObservationSnapshotsForFavorites([favorite(50.756, 2.521)] as any, "scheduled"),
    );

    expect(mocks.collectNearbyStations).toHaveBeenCalledTimes(5);
    expect(result.status).toBe("completed");
    expect(result.errors).toBeUndefined();
    expect(result.locations).toEqual([expect.objectContaining({ stored: false, attempts: 5, reason: "Aucune station physique qualifiée" })]);
    expect(mocks.insertPhysicalSnapshotCollectionTraceIfMissing).toHaveBeenCalledWith(expect.objectContaining({ status: "no_station", attempts: 5 }));
    expect(mocks.notifyOwner).not.toHaveBeenCalled();
  });

  it("isole cinq erreurs techniques d’un favori sans empêcher le snapshot du suivant", async () => {
    mocks.collectNearbyStations.mockImplementation(async (lat: number) => {
      if (lat === 50.756) throw new Error("Fournisseur indisponible");
      return [];
    });
    mocks.calculateGroundTruth.mockReturnValue(qualifiedSynthesis);

    const result = await settleWithRetries(
      collectPhysicalObservationSnapshotsForFavorites([
        favorite(50.756, 2.521),
        favorite(50.676, 2.845),
      ] as any, "scheduled"),
    );

    expect(result.status).toBe("partial");
    expect(result.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ locationKey: "50.756_2.521", stored: false, attempts: 5, reason: expect.stringContaining("Erreur de collecte après relance") }),
      expect.objectContaining({ locationKey: "50.676_2.845", stored: true, attempts: 1 }),
    ]));
    expect(mocks.insertPhysicalSnapshotCollectionTraceIfMissing).toHaveBeenCalledWith(expect.objectContaining({ locationKey: "50.756_2.521", status: "failed", attempts: 5 }));
    expect(mocks.insertPhysicalSnapshotCollectionTraceIfMissing).toHaveBeenCalledWith(expect.objectContaining({ locationKey: "50.676_2.845", status: "stored", attempts: 1 }));
  });

  it("ignore une nouvelle exécution planifiée lorsque le snapshot horaire existe déjà", async () => {
    mocks.getQualifiedObservationSnapshotsForDate.mockResolvedValue([{ hour: 16 }]);

    const result = await collectPhysicalObservationSnapshotsForFavorites([favorite(50.756, 2.521)] as any, "scheduled");

    expect(mocks.collectNearbyStations).not.toHaveBeenCalled();
    expect(result.locations).toEqual([expect.objectContaining({ skipped: true, snapshotPreserved: true, attempts: 0 })]);
  });

  it("autorise la reprise après une trace no_station et remplace seulement la trace opérationnelle après succès", async () => {
    mocks.getPhysicalSnapshotCollectionTracesByDateRange.mockResolvedValue([{ hour: 16, status: "no_station" }]);
    mocks.calculateGroundTruth.mockReturnValue(qualifiedSynthesis);

    const result = await collectPhysicalObservationSnapshotsForFavorites([favorite(50.756, 2.521)] as any, "recovery");

    expect(mocks.collectNearbyStations).toHaveBeenCalledTimes(1);
    expect(result.locations).toEqual([expect.objectContaining({ stored: true, attempts: 1 })]);
    expect(mocks.upsertPhysicalSnapshotCollectionTrace).toHaveBeenCalledWith(expect.objectContaining({ status: "stored" }));
  });
});
