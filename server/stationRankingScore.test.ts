import { describe, expect, it } from "vitest";
import { rankStations, type StationData } from "./stationService";
import {
  getStationRankingComponents,
  getStationRankingScore,
  STATION_RANKING_COMPONENT_WEIGHTS,
  STATION_RANKING_DISTANCE_CUTOFF_KM,
  STATION_RANKING_FRESHNESS_CUTOFF_MINUTES,
} from "./stationRankingScore";

const NOW = Date.parse("2026-10-05T08:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();

function station(overrides: Partial<StationData> = {}): StationData {
  return {
    stationId: "score-test",
    source: "meteofrance",
    name: "Station de test",
    lat: 50.76,
    lon: 2.52,
    altitude: null,
    distanceKm: 1,
    temperature: 18,
    humidity: 70,
    pressure: 1013,
    windSpeed: 10,
    windGust: null,
    windDirection: null,
    precipitation: null,
    updatedAt: NOW_ISO,
    reliabilityScore: 80,
    updateFrequencyMin: 60,
    dataAvailability: 0.95,
    isActive: true,
    ...overrides,
  };
}

describe("scores normalisés de classement des stations", () => {
  it("normalise la proximité linéairement sur le cutoff de 20 km", () => {
    const expected: Array<[number, number]> = [
      [0, 1],
      [0.5, 0.975],
      [1, 0.95],
      [5, 0.75],
      [10, 0.5],
      [20, 0],
      [21, 0],
    ];

    for (const [distanceKm, score] of expected) {
      expect(getStationRankingComponents(station({ distanceKm }), NOW).distanceScore)
        .toBeCloseTo(score, 12);
    }
    expect(STATION_RANKING_DISTANCE_CUTOFF_KM).toBe(20);
  });

  it("ne crédite pas une distance inconnue ou invalide", () => {
    for (const distanceKm of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, "0"]) {
      const components = getStationRankingComponents(
        { distanceKm, reliabilityScore: 80, dataAvailability: 0.95, updatedAt: NOW_ISO },
        NOW,
      );
      expect(components.distanceKnown).toBe(false);
      expect(components.distanceScore).toBe(0);
    }
  });

  it("borne chaque composante et le score composite entre 0 et 1", () => {
    expect(getStationRankingScore({
      distanceKm: 0,
      reliabilityScore: 100,
      dataAvailability: 1,
      updatedAt: NOW_ISO,
    }, NOW)).toBeCloseTo(1, 12);
    expect(getStationRankingScore({
      distanceKm: 100,
      reliabilityScore: -5,
      dataAvailability: 4,
      updatedAt: null,
    }, NOW)).toBe(0.2);
    expect(Object.values(STATION_RANKING_COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0))
      .toBeCloseTo(1, 12);
  });

  it("normalise la fraîcheur sur le cutoff existant et distingue l’horodatage inconnu", () => {
    const atAge = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
    expect(getStationRankingComponents(station({ updatedAt: atAge(0) }), NOW).freshnessScore).toBe(1);
    expect(getStationRankingComponents(station({ updatedAt: atAge(90) }), NOW).freshnessScore).toBeCloseTo(0.5, 12);
    expect(getStationRankingComponents(station({ updatedAt: atAge(180) }), NOW).freshnessScore).toBe(0);
    expect(getStationRankingComponents(station({ updatedAt: atAge(240) }), NOW).freshnessScore).toBe(0);
    expect(STATION_RANKING_FRESHNESS_CUTOFF_MINUTES).toBe(180);

    for (const updatedAt of [null, undefined, "not-a-timestamp"]) {
      const components = getStationRankingComponents(station({ updatedAt: updatedAt as string | null }), NOW);
      expect(components.freshnessKnown).toBe(false);
      expect(components.freshnessScore).toBe(0);
    }
    const knownStale = getStationRankingComponents(station({ updatedAt: atAge(240) }), NOW);
    expect(knownStale.freshnessKnown).toBe(true);
    expect(knownStale.freshnessScore).toBe(0);
  });

  it("classe une station plus éloignée de priorité réseau élevée avant une très proche au seuil bas", () => {
    const nearLowPriority = station({
      stationId: "near-low-priority",
      distanceKm: 0.5,
      reliabilityScore: 40,
    });
    const farHighPriority = station({
      stationId: "far-high-priority",
      distanceKm: 8,
      reliabilityScore: 95,
    });

    expect(getStationRankingScore(farHighPriority, NOW)).toBeGreaterThan(getStationRankingScore(nearLowPriority, NOW));
    expect(rankStations([nearLowPriority, farHighPriority], NOW).map(({ stationId }) => stationId))
      .toEqual(["far-high-priority", "near-low-priority"]);
  });

  it("ne supprime pas les stations au-delà de 20 km et reste vide sans candidate", () => {
    const fartherHighPriority = station({ stationId: "farther-high", distanceKm: 25, reliabilityScore: 95 });
    const fartherLowPriority = station({ stationId: "farther-low", distanceKm: 30, reliabilityScore: 65 });
    expect(getStationRankingComponents(fartherHighPriority, NOW).distanceScore).toBe(0);
    expect(rankStations([fartherLowPriority, fartherHighPriority], NOW).map(({ stationId }) => stationId))
      .toEqual(["farther-high", "farther-low"]);
    expect(rankStations([], NOW)).toEqual([]);
  });
});
