import { describe, expect, it } from "vitest";
import { isCompleteHourlyForecastBatch, isCompleteStoredHourlyProjection } from "./hourlyForecastCompleteness";
import { getParisDateAndHour } from "./parisHourlyTime";
import { getParisDate, getParisHour, getParisHourlyTimestamps } from "./weatherTime";

describe("isCompleteHourlyForecastBatch", () => {
  it("accepte une grille Paris complète de 23, 24 ou 25 heures avec des instants UTC distincts", () => {
    const springTimes = getParisHourlyTimestamps("2026-03-29");
    const ordinaryTimes = getParisHourlyTimestamps("2026-03-28");
    const fallTimes = getParisHourlyTimestamps("2026-10-25");

    expect(springTimes).toHaveLength(23);
    expect(ordinaryTimes).toHaveLength(24);
    expect(fallTimes).toHaveLength(25);
    expect(fallTimes.filter((validAt) => getParisHour(new Date(validAt)) === 2)).toHaveLength(2);
    expect(new Set(fallTimes).size).toBe(25);

    for (const expectedValidTimes of [springTimes, ordinaryTimes, fallTimes]) {
      const rows = expectedValidTimes.map((validAt) => ({ validAt, temperature: 10, precipitation: 0 }));
      expect(isCompleteHourlyForecastBatch({
        rows,
        expectedValidTimes,
        requiredValueFields: ["temperature", "precipitation"],
      })).toBe(true);
      expect(rows.every((row) => getParisDate(new Date(row.validAt)) === getParisDate(new Date(expectedValidTimes[0]!)))).toBe(true);
    }
  });

  it("rejette une heure manquante, répétée, hors grille ou un champ de projection absent", () => {
    const expectedValidTimes = getParisHourlyTimestamps("2026-10-25");
    const completeRows = expectedValidTimes.map((validAt) => ({ validAt, temperature: 10, precipitation: 0 }));
    const missingHour = completeRows.slice(1);
    const duplicateHour = [...completeRows.slice(1), { ...completeRows[0]!, validAt: completeRows[1]!.validAt }];
    const unexpectedHour = completeRows.map((row, index) => index === 0 ? { ...row, validAt: row.validAt + 60_000 } : row);
    const missingProjectedValue = completeRows.map((row, index) => index === 12 ? { ...row, temperature: null } : row);

    const input = { expectedValidTimes, requiredValueFields: ["temperature", "precipitation"] };
    expect(isCompleteHourlyForecastBatch({ ...input, rows: missingHour })).toBe(false);
    expect(isCompleteHourlyForecastBatch({ ...input, rows: duplicateHour })).toBe(false);
    expect(isCompleteHourlyForecastBatch({ ...input, rows: unexpectedHour })).toBe(false);
    expect(isCompleteHourlyForecastBatch({ ...input, rows: missingProjectedValue })).toBe(false);
  });
});

describe("isCompleteStoredHourlyProjection", () => {
  it("valide les multiplicités locales de 23/24/25 lignes sans prétendre identifier les deux instants 02:00", () => {
    const requiredValueFields = ["temperature", "precipitation"];
    for (const date of ["2026-03-29", "2026-03-28", "2026-10-25"]) {
      const expectedValidTimes = getParisHourlyTimestamps(date);
      const rows = expectedValidTimes.map((validAt) => ({
        hour: getParisDateAndHour(validAt)!.hour,
        temperature: 12,
        precipitation: 0,
        secondaryArchiveOnlyValue: null,
      }));

      expect(isCompleteStoredHourlyProjection({ rows, expectedValidTimes, requiredValueFields })).toBe(true);
    }
  });

  it("rejette une projection locale tronquée ou un champ actif null, sans exiger les champs secondaires d’archive", () => {
    const expectedValidTimes = getParisHourlyTimestamps("2026-10-25");
    const rows = expectedValidTimes.map((validAt) => ({
      hour: getParisDateAndHour(validAt)!.hour,
      temperature: 12,
      precipitation: 0,
      secondaryArchiveOnlyValue: null,
    }));

    expect(isCompleteStoredHourlyProjection({ rows: rows.slice(1), expectedValidTimes, requiredValueFields: ["temperature", "precipitation"] })).toBe(false);
    expect(isCompleteStoredHourlyProjection({
      rows: rows.map((row, index) => index === 5 ? { ...row, temperature: null } : row),
      expectedValidTimes,
      requiredValueFields: ["temperature", "precipitation"],
    })).toBe(false);
    expect(isCompleteStoredHourlyProjection({ rows, expectedValidTimes, requiredValueFields: ["temperature", "precipitation"] })).toBe(true);
  });
});
