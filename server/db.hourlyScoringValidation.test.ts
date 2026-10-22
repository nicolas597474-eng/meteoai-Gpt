import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";

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
  getHourlyForecastEvaluationHistory,
  persistHourlyForecastEvaluationScores,
  persistHourlyForecastExactEvaluationScores,
} from "./db";

function bucketScore(scoringValidationVersion: number | null, sampleSize = 1) {
  return {
    locationKey: "50.700_2.500",
    date: "2026-10-04",
    sourceName: "open-meteo",
    modelName: "ECMWF",
    modelId: "ecmwf_ifs025",
    variable: "temperature",
    horizonBucket: "6_24h",
    observationCount: 1,
    evaluableObservationCount: 1,
    sampleSize,
    coverageRatio: sampleSize > 0 ? 1 : 0,
    mae: sampleSize > 0 ? 0.4 : null,
    rmse: sampleSize > 0 ? 0.5 : null,
    bias: sampleSize > 0 ? 0.1 : null,
    scoringValidationVersion,
  };
}

function exactScore(scoringValidationVersion: number | null, sampleSize = 1) {
  return {
    ...bucketScore(scoringValidationVersion, sampleSize),
    horizonMilliseconds: 6 * 60 * 60_000,
    horizonMinutes: 360,
  };
}

describe("hourly scoring validation persistence and reads", () => {
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
      query.orderBy = vi.fn(() => Promise.resolve(rows));
      return query;
    });
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("archive les lignes brutes non validées sans jamais remplacer une ligne validée", async () => {
    const currentBucket = bucketScore(HOURLY_SCORING_VALIDATION_VERSION);
    const emptyBucket = bucketScore(HOURLY_SCORING_VALIDATION_VERSION, 0);
    const rawBucket = bucketScore(null);
    await persistHourlyForecastEvaluationScores([
      rawBucket,
      emptyBucket,
      currentBucket,
    ]);

    expect(fakeDatabase.insertedRows).toEqual([currentBucket, rawBucket]);
    expect(fakeDatabase.onDuplicateKeyUpdate).toHaveBeenCalledTimes(2);
    expect(fakeDatabase.onDuplicateKeyUpdate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      set: expect.objectContaining({ scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION }),
    }));
    expect(fakeDatabase.onDuplicateKeyUpdate.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      set: { modelId: "ecmwf_ifs025" },
    }));

    vi.clearAllMocks();
    fakeDatabase.insertedRows = [];
    fakeDatabase.insert.mockReturnValue({ values: fakeDatabase.values });
    fakeDatabase.values.mockImplementation((row: unknown) => {
      fakeDatabase.insertedRows.push(row);
      return { onDuplicateKeyUpdate: fakeDatabase.onDuplicateKeyUpdate };
    });
    fakeDatabase.onDuplicateKeyUpdate.mockResolvedValue(undefined);
    fakeDatabase.drizzle.mockReturnValue(fakeDatabase.db);

    const currentExact = exactScore(HOURLY_SCORING_VALIDATION_VERSION);
    expect(await persistHourlyForecastExactEvaluationScores([
      exactScore(null),
      exactScore(HOURLY_SCORING_VALIDATION_VERSION, 0),
      currentExact,
    ])).toBe(true);
    expect(fakeDatabase.insertedRows).toEqual([currentExact]);
    expect(fakeDatabase.onDuplicateKeyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({ scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION }),
    }));
  });

  it("renvoie les scores stricts aux poids et expose séparément les lignes NULL au diagnostic", async () => {
    const current = { date: "2026-10-04", scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION };
    const legacy = { date: "2026-10-03", scoringValidationVersion: null };
    fakeDatabase.readResults = [[current], [legacy]];

    const result = await getHourlyForecastEvaluationHistory(
      "50.700_2.500",
      "2026-09-01",
      "2026-10-04",
      [],
      { includeLegacy: true },
    );

    expect(result).toMatchObject({ available: true, rows: [current], legacyRows: [legacy] });
    expect(fakeDatabase.select).toHaveBeenCalledTimes(2);
    expect(fakeDatabase.whereCalls).toHaveLength(2);
  });
});
