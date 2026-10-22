import { describe, expect, it } from "vitest";
import {
  evaluateHourlyForecastRuns,
  type HourlyForecastRunValue,
  type HourlyPhysicalSnapshot,
} from "./hourlyForecastRunScoring";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";

const LOC = "50.757_2.52";
const DATE = "2026-10-11";

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function baseSnapshot(hour: number): HourlyPhysicalSnapshot {
  const base = parisLocalHourToUniqueEpochMs(DATE, hour)!;
  return {
    locationKey: LOC,
    date: DATE,
    hour,
    stationCount: 1,
    temperature: 12,
    precipitation: null,
    windSpeed: null,
    windGust: null,
    humidity: null,
    pressure: null,
    collectedAt: iso(base + 5 * 60_000),
    confidenceScore: 90,
    stationsUsed: [
      {
        stationId: "mf-07005",
        source: "meteofrance",
        observedAt: iso(base),
        fieldWeights: { temperature: 1 },
        weight: 1,
        temperature: 12,
      },
    ],
  };
}

function runs(): HourlyForecastRunValue[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const validTime = parisLocalHourToUniqueEpochMs(DATE, hour)!;
    const availableAt = validTime - 12 * 3_600_000;
    return {
      captureRunId: `run-${hour}`,
      locationKey: LOC,
      targetDate: DATE,
      sourceName: "open-meteo",
      modelName: "AROME",
      modelId: "meteofrance_arome_france_hd",
      requestStartedAt: availableAt - 60_000,
      availableAt,
      validTime,
      variable: "temperature" as const,
      value: 12.5,
      unit: "°C",
    };
  });
}

describe("Scoring horaire — horodatage de mesure des snapshots anciens", () => {
  it("accepte l'horodatage absolu au niveau station quand le détail par champ n'existe pas", () => {
    const snapshots = Array.from({ length: 24 }, (_, hour) => baseSnapshot(hour));
    const evaluation = evaluateHourlyForecastRuns(snapshots, runs());
    const bucket = evaluation.scores.find(
      (score) => score.horizonBucket === "6_24h" && score.variable === "temperature",
    );
    expect(bucket?.sampleSize).toBe(24);
    expect(bucket?.mae).toBeCloseTo(0.5, 6);
    expect(bucket?.scoringValidationVersion).toBe(HOURLY_SCORING_VALIDATION_VERSION);
  });

  it("rejette toujours un champ dont la table d'horodatages ne porte pas l'heure de mesure", () => {
    const snapshots = Array.from({ length: 24 }, (_, hour) => {
      const base = parisLocalHourToUniqueEpochMs(DATE, hour)!;
      return {
        ...baseSnapshot(hour),
        stationsUsed: [
          {
            stationId: "mf-07005",
            source: "meteofrance",
            observedAt: iso(base),
            // Snapshot moderne : le détail par champ existe mais l'heure température manque.
            measurementTimes: { temperature: null },
            fieldWeights: { temperature: 1 },
            weight: 1,
            temperature: 12,
          },
        ],
      };
    });
    const evaluation = evaluateHourlyForecastRuns(snapshots, runs());
    const bucket = evaluation.scores.find(
      (score) => score.horizonBucket === "6_24h" && score.variable === "temperature",
    );
    expect(bucket?.sampleSize ?? 0).toBe(0);
    expect(bucket?.mae).toBeNull();
  });
});
