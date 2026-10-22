import { describe, expect, it } from "vitest";
import type { ForecastRun } from "../drizzle/schema";
import { OFFICIAL_HOURLY_MODELS } from "./weatherServices";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";
import { buildDailyForecastVerificationReadModel, buildMeteoAIDailyFusionArchiveRun } from "./dailyForecastVerification";
import type { PhysicalSnapshot } from "./physicalObservationAggregation";

const LOCATION = "50.757_2.520";
const VALID_DATE = "2026-10-02";
const OFFICIAL_MODEL = OFFICIAL_HOURLY_MODELS[0];
const ISSUE_TIME = Date.parse("2026-10-01T08:00:00.000Z");

function physicalSnapshots(overrides: {
  source?: string;
  stationId?: string;
  noMeasurementTime?: boolean;
  minimumHour?: number;
} = {}): PhysicalSnapshot[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const observedAt = (parisLocalHourToUniqueEpochMs(VALID_DATE, hour) ?? 0) + 10 * 60_000;
    const temperature = hour === (overrides.minimumHour ?? 3) ? 10 : hour === 16 ? 20 : 18;
    const windSpeed = hour === 18 ? 10 : 4;
    const windGust = hour === 18 ? 15 : 8;
    const precipitation = 0.1;
    const measurementTime = overrides.noMeasurementTime ? null : new Date(observedAt).toISOString();
    return {
      id: hour + 1,
      date: VALID_DATE,
      hour,
      stationCount: 1,
      temperature,
      windSpeed,
      windGust,
      precipitation,
      stationsUsed: [{
        stationId: overrides.stationId ?? "mf-59000",
        name: "Station physique de test",
        source: overrides.source ?? "meteofrance",
        observedAt: measurementTime,
        measurementTimes: {
          temperature: measurementTime,
          windSpeed: measurementTime,
          windGust: measurementTime,
          precipitation: measurementTime,
        },
        temperature,
        windSpeed,
        windGust,
        precipitation,
        weight: 1,
      }],
    };
  });
}

function forecastRun(overrides: Partial<ForecastRun> = {}): ForecastRun {
  return {
    id: 11,
    locationKey: LOCATION,
    validDate: VALID_DATE,
    serviceName: OFFICIAL_MODEL.name,
    provider: "open-meteo",
    modelId: OFFICIAL_MODEL.modelId,
    sourceKind: "model_forecast",
    issuedAt: ISSUE_TIME,
    tempMax: 22,
    tempMin: 12,
    precipitation: 2.4,
    windSpeed: 12,
    windGust: 18,
    humidity: null,
    cloudCover: null,
    condition: null,
    rawData: null,
    capturedAt: new Date(ISSUE_TIME + 60_000),
    ...overrides,
  };
}

describe("comparaison quotidienne prévision vs observation", () => {
  it("laisse l’absence de paire indisponible, sans produire de score ni d’effectif nul présenté comme une preuve", () => {
    const result = buildDailyForecastVerificationReadModel(LOCATION, VALID_DATE, [], []);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("Aucun snapshot");
    expect(result.pairs).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.meteoai.status).toBe("unavailable");
    expect(result.meteoai.pairCount).toBeNull();
  });

  it("apparie uniquement la même clé de lieu et la même date de validité", () => {
    const runs = [
      forecastRun({ locationKey: "51.000_2.000" }),
      forecastRun({ id: 12, validDate: "2026-10-01" }),
    ];
    const result = buildDailyForecastVerificationReadModel(LOCATION, VALID_DATE, runs, physicalSnapshots());
    expect(result.status).toBe("unavailable");
    expect(result.forecastRunCount).toBe(0);
    expect(result.pairs).toEqual([]);
    expect(result.issues).toContainEqual({ code: "no_forecast_runs", count: 1 });
  });

  it("sépare émission et disponibilité et calcule les paires, erreurs et métriques par modèle-variable-horizon", () => {
    const capturedAt = (parisLocalHourToUniqueEpochMs(VALID_DATE, 0) ?? 0) - 5 * 60_000;
    const result = buildDailyForecastVerificationReadModel(LOCATION, VALID_DATE, [
      forecastRun({ capturedAt: new Date(capturedAt) }),
      forecastRun({ id: 12, serviceName: OFFICIAL_HOURLY_MODELS[1].name, modelId: OFFICIAL_HOURLY_MODELS[1].modelId, capturedAt: new Date(capturedAt) }),
    ], physicalSnapshots());
    expect(result.status).toBe("available");
    expect(result.pairs).toHaveLength(10);
    const temperatureMax = result.pairs.find((pair) => pair.modelId === OFFICIAL_MODEL.modelId && pair.variable === "temperature_max");
    expect(temperatureMax).toMatchObject({
      forecastIssuedAt: ISSUE_TIME,
      forecastAvailableAt: capturedAt,
      observationWindowStartAt: expect.any(Number),
      forecastValue: 22,
      observedValue: 20,
      signedError: 2,
      evidenceType: "physical_observation",
      observationIsQualified: 1,
    });
    expect(temperatureMax!.forecastAvailableAt!).toBeLessThan(temperatureMax!.observationWindowStartAt!);
    const precip = result.pairs.find((pair) => pair.modelId === OFFICIAL_MODEL.modelId && pair.variable === "precipitation_sum");
    expect(precip?.observedValue).toBeCloseTo(2.4);
    expect(result.groups).toHaveLength(10);
    expect(result.groups.every((group) => group.pairCount === 1 && group.evaluatedDays === 1)).toBe(true);
    expect(result.groups.every((group) => group.horizonBucket === "1-3d")).toBe(true);
  });

  it("exclut une mesure antérieure à la disponibilité réelle, même si le run a été émis auparavant", () => {
    const measuredAtHour0 = (parisLocalHourToUniqueEpochMs(VALID_DATE, 0) ?? 0) + 10 * 60_000;
    const availableAfterFirstReading = (parisLocalHourToUniqueEpochMs(VALID_DATE, 1) ?? 0) + 20 * 60_000;
    const result = buildDailyForecastVerificationReadModel(LOCATION, VALID_DATE, [
      forecastRun({ capturedAt: new Date(availableAfterFirstReading) }),
    ], physicalSnapshots({ minimumHour: 0 }));
    expect(result.pairs.some((pair) => pair.variable === "temperature_min")).toBe(false);
    expect(result.pairs.some((pair) => pair.variable === "precipitation_sum")).toBe(false);
    expect(result.pairs.every((pair) => pair.forecastAvailableAt! < pair.observationWindowStartAt!)).toBe(true);
    expect(result.issues.some((issue) => issue.code === "forecast_available_after_measurement")).toBe(true);
  });

  it("refuse une mesure sans heure source par variable et n’utilise pas l’heure d’archivage comme substitut", () => {
    const result = buildDailyForecastVerificationReadModel(LOCATION, VALID_DATE, [forecastRun()], physicalSnapshots({ noMeasurementTime: true }));
    expect(result.status).toBe("unavailable");
    expect(result.pairs).toEqual([]);
    expect(result.reason).toContain("heure réelle de mesure");
    expect(result.issues.some((issue) => issue.code === "physical_station_measurement_time_missing")).toBe(true);
  });

  it("refuse Open-Meteo Best Match en prévision et les sources de grille comme observation", () => {
    const bestMatch = forecastRun({ serviceName: "Open-Meteo", provider: "open-meteo", modelId: "best_match" });
    const fromBestMatchStation = physicalSnapshots({ source: "openmeteo", stationId: "openmeteo-50.7-2.5" });
    const result = buildDailyForecastVerificationReadModel(LOCATION, VALID_DATE, [bestMatch], fromBestMatchStation);
    expect(result.status).toBe("unavailable");
    expect(result.forecastRunCount).toBe(0);
    expect(result.pairs).toEqual([]);
    expect(result.reason).toContain("Aucune prévision immuable");
  });

  it("n’accepte pas un run hors fenêtre d’horizon documentée", () => {
    const result = buildDailyForecastVerificationReadModel(LOCATION, VALID_DATE, [
      forecastRun({ issuedAt: Date.parse("2026-09-01T08:00:00.000Z"), capturedAt: new Date("2026-09-01T08:01:00.000Z") }),
    ], physicalSnapshots());
    expect(result.status).toBe("unavailable");
    expect(result.pairs).toEqual([]);
    expect(result.reason).toContain("horizon");
  });

  it("n’archive pas rétroactivement la fusion d’une date passée et étiquette séparément MeteoAI", () => {
    expect(buildMeteoAIDailyFusionArchiveRun({
      locationKey: LOCATION,
      targetDate: "2026-10-01",
      availableAt: Date.parse("2026-10-02T08:00:00.000Z"),
      forecast: { tempMax: 20, tempMin: 10, precipitation: 0, windSpeed: 10, coreCalibrationComplete: true },
    })).toBeNull();

    const row = buildMeteoAIDailyFusionArchiveRun({
      locationKey: LOCATION,
      targetDate: VALID_DATE,
      availableAt: Date.parse("2026-10-01T08:00:00.000Z"),
      forecast: { tempMax: 20, tempMin: 10, precipitation: 0, windSpeed: 10, coreCalibrationComplete: true },
    });
    expect(row).toMatchObject({ serviceName: "MeteoAI", provider: "meteoai", modelId: "meteoai-official-daily-v2", sourceKind: "service_forecast" });
  });
});
