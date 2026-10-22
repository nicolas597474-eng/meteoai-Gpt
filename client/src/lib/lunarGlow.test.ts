import { describe, expect, it } from "vitest";
import { getLunarGlowStrength } from "./lunarGlow";

describe("getLunarGlowStrength", () => {
  it("réduit progressivement la lueur lorsque la couverture nuageuse observée augmente", () => {
    expect(getLunarGlowStrength(0)).toEqual({ opacity: 0.42, cloudCover: 0 });
    expect(getLunarGlowStrength(50)).toEqual({ opacity: 0.25, cloudCover: 50 });
    expect(getLunarGlowStrength(100)).toEqual({ opacity: 0.08, cloudCover: 100 });
  });

  it("conserve une lueur neutre lorsque la nébulosité est indisponible", () => {
    expect(getLunarGlowStrength(null)).toEqual({ opacity: 0.22, cloudCover: null });
  });
});
