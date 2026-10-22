import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrecipitationConsensusChart } from "./PrecipitationConsensusChart";
import { summarizePrecipitationModels } from "@shared/precipitationConsensus";

const expectedModels = ["AROME", "ARPEGE", "ICON", "ECMWF"];

function renderChart(amounts: Array<number | null>) {
  const summary = summarizePrecipitationModels(
    expectedModels.map((modelName, index) => ({
      modelName,
      amountMm: amounts[index],
    })),
    expectedModels
  );
  return renderToStaticMarkup(
    createElement(PrecipitationConsensusChart, { summary })
  );
}

describe("PrecipitationConsensusChart", () => {
  it("rend la fréquence brute n/N, la disponibilité et les deux quantités sur une échelle en mm distincte", () => {
    const html = renderChart([0.1, 1.5, 0, null]);

    expect(html).toContain(
      "Fréquence des modèles, pas une probabilité calibrée"
    );
    expect(html).toContain("66,7 %");
    expect(html).toContain("Modèles pluvieux / modèles valides :");
    expect(html).toContain("2 / 3");
    expect(html).toContain("3 / 4 modèles attendus disponibles");
    expect(html).toContain("Quantités · échelle indépendante en mm");
    expect(html).toContain("Uniquement parmi les modèles pluvieux");
    expect(html).toContain("0,8 mm");
    expect(html).toContain("Estimation de quantité");
    expect(html).toContain("0,5 mm");
    expect(html).toContain(
      'aria-label="Fréquence des modèles, pas une probabilité calibrée"'
    );
    expect(html).toContain(
      'aria-label="Quantités de pluie, échelle distincte en millimètres"'
    );
    expect(html).not.toContain("0–100 mm");
  });

  it("garde fréquence et quantités indisponibles lorsqu’aucun modèle n’a de valeur valide", () => {
    const html = renderChart([null, null, null, null]);

    expect(html).toContain("Indisponible</strong>");
    expect(html).toContain("0 / 0");
    expect(html).toContain("0 / 4 modèles attendus disponibles");
    expect(html).toContain("Indisponible");
    expect(html).toContain("Aucune quantité valide");
    expect(html).not.toContain("Aucun modèle pluvieux");
    expect(html).not.toContain(
      'aria-label="Fréquence brute des modèles pluvieux"'
    );
    expect(html).not.toContain("0,0 mm");
  });

  it("affiche 0 % et l’estimation partagée à 0 mm si des modèles valides ne prévoient pas de pluie, sans inventer de quantité conditionnelle", () => {
    const html = renderChart([0, 0.099, null, null]);

    expect(html).toContain("0 %");
    expect(html).toContain("0 / 2");
    expect(html).toContain("Aucun modèle pluvieux");
    expect(html).toContain(
      "Aucun modèle pluvieux : aucune quantité conditionnelle"
    );
    expect(html).toContain("Estimation de quantité");
    expect(html).toContain("0,0 mm");
    expect(html).not.toContain(
      'aria-label="Quantité conditionnelle parmi les modèles pluvieux, échelle en millimètres"'
    );
  });

  it("rend un état explicite plutôt qu’une valeur nulle lorsque le résumé entier manque", () => {
    const html = renderToStaticMarkup(
      createElement(PrecipitationConsensusChart, { summary: null })
    );

    expect(html).toContain("Données de fréquence et de quantité indisponibles");
    expect(html).not.toContain("0,0 mm");
    expect(html).not.toContain("0 %");
  });
});
