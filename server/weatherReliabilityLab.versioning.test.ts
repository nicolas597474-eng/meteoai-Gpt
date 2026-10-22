import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHourlyForecastEvaluationHistory: vi.fn(),
  getQualifiedObservationSnapshotsByDateRange: vi.fn(() => []),
  getHourlyForecastRunValuesByDateRange: vi.fn(() => []),
  makeLocationKey: vi.fn(() => "50.700_2.500"),
}));

vi.mock("./db", () => mocks);

import { OFFICIAL_HOURLY_MODELS } from "./weatherServices";
import { buildReliabilityLaboratory } from "./weatherReliabilityLab";

describe("Weather AI Lab — agrégats horaires bruts non validés", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    mocks.getHourlyForecastEvaluationHistory.mockReset();
    mocks.getHourlyForecastEvaluationHistory.mockResolvedValue({
      available: true,
      rows: [],
      legacyRows: [{
        date: "2026-10-04",
        sourceName: "open-meteo",
        modelName: OFFICIAL_HOURLY_MODELS[0]!.name,
        modelId: OFFICIAL_HOURLY_MODELS[0]!.modelId,
        variable: "temperature",
        horizonBucket: "6_24h",
        sampleSize: 35,
        mae: 0.5,
        rmse: 0.75,
        bias: 0.25,
        scoringValidationVersion: null,
      }],
      exactAvailable: false,
      exactRows: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expose les métriques brutes non validées sans jamais les compter comme preuves", async () => {
    const result = await buildReliabilityLaboratory({
      lat: 50.7,
      lon: 2.5,
      period: "30d",
      horizon: "6-24h",
    });
    const legacyOnly = result.metrics.find((row) =>
      row.modelName === OFFICIAL_HOURLY_MODELS[0]!.name && row.variable === "temperature");
    const noScore = result.metrics.find((row) =>
      row.modelName === OFFICIAL_HOURLY_MODELS[1]!.name && row.variable === "temperature");
    const selectedHorizonSummary = result.horizonEvidence.find((horizon) => horizon.id === "6-24h");
    const unarchivedHorizonSummary = result.horizonEvidence.find((horizon) => horizon.id === "24-48h");

    expect(mocks.getHourlyForecastEvaluationHistory).toHaveBeenCalledWith(
      "50.700_2.500",
      expect.any(String),
      expect.any(String),
      [],
      { includeLegacy: true },
    );
    expect(legacyOnly).toMatchObject({
      status: "legacy_unversioned_only",
      metrics: null,
      rawMetrics: {
        mae: 0.5,
        rmse: 0.75,
        bias: 0.25,
        comparisonCount: 35,
        evaluatedDays: 1,
      },
      legacyUnversionedRowCount: 1,
    });
    expect(legacyOnly?.reason).toContain("Données brutes non validées");
    expect(legacyOnly?.reason).toContain("exclues des preuves actuelles et des poids officiels");
    expect(noScore).toMatchObject({
      status: "no_evidence",
      metrics: null,
      rawMetrics: null,
      legacyUnversionedRowCount: 0,
    });
    expect(selectedHorizonSummary).toMatchObject({
      status: "available",
      rawEvidenceCellCount: 1,
      qualifiedCellCount: 0,
      expectedCellCount: OFFICIAL_HOURLY_MODELS.length * 6,
    });
    expect(unarchivedHorizonSummary).toMatchObject({
      status: "horizon_not_stored",
      rawEvidenceCellCount: null,
      qualifiedCellCount: null,
    });
  });
});
