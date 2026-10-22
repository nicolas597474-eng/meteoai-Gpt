import { describe, expect, it } from "vitest";
import { getForecastRunDisplayStatus } from "./forecastRunSummary";

describe("statut de présentation d’un batch forecast", () => {
  it("affiche un succès complet lorsque les deux couvertures persistées sont complètes", () => {
    expect(getForecastRunDisplayStatus({
      status: "completed",
      dailyModelsCollected: 16,
      dailyModelsExpected: 16,
      hourlyModelsCollected: 16,
      hourlyModelsExpected: 16,
    })).toBe("completed");
  });

  it("affiche un statut partiel si un lot a des erreurs ou une couverture incomplète", () => {
    expect(getForecastRunDisplayStatus({
      status: "completed",
      dailyModelsCollected: 8,
      dailyModelsExpected: 16,
      hourlyModelsCollected: 16,
      hourlyModelsExpected: 16,
    })).toBe("partial");
    expect(getForecastRunDisplayStatus({ status: "completed", errorMessage: "one location failed" })).toBe("partial");
  });

  it("préserve échec, exécution en cours et les anciens lots sans compteurs", () => {
    expect(getForecastRunDisplayStatus({ status: "failed" })).toBe("failed");
    expect(getForecastRunDisplayStatus({ status: "running" })).toBe("running");
    expect(getForecastRunDisplayStatus({ status: "completed" })).toBe("completed");
  });
});
