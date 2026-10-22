import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/MeteoIcon", () => ({ MeteoIcon: () => null }));
vi.stubGlobal("React", React);
import { AlertBadge, isDangerousRegime } from "./AlertBadge";

describe("AlertBadge — indicateur heuristique de régime", () => {
  it("n’affiche pas le signal de verglas en l’absence de preuve de phase", () => {
    expect(isDangerousRegime("freezing_rain")).toBe(false);
    expect(
      renderToStaticMarkup(
        createElement(AlertBadge, {
          regimeId: "freezing_rain",
          regimeScore: 100,
        })
      )
    ).toBe("");
    expect(isDangerousRegime("freezing_rain", true)).toBe(true);
    expect(
      renderToStaticMarkup(
        createElement(AlertBadge, {
          regimeId: "freezing_rain",
          regimeScore: 100,
          freezingRainPhaseConfirmed: true,
        })
      )
    ).toContain("Signal de régime · Verglas");
  });

  it("ne transforme pas le régime hivernal à phase incertaine en alerte dangereuse", () => {
    expect(isDangerousRegime("winter_precipitation_uncertain")).toBe(false);
    expect(
      renderToStaticMarkup(
        createElement(AlertBadge, {
          regimeId: "winter_precipitation_uncertain",
          regimeScore: 100,
        })
      )
    ).toBe("");
  });

  it("ne traite pas une vague de froid ponctuelle comme une alerte", () => {
    expect(isDangerousRegime("cold_wave")).toBe(false);
    expect(
      renderToStaticMarkup(
        createElement(AlertBadge, {
          regimeId: "cold_wave",
          regimeScore: 100,
        })
      )
    ).toBe("");
  });

  it("évite de présenter le signal comme une alerte ou une confiance météo calibrée", () => {
    const html = renderToStaticMarkup(
      createElement(AlertBadge, {
        regimeId: "storm",
        regimeScore: 60,
      })
    );

    expect(html).toContain("Signal de régime · Tempête");
    expect(html).not.toContain("Alerte");
    expect(html).toContain("Score de régime heuristique non calibré");
    expect(html).toContain("ni une probabilité ni une confiance météorologique");
  });

  it("conserve le seuil interne par défaut de 60", () => {
    expect(
      renderToStaticMarkup(
        createElement(AlertBadge, {
          regimeId: "storm",
          regimeScore: 59,
        })
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        createElement(AlertBadge, {
          regimeId: "storm",
          regimeScore: 60,
        })
      )
    ).toContain("Signal de régime · Tempête");
  });
});
