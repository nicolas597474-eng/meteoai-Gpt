import { describe, expect, it } from "vitest";
import { calculateUltraLocal, getUltraLocalConfig } from "./ultraLocalService";
import type { StationData } from "./stationService";

function station(overrides: Partial<StationData>): StationData {
  const updatedAt = overrides.updatedAt !== undefined ? overrides.updatedAt : new Date().toISOString();
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
    updatedAt,
    reliabilityScore: 80,
    updateFrequencyMin: 10,
    dataAvailability: 0.95,
    isActive: true,
    qualificationStatus: "validated",
    sourceTier: 1,
    ...overrides,
    measurementTimes: overrides.measurementTimes ?? {
      temperature: updatedAt,
      humidity: updatedAt,
      pressure: updatedAt,
      windSpeed: updatedAt,
      windGust: updatedAt,
      windDirection: updatedAt,
      precipitation: updatedAt,
    },
  };
}

describe("calculateUltraLocal", () => {
  it("n’infère jamais la cible depuis une station classée, inactive ou réordonnée", () => {
    const inactiveHighStation = station({ stationId: "inactive-high", altitude: 400, distanceKm: 1.1, isActive: false });
    const activeStation = station({ stationId: "active", altitude: 50, distanceKm: 1.4, temperature: 20, humidity: 62, windSpeed: 8 });

    for (const input of [[inactiveHighStation, activeStation], [activeStation, inactiveHighStation]]) {
      const result = calculateUltraLocal(input, "local", 50.75, 2.52, null, null, { recordStationReadings: false });
      const contribution = result.stationsUsed.find((entry) => entry.stationId === "active")!;
      const altitudeCheck = contribution.qualityChecks.find((check) => check.name === "Altitude");

      expect(result.temperature).toBe(20);
      expect(result.humidity).toBe(62);
      expect(result.windSpeed).toBe(8);
      expect(result.stationCount).toBe(1);
      expect(contribution.temperature).toBe(20);
      expect(contribution.adjustedTemperature).toBe(20);
      expect(contribution.altitudeAdjustment).toBe(0);
      expect(altitudeCheck).toMatchObject({ passed: false, status: "non_verifiable", value: "non vérifiable" });
      expect(result.altitudeCorrection).toEqual({ applied: false, reason: "reference_altitude_unavailable" });
    }
  });

  it("conserve la formule et le cutoff de 200 m quand la cible est fournie explicitement", () => {
    const result = calculateUltraLocal([
      station({ stationId: "inside-cutoff", altitude: 130, temperature: 20 }),
      station({ stationId: "outside-cutoff", altitude: 301, temperature: 25, distanceKm: 2 }),
    ], "local", 50.75, 2.52, 100, null, { recordStationReadings: false });

    expect(result.stationsUsed.map((entry) => entry.stationId)).toEqual(["inside-cutoff"]);
    expect(result.stationsUsed[0].altitudeAdjustment).toBeCloseTo(0.20, 2);
    expect(result.stationsUsed[0].adjustedTemperature).toBe(20.2);
    expect(result.stationsUsed[0].qualityChecks.find((check) => check.name === "Altitude"))
      .toMatchObject({ passed: true, status: "passed" });
    expect(result.stationsIgnored.find((entry) => entry.stationId === "outside-cutoff")?.reason).toContain("Altitude");
    expect(result.altitudeCorrection).toEqual({ applied: true, reason: "adjustment_applied" });
  });

  it("favorise la station plus fraîche à distance et fiabilité égales", () => {
    const now = Date.now();
    const result = calculateUltraLocal([
      station({ stationId: "fresh", name: "Fraîche", temperature: 20, updatedAt: new Date(now).toISOString() }),
      station({ stationId: "older", name: "Ancienne", temperature: 16, updatedAt: new Date(now - 25 * 60_000).toISOString() }),
    ], "ultra-local", 50.75, 2.52, 40, null);

    const fresh = result.stationsUsed.find((item) => item.stationId === "fresh");
    const older = result.stationsUsed.find((item) => item.stationId === "older");

    expect(fresh?.freshnessWeight).toBeGreaterThan(older?.freshnessWeight ?? 1);
    expect(fresh?.weight).toBeGreaterThan(older?.weight ?? 1);
    expect(result.temperature).toBeGreaterThan(18);
  });

  it("applique le poids de chaque contribution à la même station pour l’humidité", () => {
    const result = calculateUltraLocal([
      station({ stationId: "far", name: "Lointaine", distanceKm: 4, humidity: 90, temperature: 20 }),
      station({ stationId: "near", name: "Proche", distanceKm: 1, humidity: 20, temperature: 20 }),
    ], "ultra-local", 50.75, 2.52, 40, null);

    expect(result.humidity).not.toBeNull();
    expect(result.humidity!).toBeLessThan(50);
    expect(result.confidenceByParameter.humidity).not.toBeNull();
    expect(result.confidenceByParameter.temperature).toBe(result.confidenceScore);
  });

  it("signale une confiance indisponible pour une variable absente de toutes les stations", () => {
    const result = calculateUltraLocal([
      station({ stationId: "one", windGust: null }),
      station({ stationId: "two", distanceKm: 3, windGust: null }),
    ], "local", 50.75, 2.52, 40, null);

    expect(result.windGust).toBeNull();
    expect(result.confidenceByParameter.windGust).toBeNull();
  });

  it("n’invente pas de confiance avec une seule observation par variable", () => {
    const result = calculateUltraLocal([
      station({ stationId: "unique", humidity: 75, precipitation: 1.2, windSpeed: 18, windGust: 35 }),
      station({ stationId: "temp-only", distanceKm: 3, humidity: null, precipitation: null, windSpeed: null, windGust: null }),
    ], "local", 50.75, 2.52, 40, null);

    expect(result.temperature).not.toBeNull();
    expect(result.confidenceScore).not.toBeNull();
    expect(result.humidity).toBe(75);
    expect(result.precipitation).toBe(1.2);
    expect(result.windSpeed).toBe(18);
    expect(result.windGust).toBe(35);
    expect(result.confidenceByParameter).toMatchObject({ humidity: null, precipitation: null, windSpeed: null, windGust: null });
  });

  it("pondère indépendamment pluie, vent et rafales et écarte une station non fraîche", () => {
    const now = Date.now();
    const result = calculateUltraLocal([
      station({ stationId: "near", distanceKm: 1, precipitation: 0.2, windSpeed: 8, windGust: 14, updatedAt: new Date(now).toISOString() }),
      station({ stationId: "far", distanceKm: 4, precipitation: 8, windSpeed: 42, windGust: 70, updatedAt: new Date(now).toISOString() }),
      station({ stationId: "stale", distanceKm: 1.2, precipitation: 99, windSpeed: 99, windGust: 99, updatedAt: new Date(now - 90 * 60_000).toISOString() }),
    ], "ultra-local", 50.75, 2.52, 40, null);

    expect(result.stationsIgnored.map((item) => item.stationId)).toContain("stale");
    expect(result.precipitation).toBeLessThan(4);
    expect(result.windSpeed).toBeLessThan(25);
    expect(result.windGust).toBeLessThan(45);
    expect(result.confidenceByParameter.precipitation).not.toBeNull();
    expect(result.confidenceByParameter.windSpeed).not.toBeNull();
    expect(result.confidenceByParameter.windGust).not.toBeNull();
  });

  it.each(["local", "ultra-local"] as const)("filtre par champ dans le mode %s sans effacer les observations brutes", (mode) => {
    const now = Date.now();
    const recent = new Date(now - 5 * 60_000).toISOString();
    const cutoff = getUltraLocalConfig(mode).config.maxFreshnessMin;
    const old = new Date(now - (cutoff + 1) * 60_000).toISOString();
    const result = calculateUltraLocal([
      station({
        stationId: "fresh",
        temperature: 20,
        humidity: 80,
        updatedAt: recent,
        measurementTimes: { temperature: recent, humidity: recent },
      }),
      station({
        stationId: "old-temperature",
        temperature: 50,
        humidity: 20,
        updatedAt: recent,
        measurementTimes: { temperature: old, humidity: recent },
      }),
      station({
        stationId: "unknown-temperature",
        temperature: 80,
        humidity: 40,
        updatedAt: recent,
        measurementTimes: { temperature: null, humidity: recent },
      }),
    ], mode, 50.75, 2.52, 40, null, { recordStationReadings: false });

    expect(result.temperature).toBe(20);
    expect(result.humidity).toBe(46.7);
    expect(result.stationCount).toBe(1);
    const oldTemperature = result.stationsUsed.find((item) => item.stationId === "old-temperature")!;
    const unknownTemperature = result.stationsUsed.find((item) => item.stationId === "unknown-temperature")!;
    expect(oldTemperature.temperature).toBe(50);
    expect(oldTemperature.fieldWeights?.temperature).toBeUndefined();
    expect(oldTemperature.fieldWeights?.humidity).toBeGreaterThan(0);
    expect(unknownTemperature.temperature).toBe(80);
    expect(unknownTemperature.observedAt).toBeNull();
    expect(unknownTemperature.measurementAgeByField?.temperature).toMatchObject({ observedAt: null, ageMinutes: null, status: "unknown" });
    expect(unknownTemperature.fieldWeights?.temperature).toBeUndefined();
    expect(unknownTemperature.fieldWeights?.humidity).toBeGreaterThan(0);
  });

  it("limite strictement l’Ultra-local aux stations situées dans les 10 km", () => {
    const result = calculateUltraLocal([
      station({ stationId: "outside-ultra", distanceKm: 12, temperature: 21 }),
    ], "ultra-local", 50.75, 2.52, 40, null);

    expect(result.stationsUsed).toHaveLength(0);
    expect(result.stationCount).toBe(0);
    expect(result.bandBreakdown.map((band) => band.band)).toEqual(["< 2 km", "2-5 km", "5-10 km"]);
  });

  it("inclut la bande 20-30 km dans le calcul Local élargi", () => {
    const result = calculateUltraLocal([
      station({ stationId: "local-sector", distanceKm: 25, temperature: 19 }),
    ], "local", 50.75, 2.52, 40, null);

    expect(result.stationsUsed.map((item) => item.stationId)).toContain("local-sector");
    expect(result.bandBreakdown.find((band) => band.band === "20-30 km")?.stationCount).toBe(1);
    expect(result.stationCount).toBe(1);
  });

  it("contribue une station pluie seule uniquement à la précipitation", () => {
    const result = calculateUltraLocal([station({
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
      precipitation: 4.2,
    })], "local", 50.75, 2.52, 40, null, { recordStationReadings: false });

    expect(result.precipitation).toBe(4.2);
    expect(result.temperature).toBeNull();
    expect(result.windSpeed).toBeNull();
    expect(result.stationCount).toBe(0);
    expect(result.stationsUsed).toHaveLength(1);
    expect(Object.keys(result.stationsUsed[0].fieldWeights ?? {})).toEqual(["precipitation"]);
    expect(result.stationsUsed[0].fieldWeights?.precipitation).toBeGreaterThan(0);
    expect(result.stationsUsed[0].temperature).toBeNull();
    expect(result.stationsUsed[0].windSpeed).toBeNull();
    expect(result.stationsUsed[0].adjustedTemperature).toBeNull();
  });

  it("maintient les contributions température et vent strictement indépendantes", () => {
    const temperatureOnly = calculateUltraLocal([station({
      temperature: 18.5,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
      precipitation: null,
    })], "local", 50.75, 2.52, 40, null, { recordStationReadings: false });
    const windOnly = calculateUltraLocal([station({
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: 12,
      windGust: null,
      windDirection: null,
      precipitation: null,
    })], "local", 50.75, 2.52, 40, null, { recordStationReadings: false });

    expect(temperatureOnly.temperature).toBe(18.5);
    expect(temperatureOnly.windSpeed).toBeNull();
    expect(temperatureOnly.precipitation).toBeNull();
    expect(Object.keys(temperatureOnly.stationsUsed[0].fieldWeights ?? {})).toEqual(["temperature"]);
    expect(temperatureOnly.stationsUsed[0].fieldWeights?.temperature).toBeGreaterThan(0);
    expect(windOnly.temperature).toBeNull();
    expect(windOnly.windSpeed).toBe(12);
    expect(windOnly.precipitation).toBeNull();
    expect(windOnly.stationCount).toBe(0);
    expect(Object.keys(windOnly.stationsUsed[0].fieldWeights ?? {})).toEqual(["windSpeed"]);
    expect(windOnly.stationsUsed[0].fieldWeights?.windSpeed).toBeGreaterThan(0);
  });

  it.each(["aucun champ activant", "tous les champs nuls"] as const)("n’invente aucune contribution quand %s", (caseName) => {
    const result = calculateUltraLocal([station({
      temperature: null,
      humidity: caseName === "aucun champ activant" ? 72 : null,
      pressure: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
      precipitation: null,
    })], "local", 50.75, 2.52, 40, null, { recordStationReadings: false });

    expect(result.temperature).toBeNull();
    expect(result.windSpeed).toBeNull();
    expect(result.precipitation).toBeNull();
    expect(result.stationsUsed).toHaveLength(0);
    expect(result.stationCount).toBe(0);
  });
});
