import { describe, expect, it } from "vitest";
import { buildModelIndicator } from "./modelIndicator";

describe("buildModelIndicator", () => {
  it("identifie le modèle principal à partir des poids réellement appliqués", () => {
    const result = buildModelIndicator({
      parameterSources: {
        temperature: [
          { name: "ECMWF", type: "model", finalWeight: 0.7 },
          { name: "AROME", type: "model", finalWeight: 0.3 },
        ],
        precipitation: [
          { name: "ECMWF", type: "model", finalWeight: 0.5 },
          { name: "AROME", type: "model", finalWeight: 0.5 },
        ],
        wind: [{ name: "ECMWF", type: "model", finalWeight: 1 }],
      },
    });

    expect(result).toMatchObject({ mode: "multi_model", primaryModel: "ECMWF", modelCount: 2 });
    expect(result?.primaryWeight).toBeCloseTo((0.7 + 0.5 + 1) / 3, 8);
  });

  it("ne fabrique pas d’indicateur lorsqu’aucun modèle n’a contribué", () => {
    expect(buildModelIndicator({
      parameterSources: { temperature: [{ name: "Station", type: "station", finalWeight: 1 }] },
    })).toBeNull();
  });
});
