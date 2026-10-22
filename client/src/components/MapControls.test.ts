import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("contrôles cartographiques partagés", () => {
  it("expose les commandes tactiles et la signature visuelle commune", () => {
    const source = readFileSync(new URL("./MapControls.tsx", import.meta.url), "utf8");

    expect(source).toContain("ariaLabel = \"Zoom manuel de la carte\"");
    expect(source).toContain('aria-label="Zoomer"');
    expect(source).toContain('aria-label="Dézoomer"');
    expect(source).toContain('aria-label="Type de carte"');
    expect(source).toContain("bg-[#0d1117]/90");
    expect(source).toContain("border-white/20");
    expect(source).toContain("bg-sky-400/20");
    expect(source).toContain("rounded-2xl");
    expect(source).toContain("active:scale-[0.97]");
    expect(source).toContain("h-14 w-12");
    expect(source).not.toContain("h-14 w-14");
    expect(source).toContain("ariaLabel = \"Zoom manuel de la carte\"");
  });
});
