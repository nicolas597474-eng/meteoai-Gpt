import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("historique d’anomalies dans les favoris", () => {
  it("lit le cache avant calculateUltraLocal et ne réécrit pas le même snapshot après fusion", () => {
    const source = readFileSync(new URL("./favorites.ts", import.meta.url), "utf8");
    const historyRead = source.indexOf("const previousReadings = getPreviousReadings();");
    const localCalculation = source.indexOf("const ultraLocalResult = calculateUltraLocal(");
    const fusion = source.indexOf("const advancedFusion = computeFusion(");

    expect(historyRead).toBeGreaterThanOrEqual(0);
    expect(historyRead).toBeLessThan(localCalculation);
    expect(historyRead).toBeLessThan(fusion);
    expect(source).not.toContain("recordStationReadings(");
  });
});
