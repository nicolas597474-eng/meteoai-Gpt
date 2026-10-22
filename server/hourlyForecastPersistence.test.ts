import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HourlyForecastPersistenceError, withHourlyForecastPersistenceStages } from "./hourlyForecastPersistence";
import { formatHourlyJournalWriteError } from "./hourlyJournalErrors";

describe("hourly forecast persistence confirmations", () => {
  it("returns only row counts reported after successful archive and projection writes", async () => {
    const archiveRows = vi.fn(async (confirm: (count: number) => void) => {
      confirm(6 * 24);
    });
    const projectionRows = vi.fn(async (confirm: (count: number) => void) => {
      confirm(24);
    });

    await expect(withHourlyForecastPersistenceStages(archiveRows, projectionRows)).resolves.toEqual({
      archiveRowsWritten: 144,
      projectionRowsWritten: 24,
    });
  });

  it("archive un lot incomplet sans appeler le writer qui remplace la projection existante", async () => {
    const archiveRows = vi.fn(async (confirm: (count: number) => void) => {
      confirm(48 * 20);
    });
    const projectionRows = vi.fn(async (confirm: (count: number) => void) => {
      confirm(24);
    });

    await expect(withHourlyForecastPersistenceStages(archiveRows, projectionRows, { skipProjection: true })).resolves.toEqual({
      archiveRowsWritten: 960,
      projectionRowsWritten: 0,
    });
    expect(archiveRows).toHaveBeenCalledOnce();
    expect(projectionRows).not.toHaveBeenCalled();
  });

  it("does not count uncommitted archive rows or update the projection after archive failure", async () => {
    const projectionRows = vi.fn();
    const error = await withHourlyForecastPersistenceStages(async () => {
      throw new Error("sensitive database driver detail");
    }, projectionRows).catch((caught) => caught);

    expect(error).toBeInstanceOf(HourlyForecastPersistenceError);
    expect(error).toMatchObject({ errorCode: "archive_write_failed", archiveRowsWritten: 0, projectionRowsWritten: 0 });
    expect(error.message).not.toContain("sensitive database driver detail");
    expect(projectionRows).not.toHaveBeenCalled();
  });

  it("preserves only earlier transaction counts when a later archive batch fails", async () => {
    const error = await withHourlyForecastPersistenceStages(async (confirm) => {
      confirm(60); // The first transaction committed successfully.
      throw new Error("private connection string omitted");
    }, async () => {}).catch((caught) => caught);

    expect(error).toMatchObject({ errorCode: "archive_write_failed", archiveRowsWritten: 60, projectionRowsWritten: 0 });
    expect(error.message).not.toContain("private connection string");
  });

  it("reports committed archive rows separately when projection refresh fails", async () => {
    const error = await withHourlyForecastPersistenceStages(async (confirm) => {
      confirm(108);
    }, async (confirm) => {
      confirm(12);
      throw new Error("secret SQL error");
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(HourlyForecastPersistenceError);
    expect(error).toMatchObject({ errorCode: "projection_write_failed", archiveRowsWritten: 108, projectionRowsWritten: 12 });
    expect(error.message).not.toContain("secret SQL error");
  });

  it("retient la cause SQL exacte quand la projection échoue après l’archive", async () => {
    const driverError = Object.assign(new Error("Unknown column 'validTime' in 'field list'"), {
      code: "ER_BAD_FIELD_ERROR",
      errno: 1054,
      sqlState: "42S22",
      sqlMessage: "Unknown column 'validTime' in 'field list'",
    });
    const drizzleError = new Error("Drizzle query failed", { cause: driverError });
    const error = await withHourlyForecastPersistenceStages(async confirm => {
      confirm(480);
    }, async () => {
      throw drizzleError;
    }).catch(caught => caught);

    expect(error).toBeInstanceOf(HourlyForecastPersistenceError);
    expect(error).toMatchObject({
      errorCode: "projection_write_failed",
      archiveRowsWritten: 480,
      projectionRowsWritten: 0,
      cause: drizzleError,
    });
    expect(formatHourlyJournalWriteError(error)).toContain(
      'message="Unknown column \'validTime\' in \'field list\'"; code=ER_BAD_FIELD_ERROR'
    );
  });

  it("keeps collection-attempt upserts idempotent by batch, location and source", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    const projectionStart = db.indexOf("}, async (confirmCommittedRows) => {");
    const projectionEnd = db.indexOf("\n  }, { skipProjection: options.refreshProjection === false });\n}", projectionStart);
    const projectionWriter = db.slice(projectionStart, projectionEnd);
    expect(schema).toContain('uniqueIndex("hourly_collection_attempt_source_unique").on(table.batchAttemptId, table.locationKey, table.modelName)');
    expect(db).toContain("onDuplicateKeyUpdate({");
    expect(db).toContain("eq(hourlyForecastCollectionResults.batchAttemptId, latest[0].batchAttemptId)");
    expect(projectionWriter).toContain("await db.transaction(async (tx) => {");
    expect(projectionWriter.indexOf("await db.transaction")).toBeLessThan(projectionWriter.indexOf("confirmCommittedRows(rows.length)"));
    expect(projectionWriter).not.toContain("confirmCommittedRows(activeRows.length)");
  });
});
