import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHourlyForecastEvaluationHistory: vi.fn(),
  getQualifiedObservationSnapshotsByDateRange: vi.fn(),
  getHourlyForecastRunValuesByDateRange: vi.fn(),
  makeLocationKey: vi.fn(() => "50.757_2.52"),
}));

vi.mock("./db", () => mocks);

import { buildReliabilityLaboratory } from "./weatherReliabilityLab";
import { OFFICIAL_HOURLY_MODELS } from "./weatherServices";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";

const LOC = "50.757_2.52";
const MODEL = OFFICIAL_HOURLY_MODELS[0]!;

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function snapshot(date: string, hour: number) {
  const base = parisLocalHourToUniqueEpochMs(date, hour)!;
  const measurement = iso(base);
  return {
    id: 1,
    locationKey: LOC,
    date,
    hour,
    stationCount: 1,
    temperature: 10 + hour * 0.1,
    precipitation: 0,
    windSpeed: 10,
    windGust: 20,
    humidity: 80,
    pressure: 1015,
    collectedAt: new Date(base + 5 * 60_000),
    confidenceScore: 90,
    stationsUsed: [
      {
        stationId: "mf-07005",
        name: "LILLE-LESQUIN",
        source: "meteofrance",
        observedAt: measurement,
        measurementTimes: {
          temperature: measurement,
          humidity: measurement,
          pressure: measurement,
          windSpeed: measurement,
          windGust: measurement,
          windDirection: measurement,
          precipitation: measurement,
        },
        fieldWeights: { temperature: 1, precipitation: 1, windSpeed: 1, windGust: 1, humidity: 1, pressure: 1 },
        weight: 1,
        temperature: 10 + hour * 0.1,
        precipitation: 0,
        windSpeed: 10,
        windGust: 20,
        humidity: 80,
        pressure: 1015,
      },
    ],
  };
}

function runValues(dates: readonly string[]) {
  return dates.flatMap((date) =>
    Array.from({ length: 24 }, (_, hour) => {
      const validTime = parisLocalHourToUniqueEpochMs(date, hour)!;
      const availableAt = validTime - 12 * 3_600_000;
      return {
        id: 1,
        captureRunId: `run-${date}-${hour}`,
        locationKey: LOC,
        targetDate: date,
        sourceName: "open-meteo",
        modelName: MODEL.name,
        modelId: MODEL.modelId,
        requestStartedAt: availableAt - 60_000,
        availableAt,
        validTime,
        variable: "temperature",
        value: 10 + hour * 0.1 + 0.5,
        unit: "°C",
      };
    }),
  );
}

const DATES = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];

describe("Laboratoire — recalcul en lecture seule des dates sans agrégat archivé", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00.000Z"));
    mocks.getHourlyForecastEvaluationHistory.mockReset();
    mocks.getQualifiedObservationSnapshotsByDateRange.mockReset();
    mocks.getHourlyForecastRunValuesByDateRange.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("affiche la preuve archivée immuable quand l'archive agrégée est vide", async () => {
    mocks.getHourlyForecastEvaluationHistory.mockResolvedValue({
      available: true,
      rows: [],
      legacyRows: [],
      exactAvailable: false,
      exactRows: [],
    });
    mocks.getQualifiedObservationSnapshotsByDateRange.mockResolvedValue(
      DATES.flatMap((date) => Array.from({ length: 24 }, (_, hour) => snapshot(date, hour))),
    );
    mocks.getHourlyForecastRunValuesByDateRange.mockResolvedValue(runValues(DATES));

    const result = await buildReliabilityLaboratory({ lat: 50.7567, lon: 2.5204, period: "7d", horizon: "6-24h" });
    const cell = result.metrics.find((row) => row.modelName === MODEL.name && row.variable === "temperature");

    expect(cell).toMatchObject({
      status: "qualified",
      metrics: {
        mae: 0.5,
        comparisonCount: 24 * DATES.length,
        evaluatedDays: DATES.length,
      },
    });
    expect(result.evidence.recomputedScoreRows).toBeGreaterThan(0);
    expect(result.availability.recompute).toContain("recalculée(s) en lecture seule");
    const horizon = result.horizonEvidence.find((item) => item.id === "6-24h");
    expect(horizon).toMatchObject({ status: "available", qualifiedCellCount: 1 });
  });

  it("ne compte jamais deux fois une date déjà archivée", async () => {
    mocks.getHourlyForecastEvaluationHistory.mockResolvedValue({
      available: true,
      rows: DATES.map((date) => ({
        date,
        sourceName: "open-meteo",
        modelName: MODEL.name,
        modelId: MODEL.modelId,
        variable: "temperature",
        horizonBucket: "6_24h",
        sampleSize: 10,
        mae: 1.5,
        rmse: 2,
        bias: 0.5,
        scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION,
      })),
      legacyRows: [],
      exactAvailable: false,
      exactRows: [],
    });
    mocks.getQualifiedObservationSnapshotsByDateRange.mockResolvedValue(
      DATES.flatMap((date) => Array.from({ length: 24 }, (_, hour) => snapshot(date, hour))),
    );
    mocks.getHourlyForecastRunValuesByDateRange.mockResolvedValue(runValues(DATES));

    const result = await buildReliabilityLaboratory({ lat: 50.7567, lon: 2.5204, period: "7d", horizon: "6-24h" });
    const cell = result.metrics.find((row) => row.modelName === MODEL.name && row.variable === "temperature");

    // Seules les lignes stockées comptent : 7 dates × 10 comparaisons, pas 7 × (10 + 24).
    expect(cell).toMatchObject({
      status: "qualified",
      metrics: { mae: 1.5, comparisonCount: 10 * DATES.length, evaluatedDays: DATES.length },
    });
    expect(result.evidence.recomputedScoreRows).toBe(0);
  });

  it("reste silencieux quand aucune entrée immuable n'existe", async () => {
    mocks.getHourlyForecastEvaluationHistory.mockResolvedValue({
      available: true,
      rows: [],
      legacyRows: [],
      exactAvailable: false,
      exactRows: [],
    });
    mocks.getQualifiedObservationSnapshotsByDateRange.mockResolvedValue([]);
    mocks.getHourlyForecastRunValuesByDateRange.mockResolvedValue([]);

    const result = await buildReliabilityLaboratory({ lat: 50.7567, lon: 2.5204, period: "7d", horizon: "6-24h" });
    const cell = result.metrics.find((row) => row.modelName === MODEL.name && row.variable === "temperature");

    expect(cell).toMatchObject({ status: "no_evidence", metrics: null, rawMetrics: null });
    expect(result.availability.recompute).toContain("Aucune date");
  });
});
