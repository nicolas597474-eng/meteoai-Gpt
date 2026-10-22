import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalTemperatureNowcastingPanel } from "./LocalTemperatureNowcastingPanel";

describe("LocalTemperatureNowcastingPanel", () => {
  it("explique le mode shadow, la décroissance et le verrou de production", () => {
    const html = renderToStaticMarkup(React.createElement(LocalTemperatureNowcastingPanel, {
      report: {
        version: "local-temperature-nowcasting-shadow-v1",
        candidateCount: 7,
        statuses: { READY: 6, BASELINE_ONLY: 1, STALE_OBSERVATION: 0, UNAVAILABLE: 0, LEAKAGE_BLOCKED: 0 },
        productionReadsEnabled: 0,
        appliedToProduction: 0,
        shadowModeViolations: 0,
        valid: true,
        latest: {
          locationKey: "50.756_2.521", observationDate: "2026-10-03", observationHour: 8,
          observationReferenceAt: 1_791_008_000_000, observedTemperature: 16.9, stationCount: 3,
          confidenceScore: 85, validTime: 1_791_008_000_000, horizonMinutes: 0,
          candidateStatus: "READY", baselineTemperature: 18.2, rawResidual: -1.3,
          appliedCorrection: -1.3, correctedTemperature: 16.9, correctionFactor: 1,
          correctionClamped: false, forecastAvailableAt: 1_791_004_400_000,
          forecastEvidence: { bestMatchIncluded: false, baselineMode: "seven_model_median_shadow" }, reasons: [], evaluatedAt: 1_791_009_200_000,
        },
      },
    }));
    expect(html).toContain("Correction locale temporaire de température");
    expect(html).toContain("+6 h");
    expect(html).toContain("Pare-feu temporel");
    expect(html).toContain("Médiane 7 modèles · shadow");
    expect(html).toContain("Best Match exclu");
    expect(html).toContain("Production verrouillée");
    expect(html).toContain("16.9 °C");
    expect(html).toContain("Indice descriptif de concordance thermique des stations");
    expect(html).toContain("85/100");
    expect(html).toContain("Ce score n’est ni une probabilité");
    expect(html).toContain("confiance météorologique calibrée");
  });
});
