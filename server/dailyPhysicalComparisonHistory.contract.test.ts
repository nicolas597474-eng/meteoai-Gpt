import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const start = dbSource.indexOf("export async function getDailyPhysicalComparisonHistory(");
const end = dbSource.indexOf("export async function getDailyPhysicalComparisonRevisionHistory(", start);
const readerSource = dbSource.slice(start, end);
const revisionsStart = dbSource.indexOf("export async function getDailyPhysicalComparisonRevisionHistory(");
const revisionsEnd = dbSource.indexOf("export async function getDailyFusionPerformanceEvidence(", revisionsStart);
const revisionsReaderSource = dbSource.slice(revisionsStart, revisionsEnd);
const scoringStart = dbSource.indexOf("export async function getDailyFusionPerformanceEvidence(");
const scoringEnd = dbSource.indexOf("/** Upsert the daily local synthesis", scoringStart);
const scoringReaderSource = dbSource.slice(scoringStart, scoringEnd);

describe("contrat de lecture de l’historique quotidien physique", () => {
  it("ne lit que l’archive de production et exclut explicitement les preuves non physiques/non qualifiées", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(readerSource).toContain(".from(dailyForecastObservationComparisons)");
    expect(readerSource).toContain('eq(dailyForecastObservationComparisons.evidenceType, "physical_observation")');
    expect(readerSource).toContain("eq(dailyForecastObservationComparisons.observationIsQualified, 1)");
    expect(readerSource).toContain("isNotNull(dailyForecastObservationComparisons.forecastAvailableAt)");
    expect(readerSource).toContain("lt(dailyForecastObservationComparisons.forecastAvailableAt, dailyForecastObservationComparisons.observationWindowStartAt)");
    expect(readerSource).toContain("isNotNull(dailyForecastObservationComparisons.stationEvidence)");
    expect(readerSource).not.toContain("shadowWeatherPhase8Comparisons");
    expect(readerSource).not.toContain("shadowWeatherPhase7");
  });

  it("reste strictement en lecture seule et distingue l’absence de table de l’absence de base", () => {
    expect(readerSource).toContain("db.select()");
    expect(readerSource).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(readerSource).toContain('unavailableDailyPhysicalComparisonHistory("database_unavailable")');
    expect(readerSource).toContain("isDailyComparisonTableUnavailable(error)");
    expect(readerSource).toContain('unavailableDailyPhysicalComparisonHistory("table_unavailable")');
  });

  it("lit le journal append-only séparément et ne reconstruit pas les lignes legacy", () => {
    expect(revisionsStart).toBeGreaterThanOrEqual(0);
    expect(revisionsEnd).toBeGreaterThan(revisionsStart);
    expect(revisionsReaderSource).toContain(".from(dailyForecastObservationComparisonRevisions)");
    expect(revisionsReaderSource).toContain("db.select()");
    expect(revisionsReaderSource).not.toContain(".insert(");
    expect(revisionsReaderSource).not.toContain(".update(");
    expect(revisionsReaderSource).not.toContain(".delete(");
  });

  it("ne mélange pas les révisions dans le jeu de preuves du scoring existant", () => {
    expect(scoringStart).toBeGreaterThanOrEqual(0);
    expect(scoringEnd).toBeGreaterThan(scoringStart);
    expect(scoringReaderSource).toContain(".from(dailyForecastObservationComparisons)");
    expect(scoringReaderSource).not.toContain("dailyForecastObservationComparisonRevisions");
  });
});
