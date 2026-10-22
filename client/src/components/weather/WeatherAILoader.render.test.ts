import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
import { WeatherAILoader } from "./WeatherAILoader";

describe("attente transparente des données météo", () => {
  it("annonce le chargement aux lecteurs d’écran sans afficher de scène ni charger d’image", () => {
    const html = renderToStaticMarkup(
      createElement(WeatherAILoader, { loading: true, message: "Chargement des prévisions" })
    );

    expect(html).toContain('class="sr-only"');
    expect(html).not.toContain("Phase");

    // Les informations accessibles restent présentes
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Chargement des prévisions");

    // Aucune ressource à télécharger : ni image, ni canvas, ni proxy de stockage
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("/textures/");
    expect(html).not.toContain("manus-storage");
    expect(html).not.toContain("earth-globe");
  });

  it("ne rend rien une fois le chargement terminé", () => {
    expect(
      renderToStaticMarkup(createElement(WeatherAILoader, { loading: false }))
    ).toBe("");
  });
});
