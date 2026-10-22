export const DAILY_FUSION_METRICS = [
  "temperature_max",
  "temperature_min",
  "precipitation_sum",
  "wind_speed_max",
  "wind_gust_max",
] as const;

export type DailyFusionMetric = (typeof DAILY_FUSION_METRICS)[number];
export type DailyFusionHorizon = "0-6h" | "6-24h" | "1-3d" | "4-7d" | "8-15d";

export type ModelPerformanceEvidence = {
  locationKey: string;
  serviceName: string;
  modelId: string;
  variable: DailyFusionMetric;
  horizonBucket: DailyFusionHorizon;
  comparisonCount: number;
  sampleSize: number;
  evaluatedDays: number;
  mae: number;
  rmse: number;
  standardError: number;
  /** Mean signed forecast-minus-observation error, diagnostic only. */
  signedBias?: number;
  latestScoreDate: string;
};

export type ModelPerformanceContext = Pick<ModelPerformanceEvidence, "locationKey" | "variable" | "horizonBucket">;

export const MIN_DAILY_FUSION_DAYS = 30;
export const MAX_DAILY_FUSION_SCORE_AGE_DAYS = 7;
export const DAILY_FUSION_LOOKBACK_DAYS = 120;
export const MODEL_FUSION_WEIGHT_CAP = 0.35;
export const PERFORMANCE_PRIOR_DAYS = 30;
export const UNCERTAINTY_Z_90 = 1.645;

export type RegularizedPerformance = {
  evidence: ModelPerformanceEvidence;
  uncertaintyAdjustedMae: number;
  regularizedMae: number;
  sampleReliability: number;
  performanceMultiplier: number;
};

export function getEvidenceIneligibilityReason(
  evidence: ModelPerformanceEvidence | null | undefined,
  expected: ModelPerformanceContext,
  now = new Date(),
): string | null {
  if (!evidence) return "aucune preuve de production";
  if (evidence.locationKey !== expected.locationKey) return "lieu différent";
  if (evidence.variable !== expected.variable) return "variable différente";
  if (evidence.horizonBucket !== expected.horizonBucket) return "horizon différent";
  if (!Number.isInteger(evidence.sampleSize) || evidence.sampleSize < MIN_DAILY_FUSION_DAYS || evidence.evaluatedDays < MIN_DAILY_FUSION_DAYS) {
    return `moins de ${MIN_DAILY_FUSION_DAYS} jours indépendants`;
  }
  if (evidence.sampleSize !== evidence.evaluatedDays) return "effectif journalier incohérent";
  if (!Number.isInteger(evidence.comparisonCount) || evidence.comparisonCount < MIN_DAILY_FUSION_DAYS) return "comparaisons insuffisantes";
  if (![evidence.mae, evidence.rmse, evidence.standardError].every(Number.isFinite) || evidence.mae < 0 || evidence.rmse < 0 || evidence.standardError < 0) {
    return "mesure d’erreur ou d’incertitude invalide";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.latestScoreDate)) return "date de score invalide";
  const latest = Date.parse(`${evidence.latestScoreDate}T00:00:00.000Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = Math.floor((today - latest) / 86_400_000);
  if (!Number.isFinite(latest) || ageDays < 0) return "date de score future ou invalide";
  if (ageDays > MAX_DAILY_FUSION_SCORE_AGE_DAYS) return "preuve trop ancienne";
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Shrink noisy model MAE estimates toward the median of the same qualified
 * location/variable/horizon slice, while penalizing the one-sided 90% upper
 * confidence bound. Fewer independent days produce stronger shrinkage.
 */
export function regularizeModelPerformance(
  evidence: ModelPerformanceEvidence[],
  expected: ModelPerformanceContext,
  now = new Date(),
): Map<string, RegularizedPerformance> {
  const eligible = evidence.filter((item) => getEvidenceIneligibilityReason(item, expected, now) == null);
  const baselineMae = median(eligible.map((item) => item.mae));
  const result = new Map<string, RegularizedPerformance>();

  for (const item of eligible) {
    const sampleReliability = item.sampleSize / (item.sampleSize + PERFORMANCE_PRIOR_DAYS);
    const uncertaintyAdjustedMae = item.mae + UNCERTAINTY_Z_90 * item.standardError;
    const regularizedMae = baselineMae + sampleReliability * (uncertaintyAdjustedMae - baselineMae);
    const performanceMultiplier = Math.min(2, Math.max(0.3, 1 / Math.max(regularizedMae, 0.5)));
    result.set(item.serviceName, {
      evidence: item,
      uncertaintyAdjustedMae,
      regularizedMae,
      sampleReliability,
      performanceMultiplier,
    });
  }
  return result;
}

/** Normalize model weights without allowing any single model above its cap. */
export function normalizeModelWeightsWithCap(
  items: Array<{ modelId: string; rawWeight: number }>,
  budget = 1,
  cap = MODEL_FUSION_WEIGHT_CAP,
): Map<string, number> | null {
  if (!Number.isFinite(budget) || budget < 0 || budget > 1 || !Number.isFinite(cap) || cap <= 0 || cap > 1) return null;
  if (budget === 0) return new Map();

  const grouped = new Map<string, number>();
  for (const item of items) {
    if (!Number.isFinite(item.rawWeight) || item.rawWeight <= 0) continue;
    grouped.set(item.modelId, (grouped.get(item.modelId) ?? 0) + item.rawWeight);
  }
  if (grouped.size === 0) return null;

  // Preserve the configured cap whenever the selected set can satisfy it. When
  // too few models are actually available, relax only the minimum required cap;
  // a cap can never be the sole reason a finite forecast becomes unavailable.
  const effectiveCap = Math.max(cap, budget - cap * (grouped.size - 1));
  if (grouped.size * effectiveCap + 1e-12 < budget) return null;

  const remaining = new Set(grouped.keys());
  const result = new Map<string, number>();
  let remainingBudget = budget;
  while (remaining.size > 0) {
    const totalRaw = Array.from(remaining).reduce((sum, id) => sum + (grouped.get(id) ?? 0), 0);
    if (!(totalRaw > 0)) return null;
    const overCap = Array.from(remaining).filter((id) => (remainingBudget * (grouped.get(id) ?? 0) / totalRaw) > effectiveCap + 1e-12);
    if (overCap.length === 0) {
      for (const id of Array.from(remaining)) result.set(id, remainingBudget * (grouped.get(id) ?? 0) / totalRaw);
      remainingBudget = 0;
      break;
    }
    for (const id of overCap) {
      result.set(id, effectiveCap);
      remaining.delete(id);
      remainingBudget -= effectiveCap;
    }
    if (remainingBudget < -1e-12) return null;
  }
  return Math.abs(remainingBudget) <= 1e-9 ? result : null;
}

/** Bounded robust down-weighting for uncalibrated model-value outliers. */
export function calculateRobustFallbackMultipliers(
  items: Array<{ modelId: string; value: number }>,
): Map<string, number> {
  const valid = items.filter((item) => Number.isFinite(item.value));
  const result = new Map<string, number>(valid.map(({ modelId }) => [modelId, 1]));
  if (valid.length < 3) return result;

  const center = median(valid.map((item) => item.value));
  const mad = median(valid.map((item) => Math.abs(item.value - center)));
  for (const item of valid) {
    const deviation = Math.abs(item.value - center);
    if (deviation === 0) continue;
    if (mad === 0) {
      result.set(item.modelId, 0.25);
      continue;
    }
    const cutoff = 3 * 1.4826 * mad;
    if (deviation > cutoff) result.set(item.modelId, Math.max(0.25, cutoff / deviation));
  }
  return result;
}
