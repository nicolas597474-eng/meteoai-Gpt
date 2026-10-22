import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("weather.getStationReliabilityOverview", () => {
  it("compare les stations au moteur horaire qualifié à sept modèles, sans Best Match ni projection locale", () => {
    // Le modèle de lecture a migré du routeur vers server/stationReliabilityOverview.ts :
    // les invariants portent désormais sur le module qui le porte.
    const source = readFileSync(new URL("../stationReliabilityOverview.ts", import.meta.url), "utf8");

    expect(source).toContain("getHourlyForecastRunValues(locationKey, date)");
    expect(source).toContain("reconstructOfficialHourlyModelsFromArchive(hourlyRunValues, date)");
    expect(source).toContain("getHourlyForecastEvaluationHistory(");
    expect(source).toContain("computeOfficialHourlyForecast(");
    expect(source).toContain("reconstructHistoricalOfficialHours(");
    expect(source).toContain("buildStationForecastComparison24h(date, historicalHours");
    expect(source).toContain("officialHourlyWeighting: officialHourlyForecast.weighting");
    expect(source).not.toContain('modelName === "best_match"');
    expect(source).not.toContain("getStoredHourlyForecasts");
  });
});

describe("weather.getLocalOfficialDeltaHistory", () => {
  it("utilise les archives horaires immuables et des valeurs déjà pondérées, jamais best_match", () => {
    const source = readFileSync(new URL("./weather.ts", import.meta.url), "utf8");
    const start = source.indexOf("getLocalOfficialDeltaHistory: publicProcedure");
    const end = source.indexOf("compareWeightSnapshots: publicProcedure", start);
    const procedure = source.slice(start, end);

    expect(procedure).toContain("getHourlyForecastRunValues(locationKey, today)");
    expect(procedure).toContain("getHourlyForecastRunValues(locationKey, yesterday)");
    expect(procedure).toContain("reconstructHistoricalOfficialTemperatures(readings,");
    expect(procedure).toContain("selectOfficialHourlyTemperaturesBeforeLocalMeasurements(readings, candidates)");
    expect(procedure).toContain("buildLocalOfficialDeltaHistory(readings, selectedOfficialHourlyTemperaturePoints(selections))");
    expect(procedure).not.toContain("getStoredHourlyForecasts");
    expect(procedure).not.toContain('modelName === "best_match"');
  });
});
