import { describe, expect, it } from "vitest";
import { buildCurrentDashboardWeatherState } from "./currentDashboardWeather";
import type { StationData } from "./stationService";
import type { CurrentWeatherSnapshot } from "./weatherServices";

const nowMs = Date.now();
const freshAt = new Date(nowMs - 5 * 60_000).toISOString();

function station(overrides: Partial<StationData> = {}): StationData {
  return {
    stationId: "mf-1",
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
    precipitation: 2,
    updatedAt: freshAt,
    measurementTimes: {
      temperature: freshAt,
      humidity: freshAt,
      pressure: freshAt,
      windSpeed: freshAt,
      windGust: freshAt,
      windDirection: freshAt,
      precipitation: freshAt,
    },
    reliabilityScore: 80,
    updateFrequencyMin: 10,
    dataAvailability: 0.95,
    isActive: true,
    qualificationStatus: "validated",
    sourceTier: 1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CurrentWeatherSnapshot> = {}): CurrentWeatherSnapshot {
  return {
    sourceKind: "model_current_snapshot",
    source: "open-meteo",
    capturedAt: freshAt,
    elevationM: 40,
    temp: 25,
    apparentTemp: 24,
    precipitation: 0,
    windSpeed: 7,
    windGust: 10,
    windDirection: 180,
    cloudCover: 20,
    humidity: 55,
    weatherCode: 1,
    condition: "Ensoleillé",
    ...overrides,
  };
}

function build(stations: StationData[], model = snapshot()) {
  return buildCurrentDashboardWeatherState({
    lat: 50.7567,
    lon: 2.5204,
    snapshot: model,
    stations,
    nowMs,
  });
}

describe("buildCurrentDashboardWeatherState", () => {
  it("préfère l’agrégation physique fraîche sans poids modèle et expose compte, source et âge", () => {
    const state = build([
      station({ stationId: "mf-1", name: "Lille", temperature: 20 }),
      station({ stationId: "mf-2", name: "Aéroport", temperature: 20.2, distanceKm: 2 }),
    ]);

    expect(state.fields.temperature.value).toBeCloseTo(20.1, 1);
    expect(state.fields.temperature.provenance).toMatchObject({
      kind: "physical_stations",
      stationCount: 2,
      stationSources: expect.arrayContaining(["Météo-France"]),
      ageMinutes: 5,
    });
    expect(state.fields.temperature.provenance).not.toHaveProperty("confidence");
  });

  it("replie la température sur Open-Meteo si l’altitude du lieu n’est pas fournie", () => {
    const state = build([station()], snapshot({ elevationM: null }));
    expect(state.fields.temperature).toMatchObject({
      value: 25,
      provenance: { kind: "open_meteo_snapshot", reason: expect.stringContaining("Altitude du lieu absente") },
    });
  });

  it("replie la température si son horodatage manque ou dépasse la fraîcheur Local", () => {
    const missingTime = station({ measurementTimes: { ...station().measurementTimes, temperature: null } });
    const staleTime = station({
      stationId: "mf-old-temperature",
      measurementTimes: { ...station().measurementTimes, temperature: new Date(nowMs - 90 * 60_000).toISOString() },
    });
    expect(build([missingTime]).fields.temperature).toMatchObject({ value: 25, provenance: { kind: "open_meteo_snapshot" } });
    expect(build([staleTime]).fields.temperature).toMatchObject({ value: 25, provenance: { kind: "open_meteo_snapshot" } });
  });

  it("expose les températures anciennes/inconnues sans les fusionner et conserve les champs frais de ces stations", () => {
    const unknownTime = station({
      stationId: "mf-unknown-temperature",
      temperature: 18,
      humidity: 80,
      measurementTimes: { ...station().measurementTimes, temperature: null, humidity: freshAt },
    });
    const staleTime = station({
      stationId: "mf-stale-temperature",
      temperature: 35,
      humidity: 40,
      measurementTimes: {
        ...station().measurementTimes,
        temperature: new Date(nowMs - 90 * 60_000).toISOString(),
        humidity: freshAt,
      },
    });
    const state = build([unknownTime, staleTime]);

    expect(state.fields.temperature).toMatchObject({ value: 25, provenance: { kind: "open_meteo_snapshot" } });
    expect(state.fields.temperature.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ stationId: "mf-unknown-temperature", value: 18, ageStatus: "unknown", ageMinutes: null, contributes: false }),
      expect.objectContaining({ stationId: "mf-stale-temperature", value: 35, ageStatus: "known", ageMinutes: 90, contributes: false }),
    ]));
    expect(state.fields.humidity).toMatchObject({ value: 60, provenance: { kind: "physical_stations", stationCount: 2 } });
  });

  it("retourne indisponible lorsqu’il n’y a ni station physique ni snapshot modèle", () => {
    const state = buildCurrentDashboardWeatherState({ lat: 50.75, lon: 2.52, snapshot: null, stations: [], nowMs });
    expect(state.fields.temperature).toMatchObject({ value: null, provenance: { kind: "unavailable" } });
    expect(state.fields.windSpeed).toMatchObject({ value: null, provenance: { kind: "unavailable" } });
    expect(state.fields.pressure).toMatchObject({ value: null, provenance: { kind: "unavailable" } });
  });

  it("écarte les timestamps manquants ou trop anciens pour un champ, sans empêcher le repli de ce champ", () => {
    const missingTime = station({
      windSpeed: 99,
      humidity: null,
      measurementTimes: { ...station().measurementTimes, humidity: null, windSpeed: null },
    });
    const staleTime = station({
      stationId: "mf-stale",
      humidity: 99,
      windSpeed: null,
      measurementTimes: {
        ...station().measurementTimes,
        humidity: new Date(nowMs - 90 * 60_000).toISOString(),
        windSpeed: null,
      },
    });
    const state = build([missingTime, staleTime]);

    expect(state.fields.windSpeed).toMatchObject({ value: 7, provenance: { kind: "open_meteo_snapshot" } });
    expect(state.fields.humidity).toMatchObject({ value: 55, provenance: { kind: "open_meteo_snapshot" } });
    expect(state.fields.temperature.provenance.kind).toBe("physical_stations");
  });

  it("calcule la direction du vent comme moyenne circulaire autour de 0°, pas comme moyenne arithmétique", () => {
    const state = build([
      station({ stationId: "d1", windDirection: 359 }),
      station({ stationId: "d2", windDirection: 1, distanceKm: 2 }),
    ]);
    const direction = state.fields.windDirection.value as number;

    expect(direction === 0 || direction < 2 || direction > 358).toBe(true);
    expect(state.fields.windDirection.provenance.stationCount).toBe(2);
  });

  it("qualifie vent et humidité indépendamment des écarts thermiques entre stations", () => {
    const state = build([
      station({ stationId: "t-low", temperature: 0, humidity: 20, windSpeed: 5 }),
      station({ stationId: "t-mid", temperature: 25, humidity: 50, windSpeed: 10, distanceKm: 2 }),
      station({ stationId: "t-high", temperature: 50, humidity: 80, windSpeed: 15, distanceKm: 3 }),
    ]);

    expect(state.fields.temperature.provenance.stationCount).toBe(1);
    expect(state.fields.humidity.provenance.stationCount).toBe(3);
    expect(state.fields.windSpeed.provenance.stationCount).toBe(3);
  });

  it("n’agrège pas la pluie physique sans intervalle comparable et conserve même une valeur modèle zéro", () => {
    const state = build([station({ precipitation: 7 })], snapshot({ precipitation: 0 }));
    expect(state.fields.precipitation).toMatchObject({
      value: 0,
      provenance: {
        kind: "open_meteo_snapshot",
        reason: expect.stringContaining("périodes d’accumulation"),
      },
    });
  });

  it("garde les champs modèle-only sourcés modèle et marque les valeurs absentes indisponibles sans substituer zéro", () => {
    const state = build([], snapshot({ apparentTemp: 0, cloudCover: null }));
    expect(state.fields.apparentTemperature).toMatchObject({ value: 0, provenance: { kind: "open_meteo_snapshot" } });
    expect(state.fields.cloudCover).toMatchObject({ value: null, provenance: { kind: "unavailable" } });
    expect(state.fields.pressure).toMatchObject({ value: null, provenance: { kind: "unavailable" } });
  });

  it("exclut la pression physique tant que la référence barométrique n’est pas typée", () => {
    const state = build([station({ pressure: 1017 })]);
    expect(state.fields.pressure).toMatchObject({
      value: null,
      provenance: { kind: "unavailable", reason: expect.stringContaining("référence barométrique comparable") },
    });
  });

  it("ne modifie pas le snapshot reçu et n’ajoute ni séries futures ni scores au contrat courant", () => {
    const model = Object.freeze(snapshot());
    const state = build([station()], model);
    expect(model.temp).toBe(25);
    expect(Object.keys(state)).toEqual(["computedAt", "fields"]);
    expect(Object.keys(state.fields)).not.toContain("hourly");
    expect(Object.keys(state.fields.temperature)).not.toContain("confidence");
  });
});
