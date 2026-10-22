import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildLocalPrecipitationVerificationReport } from "@shared/localPrecipitationNowcastVerification";
import { LocalPrecipitationNowcastingPanel } from "./LocalPrecipitationNowcastingPanel";

const emptyStatuses = { WET_SIGNAL: 0, BASELINE_WET: 0, BASELINE_DRY: 0, STALE_OBSERVATION: 0, UNAVAILABLE: 0, LEAKAGE_BLOCKED: 0 };

function renderPanel(verification?: ReturnType<typeof buildLocalPrecipitationVerificationReport>, latest: Record<string, unknown> | null = null) {
  return renderToStaticMarkup(React.createElement(LocalPrecipitationNowcastingPanel, {
    report: {
      version: "local-precipitation-nowcasting-shadow-v1",
      candidateCount: latest ? 3 : 0,
      statuses: latest
        ? { ...emptyStatuses, WET_SIGNAL: 1, BASELINE_DRY: 2 }
        : emptyStatuses,
      productionReadsEnabled: 0,
      appliedToProduction: 0,
      shadowModeViolations: 0,
      valid: true,
      verification,
      latest,
    } as never,
  }));
}

describe("LocalPrecipitationNowcastingPanel", () => {
  it("explique le signal de référence, les limites d’accumulation et le verrou de production", () => {
    const html = renderPanel(undefined, {
      locationKey: "50.756_2.521", observationDate: "2026-10-01", observationHour: 13,
      observationReferenceAt: 1_790_856_800_000, observedPrecipitation: 0.4, stationCount: 3,
      confidenceScore: 85, validTime: 1_790_856_800_000, horizonMinutes: 0,
      candidateStatus: "WET_SIGNAL", baselinePrecipitation: 0, baselineWet: false,
      observedWet: true, localWetSignal: true, continuationFactor: 1,
      forecastAvailableAt: 1_790_853_200_000,
      forecastEvidence: { bestMatchIncluded: false, amountAdjustment: "forbidden" },
      reasons: ["MONTANT_MM_NON_CORRIGE"], evaluatedAt: 1_790_858_000_000,
    });
    expect(html).toContain("Signal local d’occurrence de pluie");
    expect(html).toContain("Les millimètres officiels ne sont jamais modifiés");
    expect(html).toContain("Médiane 7 modèles");
    expect(html).toContain("Pare-feu temporel");
    expect(html).toContain("snapshot qualifié ne conserve pas la fenêtre par station");
    expect(html).toContain("Production verrouillée");
    expect(html).toContain("Best Match exclu");
    expect(html).toContain("Accord inter-stations pour les précipitations : non mesuré ici");
    expect(html).toContain("il n’évalue pas la pluie");
    expect(html).not.toContain("confiance station");
    expect(html).not.toContain("85/100");
    expect(html).toContain("Les compteurs de statuts sont des états de candidats, pas des scores de performance");
    expect(html).toContain("Données insuffisantes / skill non mesuré");
    expect(html).toContain("aucun taux de réussite, POD, FAR ni CSI n’est calculé");
  });

  it("affiche séparément +1 h/+2 h, les dénominateurs et l’indisponibilité réelle des labels", () => {
    const verification = buildLocalPrecipitationVerificationReport({ emissions: [], outcomes: [] });
    const html = renderPanel(verification);

    expect(html).toContain("Horizon +1 h · paires horaires");
    expect(html).toContain("Horizon +2 h · paires horaires");
    expect(html).toContain("paires utilisables / prévisions échues comparables : 0/0");
    expect(html).toContain("À +2 h, le facteur de continuation actuel est nul");
    expect(html).toContain("sa prédiction d’occurrence est identique au baseline");
    expect(html).toContain("aucune paire horaire avec un label futur réellement qualifié et une fenêtre d’accumulation comparable");
    expect(html).toContain("Les répétitions horaires ne sont pas dédupliquées en épisodes indépendants");
  });

  it("affiche les fréquences seulement quand un label futur existe avec un dénominateur visible", () => {
    const referenceAt = Date.UTC(2026, 9, 1, 10);
    const validTime = referenceAt + 60 * 60_000;
    const verification = buildLocalPrecipitationVerificationReport({
      emissions: [{
        id: 1, locationKey: "50.756_2.521", observationReferenceAt: referenceAt,
        emittedAt: referenceAt + 1, availableAt: referenceAt + 1, validTime, horizonMinutes: 60,
        baselineWet: false, candidateWet: true,
        forecastAccumulationWindow: { startAt: validTime, endAt: validTime + 3_600_000, durationMinutes: 60 },
        productionReadsEnabled: 0, shadowMode: 1, appliedToProduction: 0,
      }],
      outcomes: [{
        emissionId: 1, locationKey: "50.756_2.521", validTime, horizonMinutes: 60,
        outcomeStatus: "MATCHED", futureSnapshotId: 22, futureReferenceAt: validTime,
        futureCollectedAt: validTime + 1, futureObservedAt: validTime + 1,
        sourceObservationIds: [33], sourceObservations: [], observedPrecipitation: 0.4,
        observedWet: true, accumulationWindow: { startAt: validTime, endAt: validTime + 3_600_000, durationMinutes: 60 },
        unavailabilityReason: null, productionReadsEnabled: 0, shadowMode: 1,
        appliedToProduction: 0, evaluatedAt: validTime + 2,
      }],
    });
    const html = renderPanel(verification);

    expect(html).toContain("Fréquences descriptives baseline");
    expect(html).toContain("POD 100.0 % (1/1)");
    expect(html).toContain("FAR 0.0 % (0/1)");
    expect(html).toContain("CSI 100.0 % (1/1)");
    expect(html).toContain("aucune note globale");
  });

  it("annonce explicitement l’absence de candidat et de mesure de compétence", () => {
    const html = renderPanel();
    expect(html).toContain("Aucun candidat à afficher");
    expect(html).toContain("Données insuffisantes / skill non mesuré");
  });
});
