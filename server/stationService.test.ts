import { describe, it, expect } from "vitest";
import {
  haversineKm,
  rankStations,
  calculateGroundTruth,
  getPhysicalActiveStations,
  getStationSourceKind,
  mapSynopRecord,
  revalidateStationFreshness,
  type StationData,
} from "./stationService";

// ─── Test data helpers ────────────────────────────────────────────────────────

function makeStation(overrides: Partial<StationData> = {}): StationData {
  const updatedAt = overrides.updatedAt !== undefined ? overrides.updatedAt : new Date().toISOString();
  const measurementTimes = overrides.measurementTimes ?? {
    temperature: updatedAt,
    humidity: updatedAt,
    pressure: updatedAt,
    windSpeed: updatedAt,
    windGust: updatedAt,
    windDirection: updatedAt,
    precipitation: updatedAt,
  };
  return {
    stationId: "test-001",
    source: "openmeteo",
    name: "Test Station",
    lat: 50.76,
    lon: 2.52,
    altitude: 30,
    distanceKm: 2.0,
    temperature: 18.5,
    humidity: 72,
    pressure: 1013,
    windSpeed: 15,
    windGust: 22,
    windDirection: 270,
    precipitation: 0,
    updatedAt,
    reliabilityScore: 80,
    updateFrequencyMin: 60,
    dataAvailability: 0.95,
    isActive: true,
    ...overrides,
    measurementTimes,
  };
}

// ─── haversineKm ─────────────────────────────────────────────────────────────

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(50.76, 2.52, 50.76, 2.52)).toBe(0);
  });

  it("returns ~111 km for 1 degree latitude difference at equator", () => {
    const dist = haversineKm(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(112);
  });

  it("calculates Hondeghem to Hazebrouck (~8 km)", () => {
    // Hondeghem: 50.7567, 2.5204 — Hazebrouck: 50.7239, 2.5387
    const dist = haversineKm(50.7567, 2.5204, 50.7239, 2.5387);
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(10);
  });

  it("is symmetric", () => {
    const d1 = haversineKm(50.76, 2.52, 51.0, 3.0);
    const d2 = haversineKm(51.0, 3.0, 50.76, 2.52);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

describe("getStationSourceKind", () => {
  it("distingue les observations physiques des références de modèle", () => {
    expect(getStationSourceKind("meteofrance")).toBe("physical");
    expect(getStationSourceKind("openmeteo")).toBe("reference");
    expect(getStationSourceKind("netatmo")).toBe("physical");
    expect(getStationSourceKind("synop")).toBe("reference");
    expect(getStationSourceKind("wunderground")).toBe("reference");
  });
});

// ─── rankStations ─────────────────────────────────────────────────────────────

describe("rankStations", () => {
  it("places active stations before inactive ones", () => {
    const stations = [
      makeStation({ stationId: "inactive", isActive: false, distanceKm: 0.5 }),
      makeStation({ stationId: "active", isActive: true, distanceKm: 5.0 }),
    ];
    const ranked = rankStations(stations);
    expect(ranked[0].stationId).toBe("active");
    expect(ranked[1].stationId).toBe("inactive");
  });

  it("ranks closer stations higher when reliability is equal", () => {
    const stations = [
      makeStation({ stationId: "far", distanceKm: 15.0, reliabilityScore: 80 }),
      makeStation({ stationId: "near", distanceKm: 1.0, reliabilityScore: 80 }),
    ];
    const ranked = rankStations(stations);
    expect(ranked[0].stationId).toBe("near");
  });

  it("ranks a higher-priority station 8 km away above a near station at the minimum active priority", () => {
    const now = Date.parse("2026-10-05T08:00:00.000Z");
    const stations = [
      makeStation({ stationId: "reliable-far", distanceKm: 8.0, reliabilityScore: 95, updatedAt: new Date(now).toISOString() }),
      makeStation({ stationId: "low-priority-near", distanceKm: 0.5, reliabilityScore: 40, updatedAt: new Date(now).toISOString() }),
    ];
    const ranked = rankStations(stations, now);
    expect(ranked.map((station) => station.stationId)).toEqual(["reliable-far", "low-priority-near"]);
  });

  it("does not mutate the input array", () => {
    const stations = [
      makeStation({ stationId: "b", distanceKm: 10 }),
      makeStation({ stationId: "a", distanceKm: 1 }),
    ];
    const original = [...stations];
    rankStations(stations);
    expect(stations[0].stationId).toBe(original[0].stationId);
  });
});

// ─── Physical station evidence ───────────────────────────────────────────────

describe("getPhysicalActiveStations", () => {
  it("conserve les stations physiques actives tout en excluant les références et relevés inactifs", () => {
    const stations = [
      makeStation({ stationId: "mf-1", source: "meteofrance" }),
      makeStation({ stationId: "grid-1", source: "openmeteo" }),
      makeStation({ stationId: "netatmo-personal-1", source: "netatmo" }),
      makeStation({ stationId: "mf-old", source: "meteofrance", isActive: false }),
    ];

    expect(getPhysicalActiveStations(stations).map((station) => station.stationId)).toEqual(["mf-1", "netatmo-personal-1"]);
  });

  it("ne classe pas une ancienne référence de grille comme une station Netatmo physique", () => {
    expect(getStationSourceKind("netatmo", "grid-local-est")).toBe("reference");
    expect(getStationSourceKind("netatmo", "netatmo-public-42")).toBe("physical");
  });
});

describe("présélection de fraîcheur des stations", () => {
  const now = Date.parse("2026-10-05T10:00:00.000Z");

  it.each([
    ["absente", null],
    ["invalide", "not-a-date"],
  ] as const)("désactive une station avec une date %s sans supprimer ses mesures", (_label, updatedAt) => {
    const [station] = revalidateStationFreshness([makeStation({ updatedAt })], now);

    expect(station.isActive).toBe(false);
    expect(station.temperature).toBe(18.5);
    expect(station.humidity).toBe(72);
    expect(station.pressure).toBe(1013);
    expect(station.exclusionReason).toBeTruthy();
  });

  it.each([
    ["juste avant", 180 * 60_000 - 1, true],
    ["exactement à", 180 * 60_000, true],
    ["juste après", 180 * 60_000 + 1, false],
  ] as const)("conserve la frontière de 180 minutes (%s)", (_label, ageMs, expectedActive) => {
    const updatedAt = new Date(now - ageMs).toISOString();
    const [station] = revalidateStationFreshness([makeStation({ updatedAt })], now);

    expect(station.isActive).toBe(expectedActive);
  });

  it("conserve le traitement actuel d’une date future", () => {
    const updatedAt = new Date(now + 60_000).toISOString();
    const [station] = revalidateStationFreshness([makeStation({ updatedAt })], now);

    expect(station.isActive).toBe(true);
  });

  it("revalide une station mise en cache qui franchit le cutoff avant l’expiration du TTL", () => {
    const cachedAt = now;
    const updatedAt = new Date(cachedAt - (180 * 60_000 - 30_000)).toISOString();
    const cachedStations = revalidateStationFreshness([makeStation({ updatedAt })], cachedAt);
    const cacheHitAt = cachedAt + 60_000;
    const [station] = revalidateStationFreshness(cachedStations, cacheHitAt);

    expect(cacheHitAt - cachedAt).toBeLessThan(90_000);
    expect(cachedStations[0].isActive).toBe(true);
    expect(station.isActive).toBe(false);
    expect(station.temperature).toBe(18.5);
    expect(station.humidity).toBe(72);
    expect(station.updatedAt).toBe(updatedAt);
  });
});

describe("mapSynopRecord", () => {
  const record = {
    numer_sta: "12345",
    nom: "Station de test",
    latitude: 50.76,
    longitude: 2.52,
    altitude: 40,
    t: 293.15,
    u: 70,
    pres: 101325,
    ff: 5,
    raf10: 7,
    dd: 180,
    rr1: 0,
    date: "2026-10-05T08:00:00Z",
  };

  it.each([
    { sourceField: "t", stationField: "temperature", rawValue: "NaN" },
    { sourceField: "u", stationField: "humidity", rawValue: "Infinity" },
    { sourceField: "pres", stationField: "pressure", rawValue: "-Infinity" },
    { sourceField: "ff", stationField: "windSpeed", rawValue: "NaN" },
    { sourceField: "raf10", stationField: "windGust", rawValue: "Infinity" },
    { sourceField: "dd", stationField: "windDirection", rawValue: "-Infinity" },
    { sourceField: "rr1", stationField: "precipitation", rawValue: "NaN" },
    { sourceField: "altitude", stationField: "altitude", rawValue: "Infinity" },
    { sourceField: "t", stationField: "temperature", rawValue: Number.MAX_VALUE },
    { sourceField: "ff", stationField: "windSpeed", rawValue: Number.MAX_VALUE },
  ] as const)("convertit le champ SYNOP $sourceField non fini en null", ({ sourceField, stationField, rawValue }) => {
    const station = mapSynopRecord({ ...record, [sourceField]: rawValue }, 50.76, 2.52, 20);

    expect(station).not.toBeNull();
    expect(station?.[stationField]).toBeNull();
  });

  it("n’active pas un enregistrement dont toutes les mesures activantes sont non finies", () => {
    const station = mapSynopRecord({
      ...record,
      t: "NaN",
      ff: "Infinity",
      rr1: "-Infinity",
    }, 50.76, 2.52, 20);

    expect(station).toMatchObject({
      temperature: null,
      windSpeed: null,
      precipitation: null,
      isActive: false,
      exclusionReason: "Aucune donnée disponible",
    });
  });

  it("active une station pluie seule sans fabriquer température ou vent", () => {
    const station = mapSynopRecord({
      ...record,
      t: null,
      u: null,
      pres: null,
      ff: null,
      raf10: null,
      dd: null,
      rr1: 4.2,
    }, 50.76, 2.52, 20);

    expect(station).toMatchObject({
      temperature: null,
      windSpeed: null,
      precipitation: 4.2,
      isActive: true,
    });
  });

  it("préserve les valeurs finies et leurs conversions existantes", () => {
    const station = mapSynopRecord(record, 50.76, 2.52, 20);

    expect(station).toMatchObject({
      temperature: 20,
      humidity: 70,
      pressure: 1013,
      windSpeed: 18,
      windGust: 25.2,
      windDirection: 180,
      precipitation: 0,
      isActive: true,
    });
  });
});

// ─── calculateGroundTruth ─────────────────────────────────────────────────────

describe("calculateGroundTruth", () => {
  it("returns null confidence and null values when no active stations", () => {
    const result = calculateGroundTruth([
      makeStation({ isActive: false, exclusionReason: "No data" }),
    ]);
    expect(result.stationCount).toBe(0);
    expect(result.confidenceScore).toBeNull();
    expect(result.temperature).toBeNull();
    expect(result.stationsIgnored).toHaveLength(1);
    expect(result.stationsUsed).toHaveLength(0);
  });

  it("returns the single station's values when only one active station", () => {
    const result = calculateGroundTruth([
      makeStation({ temperature: 20.0, humidity: 65, pressure: 1015 }),
    ]);
    expect(result.stationCount).toBe(1);
    expect(result.temperature).toBe(20.0);
    expect(result.humidity).toBe(65);
    expect(result.pressure).toBe(1015);
    expect(result.stationsUsed).toHaveLength(1);
    expect(result.stationsUsed[0].weight).toBeCloseTo(1.0, 1);
    expect(result.confidenceScore).toBe(80);
  });

  it("conserve exactement le score existant lorsque des températures sont qualifiées", () => {
    const result = calculateGroundTruth([
      makeStation({ stationId: "a", temperature: 18 }),
      makeStation({ stationId: "b", temperature: 20 }),
    ]);
    expect(result.stationCount).toBe(2);
    expect(result.temperature).toBe(19);
    expect(result.confidenceScore).toBe(75);
  });

  it("inclut une station pluie seule uniquement dans l’agrégat précipitation", () => {
    const result = calculateGroundTruth([makeStation({
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
      precipitation: 4.2,
    })]);

    expect(result.precipitation).toBe(4.2);
    expect(result.temperature).toBeNull();
    expect(result.windSpeed).toBeNull();
    expect(result.stationCount).toBe(0);
    expect(result.confidenceScore).toBeNull();
    expect(result.stationsUsed).toHaveLength(1);
    expect(result.stationsUsed[0].fieldWeights).toEqual({ precipitation: 1 });
    expect(result.stationsUsed[0].temperature).toBeNull();
    expect(result.stationsUsed[0].windSpeed).toBeNull();
  });

  it("conserve les contributions température et vent sans les mélanger avec la pluie", () => {
    const temperatureOnly = calculateGroundTruth([makeStation({
      temperature: 18.5,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
      precipitation: null,
    })]);
    const windOnly = calculateGroundTruth([makeStation({
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: 12,
      windGust: null,
      windDirection: null,
      precipitation: null,
    })]);

    expect(temperatureOnly.temperature).toBe(18.5);
    expect(temperatureOnly.windSpeed).toBeNull();
    expect(temperatureOnly.precipitation).toBeNull();
    expect(temperatureOnly.stationsUsed[0].fieldWeights).toEqual({ temperature: 1 });
    expect(windOnly.temperature).toBeNull();
    expect(windOnly.windSpeed).toBe(12);
    expect(windOnly.precipitation).toBeNull();
    expect(windOnly.stationCount).toBe(0);
    expect(windOnly.confidenceScore).toBeNull();
    expect(windOnly.stationsUsed).toHaveLength(1);
    expect(windOnly.stationsUsed[0].fieldWeights).toEqual({ windSpeed: 1 });
  });

  it.each(["aucun champ activant", "tous les champs nuls"] as const)("n’invente aucune contribution quand %s", (caseName) => {
    const result = calculateGroundTruth([makeStation({
      temperature: null,
      humidity: caseName === "aucun champ activant" ? 72 : null,
      pressure: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
      precipitation: null,
    })]);

    expect(result.temperature).toBeNull();
    expect(result.windSpeed).toBeNull();
    expect(result.precipitation).toBeNull();
    expect(result.stationsUsed).toHaveLength(0);
    expect(result.stationCount).toBe(0);
  });

  it("exclut une température vieille ou sans date sans retirer l’humidité récente des mêmes stations", () => {
    const now = Date.now();
    const recent = new Date(now - 5 * 60_000).toISOString();
    const old = new Date(now - 181 * 60_000).toISOString();
    const result = calculateGroundTruth([
      makeStation({
        stationId: "recent",
        temperature: 20,
        humidity: 80,
        updatedAt: recent,
        measurementTimes: { temperature: recent, humidity: recent },
      }),
      makeStation({
        stationId: "old-temperature",
        temperature: 40,
        humidity: 20,
        updatedAt: recent,
        measurementTimes: { temperature: old, humidity: recent },
      }),
      makeStation({
        stationId: "unknown-temperature",
        temperature: 60,
        humidity: 50,
        updatedAt: recent,
        measurementTimes: { temperature: null, humidity: recent },
      }),
    ]);

    expect(result.temperature).toBe(20);
    expect(result.humidity).toBe(50);
    expect(result.stationCount).toBe(1);
    const oldTemperature = result.stationsUsed.find((station) => station.stationId === "old-temperature")!;
    const unknownTemperature = result.stationsUsed.find((station) => station.stationId === "unknown-temperature")!;
    expect(oldTemperature.temperature).toBe(40);
    expect(oldTemperature.fieldWeights?.temperature).toBeUndefined();
    expect(oldTemperature.fieldWeights?.humidity).toBeGreaterThan(0);
    expect(unknownTemperature.temperature).toBe(60);
    expect(unknownTemperature.observedAt).toBeNull();
    expect(unknownTemperature.measurementTimes?.temperature).toBeNull();
    expect(unknownTemperature.measurementAgeByField?.temperature).toMatchObject({ observedAt: null, ageMinutes: null, status: "unknown" });
    expect(unknownTemperature.fieldWeights?.temperature).toBeUndefined();
    expect(unknownTemperature.fieldWeights?.humidity).toBeGreaterThan(0);
  });

  it("weights closer stations more heavily", () => {
    const near = makeStation({ stationId: "near", distanceKm: 1.0, temperature: 20.0 });
    const far = makeStation({ stationId: "far", distanceKm: 20.0, temperature: 30.0 });
    const result = calculateGroundTruth([near, far]);
    // Weighted average should be closer to 20 (near station)
    expect(result.temperature).toBeLessThan(25);
    expect(result.temperature).toBeGreaterThan(20);
  });

  it("normalise chaque composante avant d’appliquer les parts distance 50 %, qualité 30 % et fraîcheur 20 %", () => {
    const now = new Date().toISOString();
    const result = calculateGroundTruth([
      makeStation({ stationId: "near", distanceKm: 0.5, temperature: 20, reliabilityScore: 80, updatedAt: now }),
      makeStation({ stationId: "far", distanceKm: 10, temperature: 30, reliabilityScore: 80, updatedAt: now }),
    ]);
    const near = result.stationsUsed.find((station) => station.stationId === "near")!;
    const far = result.stationsUsed.find((station) => station.stationId === "far")!;

    // Chaque composante est une distribution normalisée entre les stations actives.
    expect(near.distanceWeight + far.distanceWeight).toBeCloseTo(1, 2);
    expect(near.qualityWeight + far.qualityWeight).toBeCloseTo(1, 2);
    expect(near.freshnessWeight + far.freshnessWeight).toBeCloseTo(1, 2);
    expect(near.weight + far.weight).toBeCloseTo(1, 2);

    // Avec qualité et fraîcheur identiques, l’IDW p=2 ne peut représenter que
    // les 50 % annoncés : la station proche pèse ~75 %, jamais ~100 %.
    expect(near.weight).toBeGreaterThan(0.74);
    expect(near.weight).toBeLessThan(0.76);
    expect(far.weight).toBeGreaterThan(0.24);
    expect(far.weight).toBeLessThan(0.26);
    expect(result.temperature).toBeCloseTo(22.5, 1);
  });

  it("rend la qualité et la fraîcheur réellement influentes après normalisation", () => {
    const now = Date.now();
    const result = calculateGroundTruth([
      makeStation({ stationId: "recent-reliable", distanceKm: 3, temperature: 20, reliabilityScore: 100, updatedAt: new Date(now).toISOString() }),
      makeStation({ stationId: "old-less-reliable", distanceKm: 3, temperature: 30, reliabilityScore: 40, updatedAt: new Date(now - 120 * 60_000).toISOString() }),
    ]);
    const recentReliable = result.stationsUsed.find((station) => station.stationId === "recent-reliable")!;
    const oldLessReliable = result.stationsUsed.find((station) => station.stationId === "old-less-reliable")!;
    expect(recentReliable.distanceWeight).toBeCloseTo(oldLessReliable.distanceWeight, 2);
    expect(recentReliable.qualityWeight).toBeGreaterThan(oldLessReliable.qualityWeight);
    expect(recentReliable.freshnessWeight).toBeGreaterThan(oldLessReliable.freshnessWeight);
    expect(recentReliable.weight).toBeGreaterThan(oldLessReliable.weight);
    expect(result.temperature).toBeLessThan(25);
  });

  it("handles null values gracefully (skips nulls in weighted average)", () => {
    const s1 = makeStation({ stationId: "s1", temperature: 18, humidity: null });
    const s2 = makeStation({ stationId: "s2", temperature: 22, humidity: 70 });
    const result = calculateGroundTruth([s1, s2]);
    expect(result.temperature).not.toBeNull();
    // humidity only from s2
    expect(result.humidity).toBe(70);
  });

  it.each([
    "temperature",
    "humidity",
    "pressure",
    "windSpeed",
    "windGust",
    "precipitation",
  ] as const)("convertit la mesure non finie %s en absence avant contribution et moyenne", (field) => {
    const result = calculateGroundTruth([
      makeStation({ stationId: "finite", [field]: 20 }),
      makeStation({ stationId: "non-finite", [field]: Number.POSITIVE_INFINITY }),
    ]);

    expect(result[field]).toBe(20);
    expect(result.stationsUsed.find((station) => station.stationId === "non-finite")?.[field]).toBeNull();
  });

  it("n’active ni ne couvre une station dont les seules mesures activantes sont non finies", () => {
    const result = calculateGroundTruth([
      makeStation({
        temperature: Number.NaN,
        windSpeed: Number.POSITIVE_INFINITY,
        precipitation: Number.NEGATIVE_INFINITY,
      }),
    ]);

    expect(result.stationCount).toBe(0);
    expect(result.stationsUsed).toHaveLength(0);
    expect(result.temperature).toBeNull();
    expect(result.windSpeed).toBeNull();
    expect(result.precipitation).toBeNull();
    expect(result.stationsIgnored[0]?.reason).toContain("Aucune mesure exploitable");
  });

  it("moves ignored stations to stationsIgnored list", () => {
    const result = calculateGroundTruth([
      makeStation({ stationId: "active" }),
      makeStation({ stationId: "ignored", isActive: false, exclusionReason: "Too old" }),
    ]);
    expect(result.stationsUsed.map(s => s.stationId)).toContain("active");
    expect(result.stationsIgnored.map(s => s.stationId)).toContain("ignored");
    expect(result.stationsIgnored[0].reason).toBe("Too old");
  });

  it("confidence score is higher with more agreeing stations", () => {
    const agreeing = [
      makeStation({ stationId: "a", temperature: 18.0 }),
      makeStation({ stationId: "b", temperature: 18.2 }),
      makeStation({ stationId: "c", temperature: 17.9 }),
    ];
    const disagreeing = [
      makeStation({ stationId: "x", temperature: 10.0 }),
      makeStation({ stationId: "y", temperature: 25.0 }),
    ];
    const r1 = calculateGroundTruth(agreeing);
    const r2 = calculateGroundTruth(disagreeing);
    expect(r1.confidenceScore).toBeGreaterThan(r2.confidenceScore);
  });
});
