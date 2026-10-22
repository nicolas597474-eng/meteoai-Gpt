import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  new URL("../index.css", import.meta.url),
  "utf8"
);

describe("styles de l’atmosphère météo du Dashboard", () => {
  const start = stylesheet.indexOf(
    "/* Effets atmosphériques météo 3D du Dashboard"
  );
  const end = stylesheet.indexOf(
    "/* Habillage cohérent des pages météo",
    start + 4
  );
  const atmosphereStyles = stylesheet.slice(start, end < 0 ? undefined : end);

  it("ne capte pas les interactions et conserve une couche non intrusive", () => {
    expect(atmosphereStyles).toContain("pointer-events: none");
    expect(atmosphereStyles).toContain("position: fixed");
    expect(atmosphereStyles).not.toContain(
      "dashboard-weather-atmosphere__water-bead"
    );
  });

  it("anime les phénomènes uniquement si l’utilisateur accepte les mouvements", () => {
    expect(atmosphereStyles).toContain(
      "@media (prefers-reduced-motion: no-preference)"
    );
    expect(atmosphereStyles).toContain("dashboard-weather-atmosphere__rain-drop");
    expect(atmosphereStyles).toContain("dashboard-weather-atmosphere__cloud");
    expect(atmosphereStyles).toContain("dashboard-weather-atmosphere__dust-particle");
    expect(atmosphereStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(atmosphereStyles).toContain("@media (max-width: 640px)");
    expect(atmosphereStyles).toContain('data-effects-mode="reduced"');
    expect(atmosphereStyles).toContain("var(--rain-drift, 2vw)");
    expect(atmosphereStyles).toContain("dashboard-weather-frost-breathe");
    expect(atmosphereStyles).toContain(":not(.dashboard-weather-atmosphere__wash)");
    expect(atmosphereStyles).toContain("dashboard-weather-atmosphere__snowflake");
    expect(atmosphereStyles).toContain("dashboard-weather-atmosphere__hail-canvas");
    expect(atmosphereStyles).toContain('data-hail-renderer="webgl"');
    expect(atmosphereStyles).toContain(
      "dashboard-weather-atmosphere__hail-layer:not(.dashboard-weather-atmosphere__wash)"
    );
    expect(atmosphereStyles).toContain("var(--cloud-far-opacity");
    expect(atmosphereStyles).toContain("var(--hail-drift-x");
    expect(atmosphereStyles).toContain("var(--wind-drift-x");
  });

  it("applique un traitement givré aux blocs sans dépendre d’une nouvelle donnée", () => {
    expect(stylesheet).toMatch(
      /\.dashboard-weather-page:has\(\s*\.dashboard-weather-atmosphere\[data-weather-atmosphere="ice"\]\s*\)\s*\.dashboard-sky-card/
    );
    expect(atmosphereStyles).toContain("dashboard-weather-atmosphere__ice-film");
    expect(atmosphereStyles).toContain("dashboard-weather-atmosphere__ice-crystal");
  });
});
