import { describe, expect, it } from "vitest";
import type { InsertDailyForecastObservationComparison } from "../drizzle/schema";
import { buildDailyForecastObservationComparisonRevision } from "./dailyForecastComparisonRevisions";

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

describe("révisions des comparaisons quotidiennes", () => {
  it("est idempotent pour le même snapshot, indépendamment de l’ordre des clés JSON", () => {
    const first = comparison({
      stationEvidence: [{ stationId: "station-1", nested: { source: "meteo-france", quality: 0.9 } }],
    });
    const retry = comparison({
      stationEvidence: [{ stationId: "station-1", nested: { quality: 0.9, source: "meteo-france" } }],
    });

    expect(buildDailyForecastObservationComparisonRevision(first)).toEqual(
      buildDailyForecastObservationComparisonRevision(retry),
    );
  });

  it("crée une empreinte différente dès qu’une valeur ou une preuve persistée change, sans redéfinir comparisonKey", () => {
    const original = buildDailyForecastObservationComparisonRevision(comparison());
    const correctedValue = buildDailyForecastObservationComparisonRevision(comparison({
      observedValue: 18,
      signedError: 0.5,
      absoluteError: 0.5,
    }));
    const correctedProvenance = buildDailyForecastObservationComparisonRevision(comparison({
      observationWindowEndAt: 1791216000000,
      stationEvidence: [{ stationId: "station-1", observedAt: 1791133200000, value: 17.8, source: "meteo-france" }],
    }));

    expect(original.comparisonKey).toBe(correctedValue.comparisonKey);
    expect(original.comparisonKey).toBe(correctedProvenance.comparisonKey);
    expect(new Set([original.revisionHash, correctedValue.revisionHash, correctedProvenance.revisionHash]).size).toBe(3);
    expect(original.revisionHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
