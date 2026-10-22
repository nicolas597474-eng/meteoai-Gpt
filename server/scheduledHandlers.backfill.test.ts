import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HOURLY_SCORING_BACKFILL_MAX_SCORES_PER_NIGHT,
  HOURLY_SCORING_BACKFILL_WINDOW_DAYS,
  findMissingHourlyScoringDates,
  listHourlyScoringBackfillWindowDates,
} from "./scheduledHandlers";

describe("fenêtre de rattrapage du scoring horaire", () => {
  it("couvre 30 dates civiles Paris finissant à hier, les plus récentes d'abord", () => {
    // 00:40 heure de Paris le 12 octobre 2026 : la veille est le 11 octobre.
    const now = new Date("2026-10-12T00:40:00+02:00");

    const windowDates = listHourlyScoringBackfillWindowDates(now);

    expect(HOURLY_SCORING_BACKFILL_WINDOW_DAYS).toBe(30);
    expect(windowDates).toHaveLength(30);
    expect(new Set(windowDates).size).toBe(30);
    expect(windowDates[0]).toBe("2026-10-11");
    expect(windowDates[29]).toBe("2026-09-12");
  });

  it("traverse un changement d'heure sans décaler la fenêtre", () => {
    // 23:40 UTC le 14 janvier = 00:40 heure de Paris (CET) le 15 janvier.
    const now = new Date("2026-01-14T23:40:00.000Z");

    const windowDates = listHourlyScoringBackfillWindowDates(now);

    expect(windowDates[0]).toBe("2026-01-14");
    expect(windowDates).toHaveLength(30);
  });
});

describe("sélection des dates manquantes", () => {
  const windowDates = ["2026-10-11", "2026-10-10", "2026-10-09", "2026-10-08"];

  it("ne retient que les dates sans ligne archivée, l'ordre le plus récent d'abord est conservé", () => {
    const storedRows = [{ date: "2026-10-11" }, { date: "2026-10-09" }];

    expect(findMissingHourlyScoringDates(windowDates, storedRows)).toEqual(["2026-10-10", "2026-10-08"]);
  });

  it("compte aussi les lignes legacy (version NULL) comme preuve déjà scorée", () => {
    const storedRows = [{ date: "2026-10-11" }];
    const storedLegacyRows = [{ date: "2026-10-08" }];

    expect(findMissingHourlyScoringDates(windowDates, storedRows, storedLegacyRows)).toEqual(["2026-10-10", "2026-10-09"]);
  });

  it("ignore les lignes archivées hors de la fenêtre et ne retourne rien quand tout est scoré", () => {
    const completeRows = windowDates.map((date) => ({ date }));

    expect(findMissingHourlyScoringDates(windowDates, completeRows)).toEqual([]);
    expect(findMissingHourlyScoringDates(windowDates, [{ date: "2026-05-01" }])).toEqual(windowDates);
  });
});

describe("rattrapage planifié du scoring horaire", () => {
  const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");
  const scoring = source.slice(
    source.indexOf("async function scoreHourlyForecastDate"),
    source.indexOf("export async function collectObservationsHandler"),
  );
  const handlerStart = source.indexOf("export async function collectObservationsHandler");
  const handlerEnd = source.indexOf("function determineMajorityCondition", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  it("partage un unique chemin d'évaluation et de persistance entre la veille et le rattrapage", () => {
    expect(handler).toContain("await scoreHourlyForecastDate(locKey, yesterday, snapshots)");
    expect(handler).toContain("await scoreHourlyForecastDate(backfillLocKey, missingDate)");
    // La persistance des scores vit uniquement dans la fonction partagée.
    expect(handler).not.toContain("await persistHourlyForecastEvaluationScores(");
    expect(scoring).toContain("await persistHourlyForecastEvaluationScores(");
  });

  it("conserve intégralement le mapping des colonnes de score archivées", () => {
    for (const field of [
      "locationKey", "date", "sourceName", "modelName", "modelId", "variable",
      "horizonBucket", "observationCount", "evaluableObservationCount", "sampleSize",
      "coverageRatio", "mae", "rmse", "bias", "scoringValidationVersion",
    ]) {
      expect(scoring).toContain(`${field}: score.${field}`);
    }
  });

  it("garde les garde-fous : aucune écriture sans preuve archivée, budget borné par nuit", () => {
    expect(scoring).toContain("if (evidence.length === 0) return null;");
    expect(scoring).toContain("if (hourlyForecastRuns.length === 0) return null;");
    expect(scoring.indexOf("const evaluation = evaluateHourlyForecastRuns(")).toBeLessThan(
      scoring.indexOf("await persistHourlyForecastEvaluationScores("),
    );
    expect(HOURLY_SCORING_BACKFILL_MAX_SCORES_PER_NIGHT).toBeLessThanOrEqual(7);
    expect(handler).toContain("if (backfillScoredDates >= HOURLY_SCORING_BACKFILL_MAX_SCORES_PER_NIGHT) break;");
  });

  it("place le rattrapage après le scoring de la veille, sous le même lease, sans jamais faire échouer le passage", () => {
    expect(handler).toContain("listHourlyScoringBackfillWindowDates(now)");
    expect(handler).toContain("getHourlyForecastEvaluationHistory(");
    expect(handler).toContain("findMissingHourlyScoringDates(");
    const backfillStart = handler.indexOf("// Rattrapage planifié du scoring horaire");
    const backfillCatch = handler.indexOf("} catch (backfillError) {");
    const completedWrite = handler.indexOf('status: "completed"');
    expect(backfillStart).toBeGreaterThan(-1);
    expect(backfillStart).toBeLessThan(backfillCatch);
    expect(backfillCatch).toBeLessThan(completedWrite);
  });
});
