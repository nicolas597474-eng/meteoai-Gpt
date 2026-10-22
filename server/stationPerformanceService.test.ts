import { describe, expect, it } from "vitest";
import {
  deriveStationPerformanceProfiles,
  STATION_PERFORMANCE_CALCULATION_GATES,
  studentT95Critical,
  type StationPerformanceObservation,
  type StationPerformanceStation,
} from "./stationPerformanceService";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const START = Date.parse("2026-05-01T00:00:00Z");

describe("quantiles de l’intervalle nominal à 95 %", () => {
  it("utilise les quantiles t bilatéraux alpha 0,05 et la limite normale déclarée", () => {
    expect(studentT95Critical(1)).toBe(12.706);
    expect(studentT95Critical(2)).toBe(4.303);
    expect(studentT95Critical(30)).toBe(2.042);
    expect(studentT95Critical(31)).toBe(1.96);
  });
});

function makeStation(
  stationId: string,
  source: string,
  dailyOffsets: readonly number[],
  lat: number,
  lon: number,
): StationPerformanceStation {
  const readings: StationPerformanceObservation[] = dailyOffsets.flatMap((offset, day) =>
    [0, 6, 12, 18].map((hour) => {
      const observedAt = START + day * DAY_MS + hour * HOUR_MS;
      const fieldTime = new Date(observedAt).toISOString();
      return {
        observedAt,
        measurementTimes: { temperature: fieldTime, precipitation: fieldTime },
        temperature: 20 + day + offset,
        precipitation: 0,
      };
    }),
  );
  return {
    stationId,
    source,
    qualificationStatus: "validated",
    isActive: true,
    lat,
    lon,
    distanceKm: 1,
    readings,
  };
}

// METAR a été retiré de toutes les méthodes de calcul : il ne reste que deux
// réseaux physiques (Météo-France et Netatmo). Le réseau de la station cible
// étant exclu des références, une comparaison inter-réseaux exigeant deux
// réseaux distincts ne peut plus être satisfaite ; le service doit donc
// déclarer honnêtement « non_mesuree ».
function crossNetworkFixture(dayCount = 8): StationPerformanceStation[] {
  const candidateErrors = Array.from({ length: dayCount }, (_, day) => 0.4 + (day % 4) * 0.2);
  const stablePeer = Array.from({ length: dayCount }, () => 0.05);
  const secondPeer = Array.from({ length: dayCount }, () => 0.65);
  const base = Array.from({ length: dayCount }, () => 0);
  return [
    makeStation("netatmo-target", "netatmo", candidateErrors, 50.75, 2.50),
    makeStation("netatmo-peer-1", "netatmo", stablePeer, 50.76, 2.50),
    makeStation("netatmo-peer-2", "netatmo", secondPeer, 50.77, 2.50),
    makeStation("mf-ref", "meteofrance", base, 50.74, 2.50),
  ];
}

describe("deriveStationPerformanceProfiles", () => {
  it("sans METAR, un seul réseau physique distinct restant ne permet plus la mesure inter-réseaux", () => {
    const result = deriveStationPerformanceProfiles({ stations: crossNetworkFixture(), maxDistanceKm: 20 })
      .get("netatmo-target")!.variables.temperature;

    expect(result.status).toBe("non_mesuree");
    expect(result.reason).toBe("distinct_reference_networks_insufficient");
    expect(result.referenceNetworks).toEqual(["meteofrance"]);
    expect(result.comparisons).toBe(0);
    expect(result.estimate).toBeNull();
  });

  it("exclut tout le réseau cible des références et ignore les références de modèles", () => {
    const fixture = crossNetworkFixture();
    const withModelReference = [...fixture, makeStation("model-grid", "openmeteo", Array(8).fill(100), 50.72, 2.5)];
    const withoutModel = deriveStationPerformanceProfiles({ stations: fixture, maxDistanceKm: 20 }).get("netatmo-target")!.variables.temperature;
    const withModel = deriveStationPerformanceProfiles({ stations: withModelReference, maxDistanceKm: 20 }).get("netatmo-target")!.variables.temperature;

    expect(withoutModel.status).toBe("non_mesuree");
    expect(withModel.status).toBe("non_mesuree");
    expect(withModel.reason).toBe(withoutModel.reason);
    expect(withModel.referenceNetworks).toEqual(["meteofrance"]);
    expect(withModel.referenceNetworks).toEqual(withoutModel.referenceNetworks);
    expect(withModel.estimate).toBeNull();
  });

  it("n’utilise jamais une ancienne source METAR comme référence physique", () => {
    const stations = [
      ...crossNetworkFixture(),
      makeStation("metar-legacy", "metar", Array(8).fill(0.1), 50.73, 2.50),
    ];
    const result = deriveStationPerformanceProfiles({ stations, maxDistanceKm: 20 })
      .get("netatmo-target")!.variables.temperature;

    expect(result.status).toBe("non_mesuree");
    expect(result.reason).toBe("distinct_reference_networks_insufficient");
    expect(result.referenceNetworks).toEqual(["meteofrance"]);
    expect(result.referenceNetworks).not.toContain("metar");
    expect(result.estimate).toBeNull();
  });

  it("ne mesure pas une station non validée ou hors du rayon et n’utilise pas son profil opérationnel comme preuve météo", () => {
    const stations = crossNetworkFixture().map((station) => station.stationId === "netatmo-target"
      ? { ...station, qualificationStatus: "candidate" as const, distanceKm: 25 }
      : station);
    const result = deriveStationPerformanceProfiles({ stations, maxDistanceKm: 20 }).get("netatmo-target")!;

    expect(result.status).toBe("non_mesuree");
    expect(result.variables.temperature.reason).toBe("outside_reference_radius");
    expect(result.variables.temperature.estimate).toBeNull();
  });

  it("conserve les gates de calcul déclarés, distincts de toute preuve météo", () => {
    expect(STATION_PERFORMANCE_CALCULATION_GATES).toMatchObject({
      minimumComparisons: 30,
      minimumDistinctDays: 7,
      minimumDistinctReferenceNetworksPerComparison: 2,
      minimumSourcePriorSites: 2,
    });
    expect(STATION_PERFORMANCE_CALCULATION_GATES).not.toHaveProperty("minimumPrecipitationEventDays");
  });

  it("laisse les précipitations non mesurées même avec des jours pluvieux relevés", () => {
    const stations = crossNetworkFixture().map((station) => ({
      ...station,
      readings: station.readings.map((reading, index) => ({
        ...reading,
        precipitation: Math.floor(index / 4) < 3 ? 1 : 0,
      })),
    }));
    const result = deriveStationPerformanceProfiles({ stations, maxDistanceKm: 20 })
      .get("netatmo-target")!.variables.precipitation;

    expect(result.status).toBe("non_mesuree");
    expect(result.reason).toBe("precipitation_method_not_defined");
    expect(result.estimate).toBeNull();
  });
});
