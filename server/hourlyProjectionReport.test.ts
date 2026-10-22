import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rapport de projection horaire actif", () => {
  it("expose la complétude et l’âge mesuré de la projection courante sans seuil de péremption", () => {
    const source = readFileSync(new URL("./routers/weather.ts", import.meta.url), "utf8");

    expect(source).toContain("getForecastCollectionReport: publicProcedure");
    expect(source).toContain("getStoredHourlyForecasts(locationKey, getParisDate())");
    expect(source).toContain("isCompleteStoredHourlyProjection");
    expect(source).toContain("const projectionMeasuredAt = Date.now()");
    expect(source).toContain("ageMs: Math.max(0, projectionMeasuredAt - projection.collectedAtMs)");
  });
});
