import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("BackToTopButton", () => {
  it("reste discret, accessible et remonte fluidement au début de page", () => {
    const source = readFileSync(new URL("./BackToTopButton.tsx", import.meta.url), "utf8");
    expect(source).toContain("window.scrollY > 360");
    expect(source).toContain('behavior: "smooth"');
    expect(source).toContain('aria-label="Retourner au début de la page"');
    expect(source).toContain("!h-11 !w-11");
    expect(source).toContain("aspect-square");
    expect(source).toContain("!rounded-full");
  });
});
