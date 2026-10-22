import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HourlyFusionTrace, HourlyPrecipitationAgreementTrace } from "@shared/hourlyModelMetrics";
import { HourlyFusionDebugPanel, selectHourlyDebugTarget } from "./HourlyFusionDebugPanel";

const firstValidAt = Date.parse("2026-10-04T12:00:00.000Z");
const secondValidAt = firstValidAt + 60 * 60_000;

const weighting: HourlyFusionTrace = {
  method: "mixed",
  availabilityStatus: "FUSED",
  calibrationStatus: "PARTIALLY_CALIBRATED",
  expectedModelCount: 7,
  availableModelCount: 5,
  contributingModelCount: 5,
  horizonBucket: null,
  modelsWithData: ["AROME", "ARPEGE"],
  variableWeightings: [{
    variable: "temperature",
    method: "mixed",
    selectionStrategy: "weighted_ensemble_fallback",
    selectedModelName: null,
    selectionEvidenceBasis: null,
    selectionReason: "insufficient_qualified_history",
    horizonBucket: null,
    availabilityStatus: "FUSED",
    calibrationStatus: "PARTIALLY_CALIBRATED",
    expectedModelCount: 7,
    availableModelCount: 2,
    evidenceEligibleModelCount: 1,
    contributingModelCount: 2,
    coverageLevel: "LIMITED",
    modelReasons: [{
      modelName: "UKMET",
      reason: "Aucun run exact valide pour cette échéance.",
      sourceName: null,
      modelId: null,
      runId: null,
      availableAt: null,
      validTime: null,
      horizonMinutes: null,
      horizonBucket: null,
    }],
    modelWeights: [
      {
        modelName: "AROME",
        modelId: "arome_france",
        sourceName: "open-meteo",
        runId: "capture-arome",
        runIdKind: "capture",
        requestStartedAt: firstValidAt - 130 * 60_000,
        availableAt: firstValidAt - 108 * 60_000,
        validTime: firstValidAt,
        horizonMinutes: 108,
        horizonBucket: "0_2h",
        value: 12,
        reliability: 0.5,
        historicalScore: { mae: 1, rmse: 1.5, bias: 0.2, comparisonCount: 35, evaluatedDays: 7 },
        calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_BUCKET",
        calibrationStatus: "CALIBRATED",
        rawWeight: 1.2,
        robustFallbackWeight: null,
        weight: 0.6,
        contributedToValue: true,
        historicalEvidence: {
          status: "qualified",
          minimumComparisons: 30,
          minimumComparableDays: 7,
          latestScoreDate: "2026-09-30",
          latestComputedAt: "2026-10-01T12:00:00.000Z",
        },
      },
      {
        modelName: "ARPEGE",
        modelId: "arpege_europe",
        sourceName: "open-meteo",
        runId: "capture-arpege",
        runIdKind: "capture",
        requestStartedAt: firstValidAt - 150 * 60_000,
        availableAt: firstValidAt - 122 * 60_000,
        validTime: firstValidAt,
        horizonMinutes: 122,
        horizonBucket: "2_6h",
        value: 14,
        reliability: 0.1,
        historicalScore: null,
        calibrationLevel: "UNCALIBRATED_ROBUST",
        calibrationStatus: "UNCALIBRATED_ROBUST",
        rawWeight: 0.8,
        robustFallbackWeight: 1,
        weight: 0.4,
        contributedToValue: true,
      },
    ],
  }],
};

const precipitationAgreement: HourlyPrecipitationAgreementTrace = {
  thresholdMm: 0.1,
  expectedModelCount: 5,
  modelsExpected: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS"],
  configuredModelCount: 7,
  modelsConfigured: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"],
  availableModelCount: 5,
  rainModelCount: 4,
  frequencyPercent: 80,
  conditionalMeanMm: 1.25,
  conditionalMeanMethod: "arithmetic_mean",
  consensusEstimateMm: 1,
  modelsWithData: ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS"],
  modelsPredictingRain: ["AROME", "ARPEGE", "ICON", "ECMWF"],
  modelValues: [
    { modelName: "AROME", amountMm: 1, predictsRain: true },
    { modelName: "ARPEGE", amountMm: 2, predictsRain: true },
    { modelName: "ICON", amountMm: 1, predictsRain: true },
    { modelName: "ECMWF", amountMm: 1, predictsRain: true },
    { modelName: "GFS", amountMm: 0, predictsRain: false },
  ],
  isProbabilityCalibrated: false,
};

const points = [
  { date: "2026-10-04", hour: "14:00", validAt: firstValidAt, finalValues: [
    { variable: "temperature", value: 0, unit: "°C" },
    { variable: "precipitation", value: 0, unit: "mm" },
    { variable: "wind_gust", value: null, unit: "km/h" },
  ], weighting, precipitationAgreement },
  { date: "2026-10-04", hour: "15:00", validAt: secondValidAt, weighting: null, precipitationAgreement: null },
];

describe("HourlyFusionDebugPanel", () => {
  it("sélectionne une échéance précise, par défaut celle alignée au snapshot", () => {
    expect(selectHourlyDebugTarget(points, null, firstValidAt)).toBe(points[0]);
    expect(selectHourlyDebugTarget(points, secondValidAt, firstValidAt)).toBe(points[1]);
    expect(selectHourlyDebugTarget([], null, null)).toBeNull();
  });

  it("rend les traces de chaque bucket et modèle, et présente la pluie comme un accord non probabiliste", () => {
    const html = renderToStaticMarkup(createElement(HourlyFusionDebugPanel, {
      points,
      preferredValidAt: firstValidAt,
    }));

    expect(html).toContain("Choisir l’échéance horaire à déboguer");
    expect(html).toContain("AROME");
    expect(html).toContain("ARPEGE");
    expect(html).toContain("0_2h");
    expect(html).toContain("2_6h");
    expect(html).toContain("UKMET");
    expect(html).toContain("Aucun run exact valide pour cette échéance.");
    expect(html).toContain("Valeurs finales de la fusion");
    expect(html).toContain("0 °C");
    expect(html).toContain("0 mm");
    expect(html).toContain("Rafales");
    expect(html).toContain("indisponible");
    expect(html).toContain("pas la couverture/qualité des stations physiques");
    expect(html).toContain("L’incertitude statistique n’est pas mesurée ici");
    expect(html).toContain("la fiabilité historique est affichée séparément");
    expect(html).toContain("fallback : mélange pondéré actuel (preuve historique qualifiée insuffisante)");
    expect(html).toContain("Aucune mesure instantanée n’est injectée dans cette prévision future");
    expect(html).toMatch(/accord brut 80\s?%/i);
    expect(html).toContain("probabilité calibrée : non");
    expect(html).not.toContain("Probabilité de pluie : 80 %");
  });
});
