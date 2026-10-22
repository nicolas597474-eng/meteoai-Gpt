import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OfficialWeatherSnapshot } from "./officialWeatherSnapshot";
import { buildAILabForecastComparisonReadModel, formatAILabLocationLabel } from "./aiLabForecastComparison";

const validAt = Date.parse("2026-10-02T17:00:00.000Z");

const snapshot = {
  locationKey: "50.756_2.521",
  weatherDate: "2026-10-02",
  validAt: "2026-10-02T19:00",
  computedAt: "2026-10-02T17:02:00.000Z",
  hourlyComputedAt: "2026-10-02T17:01:00.000Z",
  sourceKind: "official_forecast",
  source: "open-meteo",
  hourlyWeighting: {
    modelsConsidered: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"],
    bestMatchIncluded: false,
  },
  currentSnapshot: {
    sourceKind: "model_current_snapshot",
    source: "open-meteo",
    capturedAt: "2026-10-02T17:00:00.000Z",
    temp: 18.25,
  },
  hourly: [
    {
      date: "2026-10-02",
      hour: "19:00",
      validAt: Date.parse("2026-10-02T17:00:00.000Z"),
      temp: 19.5,
      forecastWeighting: { modelsWithData: ["AROME", "ECMWF"] },
    },
  ],
  daily: [
    { date: "2026-10-02", tempMax: 21.4, tempMin: 12.1 },
  ],
  modelsUsed: ["ECMWF", "GFS", "ICON", "Open-Meteo"],
} as unknown as OfficialWeatherSnapshot;

describe("AI Lab forecast comparison read-model", () => {
  it("formate le lieu AI Lab depuis les coordonnées de la requête ou reste neutre", () => {
    expect(formatAILabLocationLabel({ lat: 50.7567, lon: 2.5204 })).toBe("le point demandé (50.7567°N, 2.5204°E)");
    expect(formatAILabLocationLabel({ lat: -33.8651, lon: -151.2099 })).toBe("le point demandé (33.8651°S, 151.2099°O)");
    expect(formatAILabLocationLabel(null)).toBe("le lieu sélectionné");
  });

  it("branche le libellé formaté dans l’analyse AI Lab sans lieu hardcodé", () => {
    const source = readFileSync(new URL("./routers/weather.ts", import.meta.url), "utf8");
    const start = source.indexOf("// 7. AI Analysis text");
    const end = source.indexOf("const officialPrecipitationSummary", start);
    const analysis = source.slice(start, end);

    expect(analysis).toContain("formatAILabLocationLabel(coords)");
    expect(analysis).not.toContain("Hondeghem");
  });

  it("projects the model snapshot, official hourly series and daily forecast as distinct products", () => {
    const result = buildAILabForecastComparisonReadModel(snapshot, { lat: 50.756, lon: 2.521 });

    expect(result).toMatchObject({
      timeZone: "Europe/Paris",
      coordinates: { lat: 50.756, lon: 2.521 },
      currentSnapshotSource: { sourceKind: "model_current_snapshot", source: "open-meteo" },
      currentSnapshot: {
        sourceKind: "model_current_snapshot",
        source: "open-meteo",
        capturedAt: "2026-10-02T17:00:00.000Z",
        temp: 18.25,
      },
      hourlyForecast: {
        sourceKind: "official_forecast",
        source: "open-meteo",
        computedAt: "2026-10-02T17:01:00.000Z",
        modelsConsidered: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"],
        bestMatchIncluded: false,
        points: [{ validAt: Date.parse("2026-10-02T17:00:00.000Z"), temp: 19.5, modelsWithData: ["AROME", "ECMWF"] }],
      },
      dailyForecast: {
        source: "open-meteo",
        computedAt: "2026-10-02T17:02:00.000Z",
        modelsUsed: ["ECMWF", "GFS", "ICON", "Open-Meteo"],
        days: [{ date: "2026-10-02", tempMax: 21.4, tempMin: 12.1 }],
      },
    });
    expect(result.currentSnapshot).not.toEqual(result.hourlyForecast.points[0]);
    expect(result).not.toHaveProperty("stations");
    expect(result).not.toHaveProperty("observation");
  });

  it("expose les poids par modèle et variable sans imposer un bucket horaire commun", () => {
    const detailed = {
      ...snapshot,
      hourly: [{
        ...snapshot.hourly[0],
        forecastWeighting: {
          method: "mixed",
          availabilityStatus: "FUSED",
          calibrationStatus: "PARTIALLY_CALIBRATED",
          expectedModelCount: 7,
          availableModelCount: 2,
          contributingModelCount: 2,
          horizonBucket: null,
          modelsWithData: ["AROME", "ARPEGE"],
          variableWeightings: [{
            variable: "temperature",
            method: "mixed",
            horizonBucket: null,
            availabilityStatus: "FUSED",
            calibrationStatus: "PARTIALLY_CALIBRATED",
            expectedModelCount: 7,
            availableModelCount: 2,
            evidenceEligibleModelCount: 1,
            contributingModelCount: 2,
            coverageLevel: "LIMITED",
            modelReasons: [{ modelName: "UKMET", reason: "Aucun run pour cette échéance.", sourceName: null, modelId: null, runId: null, availableAt: null, validTime: null, horizonMinutes: null, horizonBucket: null }],
            modelWeights: [
              { modelName: "AROME", modelId: "arome_france", sourceName: "open-meteo", runId: "run-a", runIdKind: "capture", requestStartedAt: validAt - 130 * 60_000, availableAt: validAt - 108 * 60_000, validTime: validAt, horizonMinutes: 108, horizonBucket: "0_2h", value: 12, reliability: 0.5, historicalScore: { mae: 1, rmse: 1.5, bias: 0.2, comparisonCount: 35, evaluatedDays: 7 }, calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_BUCKET", calibrationStatus: "CALIBRATED", rawWeight: 1.2, robustFallbackWeight: null, weight: 0.6, contributedToValue: true, historicalEvidence: { status: "qualified", minimumComparisons: 30, minimumComparableDays: 7, latestScoreDate: "2026-09-30", latestComputedAt: "2026-10-01T12:00:00.000Z" } },
              { modelName: "ARPEGE", modelId: "arpege_europe", sourceName: "open-meteo", runId: "run-b", runIdKind: "capture", requestStartedAt: validAt - 150 * 60_000, availableAt: validAt - 122 * 60_000, validTime: validAt, horizonMinutes: 122, horizonBucket: "2_6h", value: 14, reliability: 0.1, historicalScore: null, calibrationLevel: "UNCALIBRATED_ROBUST", calibrationStatus: "UNCALIBRATED_ROBUST", rawWeight: 0.8, robustFallbackWeight: 1, weight: 0.4, contributedToValue: true },
            ],
          }],
        },
        multiModelMetrics: { precipitation: { thresholdMm: 0.1, expectedModelCount: 2, modelsExpected: ["AROME", "ARPEGE"], configuredModelCount: 7, modelsConfigured: ["AROME", "ARPEGE"], availableModelCount: 2, rainModelCount: 1, frequencyPercent: 50, conditionalMeanMm: 0.4, conditionalMeanMethod: "arithmetic_mean", consensusEstimateMm: 0.2, modelsWithData: ["AROME", "ARPEGE"], modelsPredictingRain: ["AROME"], modelValues: [{ modelName: "AROME", amountMm: 0.4, predictsRain: true }, { modelName: "ARPEGE", amountMm: 0, predictsRain: false }], isProbabilityCalibrated: false } },
      }],
    } as unknown as OfficialWeatherSnapshot;

    const firstModelWeight = detailed.hourly[0]!.forecastWeighting.variableWeightings[0]!.modelWeights[0] as unknown as Record<string, unknown>;
    firstModelWeight.exactHorizonEvidence = {
      status: "insufficient_evidence",
      metrics: { mae: 1, rmse: 1.5, bias: 0.2, comparisonCount: 30, evaluatedDays: 6 },
      minimumComparisons: 30,
      minimumComparableDays: 7,
      latestScoreDate: "2026-09-30",
      latestComputedAt: "2026-10-01T12:00:00.000Z",
    };

    const result = buildAILabForecastComparisonReadModel(detailed, { lat: 50.756, lon: 2.521 });
    const point = result.hourlyForecast.points[0]!;
    const temperature = point.weighting?.variableWeightings[0]!;

    expect(temperature.horizonBucket).toBeNull();
    expect(temperature.modelWeights.map((model) => [model.modelName, model.horizonMinutes, model.horizonBucket, model.weight]))
      .toEqual([["AROME", 108, "0_2h", 0.6], ["ARPEGE", 122, "2_6h", 0.4]]);
    expect(temperature.modelWeights[0]?.exactHorizonEvidence).toMatchObject({
      status: "insufficient_evidence",
      metrics: { comparisonCount: 30, evaluatedDays: 6 },
      minimumComparisons: 30,
      minimumComparableDays: 7,
    });
    expect(temperature.modelReasons[0]).toMatchObject({ modelName: "UKMET", reason: "Aucun run pour cette échéance." });
    expect(point.precipitationAgreement).toMatchObject({ frequencyPercent: 50, rainModelCount: 1, isProbabilityCalibrated: false });
  });

  it("retains unavailable values as null instead of fabricating a comparison value", () => {
    const missing = {
      ...snapshot,
      currentSnapshot: null,
      hourly: [{ date: "2026-10-02", hour: "19:00", validAt: undefined, temp: null }],
      daily: [{ date: "2026-10-02", tempMax: null, tempMin: null }],
    } as unknown as OfficialWeatherSnapshot;

    const result = buildAILabForecastComparisonReadModel(missing, { lat: 50.756, lon: 2.521 });

    expect(result.currentSnapshot).toBeNull();
    expect(result.hourlyForecast.points[0]).toMatchObject({ validAt: null, temp: null });
    expect(result.dailyForecast.days[0]).toMatchObject({ tempMax: null, tempMin: null });
  });

  it("exposes the final per-variable values without converting real zero or missing values", () => {
    const detailed = {
      ...snapshot,
      hourly: [{
        ...snapshot.hourly[0],
        apparentTemp: 18.5,
        precipitation: 0,
        windSpeed: 0,
        windGust: null,
        windDirection: 0,
        humidity: 70,
        pressure: 1005,
        cloudCover: 0,
        weatherCode: 0,
      }],
    } as unknown as OfficialWeatherSnapshot;
    const point = buildAILabForecastComparisonReadModel(detailed, { lat: 50.756, lon: 2.521 }).hourlyForecast.points[0]!;

    expect(point.finalValues).toEqual([
      { variable: "temperature", value: 19.5, unit: "°C" },
      { variable: "apparent_temperature", value: 18.5, unit: "°C" },
      { variable: "precipitation", value: 0, unit: "mm" },
      { variable: "wind_speed", value: 0, unit: "km/h" },
      { variable: "wind_direction", value: 0, unit: "°" },
      { variable: "wind_gust", value: null, unit: "km/h" },
      { variable: "humidity", value: 70, unit: "%" },
      { variable: "pressure", value: 1005, unit: "hPa" },
      { variable: "cloud_cover", value: 0, unit: "%" },
      { variable: "weather_code", value: 0, unit: "WMO" },
    ]);
  });
});
