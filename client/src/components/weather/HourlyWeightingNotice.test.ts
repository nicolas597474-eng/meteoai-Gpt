import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HourlyWeightingNotice } from "./HourlyWeightingNotice";

const sevenModels = ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"];

describe("HourlyWeightingNotice", () => {
  it("annonce l’indisponibilité des modèles uniquement quand aucune prévision admissible n’existe", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, { weighting: {
      status: "unavailable",
      availabilityStatus: "UNAVAILABLE",
      calibrationStatus: "UNAVAILABLE",
      historyStatus: "available",
      minimumComparisons: 30,
      minimumComparableDays: 7,
      modelsWithData: [],
      horizons: [{
        variable: "temperature",
        horizonBucket: "6_24h",
        method: "unavailable",
        availabilityStatus: "UNAVAILABLE",
        calibrationStatus: "UNAVAILABLE",
        unavailableReason: "no_model_data",
        hourCount: 4,
        availableModelCount: 0,
        modelNamesWithData: [],
      }],
    } }));

    expect(html).toContain("Prévision officielle horaire indisponible");
    expect(html).toContain("aucune prévision admissible pour cette variable et cette échéance");
    expect(html).toContain("30 comparaisons sur 7 jours");
    expect(html).toContain("Modèles avec données : aucun modèle");
    expect(html).toContain("Best Match est exclu");
    expect(html).not.toContain("Repli égalitaire");
  });

  it("ne présente pas un horizon inconnu comme une échéance exacte", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, { weighting: {
      status: "unavailable",
      availabilityStatus: "UNAVAILABLE",
      calibrationStatus: "UNAVAILABLE",
      historyStatus: "available",
      modelsWithData: [],
      horizons: [{
        variable: "temperature",
        horizonBucket: null,
        method: "unavailable",
        availabilityStatus: "UNAVAILABLE",
        calibrationStatus: "UNAVAILABLE",
        unavailableReason: "no_model_data",
        hourCount: 1,
        availableModelCount: 0,
        coverageLevelCounts: { NONE: 1 },
        modelNamesWithData: [],
      }],
    } }));

    expect(html).toContain("température (horizon non déterminé)");
    expect(html).toContain("aucune prévision admissible pour cette variable et cette échéance");
    expect(html).not.toContain("échéance exacte");
  });

  it("distingue les variables calibrées du repli robuste disponible", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, { weighting: {
      status: "mixed",
      availabilityStatus: "FUSED",
      calibrationStatus: "PARTIALLY_CALIBRATED",
      historyStatus: "available",
      minimumComparisons: 30,
      minimumComparableDays: 7,
      modelsWithData: ["AROME", "UKMET"],
      horizons: [
        { variable: "temperature", horizonBucket: "6_24h", method: "historical_skill", availabilityStatus: "FUSED", calibrationStatus: "CALIBRATED", unavailableReason: null, hourCount: 3, modelNamesWithData: ["AROME", "UKMET"] },
        { variable: "wind_speed", horizonBucket: "6_24h", method: "robust_fallback", availabilityStatus: "FUSED", calibrationStatus: "UNCALIBRATED_ROBUST", unavailableReason: null, hourCount: 3, modelNamesWithData: ["AROME", "UKMET"] },
      ],
    } }));

    expect(html).toContain("Calibrées : température (6_24h)");
    expect(html).toContain("Robustes non calibrées : vent (6_24h)");
    expect(html).toContain("Les autres valeurs exploitables restent incluses avec un repli robuste");
    expect(html).not.toContain("Champs sans valeur disponible");
  });

  it("signale l’override manuel et confirme que la série officielle originale est conservée", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, { weighting: {
      status: "historical_skill",
      manualOverride: {
        source: "manual_refresh",
        reason: "Rafraîchissement demandé explicitement.",
        computedAt: "2026-10-04T08:00:00.000Z",
        officialOriginalComputedAt: "2026-10-04T07:58:00.000Z",
        officialOriginalPreserved: true,
        officialOriginalPointCount: 24,
      },
    } }));

    expect(html).toContain("Override horaire manuel explicite appliqué");
    expect(html).toContain("Rafraîchissement demandé explicitement.");
    expect(html).toContain("Série officielle d’origine conservée (24 échéances");
    expect(html).toContain("2026-10-04T07:58:00.000Z");
  });

  it("affiche les niveaux indicatifs par variable et horizon, distincts de la calibration", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, { weighting: {
      status: "mixed",
      availabilityStatus: "FUSED",
      calibrationStatus: "PARTIALLY_CALIBRATED",
      horizons: [{
        variable: "temperature",
        horizonBucket: "6_24h",
        method: "mixed",
        availabilityStatus: "FUSED",
        calibrationStatus: "PARTIALLY_CALIBRATED",
        unavailableReason: null,
        hourCount: 9,
        contributingModelCount: 18,
        coverageLevelCounts: { NONE: 1, SINGLE_MODEL: 1, LIMITED: 2, MODERATE: 3, BROAD: 2 },
        modelNamesWithData: sevenModels,
      }],
    } }));

    expect(html).toContain("Nombre de modèles contributeurs, par variable et horizon");
    expect(html).toContain("effectif étendu sur 2 échéances");
    expect(html).toContain("effectif intermédiaire sur 3 échéances");
    expect(html).toContain("effectif limité sur 2 échéances");
    expect(html).toContain("prévision d’un modèle unique sur 1 échéance");
    expect(html).toContain("aucun modèle contributeur sur 1 échéance");
    expect(html).toContain("pas la couverture/qualité des stations physiques. L’incertitude statistique n’est pas mesurée ici");
    expect(html).toContain("CALIBRATED");
    expect(html).toContain("PARTIALLY_CALIBRATED");
    expect(html).toContain("UNCALIBRATED_ROBUST");
  });

  it("affiche les meilleurs modèles par variable et les raisons du fallback pondéré", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, { weighting: {
      status: "mixed",
      availabilityStatus: "FUSED",
      calibrationStatus: "PARTIALLY_CALIBRATED",
      horizons: [{
        variable: "temperature",
        horizonBucket: "6_24h",
        method: "mixed",
        availabilityStatus: "FUSED",
        calibrationStatus: "PARTIALLY_CALIBRATED",
        unavailableReason: null,
        hourCount: 4,
        selectionStrategyCounts: { qualified_best_model: 3, weighted_ensemble_fallback: 1 },
        bestModelHourCounts: [{ modelName: "ICON", hourCount: 3 }],
        selectionReasonCounts: [{ reason: "incomparable_horizons", hourCount: 1 }],
        modelNamesWithData: ["AROME", "ICON"],
      }],
    } }));

    expect(html).toContain("Meilleur modèle retenu sur preuve historique locale comparable");
    expect(html).toContain("température (6_24h) : ICON sur 3 échéances");
    expect(html).toContain("Fallback conservé :");
    expect(html).toContain("mélange pondéré actuel lorsque la preuve ne permet pas de départager sûrement les modèles");
    expect(html).toContain("horizons non comparables");
  });

  it("permet au Dashboard de masquer la couverture et le détail de fallback sans retirer la notice générale", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, {
      showCoverageDistribution: false,
      showFallbackDetails: false,
      weighting: {
        status: "mixed",
        availabilityStatus: "FUSED",
        calibrationStatus: "PARTIALLY_CALIBRATED",
        historyStatus: "available",
        horizons: [{
          variable: "temperature",
          horizonBucket: "6_24h",
          method: "mixed",
          availabilityStatus: "FUSED",
          calibrationStatus: "PARTIALLY_CALIBRATED",
          unavailableReason: null,
          hourCount: 1,
          coverageLevelCounts: { BROAD: 1 },
          selectionStrategyCounts: { weighted_ensemble_fallback: 1 },
          selectionReasonCounts: [{ reason: "incomparable_horizons", hourCount: 1 }],
          modelNamesWithData: ["AROME"],
        }],
      },
    }));

    expect(html).not.toContain("Nombre de modèles contributeurs, par variable et horizon");
    expect(html).not.toContain("Fallback conservé :");
    expect(html).toContain("Fusion disponible, calibration partielle selon le modèle");
  });

  it("ne rend plus le bloc de fusion robuste non calibrée", () => {
    const html = renderToStaticMarkup(createElement(HourlyWeightingNotice, { weighting: {
      status: "robust_fallback",
      availabilityStatus: "FUSED",
      calibrationStatus: "UNCALIBRATED_ROBUST",
      historyStatus: "available",
      minimumComparisons: 30,
      minimumComparableDays: 7,
      modelsWithData: sevenModels,
      horizons: [{
        variable: "temperature",
        horizonBucket: "6_24h",
        method: "robust_fallback",
        availabilityStatus: "FUSED",
        calibrationStatus: "UNCALIBRATED_ROBUST",
        unavailableReason: null,
        hourCount: 3,
        modelNamesWithData: sevenModels,
      }],
    } }));

    expect(html).not.toContain("Fusion des seuls modèles réellement disponibles");
    expect(html).not.toContain("pondération robuste non calibrée");
    expect(html).not.toContain("Best Match est exclu");
  });
});
