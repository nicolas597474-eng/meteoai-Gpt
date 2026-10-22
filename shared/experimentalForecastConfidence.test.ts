import { describe, expect, it } from "vitest";
import {
  calculateExperimentalForecastConfidence,
  type ExperimentalConfidenceModelValue,
} from "./experimentalForecastConfidence";

const NOW = Date.parse("2026-10-11T06:00:00.000Z");
const VALID_AT = NOW + 60 * 60_000;

function model(
  id: string,
  overrides: Partial<ExperimentalConfidenceModelValue> = {}
): ExperimentalConfidenceModelValue {
  return {
    modelId: id,
    modelName: id,
    value: 12,
    validTime: VALID_AT,
    availableAt: NOW - 60_000,
    horizonMinutes: 60,
    horizonBucket: "0-6h",
    calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_BUCKET",
    calibrationStatus: "CALIBRATED",
    historicalScore: { mae: 1, comparisonCount: 50, evaluatedDays: 12 },
    ...overrides,
  };
}

function confidenceResult(models: ExperimentalConfidenceModelValue[]) {
  return calculateExperimentalForecastConfidence({
    point: {
      validAt: VALID_AT,
      temp: 12,
      precipitation: 0,
      windSpeed: 4,
      weatherCode: 2,
      weighting: {
        variableWeightings: [
          {
            variable: "temperature",
            expectedModelCount: models.length,
            availableModelCount: models.length,
            modelWeights: models,
          },
        ],
      },
    },
    forecastComputedAt: NOW,
    stations: [],
    nowMs: NOW,
  });
}

function findComponent(
  result: ReturnType<typeof confidenceResult>,
  key: string
) {
  return result.components.find(component => component.key === key);
}

describe("calculateExperimentalForecastConfidence — preuve historique qualifiée", () => {
  it("reste non calculable quand aucun modèle aligné n’a de preuve historique qualifiée", () => {
    const result = confidenceResult([
      model("a", { calibrationStatus: "UNCALIBRATED", historicalScore: null }),
      model("b", { calibrationStatus: "CALIBRATED", historicalScore: null }),
    ]);
    const historical = findComponent(result, "historicalPerformance");
    const sampleSize = findComponent(result, "sampleSize");
    expect(historical?.score).toBeNull();
    expect(historical?.reason).toContain("preuve historique qualifiée");
    expect(sampleSize?.score).toBeNull();
    expect(result.status).not.toBe("calculated");
  });

  it("donne un poids aux modèles avec preuve historique qualifiée même si d’autres n’en ont pas", () => {
    const result = confidenceResult([
      model("a"),
      model("b", { calibrationStatus: "UNCALIBRATED", historicalScore: null }),
    ]);
    const historical = findComponent(result, "historicalPerformance");
    expect(historical?.score).toBe(80);
    expect(historical?.reason).toBeNull();
    expect(historical?.evidence).toContain("1/2");
    const sampleSize = findComponent(result, "sampleSize");
    expect(sampleSize?.score).toBe(40);
    expect(sampleSize?.evidence).toContain("1/2");
  });

  it("pondère la MAE par la masse de preuve des modèles qualifiés", () => {
    const result = confidenceResult([
      model("a", {
        historicalScore: { mae: 1, comparisonCount: 100, evaluatedDays: 12 },
      }),
      model("b", {
        historicalScore: { mae: 2, comparisonCount: 300, evaluatedDays: 20 },
      }),
    ]);
    const historical = findComponent(result, "historicalPerformance");
    // MAE pondérée = (1 × 100 + 2 × 300) / 400 = 1,75 °C → 100 × (1 − 1,75/5) = 65.
    expect(historical?.score).toBe(65);
    expect(historical?.evidence).toContain("2/2");
    expect(historical?.evidence).toContain("1.75");
  });

  it("exclut un modèle CALIBRATED dont la MAE ou les effectifs sont invalides", () => {
    const result = confidenceResult([
      model("a"),
      model("b", {
        historicalScore: { mae: null, comparisonCount: 50, evaluatedDays: 12 },
      }),
    ]);
    const historical = findComponent(result, "historicalPerformance");
    expect(historical?.score).toBe(80);
    expect(historical?.evidence).toContain("1/2");
  });

  it("agrège le groupe de base comparable le plus lourd quand les bases diffèrent", () => {
    const result = confidenceResult([
      model("a"),
      model("b", { calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_HORIZON" }),
    ]);
    const historical = findComponent(result, "historicalPerformance");
    const sampleSize = findComponent(result, "sampleSize");
    // Égalité de masse de preuve (50 vs 50) : le premier groupe comparable déclaré l'emporte.
    expect(historical?.score).toBe(80);
    expect(historical?.reason).toBeNull();
    expect(historical?.evidence).toContain("1/2");
    expect(historical?.evidence).toContain("tranche locale commune");
    expect(sampleSize?.score).toBe(40);
  });

  it("monte la version de l’indice expérimental", () => {
    const result = confidenceResult([model("a"), model("b")]);
    expect(result.version).toBe("experimental-v4");
  });
});
