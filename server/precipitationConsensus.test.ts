import { describe, expect, it } from "vitest";
import { summarizePrecipitationModels } from "../shared/precipitationConsensus";

const expectedModels = ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS"];

describe("summarizePrecipitationModels", () => {
  it("compte le seuil inclusif sur les seules valeurs valides et dérive la quantité du taux brut", () => {
    const summary = summarizePrecipitationModels(
      [
        { modelName: "AROME", amountMm: 0 },
        { modelName: "ARPEGE", amountMm: 0.1 },
        { modelName: "ICON", amountMm: 0.05 },
        { modelName: "ECMWF", amountMm: 0.4 },
        { modelName: "GFS", amountMm: null },
        { modelName: "UKMET", amountMm: 20 },
        { modelName: "ARPEGE", amountMm: 99 },
      ],
      expectedModels
    );

    expect(summary).toMatchObject({
      thresholdMm: 0.1,
      expectedModelCount: 5,
      availableModelCount: 4,
      rainModelCount: 2,
      frequencyPercent: 50,
      conditionalMeanMm: 0.25,
      conditionalMeanMethod: "arithmetic_mean",
      consensusEstimateMm: 0.125,
      modelsExpected: expectedModels,
      modelsWithData: ["AROME", "ARPEGE", "ICON", "ECMWF"],
      modelsPredictingRain: ["ARPEGE", "ECMWF"],
      isProbabilityCalibrated: false,
    });
    expect(summary.modelValues).toEqual([
      { modelName: "AROME", amountMm: 0, predictsRain: false },
      { modelName: "ARPEGE", amountMm: 0.1, predictsRain: true },
      { modelName: "ICON", amountMm: 0.05, predictsRain: false },
      { modelName: "ECMWF", amountMm: 0.4, predictsRain: true },
    ]);
    expect(summary.consensusEstimateMm).toBeCloseTo(
      (summary.rainModelCount / summary.availableModelCount) *
        summary.conditionalMeanMm!,
      12
    );
  });

  it("ne transforme ni les valeurs absentes ni les modèles sans pluie en probabilités ou en fausses quantités", () => {
    const unavailable = summarizePrecipitationModels(
      [
        { modelName: "AROME", amountMm: null },
        { modelName: "ARPEGE", amountMm: Number.NaN },
        { modelName: "ICON", amountMm: -0.1 },
      ],
      expectedModels
    );
    const allDry = summarizePrecipitationModels(
      [
        { modelName: "AROME", amountMm: 0 },
        { modelName: "ARPEGE", amountMm: 0.099 },
      ],
      expectedModels
    );

    expect(unavailable).toMatchObject({
      availableModelCount: 0,
      rainModelCount: 0,
      frequencyPercent: null,
      conditionalMeanMm: null,
      consensusEstimateMm: null,
      isProbabilityCalibrated: false,
    });
    expect(allDry).toMatchObject({
      availableModelCount: 2,
      rainModelCount: 0,
      frequencyPercent: 0,
      conditionalMeanMm: null,
      consensusEstimateMm: 0,
      isProbabilityCalibrated: false,
    });
  });

  it("utilise un conditionnel pondéré uniquement lorsqu’il est fourni explicitement", () => {
    const summary = summarizePrecipitationModels(
      [
        { modelName: "AROME", amountMm: 0 },
        { modelName: "ARPEGE", amountMm: 1 },
        { modelName: "ICON", amountMm: 3 },
        { modelName: "ECMWF", amountMm: 0 },
      ],
      expectedModels,
      {
        conditionalMeanMm: 2.5,
        conditionalMeanMethod: "historical_skill",
      }
    );

    expect(summary.frequencyPercent).toBe(50);
    expect(summary.conditionalMeanMm).toBe(2.5);
    expect(summary.conditionalMeanMethod).toBe("historical_skill");
    expect(summary.consensusEstimateMm).toBe(1.25);
    expect(summary.isProbabilityCalibrated).toBe(false);
  });
});
