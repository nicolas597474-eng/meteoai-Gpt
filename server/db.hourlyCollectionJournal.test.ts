import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDatabase = vi.hoisted(() => {
  const insert = vi.fn();
  const drizzle = vi.fn();
  const values = vi.fn();
  const onDuplicateKeyUpdate = vi.fn();
  return {
    db: { insert },
    drizzle,
    insert,
    values,
    onDuplicateKeyUpdate,
    insertedRows: [] as unknown[],
    updateSets: [] as unknown[],
  };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: fakeDatabase.drizzle }));

import {
  HOURLY_COLLECTION_ERROR_CODE_MAX_LENGTH,
  upsertHourlyForecastCollectionResults,
} from "./db";

function collectionResult(overrides: Record<string, unknown> = {}) {
  return {
    collectionJobId: 1,
    scheduleRunKey: "paris_08_2026-10-09",
    batchAttemptId: "5f0b3a5e-8f2c-4c1e-9d7a-2b3c4d5e6f70",
    locationKey: "50.700_2.500",
    targetDate: "2026-10-09",
    modelName: "ARPEGE",
    modelId: "meteofrance_arpege_europe",
    isOfficialModel: 1,
    sourceName: "open-meteo",
    status: "partial",
    requestAttempts: 1,
    hoursReceived: 24,
    valuesReceived: 420,
    expectedValueCount: 480,
    archiveRowsWritten: 420,
    projectionRowsWritten: 24,
    variableCoverage: null,
    errorCode: null,
    attemptedAt: 1_761_000_000_000,
    completedAt: null,
    ...overrides,
  } as any;
}

describe("upsertHourlyForecastCollectionResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://unit.test.invalid/meteoai";
    fakeDatabase.insertedRows = [];
    fakeDatabase.updateSets = [];
    fakeDatabase.drizzle.mockReturnValue(fakeDatabase.db);
    fakeDatabase.insert.mockReturnValue({ values: fakeDatabase.values });
    fakeDatabase.values.mockImplementation((row: unknown) => {
      fakeDatabase.insertedRows.push(row);
      return { onDuplicateKeyUpdate: fakeDatabase.onDuplicateKeyUpdate };
    });
    fakeDatabase.onDuplicateKeyUpdate.mockImplementation((arg: { set: unknown }) => {
      fakeDatabase.updateSets.push(arg.set);
    });
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("n'émet aucune écriture pour un lot vide", async () => {
    await upsertHourlyForecastCollectionResults([]);
    expect(fakeDatabase.insert).not.toHaveBeenCalled();
  });

  it("tronque un code trop long à la limite varchar(32) au lieu de faire échouer le journal", async () => {
    await upsertHourlyForecastCollectionResults([
      collectionResult({ errorCode: "partial_archive_projection_published" }),
    ]);

    expect(fakeDatabase.insertedRows).toHaveLength(1);
    const inserted = fakeDatabase.insertedRows[0] as { errorCode: string | null };
    expect(inserted.errorCode).toHaveLength(HOURLY_COLLECTION_ERROR_CODE_MAX_LENGTH);
    expect(inserted.errorCode).toBe("partial_archive_projection_publi");
    const updateSet = fakeDatabase.updateSets[0] as { errorCode: string | null };
    expect(updateSet.errorCode).toBe("partial_archive_projection_publi");
  });

  it("conserve les codes courts et les absences de code", async () => {
    await upsertHourlyForecastCollectionResults([
      collectionResult({ errorCode: "no_usable_data" }),
      collectionResult({ errorCode: null }),
    ]);

    expect(fakeDatabase.insertedRows).toHaveLength(2);
    expect((fakeDatabase.insertedRows[0] as { errorCode: string | null }).errorCode).toBe("no_usable_data");
    expect((fakeDatabase.insertedRows[1] as { errorCode: string | null }).errorCode).toBeNull();
    expect((fakeDatabase.updateSets[1] as { errorCode: string | null }).errorCode).toBeNull();
  });
});
