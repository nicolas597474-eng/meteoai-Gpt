/**
 * Version 1 is reserved for hourly aggregate scores whose forecast/observation
 * pairs pass strict F25 availability checks and are selected through one
 * unambiguous latestCompatibleRun. Nullable/missing markers remain legacy and
 * are not eligible as official hourly evidence.
 */
export const HOURLY_SCORING_VALIDATION_VERSION = 1;

export type HourlyScoringVersionedRow = {
  scoringValidationVersion?: number | null;
};

export function isCurrentHourlyScoringVersion(row: HourlyScoringVersionedRow): boolean {
  return row.scoringValidationVersion === HOURLY_SCORING_VALIDATION_VERSION;
}

export function filterCurrentHourlyScoringRows<T extends HourlyScoringVersionedRow>(
  rows: readonly T[],
): T[] {
  return rows.filter(isCurrentHourlyScoringVersion);
}
