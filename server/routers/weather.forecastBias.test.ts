import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./weather.ts", import.meta.url), "utf8");

describe("déclenchement admin des prévisions officielles", () => {
  it("fusionne les runs capturés et archive les valeurs brutes sans lire ni appliquer le biais station", () => {
    expect(source).not.toContain("applyBiasCorrection");
    expect(source).not.toContain("getQualifiedCumulativeRankingForLocation");
    expect(source).toContain("collectExpertForecastsWithDiagnostics(targetDate)");
    expect(source).toContain("const expertData = dailyCollection.forecasts");
    expect(source).toContain("buildForecastRunArchiveRows(expertData, locationKey, targetDate, issuedAt)");
    expect(source).toContain("officialRuns.flatMap((forecast) => forecast.availableAt");
    expect(source).toContain("computeOfficialDailyForecast(expertData");
    expect(source).toContain("availabilityReasonByModel: dailyCollection.availabilityReasonByModel");
  });
});
