import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(new URL("../legacy-mysql/0051_hourly_exact_horizon_calibration.sql", import.meta.url), "utf8");
const migrationJournal = JSON.parse(readFileSync(new URL("../legacy-mysql/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};
const validationVersionMigrationSql = readFileSync(new URL("../legacy-mysql/0055_hourly_scoring_validation_version.sql", import.meta.url), "utf8");
const validationVersionSnapshot = JSON.parse(readFileSync(new URL("../legacy-mysql/meta/0055_snapshot.json", import.meta.url), "utf8")) as any;
const previousSnapshot = JSON.parse(readFileSync(new URL("../legacy-mysql/meta/0054_snapshot.json", import.meta.url), "utf8")) as any;
const databaseSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const officialHourlySource = readFileSync(new URL("./officialHourlyForecast.ts", import.meta.url), "utf8");

describe("migration 0051 de calibration horaire au lead exact", () => {
  it("n’ajoute que les deux tables exactes et leurs index, sans opération destructive ni DML", () => {
    const statements = migrationSql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);

    expect(statements).toHaveLength(6);
    expect(statements.every((statement) => /^(CREATE TABLE|CREATE INDEX)\b/i.test(statement))).toBe(true);
    expect(migrationSql).not.toMatch(/\b(?:ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(migrationSql).toContain("CREATE TABLE `hourly_forecast_exact_comparisons`");
    expect(migrationSql).toContain("CREATE TABLE `hourly_forecast_exact_evaluation_scores`");
    expect(migrationSql).toContain("UNIQUE(`forecastRunValueId`,`observationSnapshotId`)");
    expect(migrationSql).toContain("`horizonMilliseconds` bigint NOT NULL");
    expect(migrationSql).toContain("UNIQUE(`locationKey`,`date`,`sourceName`,`modelName`,`variable`,`horizonMilliseconds`)");
  });

  it("conserve son entrée Drizzle sans prétendre que la migration a été appliquée", () => {
    expect(migrationJournal.entries.find((entry) => entry.tag === "0051_hourly_exact_horizon_calibration")).toMatchObject({
      idx: 51,
      tag: "0051_hourly_exact_horizon_calibration",
      // The journal records generated migrations; it does not record database application state.
      version: expect.any(String),
    });
  });
});

describe("migration 0055 de versionnement des preuves horaires", () => {
  it("ajoute seulement une colonne nullable aux deux tables d’agrégats, sans réécrire l’historique", () => {
    const statements = validationVersionMigrationSql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);

    expect(statements).toHaveLength(2);
    expect(statements.every((statement) => /^ALTER TABLE\b/i.test(statement))).toBe(true);
    expect(validationVersionMigrationSql).toContain("ALTER TABLE `hourly_forecast_evaluation_scores` ADD `scoringValidationVersion` int");
    expect(validationVersionMigrationSql).toContain("ALTER TABLE `hourly_forecast_exact_evaluation_scores` ADD `scoringValidationVersion` int");
    expect(validationVersionMigrationSql).not.toMatch(/\b(?:CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|RENAME)\b/i);
  });

  it("enregistre les filtres legacy/current et l’upsert de version sans prétendre appliquer la migration", () => {
    expect(migrationJournal.entries.find((entry) => entry.tag === "0055_hourly_scoring_validation_version")).toMatchObject({
      idx: 55,
      tag: "0055_hourly_scoring_validation_version",
    });
    expect(databaseSource).toContain("scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION");
    expect(databaseSource).toContain("eq(hourlyForecastEvaluationScores.scoringValidationVersion, HOURLY_SCORING_VALIDATION_VERSION)");
    expect(databaseSource).toContain("isNull(hourlyForecastEvaluationScores.scoringValidationVersion)");
    expect(databaseSource).toContain("eq(hourlyForecastExactEvaluationScores.scoringValidationVersion, HOURLY_SCORING_VALIDATION_VERSION)");
    expect(officialHourlySource).toContain("const filterHistory = options.historyBasis === 'provider_run'");
    expect(officialHourlySource).toContain("row.leadBasis==='provider_run'&&row.scoringValidationVersion===2");
    expect(officialHourlySource).toContain(": filterCurrentHourlyScoringRows;");
    expect(officialHourlySource).toContain("filterHistory(historyScores)");
    expect(officialHourlySource).toContain("filterHistory(options.exactHistoryScores ?? [])");
    expect(validationVersionSnapshot.prevId).toBe(previousSnapshot.id);
    for (const tableName of ["hourly_forecast_evaluation_scores", "hourly_forecast_exact_evaluation_scores"]) {
      expect(validationVersionSnapshot.tables[tableName].columns.scoringValidationVersion).toMatchObject({
        type: "int",
        notNull: false,
      });
    }
  });
});
