import { describe, expect, it } from "vitest";
import { getExtremeTemperatureTone } from "./extremeTemperatureTone";

describe("intensité visuelle des températures extrêmes", () => {
  it("renforce le maximum aux seuils de chaleur", () => {
    expect(getExtremeTemperatureTone("max", 22).level).toBe("mild");
    expect(getExtremeTemperatureTone("max", 25).level).toBe("warm");
    expect(getExtremeTemperatureTone("max", 30).level).toBe("hot");
    expect(getExtremeTemperatureTone("max", 34).level).toBe("extremeHeat");
  });

  it("renforce le minimum aux seuils de gel", () => {
    expect(getExtremeTemperatureTone("min", 9).level).toBe("cool");
    expect(getExtremeTemperatureTone("min", 3).level).toBe("frostRisk");
    expect(getExtremeTemperatureTone("min", -1).level).toBe("freezing");
    expect(getExtremeTemperatureTone("min", -6).level).toBe("severeFreeze");
  });

  it("conserve une palette sûre lorsque la température est absente", () => {
    expect(getExtremeTemperatureTone("max", null).level).toBe("mild");
    expect(getExtremeTemperatureTone("min", undefined).level).toBe("cool");
  });

  it("dégrade les capsules de gauche, intense, vers la droite, plus légère", () => {
    const maxTone = getExtremeTemperatureTone("max", 29).container;
    const minTone = getExtremeTemperatureTone("min", 8).container;
    expect(maxTone).toContain("from-orange-500/88");
    expect(maxTone).toContain("to-orange-500/14");
    expect(minTone).toContain("from-blue-500/88");
    expect(minTone).toContain("to-sky-500/14");
  });

  it("préserve des libellés et des capsules nets, sans halo diffus", () => {
    const tones = [
      getExtremeTemperatureTone("max", 22),
      getExtremeTemperatureTone("max", 29),
      getExtremeTemperatureTone("max", 34),
      getExtremeTemperatureTone("min", 8),
      getExtremeTemperatureTone("min", 3),
      getExtremeTemperatureTone("min", -6),
    ];

    for (const tone of tones) {
      expect(`${tone.container} ${tone.label} ${tone.value}`).not.toMatch(/(?:drop-)?shadow-\[/);
    }
  });
});
