import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsertStationObservation } from "../drizzle/schema";

const fakeDatabase = vi.hoisted(() => {
  const insertValues = vi.fn();
  const insert = vi.fn();
  const select = vi.fn();
  const drizzle = vi.fn();
  const db = { insert, select };
  return {
    db,
    drizzle,
    insert,
    insertValues,
    select,
    selectCount: 0,
    results: [] as unknown[][],
  };
});

vi.mock("drizzle-orm/mysql2", () => ({ drizzle: fakeDatabase.drizzle }));

import { getPhysicalStationHistory, insertStationObservationIfMissing, upsertStationObservation } from "./db";

describe("archives station_observations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://unit.test.invalid/meteoai";
    fakeDatabase.selectCount = 0;
    fakeDatabase.results = [];
    fakeDatabase.drizzle.mockReturnValue(fakeDatabase.db);
    fakeDatabase.select.mockImplementation(() => {
      const selectIndex = ++fakeDatabase.selectCount;
      const rows = fakeDatabase.results.shift() ?? [];
      const query: Record<string, any> = {};
      query.from = vi.fn(() => query);
      query.where = vi.fn(() => query);
      query.orderBy = vi.fn(() => selectIndex === 3 ? query : Promise.resolve(rows));
      query.limit = vi.fn(() => Promise.resolve(rows));
      return query;
    });
    fakeDatabase.insertValues.mockResolvedValue(undefined);
    fakeDatabase.insert.mockReturnValue({ values: fakeDatabase.insertValues });
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("transmet le dictionnaire source exact au writer DB sans fallback ni réécriture", async () => {
    const measurementTimes = {
      temperature: "2026-10-05T12:01:00.000Z",
      humidity: null,
      pressure: "timestamp-mal-formé",
      windSpeed: "2026-10-05T12:04:00+02:00",
    };
    const observation: InsertStationObservation = {
      stationId: "station-writer-test",
      observedAt: Date.parse("2026-10-05T12:05:00.000Z"),
      measurementTimes,
      temperature: 18,
      humidity: 60,
      pressure: null,
      windSpeed: 12,
      windGust: null,
      windDirection: null,
      precipitation: null,
    };

    await upsertStationObservation(observation);

    expect(fakeDatabase.insertValues).toHaveBeenCalledWith(observation);
    expect(fakeDatabase.insertValues.mock.calls[0]?.[0].measurementTimes).toEqual(measurementTimes);
  });

  it("conserve le premier relevé lorsque stationId et observedAt existent déjà", async () => {
    const observation: InsertStationObservation = {
      stationId: "station-duplicate-test",
      observedAt: Date.parse("2026-10-05T12:05:00.000Z"),
      measurementTimes: { temperature: "2026-10-05T12:05:00.000Z" },
      temperature: 18,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windGust: null,
      windDirection: null,
      precipitation: null,
    };
    fakeDatabase.results = [[{ id: 42 }]];

    await expect(insertStationObservationIfMissing(observation)).resolves.toBe(false);
    expect(fakeDatabase.insert).not.toHaveBeenCalled();
    expect(fakeDatabase.insertValues).not.toHaveBeenCalled();
  });

  it("restitue measurementTimes inchangé depuis le lecteur des archives physiques", async () => {
    const measurementTimes = {
      temperature: "2026-10-05T12:01:00.000Z",
      humidity: null,
      windSpeed: "2026-10-05T12:04:00+02:00",
    };
    const station = {
      stationId: "station-reader-test",
      refLat: 50.75,
      refLon: 2.5,
      isActive: 1,
    };
    const reading = {
      stationId: station.stationId,
      observedAt: Date.parse("2026-10-05T12:05:00.000Z"),
      measurementTimes,
      temperature: 18,
      humidity: 60,
      pressure: null,
      windSpeed: 12,
      windGust: null,
      windDirection: null,
      precipitation: null,
      collectedAt: new Date("2026-10-05T12:06:00.000Z"),
    };
    fakeDatabase.results = [[station], [reading], []];

    const history = await getPhysicalStationHistory(50.75, 2.5, 0);

    expect(history.stations[0]?.readings).toEqual([reading]);
    expect(history.stations[0]?.readings[0]?.measurementTimes).toEqual(measurementTimes);
  });
});
