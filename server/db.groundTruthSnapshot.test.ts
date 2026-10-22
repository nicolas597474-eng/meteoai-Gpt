import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsertGroundTruth } from "../drizzle/schema";

const fakeDatabase = vi.hoisted(() => {
  const limit = vi.fn();
  const where = vi.fn();
  const from = vi.fn();
  const select = vi.fn();
  const values = vi.fn();
  const insert = vi.fn();
  const db = { select, insert };
  const drizzle = vi.fn(() => db);
  return { db, drizzle, limit, where, from, select, values, insert };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: fakeDatabase.drizzle }));

import { upsertGroundTruthSnapshot } from "./db";

describe("archive Ground Truth avec confiance non mesurée", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://unit.test.invalid/meteoai";
    fakeDatabase.limit.mockResolvedValue([]);
    fakeDatabase.where.mockReturnValue({ limit: fakeDatabase.limit });
    fakeDatabase.from.mockReturnValue({ where: fakeDatabase.where });
    fakeDatabase.select.mockReturnValue({ from: fakeDatabase.from });
    fakeDatabase.values.mockResolvedValue(undefined);
    fakeDatabase.insert.mockReturnValue({ values: fakeDatabase.values });
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("persiste null dans la colonne nullable existante sans écrire un zéro synthétique", async () => {
    const snapshot: InsertGroundTruth = {
      date: "2026-10-05",
      refLat: 50.756,
      refLon: 2.521,
      radiusKm: 20,
      stationsUsed: [{ stationId: "wind-only" }],
      stationsIgnored: [],
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: 12,
      windGust: null,
      precipitation: null,
      stationCount: 0,
      confidenceScore: null,
    };

    await upsertGroundTruthSnapshot(snapshot);

    expect(fakeDatabase.drizzle).toHaveBeenCalledOnce();
    expect(fakeDatabase.values).toHaveBeenCalledWith(snapshot);
    expect(fakeDatabase.values.mock.calls[0]?.[0]).toMatchObject({
      temperature: null,
      windSpeed: 12,
      stationCount: 0,
      confidenceScore: null,
    });
  });

  it("transmet sans valeur par défaut le score nullable depuis le traitement planifié", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function collectFavoritesForecastsHandler");
    const end = source.indexOf("export async function collectPhysicalObservationSnapshotsForFavorites", start);
    const handler = source.slice(start, end);

    expect(handler).toContain("const localSynthesis = calculateGroundTruth(physicalStations);");
    expect(handler).toContain("await upsertGroundTruthSnapshot({");
    expect(handler).toContain("confidenceScore: localSynthesis.confidenceScore,");
    expect(handler).not.toContain("confidenceScore: localSynthesis.confidenceScore ?? 0");
  });
});
