import { beforeEach, describe, expect, it } from "vitest";
import { calculateUltraLocal } from "./ultraLocalService";
import { clearCache, getPreviousReadings } from "./stationReadingsCache";
import type { StationData } from "./stationService";

function station(overrides: Partial<StationData>): StationData {
  const now = new Date().toISOString();
  return {
    stationId: "station",
    source: "meteofrance",
    name: "Station physique",
    lat: 50.75,
    lon: 2.52,
    altitude: 40,
    distanceKm: 1,
    temperature: 20,
    humidity: 60,
    pressure: 1015,
    windSpeed: 10,
    windGust: 15,
    windDirection: 180,
    precipitation: 0,
    updatedAt: now,
    reliabilityScore: 80,
    updateFrequencyMin: 10,
    dataAvailability: 0.95,
    isActive: true,
    qualificationStatus: "validated",
    sourceTier: 1,
    measurementTimes: {
      temperature: now,
      humidity: now,
      pressure: now,
      windSpeed: now,
      windGust: now,
      windDirection: now,
      precipitation: now,
    },
    ...overrides,
  };
}

describe("calculateUltraLocal — cache d’anomalies", () => {
  beforeEach(() => clearCache());

  it("ne sauvegarde pas une température lorsque son observationTime est absent", () => {
    const candidate = station({
      stationId: "unknown-time",
      measurementTimes: { temperature: null },
    });

    calculateUltraLocal([candidate], "standard", 50.75, 2.52);

    expect(getPreviousReadings().has("unknown-time")).toBe(false);
  });

  it("ne réinitialise pas le gel quand le même timestamp fournisseur est recalculé", () => {
    const observedAt = new Date(Date.now() - 61 * 60_000).toISOString();
    const candidate = station({
      stationId: "duplicate",
      updatedAt: observedAt,
      measurementTimes: { temperature: observedAt },
    });
    calculateUltraLocal([candidate], "standard", 50.75, 2.52);
    const before = getPreviousReadings().get("duplicate");

    calculateUltraLocal([candidate], "standard", 50.75, 2.52);
    const after = getPreviousReadings().get("duplicate");

    expect(before).toBeDefined();
    expect(after).toEqual(before);
  });
});
