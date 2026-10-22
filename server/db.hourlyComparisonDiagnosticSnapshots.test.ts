import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDatabase = vi.hoisted(() => {
  const insert = vi.fn();
  const select = vi.fn();
  const drizzle = vi.fn();
  const values = vi.fn();
  const onDuplicateKeyUpdate = vi.fn();
  return {
    db: { insert, select },
    drizzle,
    insert,
    select,
    values,
    onDuplicateKeyUpdate,
    insertedRows: [] as unknown[],
    readResults: [] as unknown[][],
    whereCalls: [] as unknown[],
  };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: fakeDatabase.drizzle }));

import {
  getLatestHourlyComparisonDiagnosticSnapshot,
  upsertHourlyComparisonDiagnosticSnapshot,
} from "./db";

const diagnostics = [
  {
    path: "ordinary_hourly" as const,
    variable: "temperature",
    archivedForecasts: 12,
    opportunitiesAtSameLocationAndValidTime: 10,
    qualifiedPhysicalObservationsPresent: 8,
    temporallyAdmissible: 6,
    admissiblePairs: 5,
    retainedComparisons: 4,
    firstRejectionCounts: { FORECAST_AVAILABLE_AT_OR_AFTER_VALID_TIME: 2 },
    temporalRule: "availableAt < validTime",
  },
];

describe("instantané des diagnostics horaires", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://unit.test.invalid/meteoai";
    fakeDatabase.insertedRows = [];
    fakeDatabase.readResults = [];
    fakeDatabase.whereCalls = [];
    fakeDatabase.drizzle.mockReturnValue(fakeDatabase.db);
    fakeDatabase.insert.mockReturnValue({ values: fakeDatabase.values });
    fakeDatabase.values.mockImplementation((row: unknown) => {
      fakeDatabase.insertedRows.push(row);
      return { onDuplicateKeyUpdate: fakeDatabase.onDuplicateKeyUpdate };
    });
    fakeDatabase.onDuplicateKeyUpdate.mockResolvedValue(undefined);
    fakeDatabase.select.mockImplementation(() => {
      const rows = fakeDatabase.readResults.shift() ?? [];
      const query: Record<string, any> = {};
      query.from = vi.fn(() => query);
      query.where = vi.fn((condition: unknown) => {
        fakeDatabase.whereCalls.push(condition);
        return query;
      });
      query.limit = vi.fn(() => Promise.resolve(rows));
      return query;
    });
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("remplace le dernier instantané par lieu sans append ni réécriture d’autres tables", async () => {
    const result = await upsertHourlyComparisonDiagnosticSnapshot({
      locationKey: "50.757_2.52",
      cycleDate: "2026-10-06",
      diagnostics,
    });

    expect(result).toBe(true);
    expect(fakeDatabase.insertedRows).toHaveLength(1);
    expect(fakeDatabase.insertedRows[0]).toMatchObject({
      locationKey: "50.757_2.52",
      cycleDate: "2026-10-06",
      diagnostics,
      capturedAt: expect.any(Date),
    });
    expect(fakeDatabase.onDuplicateKeyUpdate).toHaveBeenCalledWith({
      set: expect.objectContaining({
        cycleDate: "2026-10-06",
        diagnostics,
        capturedAt: expect.any(Date),
      }),
    });
    expect(fakeDatabase.select).not.toHaveBeenCalled();
  });

  it("lit uniquement le snapshot demandé et renvoie null si aucun cycle n’est archivé", async () => {
    const snapshot = {
      locationKey: "50.757_2.52",
      cycleDate: "2026-10-06",
      diagnostics,
      capturedAt: new Date("2026-10-07T01:00:00.000Z"),
    };
    fakeDatabase.readResults = [[snapshot], []];

    await expect(
      getLatestHourlyComparisonDiagnosticSnapshot("50.757_2.52")
    ).resolves.toEqual(snapshot);
    await expect(
      getLatestHourlyComparisonDiagnosticSnapshot("51.000_2.000")
    ).resolves.toBeNull();

    expect(fakeDatabase.select).toHaveBeenCalledTimes(2);
    expect(fakeDatabase.whereCalls).toHaveLength(2);
    expect(fakeDatabase.insert).not.toHaveBeenCalled();
  });
});
