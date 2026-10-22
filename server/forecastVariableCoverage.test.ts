import { describe, expect, it } from "vitest";
import {
  buildDailyModelCollectionCoverage,
  buildHourlyArchiveValues,
  buildHourlyModelCollectionCoverage,
  confirmDailyArchiveCoverage,
  DAILY_FORECAST_REQUEST_KEYS,
  DAILY_FORECAST_VARIABLES,
  HOURLY_FORECAST_VARIABLES,
} from "./forecastVariableCoverage";

const targetDate = "2026-10-03";
const allHourlyValues = {
  temperature: 10, apparentTemperature: 9, precipitation: 0, rain: 0,
  showers: 0, snowfall: 0, windSpeed: 5, windDirection: 180,
  windGusts: 8, humidity: 80, pressure: 1012, cloudCover: 40,
  cloudLow: 10, cloudMid: 15, cloudHigh: 15, weatherCode: 1,
  uvIndex: 2, dewPoint: 6, visibility: 24000, solarRadiation: 120,
};

describe("daily variable collection evidence", () => {
  it("continues requesting all seven daily fields, including undocumented means", () => {
    expect(DAILY_FORECAST_REQUEST_KEYS).toEqual([
      "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
      "wind_speed_10m_max", "wind_gusts_10m_max",
      "relative_humidity_2m_mean", "cloud_cover_mean",
    ]);
    expect(DAILY_FORECAST_VARIABLES.filter((variable) => variable.documentationStatus === "unconfirmed").map((variable) => variable.requested))
      .toEqual([true, true]);
  });

  it("distinguishes a field absent for one model from a failed request, and confirms only persisted values", () => {
    const daily = buildDailyModelCollectionCoverage({
      modelName: "AROME", modelId: "meteofrance_arome_france_hd", isOfficialModel: true,
      status: "partial", requestAttempts: 1, errorCode: null, requestedDays: 2, targetDate,
      daily: {
        time: [targetDate, "2026-10-04"],
        temperature_2m_max: [20, 21], temperature_2m_min: [12, 13],
        precipitation_sum: [0, 1], wind_speed_10m_max: [8, 9], wind_gusts_10m_max: [18, 19],
        relative_humidity_2m_mean: [40, 45], cloud_cover_mean: [null, 60],
      },
    });
    const forecasts = [{ serviceName: "AROME", tempMax: 20, tempMin: 12, precipitation: 0, windSpeed: 8, windGust: 18, humidity: 40, cloudCover: null }];
    const archiveRows = [
      { serviceName: "AROME", tempMax: 20, humidity: 40, cloudCover: null },
      { serviceName: "AROME", tempMax: 21, humidity: 45, cloudCover: 60 },
    ];
    const [archived] = confirmDailyArchiveCoverage([daily], { targetDate, forecasts, archiveRows, archiveRowsWritten: 2 });
    const humidity = archived.variables.find((variable) => variable.key === "relative_humidity_2m_mean")!;
    const cloud = archived.variables.find((variable) => variable.key === "cloud_cover_mean")!;

    expect(archived.archiveWriteConfirmed).toBe(true);
    expect(humidity).toMatchObject({ requested: true, documentationStatus: "unconfirmed", status: "available", receivedCount: 2, archivedCount: 2, exposedCount: 1 });
    expect(cloud).toMatchObject({ requested: true, documentationStatus: "unconfirmed", status: "partial", receivedCount: 1, missingCount: 1, archivedCount: 1, exposedCount: 0 });
  });

  it("reports the actual short horizon separately from missing field values", () => {
    const coverage = buildDailyModelCollectionCoverage({
      modelName: "AROME", modelId: "meteofrance_arome_france_hd", isOfficialModel: true,
      status: "partial", requestAttempts: 1, errorCode: null, requestedDays: 16, targetDate,
      daily: { time: [targetDate, "2026-10-04"], temperature_2m_max: [20, 21] },
    });
    expect(coverage).toMatchObject({ returnedDays: 2, maximumDocumentedDays: 2, targetDateInResponse: true });
    expect(coverage.variables.find((variable) => variable.key === "temperature_2m_max"))
      .toMatchObject({ status: "out_of_horizon", receivedCount: 2, outOfHorizonCount: 14 });
  });

  it("marks provider failures separately from successful responses with absent data", () => {
    const failed = buildDailyModelCollectionCoverage({
      modelName: "ARPEGE", modelId: "meteofrance_arpege_europe", isOfficialModel: true,
      status: "failed", requestAttempts: 2, errorCode: "provider_http_4xx", requestedDays: 16,
    });
    expect(failed.variables.every((variable) => variable.status === "request_failed" || variable.status === "unconfirmed")).toBe(true);
    expect(failed.variables.find((variable) => variable.key === "relative_humidity_2m_mean"))
      .toMatchObject({ requested: true, status: "request_failed", receivedCount: 0 });
  });
});

describe("hourly variable collection evidence", () => {
  it("archives all 20 requested fields, including separate rain and showers values", () => {
    const archiveValues = buildHourlyArchiveValues({ values: allHourlyValues });
    expect(HOURLY_FORECAST_VARIABLES).toHaveLength(20);
    expect(archiveValues).toHaveLength(20);
    expect(archiveValues.map((row) => row.variable)).toContain("rain");
    expect(archiveValues.map((row) => row.variable)).toContain("showers");
    expect(archiveValues.find((row) => row.variable === "rain")).toMatchObject({ value: 0, unit: "mm" });
    expect(archiveValues.find((row) => row.variable === "showers")).toMatchObject({ value: 0, unit: "mm" });
  });

  it("separates values received, archive rows, and values exposed to the existing projection", () => {
    const coverage = buildHourlyModelCollectionCoverage({
      modelName: "AROME", modelId: "meteofrance_arome_france_hd", isOfficialModel: true,
      status: "partial", requestAttempts: 1, errorCode: null, requestedForecastDays: 2,
      hours: [
        { ...allHourlyValues, validAt: Date.parse("2026-10-03T00:00:00Z") },
        { ...allHourlyValues, showers: null, validAt: Date.parse("2026-10-03T01:00:00Z") },
      ],
      archiveRowsWritten: 40, projectionRowsWritten: 2,
    });
    const rain = coverage.variables.find((variable) => variable.key === "rain")!;
    const showers = coverage.variables.find((variable) => variable.key === "showers")!;

    expect(coverage).toMatchObject({ expectedArchiveRows: 40, archiveRowsWritten: 40, projectionRowsWritten: 2, returnedHours: 2 });
    expect(rain).toMatchObject({ status: "available", requestedCount: 2, receivedCount: 2, archivedCount: 2, exposedCount: 0, consumerProjected: false, unit: "mm" });
    expect(showers).toMatchObject({ status: "partial", receivedCount: 1, missingCount: 1, archivedCount: 2, exposedCount: 0 });
    expect(coverage.variables.find((variable) => variable.key === "temperature"))
      .toMatchObject({ exposedCount: 2, consumerProjected: true });
  });

  it("sépare la grille complète publiée des champs secondaires manquants dans l’archive", () => {
    const expectedValidTimes = Array.from({ length: 24 }, (_, hour) => Date.parse(`2026-10-03T${String(hour).padStart(2, "0")}:00:00Z`));
    const hours = expectedValidTimes.map((validAt) => ({
      ...allHourlyValues,
      rain: null,
      showers: null,
      validAt,
    }));
    const coverage = buildHourlyModelCollectionCoverage({
      modelName: "AROME", modelId: "meteofrance_arome_france_hd", isOfficialModel: true,
      status: "partial", requestAttempts: 1, errorCode: null, requestedForecastDays: 1,
      expectedHoursCount: expectedValidTimes.length, expectedValidTimes, projectionReady: true,
      hours, archiveRowsWritten: expectedValidTimes.length * HOURLY_FORECAST_VARIABLES.length,
      projectionRowsWritten: expectedValidTimes.length,
    });

    expect(coverage).toMatchObject({
      status: "partial", returnedHours: 24, expectedHoursCount: 24, missingHoursCount: 0,
      projectionReady: true, archiveRowsComplete: true, projectionRowsWritten: 24,
    });
    expect(coverage.variables.find((variable) => variable.key === "temperature"))
      .toMatchObject({ status: "available", requestedCount: 24, receivedCount: 24, exposedCount: 24 });
    expect(coverage.variables.find((variable) => variable.key === "rain"))
      .toMatchObject({ status: "missing", requestedCount: 24, receivedCount: 0, archivedCount: 24, exposedCount: 0 });
  });

  it("diagnostique par variable chaque créneau absent, nul, invalide ou reçu à un autre instant", () => {
    const expectedValidTimes = [0, 1, 2, 3].map((hour) => Date.parse(`2026-10-03T${String(hour).padStart(2, "0")}:00:00Z`));
    const coverage = buildHourlyModelCollectionCoverage({
      modelName: "AROME", modelId: "meteofrance_arome_france_hd", isOfficialModel: true,
      status: "partial", requestAttempts: 1, errorCode: null, requestedForecastDays: 1,
      expectedHoursCount: expectedValidTimes.length, expectedValidTimes, projectionReady: false,
      hours: [
        { ...allHourlyValues, temperature: 0, validAt: expectedValidTimes[0] },
        { ...allHourlyValues, temperature: null, validAt: expectedValidTimes[1] },
        { ...allHourlyValues, temperature: Number.NaN, validAt: expectedValidTimes[3] },
      ],
      variableDiagnostics: [{
        key: "temperature",
        slots: [
          { validAt: expectedValidTimes[0], status: "valid", rawType: "number", rawValue: null, rawUnit: "°C" },
          { validAt: expectedValidTimes[1], status: "provider_null", rawType: "null", rawValue: null, rawUnit: "°C" },
          { validAt: expectedValidTimes[2], status: "time_mismatch", rawType: null, rawValue: null, rawUnit: "°C" },
          { validAt: expectedValidTimes[3], status: "invalid_value", rawType: "string", rawValue: "Infinity", rawUnit: "°C" },
        ],
      }],
      archiveRowsWritten: 0, projectionRowsWritten: 0,
    });
    const temperature = coverage.variables.find((variable) => variable.key === "temperature")!;

    expect(coverage).toMatchObject({ schemaVersion: 2, expectedHoursCount: 4, missingHoursCount: 1, projectionReady: false });
    expect(temperature).toMatchObject({ status: "partial", receivedCount: 1, unit: "°C" });
    expect(temperature.sourceStatusCounts).toMatchObject({ valid: 1, provider_null: 1, time_mismatch: 1, invalid_value: 1 });
    expect(temperature.sourceIssues).toEqual([
      { validAt: new Date(expectedValidTimes[1]).toISOString(), status: "provider_null", rawType: "null", rawValue: null, rawUnit: "°C" },
      { validAt: new Date(expectedValidTimes[2]).toISOString(), status: "time_mismatch", rawType: null, rawValue: null, rawUnit: "°C" },
      { validAt: new Date(expectedValidTimes[3]).toISOString(), status: "invalid_value", rawType: "string", rawValue: "Infinity", rawUnit: "°C" },
    ]);
  });

  it("keeps Best Match identifiable as a non-official reference", () => {
    const coverage = buildHourlyModelCollectionCoverage({
      modelName: "best_match", modelId: null, isOfficialModel: false,
      status: "succeeded", requestAttempts: 1, errorCode: null, requestedForecastDays: 2,
      hours: [{ ...allHourlyValues, validAt: Date.parse("2026-10-03T00:00:00Z") }],
      archiveRowsWritten: 20, projectionRowsWritten: 1,
    });
    expect(coverage.isOfficialModel).toBe(false);
    expect(coverage.variables).toHaveLength(20);
  });
});
