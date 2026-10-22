import { describe, expect, it } from "vitest";
import { getFeltLabelY, getLabelAboveCurveY, getLabelBelowCurveY } from "./chartLabelLanes";

describe("chartLabelLanes", () => {
  it("conserve les libellés de maximum sous la zone d’en-tête lors de températures extrêmes", () => {
    expect(getLabelAboveCurveY(86, 82)).toBe(100);
    expect(getLabelAboveCurveY(150, 82)).toBe(122);
  });

  it("place le ressenti sous sa courbe avec une marge avant le vent", () => {
    const minLabelY = getLabelBelowCurveY(219, 82, 230);
    const feltLabelY = getLabelBelowCurveY(190, 82, 230, 12, 20);

    expect(minLabelY).toBeLessThanOrEqual(210);
    expect(feltLabelY).toBe(202);
    expect(feltLabelY).toBeLessThanOrEqual(210);
  });
});
