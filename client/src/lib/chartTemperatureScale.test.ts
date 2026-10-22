import { describe, expect, it } from "vitest";
import { getChartTemperatureScale } from "./chartTemperatureScale";
import { getLabelAboveCurveY, TEMPERATURE_LABEL_ABOVE_GAP } from "./chartLabelLanes";

describe("getChartTemperatureScale", () => {
  it("conserve des graduations de dix degrés pour une plage positive", () => {
    expect(getChartTemperatureScale([12, 23], 2)).toMatchObject({
      scaleBot: 10,
      scaleTop: 30,
      ticks: [10, 20, 30],
    });
  });

  it("étend automatiquement l’échelle sous zéro pour des températures négatives simulées", () => {
    expect(getChartTemperatureScale([-12, -6, -1], 2)).toMatchObject({
      scaleBot: -20,
      scaleTop: 10,
      ticks: [-20, -10, 0, 10],
    });
  });

  it("couvre les deux côtés de zéro pour une plage hivernale mixte", () => {
    expect(getChartTemperatureScale([-4, 12], 3)).toMatchObject({
      scaleBot: -10,
      scaleTop: 20,
      ticks: [-10, 0, 10, 20],
    });
  });

  it("conserve 42 degrés dans la courbe avec une étiquette maximale séparée", () => {
    const scale = getChartTemperatureScale([17, 42], 3);
    const tempZoneTop = 82;
    const tempCurveTop = tempZoneTop + 34;
    const tempZoneBot = 82 + (310 - 82) * 0.55;
    const pointY = tempCurveTop
      + (1 - (42 - scale.scaleBot) / scale.scaleRange) * (tempZoneBot - tempCurveTop);
    const labelY = getLabelAboveCurveY(pointY, tempZoneTop, TEMPERATURE_LABEL_ABOVE_GAP);

    expect(scale).toMatchObject({
      scaleBot: 10,
      scaleTop: 50,
      ticks: [10, 20, 30, 40, 50],
    });
    expect(pointY).toBeGreaterThanOrEqual(tempCurveTop);
    expect(labelY).toBeLessThan(pointY);
    expect(pointY - labelY).toBeGreaterThanOrEqual(TEMPERATURE_LABEL_ABOVE_GAP);
  });
});
