import { describe, expect, it } from "vitest";
import { computeFusion, detectExtendedRegime, detectMultiRegime, EXTENDED_REGIME_INFO, generateAdaptiveForecast, getLeadTimeWeights, isEligibleGlobalReliabilityScore, type FusionSource } from "./fusionEngine";
import { MODEL_FUSION_WEIGHT_CAP, normalizeModelWeightsWithCap, regularizeModelPerformance, type DailyFusionMetric, type ModelPerformanceEvidence } from "./fusionPerformance";

function station(
  id: string,
  distanceKm: number,
  temperature: number,
  updatedAt = new Date()
): FusionSource {
  const observedAt = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  return {
    id,
    name: id,
    distanceKm,
    temperature,
    humidity: 70,
    pressure: 1015,
    windSpeed: 12,
    updatedAt,
    measurementTimes: {
      temperature: observedAt,
      humidity: observedAt,
      pressure: observedAt,
      windSpeed: observedAt,
      windGust: observedAt,
      windDirection: observedAt,
      precipitation: observedAt,
    },
    reliabilityScore: 85,
    maeTemp: 1,
    type: "station",
  };
}

const performanceContext = { locationKey: "50.7567_2.5204", variable: "temperature_max" as const, horizonBucket: "6-24h" as const };

function modelEvidence(serviceName: string, mae: number, sampleSize: number, overrides: Partial<ModelPerformanceEvidence> = {}): ModelPerformanceEvidence {
  return {
    locationKey: performanceContext.locationKey,
    serviceName,
    modelId: serviceName,
    variable: performanceContext.variable,
    horizonBucket: performanceContext.horizonBucket,
    comparisonCount: sampleSize,
    sampleSize,
    evaluatedDays: sampleSize,
    mae,
    rmse: mae + 0.2,
    standardError: 0.02,
    latestScoreDate: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

function modelSource(serviceName: string, value: number | null, evidence: ModelPerformanceEvidence): FusionSource {
  return {
    id: `model:${serviceName}`,
    name: serviceName,
    modelId: evidence.modelId,
    distanceKm: 1,
    temperature: value,
    updatedAt: new Date(),
    reliabilityScore: 50,
    performanceEvidence: evidence,
    type: "model",
  };
}

describe("computeFusion — fusion IDW avancée", () => {
  it("favorise une station proche de qualité comparable", () => {
    const result = computeFusion(
      [station("proche", 1, 10), station("lointaine", 4, 20)],
      {
        altitudeCorrectionEnabled: false,
        anomalyDetectionEnabled: false,
        modelWeightFraction: 0,
      }
    );

    expect(result.methodUsed).toContain("IDW");
    expect(result.stationCount).toBe(2);
    expect(result.temperature).not.toBeNull();
    // La proximité reste prépondérante, mais ne contourne plus les parts
    // normalisées distance/qualité/fraîcheur du noyau spatial commun.
    expect(result.temperature!).toBeLessThan(15);
    expect(result.usedSources[0]?.name).toBe("proche");
  });

  it("qualifie chaque mesure station avec son horodatage propre et conserve les autres champs frais", () => {
    const now = Date.now();
    const recent = new Date(now - 5 * 60_000).toISOString();
    const old = new Date(now - 31 * 60_000).toISOString();
    const source = (id: string, temperature: number, humidity: number, temperatureAt: string | null): FusionSource => ({
      ...station(id, 1, temperature, new Date(now)),
      humidity,
      updatedAt: recent,
      measurementTimes: {
        temperature: temperatureAt,
        humidity: recent,
        pressure: null,
        windSpeed: recent,
        windGust: null,
        windDirection: null,
        precipitation: null,
      },
    });
    const result = computeFusion([
      source("fresh", 20, 80, recent),
      source("old-temperature", 50, 20, old),
      source("unknown-temperature", 80, 40, null),
    ], {
      referenceAt: now,
      maxFreshnessMin: 30,
      altitudeCorrectionEnabled: false,
      anomalyDetectionEnabled: false,
      modelWeightFraction: 0,
    });

    expect(result.temperature).toBe(20);
    expect(result.humidity).toBe(46.7);
    expect(result.stationCount).toBe(1);
    const oldTemperature = result.usedSources.find((item) => item.id === "old-temperature")!;
    const unknownTemperature = result.usedSources.find((item) => item.id === "unknown-temperature")!;
    expect(oldTemperature.fieldWeights?.temperature).toBeUndefined();
    expect(oldTemperature.fieldWeights?.humidity).toBeGreaterThan(0);
    expect(oldTemperature.measurementObservations?.temperature).toMatchObject({ value: 50, ageStatus: "known", contributes: false });
    expect(unknownTemperature.fieldWeights?.temperature).toBeUndefined();
    expect(unknownTemperature.fieldWeights?.humidity).toBeGreaterThan(0);
    expect(unknownTemperature.measurementObservations?.temperature).toMatchObject({ value: 80, observedAt: null, ageMinutes: null, ageStatus: "unknown", contributes: false });
  });

  it("évalue la fraîcheur d’un run à l’instant de référence de sa fusion", () => {
    const referenceAt = Date.parse("2026-08-18T05:00:00.000Z");
    const result = computeFusion([{
      id: "model:ECMWF",
      name: "ECMWF",
      modelId: "ecmwf_ifs025",
      distanceKm: 1,
      temperature: 20,
      updatedAt: new Date(referenceAt),
      type: "model",
    }], {
      referenceAt,
      maxFreshnessMin: 15 * 24 * 60,
      minReliabilityScore: 0,
      altitudeCorrectionEnabled: false,
      anomalyDetectionEnabled: false,
      modelWeightFraction: 1,
      allowRobustUncalibratedModels: true,
    });

    expect(result.temperature).toBe(20);
    expect(result.usedSources.map((source) => source.name)).toEqual(["ECMWF"]);
  });

  it("détecte et pénalise une valeur station figée depuis plus d'une heure", () => {
    const now = Date.now();
    const sources = [station("figee", 1, 10, new Date(now - 1)), station("reference", 2, 11, new Date(now - 1))];
    const baseline = computeFusion(sources, {
      altitudeCorrectionEnabled: false,
      anomalyDetectionEnabled: false,
      modelWeightFraction: 0,
    });
    const previousReadings = new Map([
      ["figee", { temperature: 10, timestamp: now - 61 * 60 * 1000, stableSince: now - 61 * 60 * 1000 }],
    ]);
    const result = computeFusion(
      sources,
      {
        altitudeCorrectionEnabled: false,
        anomalyDetectionEnabled: true,
        modelWeightFraction: 0,
      },
      previousReadings
    );

    expect(result.anomaliesDetected.some((anomaly) => anomaly.type === "frozen_value")).toBe(true);
    const baselineWeight = baseline.usedSources.find((source) => source.id === "figee")?.finalWeight ?? 0;
    const penalizedWeight = result.usedSources.find((source) => source.id === "figee")?.finalWeight ?? 0;
    expect(penalizedWeight).toBeLessThan(baselineWeight);
  });
});

describe("getLeadTimeWeights", () => {
  it("ignore les scores par échéance trop peu nombreux ou périmés", () => {
    const weights = getLeadTimeWeights([
      { serviceName: "Faible", bucket: "0-6h", avgMaeTemp: 0.1, avgMaePrecip: 0.1, avgMaeWind: 0.1, sampleSize: 2, latestScoreDate: "2026-08-12" },
      { serviceName: "Ancien", bucket: "0-6h", avgMaeTemp: 0.1, avgMaePrecip: 0.1, avgMaeWind: 0.1, sampleSize: 12, latestScoreDate: "2026-08-01" },
      { serviceName: "Validé", bucket: "0-6h", avgMaeTemp: 0.4, avgMaePrecip: 0.2, avgMaeWind: 1.2, sampleSize: 9, latestScoreDate: "2026-08-10" },
    ], "0-6h", new Date("2026-08-12T12:00:00.000Z"));

    expect(weights).toEqual({
      "Validé": { maeTemp: 0.4, maePrecip: 0.2, maeWind: 1.2 },
    });
  });

  it("choisit le voisin d’échéance le plus proche avant une performance très courte", () => {
    const weights = getLeadTimeWeights([
      { serviceName: "AROME", bucket: "0-6h", avgMaeTemp: 0.1, avgMaePrecip: 0.2, avgMaeWind: 1, sampleSize: 10, latestScoreDate: "2026-08-11" },
      { serviceName: "AROME", bucket: "4-7d", avgMaeTemp: 1.8, avgMaePrecip: 2.2, avgMaeWind: 8, sampleSize: 10, latestScoreDate: "2026-08-11" },
    ], "8-15d", new Date("2026-08-12T12:00:00.000Z"));

    expect(weights.AROME).toEqual({ maeTemp: 1.8, maePrecip: 2.2, maeWind: 8 });
  });
});

describe("isEligibleGlobalReliabilityScore", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("retient uniquement les scores globaux récents avec un effectif suffisant", () => {
    expect(isEligibleGlobalReliabilityScore(10, "2026-08-11", now)).toBe(true);
    expect(isEligibleGlobalReliabilityScore(3, "2026-08-12", now)).toBe(false);
    expect(isEligibleGlobalReliabilityScore(10, "2026-08-01", now)).toBe(false);
  });
});


describe("computeFusion — preuve statistique quotidienne exacte", () => {
  const config = {
    maxDistanceKm: 5,
    maxFreshnessMin: 24 * 60,
    minReliabilityScore: 0,
    altitudeCorrectionEnabled: false,
    anomalyDetectionEnabled: false,
    modelWeightFraction: 1,
    performanceContext,
  };

  it("n’utilise pas un MAE brut sans effectif ni contexte lieu/variable/horizon", () => {
    const sources = [
      { ...modelSource("mae-brut-faible", 10, modelEvidence("mae-brut-faible", 0.6, 120)), maeTemp: 0.6, performanceEvidence: undefined },
      { ...modelSource("mae-brut-fort", 20, modelEvidence("mae-brut-fort", 0.8, 120)), maeTemp: 0.8, performanceEvidence: undefined },
    ];
    const result = computeFusion(sources, { ...config, performanceContext: undefined });

    expect(result.performanceEvidenceStatus).toBe("not_requested");
    expect(result.usedSources.map((source) => source.performanceWeight)).toEqual([1, 1]);
  });

  it("n’accorde pas d’avantage excessif à 0,6 °C sur 12 cas face à 0,8 °C sur 500", () => {
    const lowN = modelEvidence("faible-effectif", 0.6, 12);
    const highN = modelEvidence("grand-effectif", 0.8, 120, { comparisonCount: 500 });
    const sources = [
      modelSource("faible-effectif", 10, lowN),
      modelSource("grand-effectif", 20, highN),
      modelSource("autre-1", 30, modelEvidence("autre-1", 0.9, 120)),
      modelSource("autre-2", 40, modelEvidence("autre-2", 1.0, 120)),
    ];
    const result = computeFusion(sources, config);

    expect(result.performanceEvidenceStatus).toBe("qualified");
    expect(result.usedSources.map((source) => source.name)).not.toContain("faible-effectif");
    expect(result.excludedSources.find((source) => source.name === "faible-effectif")?.reason).toContain("30 jours indépendants");
    const largeSample = result.usedSources.find((source) => source.name === "grand-effectif")!;
    expect(largeSample.performanceEvidence?.comparisonCount).toBe(500);
    expect(largeSample.performanceEvidence?.sampleSize).toBe(120);
    expect(largeSample.sampleReliability).toBeCloseTo(0.8, 12);
    const weight = largeSample.finalWeight;
    expect(weight).toBeGreaterThan(result.usedSources.find((source) => source.name === "autre-1")!.finalWeight);
    expect(weight).toBeLessThanOrEqual(MODEL_FUSION_WEIGHT_CAP);
    expect(result.usedSources.reduce((sum, source) => sum + source.finalWeight, 0)).toBeCloseTo(1, 8);
  });

  it("régularise l’incertitude et garde le multiplicateur dans ses bornes", () => {
    const evidence = [
      modelEvidence("très-précis", 0.1, 120, { standardError: 0 }),
      modelEvidence("médian", 0.5, 120, { standardError: 0 }),
      modelEvidence("peu-précis", 9, 120, { standardError: 0 }),
    ];
    const regularized = regularizeModelPerformance(evidence, performanceContext, new Date());

    expect(regularized.get("très-précis")?.performanceMultiplier).toBe(2);
    expect(regularized.get("peu-précis")?.performanceMultiplier).toBe(0.3);
    for (const score of regularized.values()) {
      expect(score.performanceMultiplier).toBeGreaterThanOrEqual(0.3);
      expect(score.performanceMultiplier).toBeLessThanOrEqual(2);
      expect(score.uncertaintyAdjustedMae).toBeGreaterThanOrEqual(score.evidence.mae);
    }
  });

  it("normalise les poids à un et plafonne chaque modelId indépendamment", () => {
    const weights = normalizeModelWeightsWithCap([
      { modelId: "dominant", rawWeight: 100 },
      { modelId: "m2", rawWeight: 1 },
      { modelId: "m3", rawWeight: 1 },
      { modelId: "m4", rawWeight: 1 },
      { modelId: "m5", rawWeight: 1 },
    ]);

    expect(weights).not.toBeNull();
    expect(Array.from(weights!.values()).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    expect(Math.max(...Array.from(weights!.values()))).toBeLessThanOrEqual(MODEL_FUSION_WEIGHT_CAP);
    expect(weights!.get("dominant")).toBeCloseTo(MODEL_FUSION_WEIGHT_CAP, 12);
    expect(normalizeModelWeightsWithCap([{ modelId: "only-one", rawWeight: 1 }])).toEqual(new Map([["only-one", 1]]));
  });

  it("adapte le plafond à deux sources au lieu de bloquer la prévision", () => {
    const result = computeFusion([
      modelSource("m1", 10, modelEvidence("m1", 0.8, 120)),
      modelSource("m2", 12, modelEvidence("m2", 0.9, 120)),
    ], config);
    expect(result.temperature).not.toBeNull();
    expect(result.usedSources).toHaveLength(2);
    expect(result.usedSources.reduce((sum, source) => sum + source.finalWeight, 0)).toBeCloseTo(1, 10);
    expect(Math.max(...result.usedSources.map((source) => source.finalWeight))).toBeLessThanOrEqual(0.65);
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.performanceEvidenceStatus).toBe("qualified");
  });

  it("renormalise exactement un plafond effectif relâché face à un poids 99/1", () => {
    const weights = normalizeModelWeightsWithCap([
      { modelId: "dominant", rawWeight: 99 },
      { modelId: "minor", rawWeight: 1 },
    ]);

    expect(weights).not.toBeNull();
    expect(Array.from(weights!.values()).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    expect(weights!.get("dominant")).toBeCloseTo(0.65, 12);
    expect(weights!.get("minor")).toBeCloseTo(0.35, 12);
  });

  it("ignore un modèle sans valeur pour la variable et exige des preuves du lieu, de la variable et de l’horizon exacts", () => {
    const available = [
      modelSource("m1", 10, modelEvidence("m1", 0.8, 120)),
      modelSource("m2", 12, modelEvidence("m2", 0.9, 120)),
      modelSource("m3", 14, modelEvidence("m3", 1.0, 120)),
    ];
    const missing = modelSource("m4", null, modelEvidence("m4", 0.7, 120));
    const result = computeFusion([...available, missing], config);
    expect(result.performanceEvidenceStatus).toBe("qualified");
    expect(result.usedSources.map((source) => source.name)).toEqual(["m1", "m2", "m3"]);
    expect(result.excludedSources.find((source) => source.name === "m4")?.reason).toContain("prévision de cette variable indisponible");
    expect(result.usedSources.reduce((sum, source) => sum + source.finalWeight, 0)).toBeCloseTo(1, 8);

    const mismatched = available.map((source, index) => ({
      ...source,
      performanceEvidence: {
        ...source.performanceEvidence!,
        locationKey: index === 0 ? "autre-lieu" : performanceContext.locationKey,
        variable: index === 1 ? "precipitation_sum" as DailyFusionMetric : performanceContext.variable,
        horizonBucket: index === 2 ? "1-3d" as const : performanceContext.horizonBucket,
      },
    }));
    const rejected = computeFusion(mismatched, config);
    expect(rejected.performanceEvidenceStatus).toBe("insufficient");
    expect(rejected.temperature).toBeNull();
    expect(rejected.excludedSources).toHaveLength(3);
  });
});

describe("détection de régime sans valeurs météorologiques inventées", () => {
  const complete = {
    temperature: 0,
    precipitation: 0,
    windSpeed: 0,
    humidity: 0,
    visibility: 10_000,
    cloudCover: 0,
  };

  it("conserve les zéros valides mais retourne null pour tout champ absent ou non fini", () => {
    expect(detectMultiRegime(complete)).not.toBeNull();
    expect(detectExtendedRegime(complete)).toBe("sunny");

    for (const field of Object.keys(complete) as Array<keyof typeof complete>) {
      expect(detectMultiRegime({ ...complete, [field]: null })).toBeNull();
      expect(detectMultiRegime({ ...complete, [field]: Number.NaN })).toBeNull();
      expect(detectExtendedRegime({ ...complete, [field]: null })).toBeNull();
      expect(detectExtendedRegime({ ...complete, [field]: Number.POSITIVE_INFINITY })).toBeNull();
    }
  });

  it("ne déduit ni neige ni pluie verglaçante de la seule température et quantité de précipitations", () => {
    const coldPrecipitation = { ...complete, temperature: -2, precipitation: 1, cloudCover: 65 };
    const extended = detectExtendedRegime(coldPrecipitation);
    const multi = detectMultiRegime(coldPrecipitation);

    expect(extended).toBe("winter_precipitation_uncertain");
    expect(multi?.primaryRegime.id).toBe("winter_precipitation_uncertain");
    expect(multi?.activeRegimes.map(({ id }) => id)).not.toContain("freezing_rain");
    expect(multi?.activeRegimes.map(({ id }) => id)).not.toContain("snow");
  });

  it("conserve null/unknown si la quantité est absente et ne signale pas de phase froide à quantité nulle", () => {
    expect(detectExtendedRegime({ ...complete, temperature: -2, precipitation: null })).toBeNull();
    expect(detectMultiRegime({ ...complete, temperature: -2, precipitation: undefined })).toBeNull();
    expect(detectExtendedRegime({ ...complete, temperature: -2, precipitation: 0 })).toBe("frost");
    expect(detectExtendedRegime({ ...complete, temperature: 4, precipitation: 1 })).not.toBe("freezing_rain");
  });

  it("utilise une phase réellement typée pour pluie, neige et pluie verglaçante", () => {
    const coldPrecipitation = { ...complete, temperature: -2, precipitation: 1, cloudCover: 65 };

    expect(detectExtendedRegime({ ...coldPrecipitation, precipitationType: "rain" })).toBe("showers");
    expect(detectExtendedRegime({ ...coldPrecipitation, precipitationType: "snow" })).toBe("snow");
    expect(detectExtendedRegime({ ...coldPrecipitation, precipitationType: "freezing_rain" })).toBe("freezing_rain");

    const typedRainMulti = detectMultiRegime({ ...coldPrecipitation, precipitationType: "rain" });
    expect(typedRainMulti?.activeRegimes.map(({ id }) => id)).toContain("showers");
    expect(typedRainMulti?.activeRegimes.map(({ id }) => id)).not.toContain("freezing_rain");
    expect(typedRainMulti?.activeRegimes.map(({ id }) => id)).not.toContain("snow");
    expect(detectMultiRegime({ ...coldPrecipitation, precipitationType: "snow" })?.primaryRegime.id).toBe("snow");
    expect(detectMultiRegime({ ...coldPrecipitation, temperature: -1, precipitationType: "freezing_rain" })?.primaryRegime.id).toBe("freezing_rain");
  });

  it("n’émet plus de vague de froid et conserve gel, gel intense et vent fort séparés", () => {
    const isolatedCold = { ...complete, temperature: -1 };
    const coldAndWindy = { ...complete, temperature: -4, windSpeed: 20 };

    expect(detectExtendedRegime(isolatedCold)).toBe("frost");
    expect(detectExtendedRegime(coldAndWindy)).toBe("frost");
    for (const input of [isolatedCold, coldAndWindy]) {
      const result = detectMultiRegime(input);
      expect(result?.primaryRegime.id).not.toBe("cold_wave");
      expect(result?.activeRegimes.map(({ id }) => id)).not.toContain("cold_wave");
    }

    const frostInput = { ...complete, temperature: -2, cloudCover: 65 };
    const deepFrostInput = { ...complete, temperature: -6, cloudCover: 65 };
    const windyInput = { ...complete, temperature: 10, windSpeed: 45, cloudCover: 65 };

    expect(detectExtendedRegime(frostInput)).toBe("frost");
    expect(EXTENDED_REGIME_INFO.frost.label).toBe("Gel");
    expect(detectMultiRegime(frostInput)?.activeRegimes.map(({ id }) => id)).toContain("frost");
    expect(detectExtendedRegime(deepFrostInput)).toBe("deep_frost");
    expect(EXTENDED_REGIME_INFO.deep_frost.label).toBe("Gel intense");
    expect(detectMultiRegime(deepFrostInput)?.activeRegimes.map(({ id }) => id)).toContain("deep_frost");
    expect(detectExtendedRegime(windyInput)).toBe("windy");
    expect(detectMultiRegime(windyInput)?.activeRegimes.map(({ id }) => id)).toContain("windy");
  });
});

// ─── generateAdaptiveForecast — poids de fusion par preuve qualifiée ─────────

describe("generateAdaptiveForecast — pondération par preuve historique qualifiée", () => {
  const forecasts = [
    { serviceName: "A", tempMax: 20, tempMin: 10, precipitation: 0, windSpeed: 10 },
    { serviceName: "B", tempMax: 22, tempMin: 12, precipitation: 1, windSpeed: 12 },
  ];

  it("garde un poids neutre aux services sans preuve qualifiée, même avec une MAE ou un score global", () => {
    const result = generateAdaptiveForecast(forecasts, {
      A: { maeTemp: 0.2, weightedScore: 95 },
      B: { weightedScore: 5 },
    });

    expect(result.weights).toEqual({
      A: { tempWeight: 0.5, precipWeight: 0.5, windWeight: 0.5 },
      B: { tempWeight: 0.5, precipWeight: 0.5, windWeight: 0.5 },
    });
  });

  it("surpondère le service avec preuve qualifiée en respectant le plafond individuel", () => {
    const result = generateAdaptiveForecast(forecasts, {
      A: { maeTemp: 0.5, qualified: true, comparisonCount: 100, evaluatedDays: 60 },
      B: {},
    });

    expect(result.weights.A.tempWeight).toBe(0.65);
    expect(result.weights.B.tempWeight).toBe(0.35);
  });

  it("rétrécit l’avantage de performance quand la masse de preuve est mince", () => {
    const strongEvidence = generateAdaptiveForecast(forecasts, {
      A: { maeTemp: 0.5, qualified: true, comparisonCount: 100, evaluatedDays: 60 },
      B: { maeTemp: 1.5, qualified: true, comparisonCount: 100, evaluatedDays: 60 },
    });
    const thinEvidence = generateAdaptiveForecast(forecasts, {
      A: { maeTemp: 0.5, qualified: true, comparisonCount: 100, evaluatedDays: 60 },
      B: { maeTemp: 1.5, qualified: true, comparisonCount: 4, evaluatedDays: 5 },
    });

    expect(strongEvidence.weights.A.tempWeight).toBe(0.65);
    expect(strongEvidence.weights.B.tempWeight).toBe(0.35);
    // Preuve mince : la MAE de B est rétractée vers la médiane, son poids remonte.
    expect(thinEvidence.weights.B.tempWeight).toBe(0.384);
    expect(thinEvidence.weights.A.tempWeight).toBe(0.616);
  });

  it("ignore une qualification déclarée sans effectifs valides", () => {
    const result = generateAdaptiveForecast(forecasts, {
      A: { maeTemp: 0.5, qualified: true },
      B: {},
    });

    expect(result.weights.A.tempWeight).toBe(0.5);
    expect(result.weights.B.tempWeight).toBe(0.5);
  });
});
