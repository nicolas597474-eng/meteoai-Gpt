import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OFFICIAL_HOURLY_MODELS, type HourlyModelForecast } from "./weatherServices";
import type { HourlyForecastRunValue } from "../drizzle/schema";
import { computeOfficialHourlyForecast, reconstructOfficialHourlyModelsFromArchive, type OfficialHourlyEvaluationHistoryScore } from "./officialHourlyForecast";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";
import { getParisDateDaysAgo } from "./weatherTime";

beforeAll(() => vi.useFakeTimers({ now: new Date("2026-10-05T12:00:00.000Z") }));
afterAll(() => vi.useRealTimers());

const validAt = Date.parse("2026-10-01T12:00:00.000Z");
const availableAt = validAt - 12 * 60 * 60_000;

function modelForecasts(at = validAt, available = at - 12 * 60 * 60_000): HourlyModelForecast[] {
  return OFFICIAL_HOURLY_MODELS.map((model, index) => ({
    modelName: model.name,
    modelId: model.modelId,
    sourceName: "open-meteo",
    availableAt: available,
    providerRunAt: available,
    hours: [{
      validAt: at,
      hour: new Date(at).getUTCHours(),
      temperature: 8 + index,
      apparentTemperature: 7 + index,
      precipitation: index === 6 ? 0.4 : 0,
      rain: index === 6 ? 0 : null,
      showers: index === 6 ? null : null,
      snowfall: index === 6 ? 0.2 : null,
      windSpeed: 8 + index,
      windGusts: 12 + index,
      windDirection: index === 0 ? 350 : 10,
      humidity: 70 + index,
      pressure: 1010 + index,
      cloudCover: 30 + index,
      weatherCode: index < 4 ? 2 : 3,
      uvIndex: 2 + index / 10,
      dewPoint: 4 + index,
      visibility: 10 + index,
      solarRadiation: 100 + index * 10,
      cloudLow: 20 + index,
      cloudMid: 30 + index,
      cloudHigh: 40 + index,
    }],
  }));
}

function historicalScores(
  variable = "temperature",
  horizonBucket = "6_24h",
  maeForModel: (modelIndex: number) => number = (modelIndex) => 0.5 + modelIndex * 0.35,
  sampleSize = 5,
): OfficialHourlyEvaluationHistoryScore[] {
  return OFFICIAL_HOURLY_MODELS.flatMap((model, modelIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const mae = maeForModel(modelIndex);
      return {
        date: `2026-09-${String(20 + dayIndex).padStart(2, "0")}`,
        sourceName: "open-meteo",
        modelName: model.name,
        modelId: model.modelId,
        variable,
        horizonBucket,
        sampleSize,
        mae,
        rmse: mae + 0.2,
        bias: 0,
        scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION,
      };
    }),
  );
}

function bestMatchForecast(): HourlyModelForecast {
  return {
    modelName: "best_match",
    modelId: null,
    sourceName: "open-meteo",
    availableAt,
    hours: [{
      validAt,
      hour: 12,
      temperature: 99,
      apparentTemperature: 99,
      precipitation: 99,
      windSpeed: 99,
      windGusts: 99,
      windDirection: 180,
      humidity: 99,
      pressure: 900,
      cloudCover: 100,
      weatherCode: 65,
    }],
  };
}

function variableWeighting(result: ReturnType<typeof computeOfficialHourlyForecast>, variable: string) {
  return result.hours[0]?.forecastWeighting?.variableWeightings.find((item) => item.variable === variable);
}

describe("reconstructOfficialHourlyModelsFromArchive", () => {
  it("retient les derniers runs exacts des sept modèles, ignore Best Match et garde les epochs répétés", () => {
    const targetDate = "2026-10-25";
    const model = OFFICIAL_HOURLY_MODELS[0]!;
    const firstValidAt = Date.parse("2026-10-25T00:00:00Z");
    const secondValidAt = Date.parse("2026-10-25T01:00:00Z");
    const row = (values: Partial<HourlyForecastRunValue>): HourlyForecastRunValue => ({
      id: 1,
      captureRunId: "latest-run",
      locationKey: "50.7,2.5",
      targetDate,
      sourceName: "open-meteo",
      modelName: model.name,
      modelId: model.modelId,
      requestStartedAt: Date.parse("2026-10-25T07:00:00Z"),
      availableAt: Date.parse("2026-10-25T07:01:00Z"),
      validTime: firstValidAt,
      variable: "temperature",
      value: 8,
      unit: "°C",
      capturedAt: new Date("2026-10-25T07:01:00Z"),
      ...values,
    });
    const archives = [
      row({ id: 1, captureRunId: "older-run", requestStartedAt: 1, availableAt: 2, value: 99 }),
      row({ id: 2, validTime: firstValidAt, value: 8 }),
      row({ id: 3, validTime: secondValidAt, value: 12 }),
      row({ id: 4, captureRunId: "aggregate-run", modelName: "best_match", modelId: null, value: 99 }),
      row({ id: 5, validTime: firstValidAt, variable: "cloud_cover", value: 55, unit: "%" }),
      row({ id: 6, validTime: firstValidAt, variable: "dew_point", value: 3, unit: "°C" }),
      row({ id: 7, validTime: firstValidAt, variable: "visibility", value: 6, unit: "km" }),
      row({ id: 8, validTime: firstValidAt, variable: "weather_code", value: 2, unit: "wmo code" }),
      row({ id: 9, validTime: firstValidAt, variable: "rain", value: 0, unit: "mm" }),
      row({ id: 10, validTime: firstValidAt, variable: "showers", value: 0.3, unit: "mm" }),
      row({ id: 11, validTime: firstValidAt, variable: "snowfall", value: 0.7, unit: "cm" }),
    ];

    const forecasts = reconstructOfficialHourlyModelsFromArchive(archives, targetDate);

    expect(forecasts).toHaveLength(1);
    expect(forecasts[0]?.modelName).toBe(model.name);
    expect(forecasts[0]?.hours.map((hour) => hour.validAt)).toEqual([firstValidAt, secondValidAt]);
    expect(forecasts[0]?.hours.map((hour) => hour.hour)).toEqual([2, 2]);
    expect(forecasts[0]?.hours.map((hour) => hour.temperature)).toEqual([8, 12]);
    expect(forecasts[0]?.hours[0]).toMatchObject({ cloudCover: 55, dewPoint: 3, visibility: 6, weatherCode: 2 });
    expect(forecasts[0]?.hours[0]).toMatchObject({ rain: 0, showers: 0.3, snowfall: 0.7 });
    expect(forecasts[0]?.providerRunAt).toBeNull();
  });
});

describe("computeOfficialHourlyForecast", () => {
  it("décrit le ciel depuis la nébulosité fusionnée à la même échéance sans code météo", () => {
    const forecasts = modelForecasts().map((forecast) => ({
      ...forecast,
      hours: forecast.hours.map((hour) => ({
        ...hour,
        precipitation: 0,
        cloudCover: 65,
        weatherCode: null,
      })),
    }));

    const result = computeOfficialHourlyForecast(forecasts, historicalScores());

    expect(result.hours[0]?.cloudCover).toBeCloseTo(65, 8);
    expect(result.hours[0]).toMatchObject({
      precipitation: 0,
      weatherCode: null,
      condition: "Partiellement nuageux",
    });

    const missingCloudForecasts = forecasts.map((forecast) => ({
      ...forecast,
      hours: forecast.hours.map((hour) => ({ ...hour, cloudCover: null })),
    }));
    const missingCloudResult = computeOfficialHourlyForecast(missingCloudForecasts, historicalScores());
    expect(missingCloudResult.hours[0]).toMatchObject({ cloudCover: null, condition: "Nébulosité indisponible" });
  });

  it("transmet les composantes brutes des seuls contributeurs officiels, sans moyenne ni remplacement des absences", () => {
    const forecasts = modelForecasts();

    const result = computeOfficialHourlyForecast(forecasts, historicalScores());

    expect(result.hours[0]?.precipitationComponents).toEqual([{
      modelName: OFFICIAL_HOURLY_MODELS[6]!.name,
      rain: 0,
      showers: null,
      snowfall: 0.2,
    }]);
  });

  it("utilise providerRunAt plutôt que availableAt pour le lead et la preuve horaire", () => {
    const providerRunAt = validAt - 8 * 60 * 60_000;
    const forecasts = modelForecasts(validAt, validAt - 2 * 60 * 60_000)
      .map((forecast) => ({ ...forecast, providerRunAt }));
    const result = computeOfficialHourlyForecast(forecasts, historicalScores());
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];

    expect(weights).toHaveLength(OFFICIAL_HOURLY_MODELS.length);
    expect(weights.every((item) => item.horizonMinutes === 8 * 60)).toBe(true);
    expect(weights.every((item) => item.horizonBucket === "6_24h")).toBe(true);
    expect(weights[0]?.availableAt).toBe(validAt - 2 * 60 * 60_000);
    expect(variableWeighting(result, "temperature")?.calibrationStatus).toBe("CALIBRATED");
  });

  it("conserve les valeurs avec repli robuste quand aucun providerRunAt n’est attesté, sans estimer de lead", () => {
    const forecasts = modelForecasts().map((forecast) => ({ ...forecast, providerRunAt: null }));
    const result = computeOfficialHourlyForecast(forecasts, historicalScores());
    const weighting = variableWeighting(result, "temperature");
    const weights = weighting?.modelWeights ?? [];

    expect(result.hours[0]?.temp).not.toBeNull();
    expect(weighting).toMatchObject({ method: "robust_fallback", calibrationStatus: "UNCALIBRATED_ROBUST" });
    expect(weights).toHaveLength(OFFICIAL_HOURLY_MODELS.length);
    expect(weights.every((item) => item.horizonMinutes === null && item.horizonBucket === null)).toBe(true);
    expect(weights.every((item) => item.historicalScore === null)).toBe(true);
  });

  it("exclut les scores legacy nuls des poids, conserve les valeurs robustes et accepte la version stricte courante", () => {
    const legacyRows = historicalScores().map((row) => ({ ...row, scoringValidationVersion: null }));
    const legacyResult = computeOfficialHourlyForecast(modelForecasts(), legacyRows);

    expect(legacyResult.hours[0]?.temp).not.toBeNull();
    expect(variableWeighting(legacyResult, "temperature")?.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(variableWeighting(legacyResult, "temperature")?.method).toBe("robust_fallback");
    expect(variableWeighting(legacyResult, "temperature")?.modelWeights[0]?.historicalEvidence).toMatchObject({
      status: "no_evidence",
      metrics: null,
    });

    const currentResult = computeOfficialHourlyForecast(modelForecasts(), historicalScores());
    expect(variableWeighting(currentResult, "temperature")?.calibrationStatus).toBe("CALIBRATED");
    expect(variableWeighting(currentResult, "temperature")?.modelWeights[0]?.historicalEvidence).toMatchObject({
      status: "qualified",
      metrics: { comparisonCount: 35, evaluatedDays: 7 },
    });

    const legacyExactRows = historicalScores().map((row) => ({
      ...row,
      horizonMilliseconds: 12 * 60 * 60_000,
      scoringValidationVersion: null,
    }));
    const currentBucketWithLegacyExact = computeOfficialHourlyForecast(modelForecasts(), historicalScores(), {
      exactHistoryAvailable: true,
      exactHistoryScores: legacyExactRows,
    });
    expect(variableWeighting(currentBucketWithLegacyExact, "temperature")?.modelWeights[0]).toMatchObject({
      calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_BUCKET",
      exactHorizonEvidence: { status: "no_evidence", metrics: null },
    });
  });

  it("pondère l’historique exact, exclut Best Match et conserve les autres variables avec leur repli robuste", () => {
    const validArome = modelForecasts()[0]!;
    const mislabeledArome: HourlyModelForecast = {
      ...validArome,
      modelId: null,
      availableAt: availableAt + 60_000,
      hours: [{ ...validArome.hours[0], temperature: 99 }],
    };
    const result = computeOfficialHourlyForecast(
      [...modelForecasts(), bestMatchForecast(), mislabeledArome],
      historicalScores(),
    );

    expect(result.hours).toHaveLength(1);
    expect(result.hours[0].multiModelMetrics?.temperature.availableModelCount).toBe(7);
    expect(result.hours[0].multiModelMetrics?.source).toBe("official_seven_models");
    expect(result.hours[0].multiModelMetrics?.bestMatchIncluded).toBe(false);
    expect(result.hours[0].multiModelMetrics?.temperature.min).toBe(8);
    expect(result.hours[0].multiModelMetrics?.temperature.max).toBe(14);
    expect(result.hours[0].multiModelMetrics?.temperature.median).toBe(11);
    expect(result.hours[0].multiModelMetrics?.temperature.standardDeviation).toBeCloseTo(2, 10);
    expect(result.hours[0].multiModelMetrics?.temperature.range).toBe(6);
    expect(result.hours[0].multiModelMetrics?.dispersion.windSpeed.standardDeviation).toBeCloseTo(2, 10);
    expect(result.hours[0].multiModelMetrics?.dispersion.windGust.standardDeviation).toBeCloseTo(2, 10);
    expect(result.hours[0].multiModelMetrics?.dispersion.windDirection.standardDeviation).toBeNull();
    expect(result.hours[0].multiModelMetrics?.temperature.weightedMean).toBe(result.hours[0].temp);
    expect(result.hours[0].multiModelMetrics?.modelsExpected).toEqual(OFFICIAL_HOURLY_MODELS.map((model) => model.name));
    expect(result.hours[0].temp).toBeLessThan(11);
    expect(result.hours[0].forecastWeighting?.method).toBe("mixed");
    expect(result.hours[0].forecastWeighting?.horizonBucket).toBe("6_24h");
    expect(result.hours[0].forecastWeighting?.scoredVariables).toEqual(["temperature"]);
    expect(result.hours[0].forecastWeighting?.unavailableVariables).toEqual([]);
    expect(result.hours[0].forecastWeighting?.robustVariables).toContain("wind_speed");
    expect(result.hours[0].forecastWeighting?.variableWeightings).toHaveLength(17);
    expect(result.hours[0].precipitation).toBeCloseTo(0.4 / 7, 10);
    expect(result.hours[0].multiModelMetrics?.precipitation).toMatchObject({
      thresholdMm: 0.1,
      rainModelCount: 1,
      availableModelCount: 7,
      conditionalMeanMm: 0.4,
      isProbabilityCalibrated: false,
    });
    expect(result.hours[0].multiModelMetrics?.precipitation.consensusEstimateMm).toBeCloseTo(0.4 / 7, 10);
    expect(result.hours[0].multiModelMetrics?.precipitation.frequencyPercent).toBeCloseTo(100 / 7, 10);
    expect(result.hours[0].windSpeed).not.toBeNull();
    expect(result.hours[0].apparentTemp).not.toBeNull();
    expect(result.hours[0].cloudCover).not.toBeNull();
    expect(result.hours[0].dewPoint).not.toBeNull();
    expect(result.hours[0].visibility).not.toBeNull();
    expect(result.hours[0].weatherCode).toBe(2);
    expect(variableWeighting(result, "weather_code")?.availableModelCount).toBe(7);
    expect(variableWeighting(result, "weather_code")?.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(variableWeighting(result, "temperature")).toMatchObject({
      availableModelCount: 7,
      contributingModelCount: 1,
      coverageLevel: "SINGLE_MODEL",
      selectionStrategy: "qualified_best_model",
      selectedModelName: "AROME",
      selectionEvidenceBasis: "horizon_bucket",
    });
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];
    expect(weights).toHaveLength(7);
    expect(weights.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 10);
    expect(weights[0]).toMatchObject({ value: 8, calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_BUCKET", historicalScore: { comparisonCount: 35, evaluatedDays: 7 } });
    expect(weights[0]?.reliability).toBeGreaterThan(0);
    expect(weights.find((item) => item.modelName === "AROME")!.weight).toBe(1);
    expect(weights.filter((item) => item.modelName !== "AROME").every((item) => item.weight === 0)).toBe(true);
    expect(weights.filter((item) => item.contributedToValue).map((item) => item.modelName)).toEqual(["AROME"]);
    expect(result.weighting.bestMatchIncluded).toBe(false);
    expect(result.weighting.modelsConsidered).toEqual(OFFICIAL_HOURLY_MODELS.map((model) => model.name));
    expect(result.weighting.horizons.find((row) => row.variable === "temperature")?.coverageLevelCounts).toEqual({
      NONE: 0,
      SINGLE_MODEL: 1,
      LIMITED: 0,
      MODERATE: 0,
      BROAD: 0,
    });
    expect(result.weighting.modelsConsidered).not.toContain("best_match");
    expect(result.weighting.modelsWithData).toHaveLength(7);
    expect(result.weighting.status).toBe("mixed");
  });

  it("privilégie le lead exact qualifié puis retombe sur le bucket local ou le robuste si le seuil exact échoue", () => {
    const exactLead = 12 * 60 * 60_000;
    const exactRows = historicalScores("temperature", "6_24h", (modelIndex) => 1 + modelIndex, 5)
      .map((row) => ({ ...row, horizonMilliseconds: exactLead }));
    const bucketRows = historicalScores("temperature", "6_24h", (modelIndex) => 0.5 + modelIndex * 0.2, 5);
    const exactResult = computeOfficialHourlyForecast(modelForecasts(), bucketRows, {
      exactHistoryAvailable: true,
      exactHistoryScores: exactRows,
    });
    const exactArome = variableWeighting(exactResult, "temperature")?.modelWeights[0];

    expect(exactArome).toMatchObject({
      calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_HORIZON",
      historicalScore: { comparisonCount: 35, evaluatedDays: 7, mae: 1 },
      exactHorizonEvidence: { status: "qualified", metrics: { comparisonCount: 35, evaluatedDays: 7 } },
    });
    expect(variableWeighting(exactResult, "temperature")).toMatchObject({
      selectionStrategy: "qualified_best_model",
      selectedModelName: "AROME",
      selectionEvidenceBasis: "exact_lead",
    });

    const sixDaysOnly = exactRows.filter((row) => row.date !== "2026-09-26");
    const bucketFallback = computeOfficialHourlyForecast(modelForecasts(), bucketRows, {
      exactHistoryAvailable: true,
      exactHistoryScores: sixDaysOnly,
    });
    const bucketArome = variableWeighting(bucketFallback, "temperature")?.modelWeights[0];
    expect(bucketArome).toMatchObject({
      calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_BUCKET",
      historicalScore: { comparisonCount: 35, evaluatedDays: 7, mae: 0.5 },
      exactHorizonEvidence: { status: "insufficient_evidence", metrics: { comparisonCount: 30, evaluatedDays: 6 } },
    });
    expect(variableWeighting(bucketFallback, "temperature")).toMatchObject({
      selectionStrategy: "qualified_best_model",
      selectedModelName: "AROME",
      selectionEvidenceBasis: "horizon_bucket",
    });

    const robustFallback = computeOfficialHourlyForecast(modelForecasts(), [], {
      exactHistoryAvailable: true,
      exactHistoryScores: sixDaysOnly,
    });
    expect(variableWeighting(robustFallback, "temperature")?.modelWeights[0]).toMatchObject({
      calibrationLevel: "UNCALIBRATED_ROBUST",
      calibrationStatus: "UNCALIBRATED_ROBUST",
      historicalScore: null,
      exactHorizonEvidence: { status: "insufficient_evidence", metrics: { comparisonCount: 30, evaluatedDays: 6 } },
    });
    expect(variableWeighting(robustFallback, "temperature")).toMatchObject({
      selectionStrategy: "weighted_ensemble_fallback",
      selectionReason: "insufficient_qualified_history",
    });
  });

  it("utilise la preuve de bucket commune quand les leads exacts des modèles diffèrent", () => {
    const horizons = OFFICIAL_HOURLY_MODELS.map((_, index) => 7 + index);
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      providerRunAt: validAt - horizons[index]! * 60 * 60_000,
      availableAt: validAt - horizons[index]! * 60 * 60_000 + 60_000,
    }));
    const exactRows = historicalScores("temperature").map((row) => {
      const modelIndex = OFFICIAL_HOURLY_MODELS.findIndex((model) => model.name === row.modelName);
      return { ...row, horizonMilliseconds: horizons[modelIndex]! * 60 * 60_000 };
    });
    const result = computeOfficialHourlyForecast(forecasts, historicalScores("temperature"), {
      exactHistoryAvailable: true,
      exactHistoryScores: exactRows,
    });

    expect(variableWeighting(result, "temperature")).toMatchObject({
      selectionStrategy: "qualified_best_model",
      selectedModelName: "AROME",
      selectionEvidenceBasis: "horizon_bucket",
    });
    expect(result.hours[0]?.temp).toBe(8);
    expect(variableWeighting(result, "temperature")?.modelWeights.every((model) => model.horizonBucket === "6_24h")).toBe(true);
  });

  it("retient le gagnant pluie mais garde l’accord et le consensus multimodèles comme diagnostics séparés", () => {
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      hours: [{ ...model.hours[0], precipitation: index === 1 ? 0.1 : index === 6 ? 0.4 : 0 }],
    }));
    const result = computeOfficialHourlyForecast(forecasts, [
      ...historicalScores("temperature"),
      ...historicalScores("precipitation"),
    ]);
    const metrics = result.hours[0].multiModelMetrics!.precipitation;
    expect(metrics).toMatchObject({
      rainModelCount: 2,
      availableModelCount: 7,
      frequencyPercent: (2 / 7) * 100,
      modelsPredictingRain: [OFFICIAL_HOURLY_MODELS[1]!.name, OFFICIAL_HOURLY_MODELS[6]!.name],
    });
    expect(metrics.conditionalMeanMm).toBeGreaterThan(0.1);
    expect(metrics.conditionalMeanMm).toBeLessThan(0.25);
    expect(metrics.consensusEstimateMm).toBeCloseTo((2 / 7) * metrics.conditionalMeanMm!, 10);
    expect(variableWeighting(result, "precipitation")).toMatchObject({
      selectionStrategy: "qualified_best_model",
      selectedModelName: "AROME",
      contributingModelCount: 1,
    });
    expect(result.hours[0]!.precipitation).toBe(0);
    expect(metrics.consensusEstimateMm).toBeGreaterThan(0);
  });

  it("exclut null et non-finis, mais conserve zéro et le seuil de pluie de 0,1 mm", () => {
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      hours: [{
        ...model.hours[0],
        temperature: index === 0 ? 0 : index === 1 ? null : index === 2 ? Number.NaN : 10 + index,
        precipitation: index === 0 ? 0 : index === 1 ? 0.1 : index === 2 ? 0.3 : index === 3 ? null : 0,
      }],
    }));
    const result = computeOfficialHourlyForecast(forecasts, [
      ...historicalScores("temperature"),
      ...historicalScores("precipitation"),
    ]);
    const metrics = result.hours[0].multiModelMetrics!;

    expect(metrics.temperature).toMatchObject({ min: 0, max: 16, median: 14, range: 16, availableModelCount: 5 });
    expect(metrics.temperature.modelsWithData).toEqual([
      OFFICIAL_HOURLY_MODELS[0]!.name,
      OFFICIAL_HOURLY_MODELS[3]!.name,
      OFFICIAL_HOURLY_MODELS[4]!.name,
      OFFICIAL_HOURLY_MODELS[5]!.name,
      OFFICIAL_HOURLY_MODELS[6]!.name,
    ]);
    expect(metrics.precipitation).toMatchObject({
      rainModelCount: 2,
      availableModelCount: 6,
      frequencyPercent: (2 / 6) * 100,
      modelsWithData: OFFICIAL_HOURLY_MODELS.filter((_, index) => index !== 3).map((model) => model.name),
      modelsPredictingRain: [OFFICIAL_HOURLY_MODELS[1]!.name, OFFICIAL_HOURLY_MODELS[2]!.name],
    });
    expect(metrics.precipitation.conditionalMeanMm).not.toBeNull();
  });

  it("conserve la fusion disponible malgré une forte divergence et expose son étendue", () => {
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      hours: [{ ...model.hours[0], temperature: index === 0 ? 0 : index === 1 ? 40 : null }],
    }));
    const result = computeOfficialHourlyForecast(forecasts, []);
    const metrics = result.hours[0]?.multiModelMetrics?.temperature;

    expect(result.hours[0]?.temp).toEqual(expect.any(Number));
    expect(metrics).toMatchObject({ min: 0, max: 40, range: 40, availableModelCount: 2 });
    expect(variableWeighting(result, "temperature")?.availableModelCount).toBe(2);
  });

  it("ne calcule pas de dispersion avec un seul modèle température valide", () => {
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      hours: [{ ...model.hours[0], temperature: index === 0 ? 0 : null }],
    }));
    const result = computeOfficialHourlyForecast(forecasts, historicalScores());

    expect(result.hours[0].multiModelMetrics?.temperature).toMatchObject({
      min: 0,
      max: 0,
      median: 0,
      weightedMean: 0,
      standardDeviation: null,
      range: null,
      availableModelCount: 1,
    });
  });

  it("conserve les valeurs et qualifie la preuve sous le seuil comme partielle", () => {
    const result = computeOfficialHourlyForecast(modelForecasts(), historicalScores("temperature", "6_24h", undefined, 4));
    const temperatureWeighting = variableWeighting(result, "temperature");

    expect(result.weighting.status).toBe("mixed");
    expect(result.hours[0].temp).not.toBeNull();
    expect(temperatureWeighting?.method).toBe("mixed");
    expect(temperatureWeighting?.availabilityStatus).toBe("FUSED");
    expect(temperatureWeighting?.calibrationStatus).toBe("PARTIALLY_CALIBRATED");
    expect(temperatureWeighting?.unavailableReason).toBeNull();
    expect(temperatureWeighting?.modelsWithData).toHaveLength(7);
    expect(temperatureWeighting?.modelWeights).toHaveLength(7);
    expect(temperatureWeighting).toMatchObject({
      selectionStrategy: "weighted_ensemble_fallback",
      selectedModelName: null,
      selectionReason: "insufficient_qualified_history",
    });
    expect(result.hours[0].forecastWeighting?.method).toBe("mixed");
  });

  it("n’exclut pas les autres modèles si un seul modèle manque d’historique qualifié", () => {
    const scores = historicalScores().filter((score) => score.modelName !== "UKMET");
    const result = computeOfficialHourlyForecast(modelForecasts(), scores);

    expect(result.hours[0].temp).not.toBeNull();
    expect(variableWeighting(result, "temperature")?.availabilityStatus).toBe("FUSED");
    expect(variableWeighting(result, "temperature")?.calibrationStatus).toBe("PARTIALLY_CALIBRATED");
    expect(variableWeighting(result, "temperature")?.modelWeights).toHaveLength(7);
    expect(variableWeighting(result, "temperature")?.calibrationReasons.some((reason) => reason.modelName === "UKMET")).toBe(true);
    expect(variableWeighting(result, "temperature")?.modelsWithData).toHaveLength(7);
  });

  it("n’emprunte pas les scores d’un autre bucket et garde un repli robuste exact à cet horizon", () => {
    const nearForecasts = modelForecasts(validAt, validAt - 60 * 60_000);
    const result = computeOfficialHourlyForecast(nearForecasts, historicalScores());

    expect(result.hours[0].forecastWeighting?.horizonBucket).toBe("0_2h");
    expect(result.hours[0].temp).not.toBeNull();
    expect(variableWeighting(result, "temperature")?.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(variableWeighting(result, "temperature")?.modelWeights).toHaveLength(7);
  });

  it("calcule des poids propres à chaque variable et conserve le seuil de régularisation", () => {
    const scores = [
      ...historicalScores("temperature", "6_24h", (index) => 0.5 + index * 0.35),
      ...historicalScores("wind_speed", "6_24h", (index) => 0.5 + (6 - index) * 0.35),
    ];
    const result = computeOfficialHourlyForecast(modelForecasts(), scores);
    const temperatureWeights = variableWeighting(result, "temperature")?.modelWeights ?? [];
    const windWeights = variableWeighting(result, "wind_speed")?.modelWeights ?? [];
    const aromeTemperature = temperatureWeights.find((item) => item.modelName === "AROME")!.weight;
    const ukmetTemperature = temperatureWeights.find((item) => item.modelName === "UKMET")!.weight;
    const aromeWind = windWeights.find((item) => item.modelName === "AROME")!.weight;
    const ukmetWind = windWeights.find((item) => item.modelName === "UKMET")!.weight;

    expect(result.hours[0].temp).not.toBeNull();
    expect(result.hours[0].windSpeed).not.toBeNull();
    expect(variableWeighting(result, "temperature")).toMatchObject({
      selectionStrategy: "qualified_best_model",
      selectedModelName: "AROME",
    });
    expect(variableWeighting(result, "wind_speed")).toMatchObject({
      selectionStrategy: "qualified_best_model",
      selectedModelName: "UKMET",
    });
    expect(aromeTemperature).toBeGreaterThan(ukmetTemperature);
    expect(aromeWind).toBeLessThan(ukmetWind);
    expect(temperatureWeights).not.toEqual(windWeights);
    expect(variableWeighting(result, "wind_speed")?.minimumComparisons).toBe(35);
    expect(variableWeighting(result, "wind_speed")?.minimumComparableDays).toBe(7);
  });

  it("garde le mélange pondéré quand les modèles ont des scores qualifiés ex æquo", () => {
    const result = computeOfficialHourlyForecast(modelForecasts(), historicalScores("temperature", "6_24h", () => 1));
    const weighting = variableWeighting(result, "temperature")!;

    expect(weighting).toMatchObject({
      selectionStrategy: "weighted_ensemble_fallback",
      selectedModelName: null,
      selectionReason: "tied_qualified_scores",
    });
    expect(weighting.contributingModelCount).toBe(OFFICIAL_HOURLY_MODELS.length);
    expect(weighting.modelWeights.reduce((sum, model) => sum + model.weight, 0)).toBeCloseTo(1, 10);
  });

  it("n’utilise pas l’historique d’une autre variable ou échéance et garde le vent en repli robuste", () => {
    const scores = [
      ...historicalScores("temperature", "6_24h"),
      ...historicalScores("wind_speed", "0_2h", (index) => 0.5 + index * 0.35),
    ];
    const result = computeOfficialHourlyForecast(modelForecasts(), scores);

    expect(result.hours[0].temp).not.toBeNull();
    expect(result.hours[0].windSpeed).not.toBeNull();
    expect(variableWeighting(result, "wind_speed")?.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(variableWeighting(result, "wind_speed")?.unavailableReason).toBeNull();
  });

  it("publie une valeur single-model robuste sans la qualifier de fusion multimodèle", () => {
    const result = computeOfficialHourlyForecast(modelForecasts().slice(0, 1), [], {
      historyAvailable: false,
      referenceAt: availableAt,
    });

    expect(result.weighting.status).toBe("single_model");
    expect(result.weighting.availabilityStatus).toBe("SINGLE_MODEL");
    expect(result.weighting.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(result.hours[0].forecastWeighting?.method).toBe("single_model");
    expect(result.hours[0].temp).toBe(8);
    expect(variableWeighting(result, "temperature")).toMatchObject({
      availableModelCount: 1,
      contributingModelCount: 1,
      coverageLevel: "SINGLE_MODEL",
    });
    expect(variableWeighting(result, "temperature")?.modelWeights[0]?.weight).toBe(1);
  });

  it("renormalise uniquement les poids historiques des modèles présents et liste les modèles manquants", () => {
    const forecasts = modelForecasts().filter((model) => model.modelName !== "UKMET");
    const result = computeOfficialHourlyForecast(forecasts, historicalScores());
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];

    expect(result.hours[0].multiModelMetrics?.temperature.availableModelCount).toBe(6);
    expect(weights).toHaveLength(6);
    expect(weights.some((item) => item.modelName === "UKMET")).toBe(false);
    expect(variableWeighting(result, "temperature")?.modelsWithData).not.toContain("UKMET");
    expect(weights.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 10);
  });

  it("pondère les échéances par bucket propre à chaque run au lieu d’exiger un horizon commun", () => {
    const forecasts = modelForecasts().map((model) => model.modelName === "UKMET"
      ? { ...model, availableAt: validAt - 30_000, providerRunAt: validAt - 60 * 60_000 }
      : model);
    const result = computeOfficialHourlyForecast(forecasts, historicalScores());

    expect(result.hours[0].forecastWeighting?.horizonBucket).toBeNull();
    expect(result.hours[0].temp).not.toBeNull();
    expect(variableWeighting(result, "temperature")?.availabilityStatus).toBe("FUSED");
    expect(variableWeighting(result, "temperature")?.modelWeights).toHaveLength(7);
    expect(variableWeighting(result, "temperature")?.calibrationReasons.some((reason) => reason.modelName === "UKMET")).toBe(true);
  });

  it("fusionne sept horizons individuels valides et conserve le bucket exact de chacun", () => {
    const horizons = [30, 119.6, 120, 359.6, 360, 1439.6, 1440];
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      availableAt: validAt - 30_000,
      providerRunAt: validAt - horizons[index]! * 60_000,
    }));
    const result = computeOfficialHourlyForecast(forecasts, historicalScores());
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];

    expect(result.hours).toHaveLength(1);
    expect(result.hours[0]?.temp).not.toBeNull();
    expect(result.hours[0]?.forecastWeighting?.horizonBucket).toBeNull();
    expect(weights.map((model) => model.horizonMinutes)).toEqual(horizons);
    expect(weights.map((model) => model.horizonBucket)).toEqual([
      "0_2h", "0_2h", "2_6h", "2_6h", "6_24h", "6_24h", "1_3d",
    ]);
    expect(weights.every((model) => model.validTime === validAt)).toBe(true);
    expect(weights.reduce((sum, model) => sum + model.weight, 0)).toBeCloseTo(1, 10);
    expect(variableWeighting(result, "temperature")?.availabilityStatus).toBe("FUSED");
  });

  it("récupère pour chaque modèle la preuve de son propre bucket dans une même échéance", () => {
    const horizons = [30, 119.6, 120, 359.6, 360, 1439.6, 1440];
    const buckets = ["0_2h", "0_2h", "2_6h", "2_6h", "6_24h", "6_24h", "1_3d"];
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      availableAt: validAt - 30_000,
      providerRunAt: validAt - horizons[index]! * 60_000,
    }));
    const scores = OFFICIAL_HOURLY_MODELS.flatMap((model, modelIndex) => Array.from({ length: 7 }, (_, dayIndex) => {
      const mae = 0.25 + modelIndex;
      return {
        date: `2026-09-${String(20 + dayIndex).padStart(2, "0")}`,
        sourceName: "open-meteo",
        modelName: model.name,
        modelId: model.modelId,
        variable: "temperature",
        horizonBucket: buckets[modelIndex]!,
        sampleSize: 5,
        mae,
        rmse: mae + 0.2,
        bias: 0,
        scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION,
      };
    }));
    const result = computeOfficialHourlyForecast(forecasts, scores);
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];

    expect(weights.map((item) => item.horizonBucket)).toEqual(buckets);
    expect(weights.map((item) => item.historicalScore?.mae)).toEqual(OFFICIAL_HOURLY_MODELS.map((_, index) => 0.25 + index));
    expect(weights.every((item) => item.calibrationStatus === "CALIBRATED")).toBe(true);
    expect(weights.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 10);
    expect(variableWeighting(result, "temperature")).toMatchObject({
      selectionStrategy: "weighted_ensemble_fallback",
      selectionReason: "incomparable_horizons",
    });
  });

  it("traite indépendamment les valeurs nuage/visibilité/rosée et moyenne la direction du vent circulairement", () => {
    const forecasts = modelForecasts().map((model, index) => index === 0
      ? { ...model, hours: [{ ...model.hours[0]!, windSpeed: null }] }
      : index === 1
        ? { ...model, hours: [{ ...model.hours[0]!, cloudCover: null }] }
        : model);
    const result = computeOfficialHourlyForecast(forecasts, []);
    const windSpeed = variableWeighting(result, "wind_speed")!;
    const cloudCover = variableWeighting(result, "cloud_cover")!;

    expect(windSpeed.availableModelCount).toBe(6);
    expect(cloudCover.availableModelCount).toBe(6);
    expect(variableWeighting(result, "visibility")?.availableModelCount).toBe(7);
    expect(variableWeighting(result, "dew_point")?.availableModelCount).toBe(7);
    expect(result.hours[0]?.windSpeed).not.toBeNull();
    expect(result.hours[0]?.cloudCover).not.toBeNull();
    expect(result.hours[0]?.visibility).not.toBeNull();
    expect(result.hours[0]?.dewPoint).not.toBeNull();
    expect(result.hours[0]?.windDirection).toBeLessThan(20);
    expect(result.hours[0]?.windDirection).toBeGreaterThanOrEqual(0);
    expect(cloudCover.modelWeights.some((item) => item.modelName === OFFICIAL_HOURLY_MODELS[1]!.name)).toBe(false);
    expect(variableWeighting(result, "cloud_cover")?.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(variableWeighting(result, "cloud_cover")?.selectionReason).toBe("variable_without_station_validation");
    expect(variableWeighting(result, "wind_direction")?.selectionReason).toBe("variable_without_station_validation");
    expect(variableWeighting(result, "uv_index")?.selectionReason).toBe("variable_without_station_validation");
  });

  it("garde un modèle disponible mais historiquement mauvais avec un poids inférieur", () => {
    const scores = historicalScores("temperature", "6_24h", (index) => index === 0 ? 50 : 0.1);
    const result = computeOfficialHourlyForecast(modelForecasts(), scores);
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];
    const poorModel = weights.find((item) => item.modelName === OFFICIAL_HOURLY_MODELS[0]!.name)!;
    const strongModels = weights.filter((item) => item.modelName !== OFFICIAL_HOURLY_MODELS[0]!.name);

    expect(poorModel.contributedToValue).toBe(true);
    expect(poorModel.weight).toBeLessThan(Math.min(...strongModels.map((item) => item.weight)));
  });

  it("maintient une série horaire continue quand le nombre de modèles change à une échéance", () => {
    const nextValidAt = validAt + 60 * 60_000;
    const forecasts = modelForecasts().map((model, index) => ({
      ...model,
      hours: index < 5
        ? [...model.hours, { ...model.hours[0]!, validAt: nextValidAt, hour: "13:00", temperature: model.hours[0]!.temperature! + 1 }]
        : model.hours,
    }));
    const result = computeOfficialHourlyForecast(forecasts, []);

    expect(result.hours.map((point) => point.validAt)).toEqual([validAt, nextValidAt]);
    expect(result.hours.every((point) => point.temp != null)).toBe(true);
    expect(variableWeighting(result, "temperature")?.availableModelCount).toBe(7);
    expect(result.hours[1]?.forecastWeighting?.variableWeightings.find((item) => item.variable === "temperature"))
      .toMatchObject({ availableModelCount: 5, contributingModelCount: 5, calibrationStatus: "UNCALIBRATED_ROBUST" });
  });

  it("utilise un modèle pour la température mais l’exclut seulement du vent manquant", () => {
    const forecasts = modelForecasts().map((model, index) => index === 0
      ? { ...model, hours: [{ ...model.hours[0]!, windSpeed: null }] }
      : model);
    const result = computeOfficialHourlyForecast(forecasts, []);
    const temperature = variableWeighting(result, "temperature")!;
    const wind = variableWeighting(result, "wind_speed")!;

    expect(temperature.availableModelCount).toBe(7);
    expect(wind.availableModelCount).toBe(6);
    expect(result.hours[0]?.windSpeed).not.toBeNull();
    expect(wind.modelReasons.find((item) => item.modelName === OFFICIAL_HOURLY_MODELS[0]!.name)?.reason)
      .toContain("Aucune valeur finie");
  });

  it("fusionne sans NULL artificiel avec deux modèles et conserve le statut UNCALIBRATED_ROBUST", () => {
    const result = computeOfficialHourlyForecast(modelForecasts().slice(0, 2), [], { historyAvailable: false });
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];

    expect(result.hours[0]?.temp).not.toBeNull();
    expect(variableWeighting(result, "temperature")).toMatchObject({
      availabilityStatus: "FUSED",
      calibrationStatus: "UNCALIBRATED_ROBUST",
      availableModelCount: 2,
      contributingModelCount: 2,
    });
    expect(weights).toHaveLength(2);
    expect(weights.reduce((sum, model) => sum + model.weight, 0)).toBeCloseTo(1, 10);
  });

  it("exclut un modèle historiquement excellent s’il n’a pas de run à cette échéance", () => {
    const scores = historicalScores("temperature", "6_24h", (index) => index === 6 ? 0.05 : 5);
    const forecasts = modelForecasts().filter((model) => model.modelName !== OFFICIAL_HOURLY_MODELS[6]!.name);
    const result = computeOfficialHourlyForecast(forecasts, scores);
    const weights = variableWeighting(result, "temperature")?.modelWeights ?? [];

    expect(result.hours[0]?.temp).not.toBeNull();
    expect(weights.map((model) => model.modelName)).not.toContain(OFFICIAL_HOURLY_MODELS[6]!.name);
    expect(variableWeighting(result, "temperature")?.modelReasons.map((model) => model.modelName)).toContain(OFFICIAL_HOURLY_MODELS[6]!.name);
    expect(weights.reduce((sum, model) => sum + model.weight, 0)).toBeCloseTo(1, 10);
  });

  it("ne compte pas comme absence de contributeurs les heures écoulées sans prévision admissible", () => {
    const referenceAt = validAt + 30 * 60_000;
    const elapsedTimes = [validAt - 60 * 60_000, validAt, validAt + 60 * 60_000];
    const forecasts = modelForecasts(elapsedTimes[2], referenceAt).map((model) => ({
      ...model,
      hours: elapsedTimes.map((time) => ({
        ...model.hours[0]!,
        validAt: time,
        hour: new Date(time).getUTCHours(),
      })),
    }));
    const result = computeOfficialHourlyForecast(forecasts, [], { referenceAt });

    expect(result.hours).toHaveLength(3);
    expect(result.hours[0]?.temp).toBeNull();
    expect(result.hours[1]?.temp).toBeNull();
    expect(result.hours[2]?.temp).not.toBeNull();
    expect(result.weighting.horizons).toHaveLength(17);
    expect(result.weighting.horizons.every((row) => row.hourCount === 1)).toBe(true);
    expect(result.weighting.horizons.every((row) => row.availabilityStatus !== "UNAVAILABLE")).toBe(true);
    expect(result.weighting.horizons.find((row) => row.variable === "temperature")?.coverageLevelCounts.BROAD).toBe(1);
  });

  it("garde une échéance existante avec UNAVAILABLE quand aucun modèle n’a de valeur", () => {
    const forecasts = modelForecasts().map((model) => ({
      ...model,
      hours: [Object.fromEntries(Object.keys(model.hours[0]!).map((key) => [key, key === "validAt" ? validAt : key === "hour" ? "12:00" : null])) as unknown as HourlyModelForecast["hours"][number]],
    }));
    const result = computeOfficialHourlyForecast(forecasts, []);

    expect(result.hours).toHaveLength(1);
    expect(result.hours[0]?.temp).toBeNull();
    expect(result.hours[0]?.forecastWeighting?.availabilityStatus).toBe("UNAVAILABLE");
    expect(variableWeighting(result, "temperature")).toMatchObject({ availableModelCount: 0, contributingModelCount: 0, calibrationStatus: "UNAVAILABLE" });
  });

  it("écarte les évaluations contemporaines ou futures pour éviter les fuites d’information", () => {
    const scores = historicalScores();
    scores.push(...OFFICIAL_HOURLY_MODELS.map((model) => ({
      date: "2026-10-01",
      sourceName: "open-meteo",
      modelName: model.name,
      modelId: model.modelId,
      variable: "temperature",
      horizonBucket: "6_24h",
      sampleSize: 1_000,
      mae: model.name === "UKMET" ? 0 : 100,
    })));
    const result = computeOfficialHourlyForecast(modelForecasts(), scores);

    expect(variableWeighting(result, "temperature")?.modelWeights.find((item) => item.modelName === "AROME")!.weight)
      .toBeGreaterThan(variableWeighting(result, "temperature")?.modelWeights.find((item) => item.modelName === "UKMET")!.weight ?? 0);
  });

  it("écarte des poids les preuves bucket et exact au-delà de la fenêtre officielle de 365 jours", () => {
    const expiredScores = historicalScores().map((row, index) => ({
      ...row,
      date: getParisDateDaysAgo(366 + (index % 7)),
    }));
    const expiredExactScores = expiredScores.map((row) => ({
      ...row,
      horizonMilliseconds: 12 * 60 * 60_000,
    }));
    const result = computeOfficialHourlyForecast(modelForecasts(), expiredScores, {
      exactHistoryAvailable: true,
      exactHistoryScores: expiredExactScores,
    });
    const weighting = variableWeighting(result, "temperature")!;
    const noHistory = computeOfficialHourlyForecast(modelForecasts(), []);
    const weights = weighting.modelWeights.map(({ modelName, weight }) => ({ modelName, weight }));
    const noHistoryWeights = variableWeighting(noHistory, "temperature")!.modelWeights
      .map(({ modelName, weight }) => ({ modelName, weight }));

    expect(weighting.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(weighting.evidenceEligibleModelCount).toBe(0);
    expect(weighting.modelWeights[0]).toMatchObject({
      historicalEvidence: { status: "no_evidence" },
      exactHorizonEvidence: { status: "no_evidence" },
    });
    expect(weighting.calibrationReasons[0]?.reason).toContain("365 jours");
    expect(weights).toEqual(noHistoryWeights);
    expect(result.hours[0]?.temp).not.toBeNull();
  });

  it("signale l’indisponibilité de l’historique et conserve les deux instants de l’heure répétée", () => {
    const firstRepeatedHour = Date.parse("2026-10-25T00:00:00.000Z");
    const secondRepeatedHour = Date.parse("2026-10-25T01:00:00.000Z");
    const repeatedForecasts = OFFICIAL_HOURLY_MODELS.map((model) => ({
      modelName: model.name,
      modelId: model.modelId,
      sourceName: "open-meteo",
      availableAt: firstRepeatedHour - 30 * 60_000,
      hours: [firstRepeatedHour, secondRepeatedHour].map((time) => ({
        validAt: time,
        hour: 2,
        temperature: 10,
        apparentTemperature: 10,
        precipitation: 0,
        windSpeed: 5,
        windGusts: 8,
        windDirection: 180,
        humidity: 80,
        pressure: 1012,
        cloudCover: 50,
        weatherCode: 2,
        uvIndex: 1,
        dewPoint: 7,
        visibility: 12,
        solarRadiation: 50,
        cloudLow: 25,
        cloudMid: 30,
        cloudHigh: 35,
      })),
    }));
    const result = computeOfficialHourlyForecast(repeatedForecasts, [], {
      historyAvailable: false,
      referenceAt: firstRepeatedHour - 30 * 60_000,
    });

    expect(result.weighting.status).toBe("robust_fallback");
    expect(result.weighting.availabilityStatus).toBe("FUSED");
    expect(result.weighting.calibrationStatus).toBe("UNCALIBRATED_ROBUST");
    expect(result.hours).toHaveLength(2);
    expect(result.hours.map((hour) => hour.hour)).toEqual(["02:00", "02:00"]);
    expect(result.hours.map((hour) => hour.validAt)).toEqual([firstRepeatedHour, secondRepeatedHour]);
    expect(result.hours.every((hour) => hour.temp != null)).toBe(true);
    expect(result.hours.every((hour) => hour.forecastWeighting?.variableWeightings.every((item) =>
      item.availabilityStatus === "FUSED" && item.calibrationStatus === "UNCALIBRATED_ROBUST" && item.unavailableReason == null,
    ))).toBe(true);
  });
});
