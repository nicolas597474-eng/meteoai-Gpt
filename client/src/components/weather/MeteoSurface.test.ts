import { describe, expect, it } from "vitest";
import { meteoSurfaceClasses } from "./MeteoSurface";

describe("primitives visuelles MeteoAI", () => {
  it("reste fondée sur les couleurs sémantiques existantes", () => {
    expect(meteoSurfaceClasses.default).toContain("border-border");
    expect(meteoSurfaceClasses.default).toContain("bg-card");
    expect(meteoSurfaceClasses.default).toContain("weather-surface");
    expect(meteoSurfaceClasses.accent).toContain("bg-primary/5");
  });

  it("propose des variantes de surface sans logique météo", () => {
    expect(Object.keys(meteoSurfaceClasses)).toEqual(["default", "subtle", "inset", "accent", "lab"]);
    expect(meteoSurfaceClasses.lab).toContain("bg-[#0d131d]");
    expect(meteoSurfaceClasses.lab).toContain("weather-surface-lab");
  });
});
