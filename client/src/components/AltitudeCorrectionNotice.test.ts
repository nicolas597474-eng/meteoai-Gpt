import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AltitudeCorrectionNotice } from "./AltitudeCorrectionNotice";

describe("état de correction d’altitude dans le contexte local", () => {
  it("annonce l’ajustement uniquement quand des stations ont une altitude exploitable", () => {
    const markup = renderToStaticMarkup(createElement(AltitudeCorrectionNotice, {
      correction: { applied: true, reason: "adjustment_applied" },
    }));

    expect(markup).toContain("Correction d’altitude appliquée");
    expect(markup).toContain("altitude est connue");
  });

  it("présente une cible absente comme non vérifiable et les relevés de station comme bruts", () => {
    const markup = renderToStaticMarkup(createElement(AltitudeCorrectionNotice, {
      correction: { applied: false, reason: "reference_altitude_unavailable" },
    }));

    expect(markup).toContain("non vérifiable");
    expect(markup).toContain("altitude cible inconnue");
    expect(markup).toContain("relevés de stations sont conservés bruts");
  });

  it("masque l’état d’un ancien lieu pendant le chargement de données provisoires", () => {
    const markup = renderToStaticMarkup(createElement(AltitudeCorrectionNotice, {
      correction: { applied: false, reason: "reference_altitude_unavailable" },
      isPlaceholderData: true,
    }));

    expect(markup).toBe("");
  });

  it("ne revendique aucun effet quand les altitudes sont égales", () => {
    const markup = renderToStaticMarkup(createElement(AltitudeCorrectionNotice, {
      correction: { applied: false, reason: "no_altitude_difference" },
    }));

    expect(markup).toContain("Aucun écart d’altitude à corriger");
    expect(markup).toContain("températures sont inchangées");
  });
});
