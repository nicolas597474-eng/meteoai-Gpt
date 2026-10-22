import { describe, expect, it } from "vitest";
import { aggregateForecastCondition } from "./weatherConditionAggregation";

describe("aggregateForecastCondition", () => {
  it("returns unavailable when no forecast has finite precipitation or cloud cover", () => {
    expect(aggregateForecastCondition([])).toBe("Conditions indisponibles");
    expect(aggregateForecastCondition([
      { precipitation: null, cloudCover: null },
      { precipitation: Number.NaN, cloudCover: Number.NaN },
    ])).toBe("Conditions indisponibles");
  });

  it("preserves real zeros and averages only values that were actually received", () => {
    expect(aggregateForecastCondition([
      { precipitation: 0, cloudCover: 0 },
      { precipitation: null, cloudCover: null },
    ])).toBe("Ensoleillé");
    expect(aggregateForecastCondition([
      { precipitation: 0, cloudCover: null },
      { precipitation: 2, cloudCover: null },
    ])).toBe("Pluie légère");
    expect(aggregateForecastCondition([
      { precipitation: null, cloudCover: 100 },
      { precipitation: null, cloudCover: null },
    ])).toBe("Ciel couvert");
  });
});
