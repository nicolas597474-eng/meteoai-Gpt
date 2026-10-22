import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
import { HistoryChartTooltip } from "@/components/HistoryCharts";

/**
 * Ce module est désormais chargé en différé par la page Historique. Ce test
 * vérifie qu'il s'importe seul (donc que la bibliothèque de graphiques et ses
 * helpers résolvent bien) et que l'infobulle partagée rend son contenu.
 */
describe("HistoryCharts — module de graphiques chargé en différé", () => {
  it("rend l'infobulle accessible et l'écart MeteoAI / observation", () => {
    const html = renderToStaticMarkup(
      createElement(HistoryChartTooltip, {
        active: true,
        label: "2026-10-12",
        unit: "°C",
        payload: [
          { dataKey: "obsMax", name: "Observation", value: 14.2 },
          { dataKey: "meteoAIMax", name: "MeteoAI", value: 15.1 },
        ],
      })
    );

    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Écart MeteoAI / observation");
    expect(html).toContain("+0.9");
    expect(html).toContain("Fermer le détail d’observation");
  });

  it("ne rend rien sans survol actif", () => {
    expect(
      renderToStaticMarkup(
        createElement(HistoryChartTooltip, { active: false, label: "2026-10-12", payload: [] })
      )
    ).toBe("");
  });
});
