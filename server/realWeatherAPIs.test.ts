import { describe, expect, it } from "vitest";
import { wmoToConditionFr } from "./realWeatherAPIs";

describe("wmoToConditionFr", () => {
  it("aligne les descriptions WMO de ciel avec les catégories de régime", () => {
    expect(wmoToConditionFr(0)).toBe("Ensoleillé");
    expect(wmoToConditionFr(1)).toBe("Peu nuageux");
    expect(wmoToConditionFr(2)).toBe("Partiellement nuageux");
    expect(wmoToConditionFr(3)).toBe("Ciel couvert");
  });
});
