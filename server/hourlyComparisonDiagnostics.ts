export type HourlyComparisonDiagnosticPath = "ordinary_hourly" | "single_runs";

export type HourlyComparisonFirstRejectionReason =
  | "FORECAST_METADATA_INVALID"
  | "FORECAST_REPLAY_OR_CONFLICTING_DUPLICATE"
  | "NO_MATCHING_LOCATION_VALID_TIME_OBSERVATION"
  | "NO_QUALIFIED_PHYSICAL_OBSERVATION"
  | "FORECAST_AVAILABLE_AT_OR_AFTER_VALID_TIME"
  | "FORECAST_AVAILABLE_AT_OR_AFTER_MEASUREMENT_TIME"
  | "FORECAST_VALUE_MISSING_OR_NONFINITE"
  | "SUPERSEDED_BY_LATER_ADMISSIBLE_FORECAST"
  | "AMBIGUOUS_ADMISSIBLE_FORECAST_TIE"
  | "FORECAST_OUTSIDE_SCORING_HORIZON"
  | "NOT_RETAINED_BY_CURRENT_SCORER";

export type HourlyComparisonDiagnostic = {
  path: HourlyComparisonDiagnosticPath;
  variable: string;
  /** Input archive rows for this supported variable, before validation and deduplication. */
  archivedForecasts: number;
  /** Archived values matching an aggregate observation at the same location and exact UTC validTime. */
  opportunitiesAtSameLocationAndValidTime: number;
  /** Matched values with a qualified physical observation for this variable. */
  qualifiedPhysicalObservationsPresent: number;
  /** Matched values that pass this path's strict temporal admissibility rule. */
  temporallyAdmissible: number;
  /** Temporally admissible pairs with finite forecast and observation values. */
  admissiblePairs: number;
  /** Comparisons actually retained by the existing scorer. */
  retainedComparisons: number;
  /** Exactly one first rejection reason per eliminated opportunity that reached a rejection stage. */
  firstRejectionCounts: Partial<
    Record<HourlyComparisonFirstRejectionReason, number>
  >;
  /** Human-readable, path-specific temporal rule used by this diagnostic. */
  temporalRule: string;
};

export function createHourlyComparisonDiagnostics(
  path: HourlyComparisonDiagnosticPath,
  variables: readonly string[]
): HourlyComparisonDiagnostic[] {
  const temporalRule =
    path === "ordinary_hourly"
      ? "availableAt < validTime AND availableAt < earliest measurementTime among positive-weight contributors for the field"
      : "Single Runs metadata is structurally valid AND availableAt < validTime; station measurementTime is not an input to this path";

  return variables.map(variable => ({
    path,
    variable,
    archivedForecasts: 0,
    opportunitiesAtSameLocationAndValidTime: 0,
    qualifiedPhysicalObservationsPresent: 0,
    temporallyAdmissible: 0,
    admissiblePairs: 0,
    retainedComparisons: 0,
    firstRejectionCounts: {},
    temporalRule,
  }));
}

export function recordHourlyComparisonFirstRejection(
  diagnostic: HourlyComparisonDiagnostic,
  reason: HourlyComparisonFirstRejectionReason
): void {
  diagnostic.firstRejectionCounts[reason] =
    (diagnostic.firstRejectionCounts[reason] ?? 0) + 1;
}
