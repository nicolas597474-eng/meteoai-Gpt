import { describe, expect, it } from "vitest";
import { clampLunarIllumination, getLunarShadowPath, getLunarShadowTransform } from "./lunarPhaseVisual";

describe("rendu géométrique de la phase lunaire", () => {
  it("borne l’éclairage entre 0 et 100 sans laisser passer NaN", () => {
    expect(clampLunarIllumination(-5)).toBe(0);
    expect(clampLunarIllumination(85)).toBe(85);
    expect(clampLunarIllumination(120)).toBe(100);
    expect(clampLunarIllumination(Number.NaN)).toBe(0);
  });

  it("dessine une limite courbe correspondant à 85 % d’éclairage, plutôt qu’un secteur conique", () => {
    const path = getLunarShadowPath(85);
    expect(path).toContain("A 35 50");
    expect(path).toContain("A 50 50 0 0 0");
    expect(path).not.toContain("L 50 50");
  });

  it("place le terminateur à la moitié du disque au quartier et inverse le côté ombré après la pleine lune", () => {
    expect(getLunarShadowPath(50)).toContain("A 0 50 0 0 0");
    expect(getLunarShadowPath(15)).toContain("A 35 50 0 0 0 50 0");
    expect(getLunarShadowPath(85)).toContain("A 35 50 0 0 1 50 0");
    expect(getLunarShadowPath(100)).toBeNull();
  });

  it("couvre la nouvelle lune, les quartiers et les phases croissantes ou décroissantes", () => {
    expect(getLunarShadowPath(0)).toContain("A 50 50 0 0 0 50 0");
    expect(getLunarShadowPath(25)).toContain("A 25 50 0 0 0 50 0");
    expect(getLunarShadowPath(50)).toContain("A 0 50 0 0 0 50 0");
    expect(getLunarShadowPath(75)).toContain("A 25 50 0 0 1 50 0");
    expect(getLunarShadowPath(100)).toBeNull();
  });

  it("oriente le limbe éclairé selon l’angle calculé localement", () => {
    expect(getLunarShadowTransform(41.3)).toBe("rotate(228.7 50 50)");
    expect(getLunarShadowTransform(90)).toBe("rotate(180 50 50)");
    expect(getLunarShadowTransform(244.8)).toBe("rotate(25.2 50 50)");
    expect(getLunarShadowTransform(234.4)).toBe("rotate(35.6 50 50)");
    expect(getLunarShadowTransform(42.4)).toBe("rotate(227.6 50 50)");
    expect(getLunarShadowTransform(97.5)).toBe("rotate(172.5 50 50)");
    expect(getLunarShadowTransform(0)).toBe("rotate(270 50 50)");
  });
});
