import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("WeatherStatusBadge", () => {
  it("expose des variantes sémantiques et une animation respectueuse des préférences utilisateur", () => {
    const source = readFileSync(new URL("./WeatherStatusBadge.tsx", import.meta.url), "utf8");
    expect(source).toContain('"info" | "success" | "warning" | "lab" | "neutral" | "danger"');
    expect(source).toContain("motion-safe:animate-pulse");
    expect(source).toContain("data-weather-status-badge");
    expect(source).toContain("aria-label");
    expect(source).toContain("PopoverContent");
    expect(source).toContain("collisionPadding={12}");
    expect(source).toContain("Ouvrir l’aide");
    expect(source).toContain("PopoverClose");
    expect(source).toContain("Fermer l’aide");
    expect(source).toContain("h-2 w-2 shrink-0 opacity-55");
    expect(source).toContain("À propos de cet indicateur");
    expect(source).toContain("description?: string");
  });
});
