import { describe, expect, it } from "vitest";
import { circularDifferenceDegrees, circularMeanDegrees } from "./weatherServices";

describe("circularMeanDegrees", () => {
  it("préserve la proximité de directions autour du nord", () => {
    expect(circularMeanDegrees([350, 10])).toBe(0);
  });

  it("ignore les directions non finies et retourne null sans donnée exploitable", () => {
    expect(circularMeanDegrees([90, Number.NaN, Number.POSITIVE_INFINITY])).toBe(90);
    expect(circularMeanDegrees([Number.NaN])).toBeNull();
  });
});

describe("circularDifferenceDegrees", () => {
  it("mesure le plus court écart autour du nord", () => {
    expect(circularDifferenceDegrees(350, 10)).toBe(20);
    expect(circularDifferenceDegrees(10, 350)).toBe(20);
  });

  it("retourne null lorsqu’une direction manque", () => {
    expect(circularDifferenceDegrees(null, 90)).toBeNull();
  });
});
