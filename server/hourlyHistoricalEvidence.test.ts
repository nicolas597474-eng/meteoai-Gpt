import { describe, expect, it } from "vitest";
import { summarizeHourlyHistoricalEvidence, type HourlyHistoricalScoreRow } from "./hourlyHistoricalEvidence";

const key = { modelName: "ECMWF", modelId: "ecmwf_ifs025", variable: "temperature", horizonBucket: "0-6h", beforeDate: "2026-01-01", historyAvailable: true };
function row(date: string, sampleSize = 5, extra: Partial<HourlyHistoricalScoreRow> = {}): HourlyHistoricalScoreRow {
  return { date, sourceName: "open-meteo", modelName: key.modelName, modelId: key.modelId, variable: key.variable, horizonBucket: key.horizonBucket, sampleSize, mae: 2, rmse: 3, bias: -1, computedAt: `${date}T12:00:00.000Z`, ...extra };
}
function spreadRows(dates: string[], samplesPerDate: number, score: Partial<HourlyHistoricalScoreRow> = {}) {
  return dates.map((date) => row(date, samplesPerDate, score));
}
function daysBefore(reference: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${reference}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - index - 1);
    return date.toISOString().slice(0, 10);
  });
}

describe("summarizeHourlyHistoricalEvidence", () => {
  it("qualifies only at the existing 30-comparison and 7-day threshold and pools metrics by n", () => {
    const rows = [...spreadRows(daysBefore("2026-01-01", 7), 5, { mae: 2, rmse: 3, bias: -1 }), row("2025-12-25", 5, { mae: 4, rmse: 5, bias: 1 })];
    const result = summarizeHourlyHistoricalEvidence(rows, key);
    expect(result.status).toBe("qualified");
    expect(result.metrics).toMatchObject({ comparisonCount: 40, evaluatedDays: 7 });
    expect(result.metrics?.mae).toBe(2.25);
    expect(result.metrics?.rmse).toBeCloseTo(Math.sqrt((7 * 5 * 9 + 5 * 25) / 40));
    expect(result.metrics?.bias).toBe(-0.75);
    expect(result.firstScoreDate).toBe("2025-12-25");
  });

  it("qualifies exact leads independently, never pooling a neighboring millisecond horizon", () => {
    const exactLead = 7_176_000;
    const dates = daysBefore("2026-01-01", 7);
    const exactRows = [
      ...spreadRows(dates, 5, { mae: 2, rmse: 3, bias: -1, horizonMilliseconds: exactLead }),
      ...spreadRows(dates, 100, { mae: 99, rmse: 100, bias: 50, horizonMilliseconds: exactLead + 1 }),
    ];

    const exact = summarizeHourlyHistoricalEvidence(exactRows, { ...key, horizonMilliseconds: exactLead });
    expect(exact.status).toBe("qualified");
    expect(exact.metrics).toMatchObject({ comparisonCount: 35, evaluatedDays: 7, mae: 2, bias: -1 });

    const sixDays = summarizeHourlyHistoricalEvidence(
      spreadRows(dates.slice(0, 6), 5, { horizonMilliseconds: exactLead }),
      { ...key, horizonMilliseconds: exactLead },
    );
    expect(sixDays.status).toBe("insufficient_evidence");
    expect(sixDays.metrics).toMatchObject({ comparisonCount: 30, evaluatedDays: 6 });
  });

  it("leaves insufficient, absent, unavailable, wrong-horizon and incomplete evidence explicit", () => {
    const sixDays = spreadRows(daysBefore("2026-01-01", 6), 5);
    expect(summarizeHourlyHistoricalEvidence(sixDays, key).status).toBe("insufficient_evidence");
    expect(summarizeHourlyHistoricalEvidence([], key).status).toBe("no_evidence");
    expect(summarizeHourlyHistoricalEvidence([], { ...key, historyAvailable: false }).status).toBe("history_unavailable");
    expect(summarizeHourlyHistoricalEvidence([row("2025-12-30", 40)], { ...key, horizonBucket: "6-24h" }).status).toBe("no_evidence");
    expect(summarizeHourlyHistoricalEvidence([row("2025-12-30", 40, { bias: null })], key).status).toBe("incomplete_metrics");
  });

  it("exclut Best Match, les mauvais identifiants et les dates futures", () => {
    const rows = [
      ...spreadRows(daysBefore("2026-01-01", 7), 5),
      row("2025-12-31", 100, { modelName: "Best Match", modelId: null }),
      row("2025-12-31", 100, { modelId: "wrong-model-id" }),
      row("2026-01-02", 100),
    ];
    const result = summarizeHourlyHistoricalEvidence(rows, key);
    expect(result.metrics?.comparisonCount).toBe(35);
    expect(result.metrics?.evaluatedDays).toBe(7);
  });

  it("keeps the selected metric period separate from the 60-day trend evidence window", () => {
    const recentDates = daysBefore("2026-01-01", 7);
    const previousDates = daysBefore("2025-12-02", 7);
    const rows = [
      ...spreadRows(recentDates, 5, { mae: 1, rmse: 2, bias: -0.5 }),
      ...spreadRows(previousDates, 5, { mae: 3, rmse: 4, bias: 1 }),
    ];
    const result = summarizeHourlyHistoricalEvidence(rows, { ...key, periodStartDate: "2025-12-25" });

    expect(result.metrics).toMatchObject({ comparisonCount: 35, evaluatedDays: 7, mae: 1 });
    expect(result.firstScoreDate).toBe("2025-12-25");
    expect(result.trend.status).toBe("qualified");
    expect(result.trend.delta).toMatchObject({ mae: -2, rmse: -2, bias: -1.5 });
  });

  it("publishes the 30-day MAE/RMSE/bias change only when both windows meet the same evidence gate", () => {
    const recentDates = daysBefore("2026-01-01", 7);
    const previousDates = daysBefore("2025-12-02", 7);
    const rows = [
      ...spreadRows(recentDates, 5, { mae: 1, rmse: 2, bias: -0.5 }),
      ...spreadRows(previousDates, 5, { mae: 3, rmse: 4, bias: 1 }),
    ];
    const result = summarizeHourlyHistoricalEvidence(rows, key);
    expect(result.trend.status).toBe("qualified");
    expect(result.trend.delta).toMatchObject({ mae: -2, rmse: -2, bias: -1.5 });
    expect(summarizeHourlyHistoricalEvidence(spreadRows(recentDates, 5), key).trend.status).toBe("no_evidence");
  });
});
