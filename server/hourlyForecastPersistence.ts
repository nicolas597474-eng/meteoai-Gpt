export type HourlyForecastPersistenceErrorCode = "database_unavailable" | "archive_write_failed" | "projection_write_failed";

/** Safe, classified persistence failure with counts committed before the failure. */
export class HourlyForecastPersistenceError extends Error {
  constructor(
    readonly errorCode: HourlyForecastPersistenceErrorCode,
    readonly archiveRowsWritten: number,
    readonly projectionRowsWritten: number,
    cause?: unknown,
  ) {
    super(`Hourly forecast persistence failed (${errorCode}).`, { cause });
    this.name = "HourlyForecastPersistenceError";
  }
}

/**
 * Run immutable archive writes before refreshing the current projection.
 * Writers report only committed row counts; a failed later batch preserves the
 * exact count already confirmed by earlier transactions.
 */
export async function withHourlyForecastPersistenceStages(
  writeArchive: (confirmCommittedRows: (count: number) => void) => Promise<void>,
  writeProjection: (confirmCommittedRows: (count: number) => void) => Promise<void>,
  options: { skipProjection?: boolean } = {},
): Promise<{ archiveRowsWritten: number; projectionRowsWritten: number }> {
  let archiveRowsWritten = 0;
  let projectionRowsWritten = 0;
  try {
    await writeArchive((count) => {
      if (Number.isFinite(count) && count > 0) archiveRowsWritten += Math.floor(count);
    });
  } catch (error) {
    throw new HourlyForecastPersistenceError("archive_write_failed", archiveRowsWritten, projectionRowsWritten, error);
  }
  if (options.skipProjection) return { archiveRowsWritten, projectionRowsWritten };
  try {
    await writeProjection((count) => {
      if (Number.isFinite(count) && count > 0) projectionRowsWritten += Math.floor(count);
    });
  } catch (error) {
    throw new HourlyForecastPersistenceError("projection_write_failed", archiveRowsWritten, projectionRowsWritten, error);
  }
  return { archiveRowsWritten, projectionRowsWritten };
}
