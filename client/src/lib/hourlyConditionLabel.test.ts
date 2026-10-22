import { describe, expect, it } from "vitest";
import { getHourlyConditionLabel } from "./hourlyConditionLabel";

describe("getHourlyConditionLabel", () => {
  it("preserves a supplied WMO condition even when cloud cover suggests another label", () => {
    expect(getHourlyConditionLabel(95, 0, "Partiellement nuageux")).toBe(
      "Partiellement nuageux"
    );
    expect(getHourlyConditionLabel(10, 0, "Ciel couvert")).toBe("Ciel couvert");
  });

  it("derives a label from known precipitation or cloud cover only", () => {
    expect(getHourlyConditionLabel(90, 0, null)).toBe("Ciel couvert");
    expect(getHourlyConditionLabel(20, 2, null)).toBe("Averses");
    expect(getHourlyConditionLabel(null, 0, null)).toBe("Nébulosité indisponible");
    expect(getHourlyConditionLabel(null, null, null)).toBe("Conditions indisponibles");
  });
});
