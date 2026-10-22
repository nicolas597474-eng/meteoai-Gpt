import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateExperimentalForecastConfidence } from "@shared/experimentalForecastConfidence";
import { ExperimentalForecastConfidencePanel } from "./ExperimentalForecastConfidencePanel";

const NOW = Date.parse("2026-10-08T06:00:00.000Z");
const VALID_AT = NOW + 60 * 60_000;
const model = (id: string, value: number) => ({
  modelId: id,
  modelName: id,
  value,
  validTime: VALID_AT,
  availableAt: NOW - 60_000,
  horizonMinutes: 60,
  horizonBucket: "0-6h",
  calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_BUCKET",
  calibrationStatus: "CALIBRATED",
  historicalScore: { mae: 1, comparisonCount: 50, evaluatedDays: 12 },
});

function partialResult() {
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
            expectedModelCount: 2,
            availableModelCount: 2,
            modelWeights: [model("a", 10), model("b", 12)],
          },
        ],
      },
    },
    forecastComputedAt: NOW,
    stations: [],
    nowMs: NOW,
  });
}

describe("ExperimentalForecastConfidencePanel", () => {
  it("signale la nature non calibrée, la couverture fixe et l’absence de score partiel", () => {
    const html = renderToStaticMarkup(
      createElement(ExperimentalForecastConfidencePanel, {
        result: partialResult(),
      })
    );
    expect(html).toContain("expérimental / non calibré");
    expect(html).toContain("Score masqué · preuves incomplètes");
    expect(html).toContain("Poids calculable :");
    expect(html).toContain(
      "Cette échelle descriptive n’est ni une probabilité"
    );
    expect(html).toContain("poids 20 %");
    expect(html).toContain("non calculable");
    expect(html).toContain("—/100");
  });
});
