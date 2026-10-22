import type {
  HistoricalMetricValues,
  HourlyHistoricalEvidence,
  HourlyHistoricalEvidenceStatus,
  HourlyHistoricalTrend,
} from "../shared/hourlyModelMetrics";
import { isPublicModelRankingEligible, PUBLIC_RANKING_EVIDENCE_THRESHOLDS } from "./weatherReliabilityConfig";

export type { HourlyHistoricalEvidence, HourlyHistoricalEvidenceStatus } from "../shared/hourlyModelMetrics";

export type HourlyHistoricalScoreRow = {
  leadBasis?: 'provider_run';
  date: string;
  sourceName: string;
  modelName: string;
  modelId: string | null;
  variable: string;
  horizonBucket: string;
  /** Present only for the additive exact-lead score table; never rounded or interpolated. */
  horizonMilliseconds?: number;
  scoringValidationVersion?: number | null;
  sampleSize: number;
  mae: number | null;
  rmse?: number | null;
  bias?: number | null;
  computedAt?: Date | string | number | null;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shiftDate(date: string, deltaDays: number): string {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + deltaDays);
  return result.toISOString().slice(0, 10);
}

function timestamp(value: HourlyHistoricalScoreRow["computedAt"]): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function isComplete(row: HourlyHistoricalScoreRow): boolean {
  return Number.isInteger(row.sampleSize) && row.sampleSize > 0
    && finite(row.mae) && row.mae >= 0
    && finite(row.rmse) && row.rmse >= 0
    && finite(row.bias);
}

function aggregate(rows: readonly HourlyHistoricalScoreRow[]): HistoricalMetricValues | null {
  const complete = rows.filter(isComplete);
  const comparisonCount = complete.reduce((sum, row) => sum + row.sampleSize, 0);
  const evaluatedDays = new Set(complete.map((row) => row.date)).size;
  if (comparisonCount <= 0 || evaluatedDays === 0) return null;
  const mae = complete.reduce((sum, row) => sum + row.mae! * row.sampleSize, 0) / comparisonCount;
  const mse = complete.reduce((sum, row) => sum + (row.rmse! ** 2) * row.sampleSize, 0) / comparisonCount;
  const bias = complete.reduce((sum, row) => sum + row.bias! * row.sampleSize, 0) / comparisonCount;
  const rmse = Math.sqrt(mse);
  if (![mae, rmse, bias].every(Number.isFinite)) return null;
  return { mae, rmse, bias, comparisonCount, evaluatedDays };
}

function statusFor(metrics: HistoricalMetricValues | null): "qualified" | "insufficient_evidence" | "no_evidence" {
  if (!metrics) return "no_evidence";
  return isPublicModelRankingEligible({ comparisons: metrics.comparisonCount, evaluatedDays: metrics.evaluatedDays })
    ? "qualified"
    : "insufficient_evidence";
}

/**
 * Produces location-filtered raw verification metrics for one exact model ×
 * variable × bucket, or one strictly equal millisecond lead when requested.
 * MAE/RMSE/bias are pooled by their stored comparison count;
 * model aggregators, mismatched IDs, incomplete rows and future dates are excluded.
 */
export function summarizeHourlyHistoricalEvidence(
  rows: readonly HourlyHistoricalScoreRow[],
  input: {
    modelName: string;
    modelId: string;
    variable: string;
    horizonBucket: string;
    horizonMilliseconds?: number;
    beforeDate: string | null;
    periodStartDate?: string | null;
    historyAvailable: boolean;
  },
): HourlyHistoricalEvidence {
  const minimumComparisons = PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons;
  const minimumComparableDays = PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays;
  const historicalRows = input.historyAvailable ? rows.filter((row) =>
    row.sourceName === "open-meteo"
    && row.modelName === input.modelName
    && row.modelId === input.modelId
    && row.variable === input.variable
    && row.horizonBucket === input.horizonBucket
    && (input.horizonMilliseconds == null
      ? row.horizonMilliseconds == null
      : row.horizonMilliseconds === input.horizonMilliseconds)
    && validDate(row.date)
    && (input.beforeDate == null || row.date < input.beforeDate)
  ) : [];
  const matching = historicalRows.filter((row) => input.periodStartDate == null || row.date >= input.periodStartDate);
  const complete = matching.filter(isComplete);
  const completeHistoricalRows = historicalRows.filter(isComplete);
  const metrics = aggregate(complete);
  const incompleteMetricRows = matching.length - complete.length;
  const status: HourlyHistoricalEvidenceStatus = !input.historyAvailable
    ? "history_unavailable"
    : metrics == null
      ? matching.length > 0 ? "incomplete_metrics" : "no_evidence"
      : statusFor(metrics);
  const scoreDates = complete.map((row) => row.date).sort();
  const computedAtValues = complete.map((row) => timestamp(row.computedAt)).filter((value): value is string => value != null).sort();

  const referenceDate = validDate(input.beforeDate)
    ? input.beforeDate
    : scoreDates.at(-1) ? shiftDate(scoreDates.at(-1)!, 1) : new Date().toISOString().slice(0, 10);
  const recentStart = shiftDate(referenceDate, -30);
  const previousStart = shiftDate(referenceDate, -60);
  const recentRows = completeHistoricalRows.filter((row) => row.date >= recentStart && row.date < referenceDate);
  const previousRows = completeHistoricalRows.filter((row) => row.date >= previousStart && row.date < recentStart);
  const recent = aggregate(recentRows);
  const previous = aggregate(previousRows);
  const recentStatus = statusFor(recent);
  const previousStatus = statusFor(previous);
  const trendStatus: HourlyHistoricalTrend["status"] = !input.historyAvailable
    ? "history_unavailable"
    : recentStatus === "qualified" && previousStatus === "qualified"
      ? "qualified"
      : recent == null || previous == null ? "no_evidence" : "insufficient_evidence";

  return {
    modelName: input.modelName,
    modelId: input.modelId,
    variable: input.variable,
    horizonBucket: input.horizonBucket,
    status,
    metrics,
    minimumComparisons,
    minimumComparableDays,
    firstScoreDate: scoreDates[0] ?? null,
    latestScoreDate: scoreDates.at(-1) ?? null,
    latestComputedAt: computedAtValues.at(-1) ?? null,
    incompleteMetricRows,
    trend: {
      status: trendStatus,
      recentWindowStart: recentStart,
      recentWindowEnd: shiftDate(referenceDate, -1),
      previousWindowStart: previousStart,
      previousWindowEnd: shiftDate(recentStart, -1),
      recent,
      previous,
      delta: trendStatus === "qualified" && recent && previous
        ? { mae: recent.mae - previous.mae, rmse: recent.rmse - previous.rmse, bias: recent.bias - previous.bias }
        : null,
      minimumComparisons,
      minimumComparableDays,
    },
  };
}
