import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import type { NearbyStationsCollection, StationData } from "../stationService";

vi.mock("../stationService", async () => {
  const actual = await vi.importActual<typeof import("../stationService")>("../stationService");
  return {
    ...actual,
    collectNearbyStationsWithDiagnostics: vi.fn(),
    fetchCurrentModelReferences: vi.fn(),
  };
});

import { weatherRouter } from "./weather";
import { collectNearbyStationsWithDiagnostics, fetchCurrentModelReferences } from "../stationService";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

function stationFixture(): StationData {
  const now = new Date().toISOString();
  return {
    stationId: "netatmo-public-42",
    source: "netatmo",
    name: "Netatmo · Station synthétique",
    lat: 50.76,
    lon: 2.52,
    altitude: 10,
    distanceKm: 3,
    temperature: 18,
    humidity: 65,
    pressure: 1018,
    windSpeed: 9,
    windGust: 15,
    windDirection: 180,
    precipitation: null,
    updatedAt: now,
    measurementTimes: {
      temperature: now,
      humidity: now,
      pressure: now,
      windSpeed: now,
      windGust: now,
      windDirection: now,
      precipitation: now,
    },
    reliabilityScore: 65,
    updateFrequencyMin: 10,
    dataAvailability: 0.75,
    isActive: true,
  };
}

beforeEach(() => {
  vi.mocked(collectNearbyStationsWithDiagnostics).mockReset();
  vi.mocked(fetchCurrentModelReferences).mockReset();
  vi.mocked(fetchCurrentModelReferences).mockResolvedValue([]);
});

describe("weather.searchStations · diagnostics des sources", () => {
  it("distingue la panne Météo-France des sources vides et conserve la station physique Netatmo", async () => {
    const collection: NearbyStationsCollection = {
      stations: [stationFixture()],
      sourceDiagnostics: [
        { source: "meteofrance", status: "error", stationCount: 0, reason: "network_error" },
        { source: "netatmo", status: "success_with_data", stationCount: 1 },
      ],
      cacheHit: false,
    };
    vi.mocked(collectNearbyStationsWithDiagnostics).mockResolvedValue(collection);

    const result = await weatherRouter.createCaller(createPublicContext()).searchStations({
      lat: 50.76,
      lon: 2.52,
      radiusKm: 20,
    });

    expect(result.sourceDiagnostics).toEqual(collection.sourceDiagnostics);
    expect(result.sourceDiagnosticsFromCache).toBe(false);
    expect(result.totalFound).toBe(1);
    expect(result.physicalStationCount).toBe(1);
    expect(result.stations.map((station) => station.stationId)).toEqual(["netatmo-public-42"]);
    expect(JSON.stringify(result)).not.toContain("provider.invalid");
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });
});
