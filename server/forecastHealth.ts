export type HourlyForecastRunStatus =
  | "succeeded"
  | "partial"
  | "failed"
  | "safe_error";

export interface HourlyForecastArchiveCoverage {
  archiveRowsWritten: number;
  expectedValueCount: number;
}

/** True only when every expected hourly forecast value reached the main archive. */
export function isHourlyForecastArchiveComplete(
  coverage: HourlyForecastArchiveCoverage
): boolean {
  return (
    coverage.expectedValueCount > 0 &&
    coverage.archiveRowsWritten === coverage.expectedValueCount
  );
}

export interface HourlyForecastRunHealth extends HourlyForecastArchiveCoverage {
  isOfficialModel: boolean;
  status: HourlyForecastRunStatus;
  projectionRowsWritten: number;
  expectedHoursCount: number;
  resultJournaled: boolean;
}

/**
 * The batch's hourly health counter is intentionally stricter than archive coverage:
 * the full archive, consumer projection, and final per-model journal record must exist.
 */
export function isHourlyForecastRunHealthy(
  result: HourlyForecastRunHealth
): boolean {
  return (
    result.isOfficialModel &&
    result.status === "succeeded" &&
    result.resultJournaled &&
    isHourlyForecastArchiveComplete(result) &&
    result.expectedHoursCount > 0 &&
    result.projectionRowsWritten === result.expectedHoursCount
  );
}
