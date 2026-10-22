/**
 * Configuration unique du Laboratoire de fiabilité météo.
 *
 * Les pondérations décrivent le score normalisé demandé pour les comparaisons
 * modèle ↔ observation. Elles ne remplacent pas les poids contextuels de la
 * fusion opérationnelle : le laboratoire décrit une performance mesurée, alors
 * que la fusion adapte les prévisions à la situation météorologique en cours.
 */
export const LABORATORY_SCORE_WEIGHTS = {
  temperature: 0.30,
  precipitation: 0.25,
  wind: 0.20,
  gusts: 0.10,
  humidity: 0.10,
  pressure: 0.05,
} as const;

export const LABORATORY_SCORE_WEIGHT_TOTAL = Object.values(LABORATORY_SCORE_WEIGHTS)
  .reduce((total, weight) => total + weight, 0);

/** The existing physical hourly scorer only emits a result once 18 aligned hours exist. */
export const MINIMUM_RELIABILITY_COMPARISONS = 18;

/**
 * Seuil plus strict pour les classements visibles hors Laboratoire. Il évite
 * qu'une tendance exploratoire soit interprétée comme un meilleur modèle.
 */
export const PUBLIC_RANKING_EVIDENCE_THRESHOLDS = {
  minimumComparisons: 30,
  minimumComparableDays: 7,
} as const;

export function isPublicModelRankingEligible(input: {
  comparisons: number | null | undefined;
  evaluatedDays: number | null | undefined;
}): boolean {
  return Number(input.comparisons ?? 0) >= PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons
    && Number(input.evaluatedDays ?? 0) >= PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays;
}

/**
 * Confidence thresholds only qualify the volume and persistence of archived
 * evidence. A score remains unavailable when a required metric was not stored.
 */
export const STATISTICAL_CONFIDENCE_THRESHOLDS = {
  minimumComparableDays: 2,
  mediumComparisons: 72,
  highComparisons: 180,
  mediumComparableDays: 7,
  highComparableDays: 30,
} as const;

/**
 * Note de couverture des preuves : elle mesure uniquement la maturité de
 * l’échantillon avant le classement validé, jamais la performance prédictive.
 */
export function getProvisionalEvidenceScore(input: {
  comparisons: number | null | undefined;
  evaluatedDays: number | null | undefined;
}): number {
  const comparisons = Math.max(0, Number(input.comparisons ?? 0));
  const evaluatedDays = Math.max(0, Number(input.evaluatedDays ?? 0));
  const comparisonCoverage = comparisons / STATISTICAL_CONFIDENCE_THRESHOLDS.mediumComparisons;
  const durationCoverage = evaluatedDays / STATISTICAL_CONFIDENCE_THRESHOLDS.mediumComparableDays;
  return Math.round(Math.max(0, Math.min(1, comparisonCoverage, durationCoverage)) * 100);
}

export type StatisticalConfidenceLevel = "insufficient" | "low" | "medium" | "high";

export type StatisticalConfidence = {
  level: StatisticalConfidenceLevel;
  label: string;
  tone: "red" | "yellow" | "green";
  isRankable: boolean;
  minimumMissing: number;
  evidenceScore: number;
};

export function getStatisticalConfidence(input: {
  comparisons: number | null | undefined;
  evaluatedDays: number | null | undefined;
}): StatisticalConfidence {
  const comparisons = Math.max(0, Number(input.comparisons ?? 0));
  const evaluatedDays = Math.max(0, Number(input.evaluatedDays ?? 0));
  const minimumMissing = Math.max(0, MINIMUM_RELIABILITY_COMPARISONS - comparisons);
  const evidenceScore = getProvisionalEvidenceScore({ comparisons, evaluatedDays });

  if (
    comparisons < MINIMUM_RELIABILITY_COMPARISONS
    || evaluatedDays < STATISTICAL_CONFIDENCE_THRESHOLDS.minimumComparableDays
  ) {
    return {
      level: "insufficient",
      label: "Données insuffisantes",
      tone: "red",
      isRankable: false,
      minimumMissing,
      evidenceScore,
    };
  }

  if (
    comparisons < STATISTICAL_CONFIDENCE_THRESHOLDS.mediumComparisons
    || evaluatedDays < STATISTICAL_CONFIDENCE_THRESHOLDS.mediumComparableDays
  ) {
    return {
      level: "low",
      label: "Confiance statistique faible",
      tone: "red",
      isRankable: true,
      minimumMissing: 0,
      evidenceScore,
    };
  }

  if (
    comparisons < STATISTICAL_CONFIDENCE_THRESHOLDS.highComparisons
    || evaluatedDays < STATISTICAL_CONFIDENCE_THRESHOLDS.highComparableDays
  ) {
    return {
      level: "medium",
      label: "Confiance statistique moyenne",
      tone: "yellow",
      isRankable: true,
      minimumMissing: 0,
      evidenceScore,
    };
  }

  return {
    level: "high",
    label: "Haute confiance statistique",
    tone: "green",
    isRankable: true,
    minimumMissing: 0,
    evidenceScore,
  };
}

/**
 * storageBucket doit être une clé exacte de FORECAST_HORIZON_WINDOWS
 * (shared/forecastHorizon.ts), celle écrite par le scoring horaire. Un horizon
 * qui recouvre plusieurs buckets, ou dont les bornes ne coïncident avec aucun
 * bucket, reste non archivé séparément : il n’est ni agrégé ni remplacé par un
 * bucket voisin.
 */
export const LABORATORY_HORIZONS = [
  { id: "0-6h", label: "0–6 h", storageBucket: null }, // recouvre les buckets 0_2h et 2_6h
  { id: "6-24h", label: "6–24 h", storageBucket: "6_24h" },
  { id: "24-48h", label: "24–48 h", storageBucket: null },
  { id: "2-3d", label: "2–3 jours", storageBucket: null },
  { id: "4-7d", label: "4–7 jours", storageBucket: null }, // 4 à 7 jours ne correspond pas au bucket 3_7d
  { id: "8-10d", label: "8–10 jours", storageBucket: null },
  { id: "11-15d", label: "11–15 jours", storageBucket: null },
] as const;

export type LaboratoryHorizonId = (typeof LABORATORY_HORIZONS)[number]["id"];

export function getLaboratoryHorizon(id: LaboratoryHorizonId) {
  return LABORATORY_HORIZONS.find((horizon) => horizon.id === id) ?? null;
}
