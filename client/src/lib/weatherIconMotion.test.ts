import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("animations des icônes météo", () => {
  it("n’anime les pictogrammes que si l’utilisateur n’a pas demandé moins de mouvement", () => {
    const firstIconRule = stylesheet.indexOf(".meteo-icon-motion-ambient");
    const motionPreferenceStart = stylesheet.lastIndexOf("@media (prefers-reduced-motion: no-preference)", firstIconRule);
    const motionBlockEnd = stylesheet.indexOf("\n}", motionPreferenceStart);
    const motionBlock = stylesheet.slice(motionPreferenceStart, motionBlockEnd);

    expect(motionPreferenceStart).toBeGreaterThanOrEqual(0);
    expect(motionBlock).toContain(".meteo-icon-motion-sun");
    expect(motionBlock).toContain(".meteo-icon-motion-cloud");
    expect(motionBlock).toContain(".meteo-icon-motion-rain");
    expect(motionBlock).toContain(".meteo-icon-motion-storm");
    expect(motionBlock).toContain(".meteo-icon-motion-snow");
    expect(motionBlock).toContain(".meteo-icon-motion-fog");
  });
});
