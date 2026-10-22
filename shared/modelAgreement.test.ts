import { describe, expect, it } from "vitest";
import { summarizeDailyModelAgreement } from "./modelAgreement";

describe("summarizeDailyModelAgreement", () => {
  it("calcule les statistiques des valeurs reçues en excluant les agrégateurs, sans garantir de cycle commun", () => {
    const result = summarizeDailyModelAgreement([
      { modelName: "ECMWF", tempMax: 20, precipitation: 0, windSpeed: 18 },
      { modelName: "GFS", tempMax: 22, precipitation: 1.2, windSpeed: 24, windGust: 30 },
      { modelName: "ICON", tempMax: 21, precipitation: 0.4, windSpeed: 20, windGust: 34 },
      { modelName: "Open-Meteo", tempMax: 99, precipitation: 99, windSpeed: 99 },
      { modelName: "Unknown", tempMax: 50, precipitation: 50, windSpeed: 50 },
    ], ["ECMWF", "GFS", "ICON"], 2);

    expect(result.bestMatchIncluded).toBe(false);
    expect(result.expectedModelCount).toBe(3);
    expect(result.requestDayOffset).toBe(2);
    expect(result.modelIssueTimeAvailable).toBe(false);
    expect(result.commonRunVerified).toBe(false);
    expect(result.statisticsBasis).toBe("received_values_for_target_day");
    expect(result.tempMax.standardDeviation).toBeCloseTo(Math.sqrt(2/3));
    expect(result.horizonUnavailableReason).toBe("run_issue_time_missing");
    expect(result.tempMax).toMatchObject({ min: 20, max: 22, mean: 21, range: 2, availableModelCount: 3, modelsWithData: ["ECMWF", "ICON", "GFS"] });
    expect(result.precipitation).toMatchObject({ min: 0, max: 1.2, range: 1.2, availableModelCount: 3 });
    expect(result.precipitationOccurrence).toMatchObject({ thresholdMm: 0.1, rainModelCount: 2, availableModelCount: 3, expectedModelCount: 3 });
    expect(result.precipitationWetAmounts).toMatchObject({ min: .4, max: 1.2, mean: .8, availableModelCount: 2 });
    expect(result.windSpeed).toMatchObject({ range: 6, availableModelCount: 3 });
    expect(result.windGust).toMatchObject({ range: 4, availableModelCount: 2 });
    expect(result.tempMax.modelsWithData).toEqual(["ECMWF", "ICON", "GFS"]);
  });

  it("n’invente pas une dispersion lorsque zéro ou un modèle a une valeur", () => {
    const noValues = summarizeDailyModelAgreement([{ modelName: "ECMWF", tempMax: null }], ["ECMWF", "GFS"], null);
    const oneValue = summarizeDailyModelAgreement([{ modelName: "ECMWF", tempMax: 0, precipitation: 0.5 }], ["ECMWF", "GFS"], null);
    expect(noValues.tempMax).toMatchObject({ min: null, max: null, range: null, standardDeviation: null, availableModelCount: 0 });
    expect(oneValue.tempMax).toMatchObject({ min: 0, max: 0, mean: 0, range: null, standardDeviation: null, availableModelCount: 1 });
    expect(oneValue.precipitationWetAmounts).toMatchObject({ min: .5, max: .5, mean: .5, range: null, standardDeviation: null, availableModelCount: 1 });
    expect(oneValue.precipitationOccurrence).toMatchObject({ rainModelCount: 1, availableModelCount: 1, expectedModelCount: 2 });
    expect(noValues.requestDayOffset).toBeNull();
  });
});
