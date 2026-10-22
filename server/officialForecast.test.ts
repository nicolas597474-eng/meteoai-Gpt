import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeOfficialDailyForecast, computeOfficialDailyForecastWithDiagnostics } from "./officialForecast";
import { OFFICIAL_HOURLY_MODELS, WEATHER_SERVICES } from "./weatherServices";
import { DAILY_FUSION_METRICS, type DailyFusionHorizon, type DailyFusionMetric, type ModelPerformanceEvidence } from "./fusionPerformance";

const targetDate = "2026-10-02";
const issuedAt = Date.parse("2026-10-02T08:00:00.000Z");
const validTime = Date.parse("2026-10-02T22:00:00.000Z");
const locationKey = "50.7567_2.5204";
const horizonBucket: DailyFusionHorizon = "6-24h";
const serviceNames = ["AROME", "ARPEGE", "ICON", "ECMWF"];
const serviceModelId = (serviceName: string) => WEATHER_SERVICES.expert.find((service) => service.name === serviceName)!.modelId;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(issuedAt);
});

afterAll(() => vi.useRealTimers());

const forecasts = serviceNames.map((serviceName, index) => ({
  serviceName,
  serviceCategory: "expert" as const,
  modelId: serviceModelId(serviceName),
  sourceName: "open-meteo",
  runId: `${serviceName}-capture-1`,
  runIdKind: "capture" as const,
  requestStartedAt: issuedAt - 30_000,
  availableAt: issuedAt,
  validTime,
  tempMax: 21 + index,
  tempMin: 11 + index,
  precipitation: 0.5 + index,
  windSpeed: 10 + index * 2,
  windGust: 18 + index * 3,
  humidity: 55 + index * 5,
  cloudCover: 30 + index * 10,
}));

function evidenceFor(
  serviceName: string,
  variable: DailyFusionMetric,
  options: Partial<Pick<ModelPerformanceEvidence, "locationKey" | "horizonBucket" | "sampleSize" | "evaluatedDays" | "comparisonCount" | "mae" | "standardError">> = {},
): ModelPerformanceEvidence {
  const sampleSize = options.sampleSize ?? 120;
  return {
    locationKey: options.locationKey ?? locationKey,
    serviceName,
    modelId: serviceModelId(serviceName),
    variable,
    horizonBucket: options.horizonBucket ?? horizonBucket,
    comparisonCount: options.comparisonCount ?? sampleSize,
    sampleSize,
    evaluatedDays: options.evaluatedDays ?? sampleSize,
    mae: options.mae ?? 0.5 + serviceNames.indexOf(serviceName) * 0.2,
    rmse: (options.mae ?? 0.5 + serviceNames.indexOf(serviceName) * 0.2) + 0.2,
    standardError: options.standardError ?? 0.05,
    latestScoreDate: "2026-10-01",
  };
}

function qualifiedEvidence(): ModelPerformanceEvidence[] {
  return serviceNames.flatMap((serviceName) => DAILY_FUSION_METRICS.map((variable) => evidenceFor(serviceName, variable)));
}

function options(evidence = qualifiedEvidence(), evidenceStoreAvailable = true) {
  return { locationKey, targetDate, issuedAt, evidenceStoreAvailable, evidence };
}

const allOfficialServiceNames = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
const sevenModelForecasts = OFFICIAL_HOURLY_MODELS.map((model, index) => ({
  serviceName: model.name,
  serviceCategory: "expert" as const,
  modelId: model.modelId,
  sourceName: "open-meteo",
  runId: `${model.name}-capture-1`,
  runIdKind: "capture" as const,
  requestStartedAt: issuedAt - 30_000,
  availableAt: issuedAt,
  validTime,
  tempMax: 22 + index,
  tempMin: 12 + index,
  precipitation: 0.5 + index,
  windSpeed: 9 + index,
  windGust: 15 + index,
  humidity: 40 + index,
  cloudCover: 20 + index,
}));
const bestMatchForecast = {
  serviceName: "Open-Meteo",
  serviceCategory: "expert" as const,
  modelId: "best_match",
  sourceName: "open-meteo",
  runId: "best-match-capture-1",
  runIdKind: "capture" as const,
  requestStartedAt: issuedAt - 30_000,
  availableAt: issuedAt,
  validTime,
  tempMax: 99,
  tempMin: -50,
  precipitation: 1000,
  windSpeed: 400,
  windGust: 700,
  humidity: 100,
  cloudCover: 100,
};

function sevenModelEvidence(): ModelPerformanceEvidence[] {
  return allOfficialServiceNames.flatMap((serviceName, index) => DAILY_FUSION_METRICS.map((variable) => evidenceFor(
    serviceName,
    variable,
    { sampleSize: 120, comparisonCount: 500, evaluatedDays: 120, mae: 0.4 + index * 0.1, standardError: 0.05 },
  )));
}

function bestMatchEvidence(): ModelPerformanceEvidence[] {
  return DAILY_FUSION_METRICS.map((variable) => evidenceFor(
    "Open-Meteo",
    variable,
    { sampleSize: 120, comparisonCount: 500, evaluatedDays: 120, mae: 0.001, standardError: 0 },
  ));
}

describe("computeOfficialDailyForecast", () => {
  it("fuse uniquement les preuves de production exactes et respecte le plafond individuel", () => {
    const first = computeOfficialDailyForecast(forecasts, options());
    const second = computeOfficialDailyForecast(forecasts, options());

    expect(first).toEqual(second);
    const live = computeOfficialDailyForecastWithDiagnostics(forecasts, options());
    expect(first).not.toHaveProperty("parameterDiagnostics");
    expect(first.trace).not.toHaveProperty("parameterDiagnostics");
    expect(live.trace).toEqual(first.trace);
    expect(live.weights).toEqual(first.weights);
    expect(live.tempMax).toBe(first.tempMax);
    expect(live.tempMin).toBe(first.tempMin);
    expect(live.precipitation).toBe(first.precipitation);
    expect(live.windSpeed).toBe(first.windSpeed);
    expect(live.windGust).toBe(first.windGust);
    expect(live.parameterDiagnostics.temperature_max.status).toBe("FUSED");
    expect(first.coreCalibrationComplete).toBe(true);
    expect(first.tempMax).not.toBeNull();
    expect(first.tempMin).not.toBeNull();
    expect(first.precipitation).not.toBeNull();
    expect(first.windSpeed).not.toBeNull();
    expect(first.confidenceScore).not.toBeNull();
    expect(first.trace.version).toBe(4);
    expect(first.trace.horizonBucket).toBe("6-24h");
    expect(first.trace.availabilityStatus.temperature_max).toBe("FUSED");
    expect(first.trace.calibrationStatus.tempMax).toBe("CALIBRATED");
    expect(first.trace.calibrationStatus.precipitation).toBe("CALIBRATED");
    expect(first.trace.precipitationConsensus).toMatchObject({
      thresholdMm: 0.1,
      expectedModelCount: 4,
      availableModelCount: 4,
      rainModelCount: 4,
      frequencyPercent: 100,
      conditionalMeanMethod: "historical_skill",
      consensusEstimateMm: first.precipitation,
      modelsWithData: serviceNames,
      modelsPredictingRain: serviceNames,
      isProbabilityCalibrated: false,
    });
    expect(first.precipitation).toBeCloseTo(
      (first.trace.precipitationConsensus.rainModelCount / first.trace.precipitationConsensus.availableModelCount)
        * first.trace.precipitationConsensus.conditionalMeanMm!,
      10,
    );
    expect(first.trace.availabilityStatus.humidity).toBe("FUSED");
    expect(first.trace.calibrationStatus.humidity).toBe("UNCALIBRATED_ROBUST");
    expect(first.humidity).not.toBeNull();
    expect(first.cloudCover).not.toBeNull();

    for (const metricSources of [
      first.trace.parameterSources.tempMax,
      first.trace.parameterSources.precipitation,
      first.trace.parameterSources.windSpeed,
    ]) {
      expect(metricSources.reduce((sum, source) => sum + source.finalWeight, 0)).toBeCloseTo(1, 8);
      expect(metricSources.every((source) => source.finalWeight <= 0.35)).toBe(true);
      expect(metricSources.every((source) => source.sampleSize === 120 && source.horizonBucket === "6-24h")).toBe(true);
    }
    expect(first.trace.parameterSources.tempMax.every((source) => source.variable === "temperature_max")).toBe(true);
    expect(Object.values(first.weights).every((weight) => weight.tempWeight <= 0.35 && weight.precipWeight <= 0.35 && weight.windWeight <= 0.35)).toBe(true);
    expect(first.trace.parameterSources.tempMin.every((source) => source.variable === "temperature_min")).toBe(true);
    expect(first.trace.parameterSources.windGust.every((source) => source.variable === "wind_gust_max")).toBe(true);
  });

  it("expose le biais sign\u00e9 comme diagnostic sans corriger les valeurs ou les poids", () => {
    const withoutBias = computeOfficialDailyForecast(forecasts, options(qualifiedEvidence()));
    const withBias = computeOfficialDailyForecast(
      forecasts,
      options(qualifiedEvidence().map((item) => ({ ...item, signedBias: 999 }))),
    );

    for (const metric of ["tempMax", "tempMin", "precipitation", "windSpeed", "windGust"] as const) {
      expect(withBias[metric]).toBe(withoutBias[metric]);
    }
    expect(withBias.weights).toEqual(withoutBias.weights);
    expect(withBias.trace.parameterSources.tempMax.every((source) => source.signedBias === 999)).toBe(true);
    expect(withBias.trace.parameterSources.tempMax.every((source) => source.latestScoreDate === "2026-10-01")).toBe(true);
  });

  it("garde valeurs, poids, trace et compte officiel invariants face \u00e0 Best Match pour Tmin/Tmax, pluie, vent et rafales", () => {
    const evidence = sevenModelEvidence();
    const withoutBestMatch = computeOfficialDailyForecastWithDiagnostics(sevenModelForecasts, options(evidence));
    const withBestMatch = computeOfficialDailyForecastWithDiagnostics(
      [...sevenModelForecasts, bestMatchForecast],
      options([...evidence, ...bestMatchEvidence()]),
    );

    expect(withoutBestMatch.coreCalibrationComplete).toBe(true);
    expect(withBestMatch).toEqual(withoutBestMatch);
    for (const metric of ["tempMax", "tempMin", "precipitation", "windSpeed", "windGust"] as const) {
      expect(withBestMatch[metric]).toBe(withoutBestMatch[metric]);
    }
    expect(withBestMatch.weights).toEqual(withoutBestMatch.weights);
    expect(withBestMatch.parameterDiagnostics).toEqual(withoutBestMatch.parameterDiagnostics);
    expect(withBestMatch.parameterDiagnostics.temperature_max).toMatchObject({
      expectedModelCount: 7,
      availableValueModelCount: 7,
      evidenceEligibleModelCount: 7,
      contributingModelCount: 7,
    });
    expect(Object.keys(withBestMatch.weights)).toEqual(allOfficialServiceNames);
    expect(withBestMatch.weights).not.toHaveProperty("Open-Meteo");
    expect(withBestMatch.trace.sourceCount).toBe(7);
    expect(withBestMatch.trace.parameterSources.tempMax.every((source) => source.name !== "Open-Meteo")).toBe(true);
    expect(withBestMatch.trace.parameterSources.precipitation.every((source) => source.name !== "Open-Meteo")).toBe(true);
    expect(withBestMatch.trace.parameterSources.windSpeed.every((source) => source.name !== "Open-Meteo")).toBe(true);
    expect(withBestMatch.trace.precipitationConsensus.modelsWithData).toEqual(allOfficialServiceNames);
  });

  it("garde les mod\u00e8les disponibles en repli robuste quand la seule preuve qualifi\u00e9e est celle de Best Match", () => {
    const result = computeOfficialDailyForecast(
      [...sevenModelForecasts, bestMatchForecast],
      options(bestMatchEvidence()),
    );

    expect(result.coreCalibrationComplete).toBe(false);
    expect(result.tempMax).not.toBeNull();
    expect(result.tempMin).not.toBeNull();
    expect(result.precipitation).not.toBeNull();
    expect(result.windSpeed).not.toBeNull();
    expect(result.windGust).not.toBeNull();
    expect(result.trace.sourceCount).toBe(7);
    expect(result.trace.calibrationStatus.tempMax).toBe("UNCALIBRATED_ROBUST");
    expect(result.trace.parameterSources.tempMax).toHaveLength(7);
    expect(result.trace.parameterSources.precipitation).toHaveLength(7);
    expect(result.trace.parameterSources.windSpeed).toHaveLength(7);
    expect(result.trace.precipitationConsensus).toMatchObject({
      expectedModelCount: 7,
      availableModelCount: 7,
      conditionalMeanMethod: "robust_fallback",
      modelsWithData: allOfficialServiceNames,
    });
    expect(Object.keys(result.weights)).toEqual(allOfficialServiceNames);
    expect(Object.values(result.weights).some((weight) => weight.tempWeight > 0 && weight.precipWeight > 0 && weight.windWeight > 0)).toBe(true);
  });

  it("publie une fusion robuste lorsque l\u2019historique est absent, sans la pr\u00e9senter comme calibr\u00e9e", () => {
    const result = computeOfficialDailyForecast(forecasts, options([]));

    expect(result.coreCalibrationComplete).toBe(false);
    expect(result.tempMax).not.toBeNull();
    expect(result.tempMin).not.toBeNull();
    expect(result.precipitation).not.toBeNull();
    expect(result.windSpeed).not.toBeNull();
    expect(result.confidenceScore).toBeNull();
    expect(result.trace.availabilityStatus.temperature_max).toBe("FUSED");
    expect(result.trace.calibrationStatus.tempMax).toBe("UNCALIBRATED_ROBUST");
    expect(result.trace.parameterSources.tempMax).toHaveLength(4);
    expect(result.trace.precipitationConsensus).toMatchObject({
      availableModelCount: 4,
      rainModelCount: 4,
      frequencyPercent: 100,
      conditionalMeanMm: 2,
      conditionalMeanMethod: "robust_fallback",
      consensusEstimateMm: 2,
      isProbabilityCalibrated: false,
    });
    expect(Object.values(result.weights).some((weight) => weight.tempWeight > 0 && weight.precipWeight > 0 && weight.windWeight > 0)).toBe(true);
  });

  it("exclut les mod\u00e8les sous 0,1 mm de la quantit\u00e9 conditionnelle et du poids officiel de pluie", () => {
    const mixedRainForecasts = forecasts.map((forecast, index) => ({
      ...forecast,
      precipitation: [0, 0.1, 0.4, 1][index]!,
    }));
    const result = computeOfficialDailyForecast(mixedRainForecasts, options());
    const summary = result.trace.precipitationConsensus;

    expect(summary).toMatchObject({
      thresholdMm: 0.1,
      expectedModelCount: 4,
      availableModelCount: 4,
      rainModelCount: 3,
      frequencyPercent: 75,
      conditionalMeanMethod: "historical_skill",
      isProbabilityCalibrated: false,
    });
    expect(summary.modelsPredictingRain).toEqual(["ARPEGE", "ICON", "ECMWF"]);
    expect(result.weights.AROME!.precipWeight).toBe(0);
    expect(result.weights.ARPEGE!.precipWeight).toBeGreaterThan(0);
    expect(result.precipitation).toBeCloseTo((3 / 4) * summary.conditionalMeanMm!, 10);
    expect(result.precipitation).toBeCloseTo(summary.consensusEstimateMm!, 10);
  });

  it("signale un historique indisponible tout en conservant les valeurs avec un repli robuste", () => {
    const result = computeOfficialDailyForecast(forecasts, options([], false));
    expect(result.tempMax).not.toBeNull();
    expect(result.confidenceScore).toBeNull();
    expect(result.trace.calibrationStatus.tempMax).toBe("UNCALIBRATED_ROBUST");
    expect(result.methodNote).toContain("non calibr\u00e9e");
    expect(result.methodNote).toContain("preuves calibrées exactes pour 0/5 variables calibrables");
  });

  it("refuse une pr\u00e9vision dont l\u2019horodatage d\u00e9passe la fra\u00eecheur maximale", () => {
    const staleForecasts = forecasts.map((f) => ({ ...f, availableAt: issuedAt - 16 * 24 * 60 * 60 * 1_000 }));
    const result = computeOfficialDailyForecast(staleForecasts, {
      ...options(),
      referenceAt: issuedAt,
    });

    expect(result.tempMax).toBeNull();
    expect(result.trace.parameterSources.tempMax).toEqual([]);
  });

  it("n\u2019emprunte ni une variable, ni une \u00e9ch\u00e9ance, ni un lieu diff\u00e9rent", () => {
    const mismatched = serviceNames.flatMap((serviceName) => [
      evidenceFor(serviceName, "temperature_max", { horizonBucket: "1-3d" }),
      evidenceFor(serviceName, "temperature_max", { horizonBucket, locationKey: "autre-lieu" }),
    ]);
    const result = computeOfficialDailyForecast(forecasts, options(mismatched));

    expect(result.trace.horizonBucket).toBe("6-24h");
    expect(result.tempMax).not.toBeNull();
    expect(result.tempMin).not.toBeNull();
    expect(result.trace.calibrationStatus.tempMax).toBe("UNCALIBRATED_ROBUST");
    expect(result.trace.calibrationStatus.tempMin).toBe("UNCALIBRATED_ROBUST");
    expect(result.precipitation).not.toBeNull();
    expect(result.windSpeed).not.toBeNull();
  });

  it("fusionne les seules couvertures r\u00e9ellement re\u00e7ues \u00e0 J+3, J+7 et J+15 et marque un mod\u00e8le unique", () => {
    const referenceAt = Date.parse("2026-10-02T22:00:00.000Z");
    const forecastsAt = (date: string, names: string[]) => OFFICIAL_HOURLY_MODELS
      .filter((model) => names.includes(model.name))
      .map((model, index) => ({
        serviceName: model.name,
        modelId: model.modelId,
        sourceName: "open-meteo",
        runId: `${model.name}-${date}-capture`,
        runIdKind: "capture" as const,
        requestStartedAt: referenceAt - 30_000,
        availableAt: referenceAt,
        validTime: Date.parse(`${date}T22:00:00.000Z`),
        tempMax: 20 + index,
        tempMin: 10 + index,
        precipitation: 0.2 + index,
        windSpeed: 8 + index,
        windGust: 12 + index,
        humidity: 60 + index,
        cloudCover: 30 + index,
      }));
    const run = (date: string, names: string[]) => computeOfficialDailyForecastWithDiagnostics(
      forecastsAt(date, names),
      { ...options([], false), targetDate: date, issuedAt: referenceAt, referenceAt },
    );

    const j3 = run("2026-10-05", ["ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"]);
    expect(j3.parameterDiagnostics.temperature_max).toMatchObject({
      availabilityStatus: "FUSED",
      calibrationStatus: "UNCALIBRATED_ROBUST",
      expectedModelCount: 7,
      availableValueModelCount: 6,
      contributingModelCount: 6,
      coverageLevel: "BROAD",
    });
    expect(j3.tempMax).not.toBeNull();
    expect(j3.parameterDiagnostics.temperature_max.modelReasons.find(({ modelName }) => modelName === "AROME")?.reason).toContain("Aucun run");

    const j7 = run("2026-10-09", ["ECMWF", "GFS", "GEM", "UKMET"]);
    expect(j7.trace.horizonBucket).toBe("4-7d");
    expect(j7.parameterDiagnostics.temperature_max).toMatchObject({ availableValueModelCount: 4, coverageLevel: "MODERATE" });
    expect(j7.tempMax).not.toBeNull();

    const j15 = run("2026-10-17", ["ECMWF", "GFS"]);
    expect(j15.trace.horizonBucket).toBe("8-15d");
    expect(j15.parameterDiagnostics.temperature_max).toMatchObject({ availableValueModelCount: 2, contributingModelCount: 2, coverageLevel: "LIMITED" });
    expect(j15.parameterDiagnostics.temperature_max.contributingModelCount).toBe(2);
    expect(j15.tempMax).not.toBeNull();
    expect(j15.trace.parameterSources.tempMax.reduce((sum, source) => sum + source.finalWeight, 0)).toBeCloseTo(1, 8);

    const singleModel = run("2026-10-17", ["ECMWF"]);
    expect(singleModel.parameterDiagnostics.temperature_max).toMatchObject({ availabilityStatus: "SINGLE_MODEL", contributingModelCount: 1, coverageLevel: "SINGLE_MODEL" });
    expect(singleModel.tempMax).not.toBeNull();
    expect(singleModel.trace.parameterSources.tempMax).toHaveLength(1);
    expect(singleModel.trace.parameterSources.tempMax[0]?.finalWeight).toBe(1);
  });

  it("exclut le mod\u00e8le sans valeur pour cette variable et fusionne les deux contributeurs restants", () => {
    const threeForecasts = forecasts.slice(0, 3).map((forecast, index) => ({
      ...forecast,
      tempMax: index === 0 ? null : forecast.tempMax,
    }));
    const result = computeOfficialDailyForecast(threeForecasts, options(qualifiedEvidence()));

    expect(result.tempMax).not.toBeNull();
    expect(result.trace.availabilityStatus.temperature_max).toBe("FUSED");
    expect(result.trace.calibrationStatus.tempMax).toBe("CALIBRATED");
    expect(result.tempMin).not.toBeNull();
    expect(result.trace.parameterSources.tempMax).toHaveLength(2);
    expect(result.trace.eligibilityByVariable.temperature_max.find((item) => item.modelName === "AROME")?.reason).toContain("Aucune valeur finie disponible");
  });

  it("distingue une absence r\u00e9elle de valeur d\u2019un manque de preuve historique", () => {
    const noValues = computeOfficialDailyForecastWithDiagnostics(
      forecasts.map((forecast) => ({ ...forecast, tempMax: null })),
      options(),
    );
    const invalidEvidence = qualifiedEvidence().map((item) => item.variable === "temperature_max"
      ? { ...item, sampleSize: 29, evaluatedDays: 29, comparisonCount: 29 }
      : item);
    const noEvidence = computeOfficialDailyForecastWithDiagnostics(forecasts, options(invalidEvidence));

    expect(noValues.parameterDiagnostics.temperature_max).toMatchObject({
      status: "UNAVAILABLE",
      expectedModelCount: 7,
      availableValueModelCount: 0,
      evidenceEligibleModelCount: 0,
      contributingModelCount: 0,
      coverageLevel: "NONE",
    });
    expect(noValues.tempMax).toBeNull();
    expect(noEvidence.parameterDiagnostics.temperature_max).toMatchObject({
      status: "FUSED",
      calibrationStatus: "UNCALIBRATED_ROBUST",
      availableValueModelCount: 4,
      evidenceEligibleModelCount: 0,
      contributingModelCount: 4,
    });
    expect(noEvidence.parameterDiagnostics.temperature_max.calibrationReasons
      .filter(({ modelName }) => serviceNames.includes(modelName))
      .every(({ reason }) => reason.includes("fallback robuste"))).toBe(true);
    expect(noEvidence.tempMax).not.toBeNull();
  });

  it("fusionne dynamiquement deux ou trois sources \u00e0 preuve qualifi\u00e9e sans blocage du plafond", () => {
    const twoModels = computeOfficialDailyForecastWithDiagnostics(forecasts.slice(0, 2), options());
    const threeModels = computeOfficialDailyForecastWithDiagnostics(forecasts.slice(0, 3), options());

    expect(twoModels.parameterDiagnostics.temperature_max).toMatchObject({
      status: "FUSED",
      availableValueModelCount: 2,
      evidenceEligibleModelCount: 2,
      contributingModelCount: 2,
      coverageLevel: "LIMITED",
      evidenceEligibleModels: serviceNames.slice(0, 2),
    });
    expect(twoModels.tempMax).not.toBeNull();
    expect(twoModels.trace.parameterSources.tempMax.reduce((sum, source) => sum + source.finalWeight, 0)).toBeCloseTo(1, 8);
    expect(Math.max(...twoModels.trace.parameterSources.tempMax.map((source) => source.finalWeight))).toBeLessThanOrEqual(0.65);

    expect(threeModels.parameterDiagnostics.temperature_max).toMatchObject({
      status: "FUSED",
      calibrationStatus: "CALIBRATED",
      availableValueModelCount: 3,
      evidenceEligibleModelCount: 3,
      contributingModelCount: 3,
      coverageLevel: "MODERATE",
    });
    expect(threeModels.trace.parameterSources.tempMax).toHaveLength(3);
    expect(threeModels.trace.parameterSources.tempMax.reduce((sum, source) => sum + source.finalWeight, 0)).toBeCloseTo(1, 8);
  });

  it("conserve les pr\u00e9visions s\u00e8ches comme valeurs disponibles \u00e0 z\u00e9ro", () => {
    const result = computeOfficialDailyForecastWithDiagnostics(
      forecasts.map((forecast) => ({ ...forecast, precipitation: 0 })),
      options(),
    );

    expect(result.parameterDiagnostics.precipitation_sum).toMatchObject({
      status: "FUSED",
      availableValueModelCount: 4,
      evidenceEligibleModelCount: 4,
      contributingModelCount: 4,
    });
    expect(result.precipitation).toBe(0);
  });
});
