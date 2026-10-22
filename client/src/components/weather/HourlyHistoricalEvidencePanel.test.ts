import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HourlyHistoricalEvidencePanel } from "./HourlyHistoricalEvidencePanel";

describe("HourlyHistoricalEvidencePanel coverage indication", () => {
  it("shows a per-variable indicative level separately from historical calibration", () => {
    const html = renderToStaticMarkup(createElement(HourlyHistoricalEvidencePanel, {
      variableWeightings: [
        { variable: "temperature", horizonBucket: "6_24h", contributingModelCount: 1, calibrationStatus: "UNCALIBRATED_ROBUST" },
        { variable: "wind_speed", horizonBucket: "6_24h", contributingModelCount: 2, calibrationStatus: "CALIBRATED" },
      ],
      horizonBucket: "6_24h",
      horizonUnavailableReason: null,
    }));

    expect(html).toContain("Nombre de modèles contributeurs pour cette échéance et variable");
    expect(html).toContain("prévision d’un modèle unique (1 contributeur)");
    expect(html).toContain("effectif limité (2 contributeurs)");
    expect(html).toContain("calibration UNCALIBRATED_ROBUST");
    expect(html).toContain("calibration CALIBRATED");
    expect(html).toContain("L’incertitude statistique n’est pas mesurée ici; la performance historique");
  });
});
