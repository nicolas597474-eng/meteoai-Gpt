import { createHash } from "node:crypto";
import type {
  InsertDailyForecastObservationComparison,
  InsertDailyForecastObservationComparisonRevision,
} from "../drizzle/schema";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value === undefined ? null : value;
}

/**
 * Build an append-only revision snapshot. The existing comparisonKey remains the
 * forecast-run/variable identity; a canonical hash of every persisted value
 * distinguishes revisions while making exact retries idempotent.
 */
export function buildDailyForecastObservationComparisonRevision(
  row: InsertDailyForecastObservationComparison,
): InsertDailyForecastObservationComparisonRevision {
  const payload = {
    comparisonKey: row.comparisonKey,
    forecastRunId: row.forecastRunId,
    locationKey: row.locationKey,
    validDate: row.validDate,
    serviceName: row.serviceName,
    provider: row.provider,
    modelId: row.modelId,
    horizonBucket: row.horizonBucket,
    leadTimeMinutes: row.leadTimeMinutes,
    variable: row.variable,
    forecastValue: row.forecastValue,
    observedValue: row.observedValue,
    signedError: row.signedError,
    absoluteError: row.absoluteError,
    evidenceType: row.evidenceType ?? "physical_observation",
    observationIsQualified: row.observationIsQualified ?? 1,
    observationCoverageHours: row.observationCoverageHours,
    forecastAvailableAt: row.forecastAvailableAt ?? null,
    observationWindowStartAt: row.observationWindowStartAt ?? null,
    observationWindowEndAt: row.observationWindowEndAt ?? null,
    stationEvidence: row.stationEvidence ?? null,
  };
  const canonicalPayload = JSON.stringify(canonicalize(payload));
  const revisionHash = createHash("sha256").update(canonicalPayload).digest("hex");
  return { ...payload, revisionHash };
}
