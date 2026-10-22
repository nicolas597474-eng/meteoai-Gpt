import { describe, expect, it } from "vitest";
import { buildModelReferenceCoherence } from "./modelReferenceCoherence";

describe("cohérence des références de modèles", () => {
  const references = [
    { id: "arome", name: "AROME", temperature: 20, humidity: null, pressure: null, windSpeed: null, windGust: null, windDirection: null, precipitation: null, updatedAt: null },
    { id: "ecmwf", name: "ECMWF", temperature: 23, humidity: null, pressure: null, windSpeed: null, windGust: null, windDirection: null, precipitation: null, updatedAt: null },
  ];

  it("favorise visuellement la référence la plus cohérente avec la station locale et l’ensemble", () => {
    const result = buildModelReferenceCoherence(references, [20.2]);
    expect(result[0]).toMatchObject({ id: "arome", coherenceStatus: "measured", localDeltaC: -0.2 });
    expect(result[0].coherenceWeight).toBeGreaterThan(result[1].coherenceWeight ?? 0);
  });

  it("ne produit aucun poids de cohérence sans observation physique locale", () => {
    const result = buildModelReferenceCoherence(references, []);
    expect(result.map((reference) => reference.coherenceWeight)).toEqual([null, null]);
    expect(result.every((reference) => reference.coherenceStatus === "unavailable")).toBe(true);
  });
});
