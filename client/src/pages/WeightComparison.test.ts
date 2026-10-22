import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./WeightComparison.tsx", import.meta.url), "utf8");

describe("WeightComparison", () => {
  it("réinitialise la sélection aux changements de coordonnées et ignore les résultats provisoires", () => {
    expect(source).toContain('const locationKey = coords ? `${coords.lat},${coords.lon}` : "default"');
    expect(source).toContain("setSelection({ locationKey, before: null, after: null })");
    expect(source).toContain("}, [locationKey]);");
    expect(source).toContain("resolveWeightComparisonSelection(history, currentSelection.before, currentSelection.after)");
    expect(source).toContain("const canCompareCurrentLocation = canCompare && !isPlaceholderData");
    expect(source).toContain("historyLoading || isPlaceholderData");
  });
});
