import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dailyForecastObservationComparisonRevisions,
  dailyForecastObservationComparisons,
  type InsertDailyForecastObservationComparison,
} from "../drizzle/schema";

const fakeDatabase = vi.hoisted(() => {
  const seenRevisions = new Set<string>();
  const archivedRevisions: any[] = [];
  const currentProjectionWrites: any[] = [];
  const insert = vi.fn();
  const transaction = vi.fn();
  const db = { insert, transaction };
  const drizzle = vi.fn(() => db);
  return { db, drizzle, insert, transaction, seenRevisions, archivedRevisions, currentProjectionWrites };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: fakeDatabase.drizzle }));

import { upsertDailyForecastObservationComparisons } from "./db";

function comparison(overrides: Partial<InsertDailyForecastObservationComparison> = {}): InsertDailyForecastObservationComparison {
  return {
    comparisonKey: "412:temperature_max",
    forecastRunId: 412,
    locationKey: "50.757_2.52",
    validDate: "2026-10-04",
    serviceName: "AROME",
    provider: "open-meteo",
    modelId: "meteofrance_arome_france_hd",
    horizonBucket: "6-24h",
    leadTimeMinutes: 960,
    variable: "temperature_max",
    forecastValue: 18.5,
    observedValue: 17.8,
    signedError: 0.7,
    absoluteError: 0.7,
    evidenceType: "physical_observation",
    observationIsQualified: 1,
    observationCoverageHours: 24,
    forecastAvailableAt: 1791091200000,
    observationWindowStartAt: 1791133200000,
    observationWindowEndAt: 1791212400000,
    stationEvidence: [{ stationId: "station-1", observedAt: 1791133200000, value: 17.8 }],
    ...overrides,
  };
}

describe("writer de révisions des comparaisons quotidiennes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeDatabase.seenRevisions.clear();
    fakeDatabase.archivedRevisions.length = 0;
    fakeDatabase.currentProjectionWrites.length = 0;
    process.env.DATABASE_URL = "mysql://unit.test.invalid/meteoai";
    fakeDatabase.drizzle.mockReturnValue(fakeDatabase.db);
    fakeDatabase.transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => work({
      insert: fakeDatabase.insert,
    }));
    fakeDatabase.insert.mockImplementation((table: unknown) => ({
      values: vi.fn((payload: any) => {
        if (table === dailyForecastObservationComparisonRevisions) {
          const key = `${payload.comparisonKey}:${payload.revisionHash}`;
          if (fakeDatabase.seenRevisions.has(key)) {
            return Promise.reject(Object.assign(new Error("duplicate revision"), { code: "ER_DUP_ENTRY", errno: 1062 }));
          }
          fakeDatabase.seenRevisions.add(key);
          fakeDatabase.archivedRevisions.push(payload);
          return Promise.resolve();
        }
        if (table === dailyForecastObservationComparisons) {
          return {
            onDuplicateKeyUpdate: vi.fn(async ({ set }: { set: Record<string, unknown> }) => {
              fakeDatabase.currentProjectionWrites.push({ ...payload, ...set });
            }),
          };
        }
        throw new Error("Unexpected table in daily comparison writer");
      }),
    }));
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("ne duplique pas un retry exact, ajoute une nouvelle révision et conserve la projection courante pour le scoring", async () => {
    const original = comparison();
    const revised = comparison({
      observedValue: 18,
      signedError: 0.5,
      absoluteError: 0.5,
      observationWindowEndAt: 1791216000000,
    });

    expect(await upsertDailyForecastObservationComparisons([original])).toBe(true);
    expect(await upsertDailyForecastObservationComparisons([original])).toBe(true);
    expect(await upsertDailyForecastObservationComparisons([revised])).toBe(true);

    expect(fakeDatabase.archivedRevisions).toHaveLength(2);
    expect(fakeDatabase.archivedRevisions.map((item) => item.comparisonKey)).toEqual([
      "412:temperature_max",
      "412:temperature_max",
    ]);
    expect(new Set(fakeDatabase.archivedRevisions.map((item) => item.revisionHash)).size).toBe(2);
    expect(fakeDatabase.currentProjectionWrites).toHaveLength(3);
    expect(fakeDatabase.currentProjectionWrites.at(-1)).toMatchObject({
      comparisonKey: original.comparisonKey,
      observedValue: 18,
      absoluteError: 0.5,
    });
  });

  it("n’écrase pas la projection existante si le journal additif n’est pas migré", async () => {
    fakeDatabase.insert.mockImplementation((table: unknown) => ({
      values: vi.fn(() => table === dailyForecastObservationComparisonRevisions
        ? Promise.reject(Object.assign(new Error("missing revision table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }))
        : Promise.resolve()),
    }));

    await expect(upsertDailyForecastObservationComparisons([comparison()])).resolves.toBe(false);
    expect(fakeDatabase.currentProjectionWrites).toHaveLength(0);
  });
});
