import { describe, expect, it } from "vitest";
import { drawTemperatureCurveSegments, getTemperatureTone } from "./chartTemperatureTone";

function canvasContext() {
  let gradientCount = 0;
  const context = {
    createLinearGradient: () => {
      gradientCount += 1;
      return { addColorStop: () => undefined };
    },
    beginPath: () => undefined,
    moveTo: () => undefined,
    bezierCurveTo: () => undefined,
    stroke: () => undefined,
  } as unknown as CanvasRenderingContext2D;
  return { context, gradientCount: () => gradientCount };
}

describe("getTemperatureTone", () => {
  it("préserve la couleur normale à 35 °C et à 0 °C", () => {
    expect(getTemperatureTone(35, "maximum").status).toBe("normal");
    expect(getTemperatureTone(0, "minimum").status).toBe("normal");
  });

  it("bascule vers la couleur chaude uniquement au-dessus de 35 °C", () => {
    const tone = getTemperatureTone(35.1, "hourly");
    expect(tone).toMatchObject({ status: "heat", stroke: "#f43f5e", label: "#fecdd3" });
  });

  it("bascule vers la couleur de gel uniquement sous 0 °C", () => {
    const tone = getTemperatureTone(-0.1, "minimum");
    expect(tone).toMatchObject({ status: "frost", stroke: "#22d3ee", label: "#cffafe" });
  });

  it("ne trace pas de segment à travers une température inconnue, mais conserve un vrai zéro", () => {
    const points = [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }];
    const missing = canvasContext();
    drawTemperatureCurveSegments(missing.context, points, [10, null, 12], "hourly");
    expect(missing.gradientCount()).toBe(0);

    const zero = canvasContext();
    drawTemperatureCurveSegments(zero.context, points, [10, 0, 12], "hourly");
    expect(zero.gradientCount()).toBe(4);
  });
});
