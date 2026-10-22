import { describe, expect, it } from "vitest";
import {
  getLaboratoryHorizon,
  getProvisionalEvidenceScore,
  getStatisticalConfidence,
  LABORATORY_HORIZONS,
  LABORATORY_SCORE_WEIGHT_TOTAL,
  LABORATORY_SCORE_WEIGHTS,
  MINIMUM_RELIABILITY_COMPARISONS,
  PUBLIC_RANKING_EVIDENCE_THRESHOLDS,
  isPublicModelRankingEligible,
} from "./weatherReliabilityConfig";
import { FORECAST_HORIZON_WINDOWS, getForecastHorizonWindow } from "../shared/forecastHorizon";

describe("weatherReliabilityConfig", () => {
  it("conserve exactement 100 % de pondération pour le score normalisé", () => {
    expect(LABORATORY_SCORE_WEIGHT_TOTAL).toBeCloseTo(1, 10);
    expect(LABORATORY_SCORE_WEIGHTS).toEqual({
      temperature: 0.30,
      precipitation: 0.25,
      wind: 0.20,
      gusts: 0.10,
      humidity: 0.10,
      pressure: 0.05,
    });
  });

  it("refuse tout classement sous le minimum de comparaisons physiques", () => {
    const confidence = getStatisticalConfidence({
      comparisons: MINIMUM_RELIABILITY_COMPARISONS - 1,
      evaluatedDays: 2,
    });
    expect(confidence.level).toBe("insufficient");
    expect(confidence.isRankable).toBe(false);
    expect(confidence.minimumMissing).toBe(1);
  });

  it("réserve les classements publics aux preuves physiques suffisamment longues", () => {
    expect(isPublicModelRankingEligible({
      comparisons: PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons - 1,
      evaluatedDays: 30,
    })).toBe(false);
    expect(isPublicModelRankingEligible({
      comparisons: 300,
      evaluatedDays: PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays - 1,
    })).toBe(false);
    expect(isPublicModelRankingEligible({ comparisons: 30, evaluatedDays: 7 })).toBe(true);
  });

  it("qualifie les niveaux faible, moyen et élevé uniquement avec assez de durée et de comparaisons", () => {
    expect(getStatisticalConfidence({ comparisons: 18, evaluatedDays: 2 }).level).toBe("low");
    expect(getStatisticalConfidence({ comparisons: 72, evaluatedDays: 7 }).level).toBe("medium");
    expect(getStatisticalConfidence({ comparisons: 180, evaluatedDays: 30 }).level).toBe("high");
  });

  it("mesure la couverture provisoire sans la confondre avec une performance de modèle", () => {
    expect(getProvisionalEvidenceScore({ comparisons: 43, evaluatedDays: 2 })).toBe(29);
    expect(getProvisionalEvidenceScore({ comparisons: 72, evaluatedDays: 7 })).toBe(100);
    expect(getStatisticalConfidence({ comparisons: 43, evaluatedDays: 2 }).evidenceScore).toBe(29);
  });

  it("n’assimile pas les horizons non archivés séparément à un horizon voisin", () => {
    expect(getLaboratoryHorizon("6-24h")?.storageBucket).toBe("6_24h");
    expect(getLaboratoryHorizon("0-6h")?.storageBucket).toBeNull();
    expect(getLaboratoryHorizon("4-7d")?.storageBucket).toBeNull();
    expect(getLaboratoryHorizon("24-48h")?.storageBucket).toBeNull();
    expect(getLaboratoryHorizon("8-10d")?.storageBucket).toBeNull();
  });

  it("n’archive séparément que les buckets qui existent dans le découpage partagé", () => {
    const writtenBuckets = new Set<string>(FORECAST_HORIZON_WINDOWS.map((window) => window.key));
    for (const horizon of LABORATORY_HORIZONS) {
      if (horizon.storageBucket !== null) {
        expect(writtenBuckets.has(horizon.storageBucket)).toBe(true);
      }
    }
  });

  it("fait correspondre 6–24 h au bucket 6_24h et ne fait pas coïncider 0–6 h ni 4–7 j avec un bucket", () => {
    expect(getForecastHorizonWindow(6 * 60)?.key).toBe("6_24h");
    expect(getForecastHorizonWindow(0)?.key).toBe("0_2h");
    expect(getForecastHorizonWindow(5 * 60)?.key).toBe("2_6h");
    expect(getForecastHorizonWindow(4 * 24 * 60)?.key).toBe("3_7d");
    expect(getLaboratoryHorizon("0-6h")?.storageBucket).toBeNull();
    expect(getLaboratoryHorizon("4-7d")?.storageBucket).toBeNull();
  });
});
