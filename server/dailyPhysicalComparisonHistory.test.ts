import { describe, expect, it } from "vitest";
import type {
  DailyForecastObservationComparison,
  DailyForecastObservationComparisonRevision,
} from "../drizzle/schema";
import {
  buildDailyPhysicalComparisonHistoryPage,
  DEFAULT_DAILY_COMPARISON_PAGE_SIZE,
  MAX_DAILY_COMPARISON_PAGE_SIZE,
  normalizeDailyComparisonPageSize,
  unavailableDailyPhysicalComparisonHistory,
} from "./dailyPhysicalComparisonHistory";

const locationKey = "50.7567_2.5204";

function row(overrides: Partial<DailyForecastObservationComparison> = {}): DailyForecastObservationComparison {
  return {
    id: 1,
    comparisonKey: "1:temperature_max",
    forecastRunId: 1,
    locationKey,
    validDate: "2026-10-02",
    serviceName: "AROME",
    provider: "open-meteo",
    modelId: "meteofrance_arome_france_hd",
    horizonBucket: "6-24h",
    leadTimeMinutes: 840,
    variable: "temperature_max",
    forecastValue: 20,
    observedValue: 18,
    signedError: 2,
    absoluteError: 2,
    evidenceType: "physical_observation",
    observationIsQualified: 1,
    observationCoverageHours: 24,
    forecastAvailableAt: Date.parse("2026-10-01T08:00:00.000Z"),
    observationWindowStartAt: Date.parse("2026-10-02T07:00:00.000Z"),
    observationWindowEndAt: Date.parse("2026-10-02T07:00:00.000Z"),
    stationEvidence: [{
      stationId: "mf-59000",
      stationName: "Station physique",
      source: "meteofrance",
      snapshotHour: 9,
      observedAt: Date.parse("2026-10-02T07:00:00.000Z"),
      value: 18,
      weight: 1,
    }],
    createdAt: new Date("2026-10-03T01:00:00.000Z"),
    ...overrides,
  };
}

describe("historique des comparaisons physiques quotidiennes", () => {
  it("combine les filtres de lieu, dates, modèle, variable et horizon sur les champs archivés", () => {
    const matching = row({ id: 3, validDate: "2026-10-02" });
    const rows = [
      matching,
      row({ id: 4, validDate: "2026-10-01" }),
      row({ id: 5, serviceName: "GFS" }),
      row({ id: 6, variable: "temperature_min" }),
      row({ id: 7, horizonBucket: "1-3d" }),
      row({ id: 8, locationKey: "autre_lieu" }),
      row({ id: 9, evidenceType: "physical_observation", observationIsQualified: 0 }),
      row({ id: 10, forecastAvailableAt: null, observationWindowStartAt: null, observationWindowEndAt: null, stationEvidence: null }),
      row({ id: 11, forecastAvailableAt: Date.parse("2026-10-02T08:00:00.000Z") }),
      row({ id: 12, stationEvidence: [{ stationId: "openmeteo-grid", source: "openmeteo", observedAt: Date.parse("2026-10-02T07:00:00.000Z") }] }),
      row({ id: 13, stationEvidence: [{ stationId: "mf-59000", source: "meteofrance", observedAt: Date.parse("2026-10-01T20:00:00.000Z") }] }),
    ];

    const result = buildDailyPhysicalComparisonHistoryPage(rows, {
      locationKey,
      validDateFrom: "2026-10-02",
      validDateTo: "2026-10-03",
      serviceName: "AROME",
      variable: "temperature_max",
      horizonBucket: "6-24h",
      pageSize: 25,
    });

    expect(result.status).toBe("available");
    expect(result.rows).toEqual([matching]);
    expect(result.rows.every((item) => item.evidenceType === "physical_observation"
      && item.observationIsQualified === 1
      && item.forecastAvailableAt! < item.observationWindowStartAt!
      && item.stationEvidence != null)).toBe(true);
  });

  it("n’émet pas de page suivante quand il n’y a aucune preuve correspondante", () => {
    const result = buildDailyPhysicalComparisonHistoryPage([], { locationKey });
    expect(result).toEqual({ status: "empty", rows: [], hasMore: false, nextCursor: null });
  });

  it("préserve les métadonnées de révision dans le lecteur paginé distinct", () => {
    const { createdAt: _createdAt, ...comparisonFields } = row();
    const revision: DailyForecastObservationComparisonRevision = {
      ...comparisonFields,
      revisionHash: "a".repeat(64),
      recordedAt: new Date("2026-10-03T02:00:00.000Z"),
    };

    const result = buildDailyPhysicalComparisonHistoryPage([revision], { locationKey });

    expect(result.status).toBe("available");
    expect(result.rows[0]).toMatchObject({
      comparisonKey: revision.comparisonKey,
      revisionHash: revision.revisionHash,
      recordedAt: revision.recordedAt,
    });
  });

  it("borne la taille de page et fournit un curseur stable basé sur date valide et id", () => {
    const rows = [
      row({ id: 5, validDate: "2026-10-02" }),
      row({ id: 4, validDate: "2026-10-02" }),
      row({
        id: 3,
        validDate: "2026-10-01",
        forecastAvailableAt: Date.parse("2026-09-30T08:00:00.000Z"),
        observationWindowStartAt: Date.parse("2026-10-01T07:00:00.000Z"),
        observationWindowEndAt: Date.parse("2026-10-01T07:00:00.000Z"),
        stationEvidence: [{ stationId: "mf-59000", stationName: "Station physique", source: "meteofrance", snapshotHour: 9, observedAt: Date.parse("2026-10-01T07:00:00.000Z"), value: 18, weight: 1 }],
      }),
    ];
    const result = buildDailyPhysicalComparisonHistoryPage(rows, { locationKey, pageSize: 2 });

    expect(result.status).toBe("available");
    expect(result.rows.map((item) => item.id)).toEqual([5, 4]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({ validDate: "2026-10-02", id: 4 });

    const nextPage = buildDailyPhysicalComparisonHistoryPage(rows, {
      locationKey,
      pageSize: 2,
      cursor: result.nextCursor!,
    });
    expect(nextPage.status).toBe("available");
    expect(nextPage.rows.map((item) => item.id)).toEqual([3]);
    expect(nextPage.hasMore).toBe(false);
    expect(normalizeDailyComparisonPageSize(undefined)).toBe(DEFAULT_DAILY_COMPARISON_PAGE_SIZE);
    expect(normalizeDailyComparisonPageSize(10_000)).toBe(MAX_DAILY_COMPARISON_PAGE_SIZE);
  });

  it("distingue l’indisponibilité de la base et celle de la table de production", () => {
    expect(unavailableDailyPhysicalComparisonHistory("database_unavailable")).toMatchObject({
      status: "unavailable",
      reason: "database_unavailable",
      rows: [],
    });
    expect(unavailableDailyPhysicalComparisonHistory("table_unavailable")).toMatchObject({
      status: "unavailable",
      reason: "table_unavailable",
      rows: [],
    });
  });
});
