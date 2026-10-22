import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../legacy-mysql/0050_prevision-vs-observation.sql", import.meta.url), "utf8");

function functionSource(name: string, nextMarker: string): string {
  const start = dbSource.indexOf(`export async function ${name}(`);
  const end = dbSource.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dbSource.slice(start, end);
}

describe("contrat d’immutabilité de l’archive des runs", () => {
  it("n’actualise jamais une émission fournisseur dupliquée", () => {
    const writer = functionSource("insertForecastRuns", "export async function insertMeteoAIDailyFusionRun");
    expect(writer).toContain("await db.insert(forecastRuns).values(row)");
    expect(writer).toContain('error?.code === "ER_DUP_ENTRY"');
    expect(writer).not.toContain("onDuplicateKeyUpdate");
  });

  it("insère séparément les runs MeteoAI sans mettre à jour une émission existante", () => {
    const writer = functionSource("insertMeteoAIDailyFusionRun", "export async function getForecastsByDate");
    expect(writer).toContain('row.sourceKind !== "service_forecast"');
    expect(writer).toContain('row.modelId !== "meteoai-official-daily-v2"');
    expect(writer).toContain("await db.insert(forecastRuns).values(row)");
    expect(writer).not.toContain("onDuplicateKeyUpdate");
  });

  it("fournit une migration strictement additive sans application ni backfill", () => {
    expect(migration).toContain("ADD `forecastAvailableAt` bigint");
    expect(migration).toContain("ADD `observationWindowStartAt` bigint");
    expect(migration).toContain("ADD `observationWindowEndAt` bigint");
    expect(migration).toContain("ADD `stationEvidence` json");
    expect(migration).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT)\b/i);
  });
});
