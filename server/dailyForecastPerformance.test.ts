import { describe, expect, it } from "vitest";
import type { ForecastRun } from "../drizzle/schema";
import { aggregateDailyForecastPerformance, buildDailyForecastObservationComparisons, buildForecastRunArchiveRows, getDailyForecastHorizon } from "./dailyForecastPerformance";
import { OFFICIAL_HOURLY_MODELS } from "./weatherServices";
import type { PhysicalSnapshot } from "./physicalObservationAggregation";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";

const locationKey = "50.7567_2.5204";
const validDate = "2026-10-02";
const issuedAt = Date.parse("2026-10-01T22:00:00.000Z");

function makeForecast() {
  return {
    serviceName: "AROME",
    serviceCategory: "expert" as const,
    tempMax: 20,
    tempMin: 10,
    precipitation: 3,
    windSpeed: 15,
    windGust: 22,
    humidity: 60,
    cloudCover: 40,
    condition: null,
    rawData: {
      daily: {
        time: ["2026-10-02", "2026-10-03"],
        temperature_2m_max: [20, 21],
        temperature_2m_min: [10, 11],
        precipitation_sum: [3, 4],
        wind_speed_10m_max: [15, 16],
        wind_gusts_10m_max: [22, 23],
        relative_humidity_2m_mean: [60, 61],
        cloud_cover_mean: [40, 41],
      },
    },
  };
}

function snapshots(): PhysicalSnapshot[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const observedAt = (parisLocalHourToUniqueEpochMs(validDate, hour) ?? 0) + 10 * 60_000;
    const temperature = 8 + hour / 2;
    const windSpeed = 7 + hour / 2;
    const windGust = 12 + hour / 2;
    const precipitation = 0.5;
    const timestamp = new Date(observedAt).toISOString();
    return {
      date: validDate,
      hour,
      stationCount: 1,
      temperature,
      windSpeed,
      windGust,
      precipitation,
      stationsUsed: [{
        stationId: "mf-59000",
        name: "Station physique test",
        source: "meteofrance",
        observedAt: timestamp,
        measurementTimes: { temperature: timestamp, windSpeed: timestamp, windGust: timestamp, precipitation: timestamp },
        temperature,
        windSpeed,
        windGust,
        precipitation,
        weight: 1,
      }],
    };
  });
}

describe("daily production forecast performance archive", () => {
  it("archives the provider’s actual dates and raw forecast values", () => {
    const rows = buildForecastRunArchiveRows([makeForecast()], locationKey, validDate, issuedAt);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.validDate)).toEqual(["2026-10-02", "2026-10-03"]);
    expect(rows[0].tempMax).toBe(20);
    expect(rows[0].tempMin).toBe(10);
    expect(rows[0].precipitation).toBe(3);
    expect(rows[1].tempMax).toBe(21);
    expect(rows[0].rawData).toEqual(makeForecast().rawData);
  });

  it("classifies the same target day by the lead time from issue to Paris-local day end", () => {
    expect(getDailyForecastHorizon(issuedAt, validDate)).toEqual({ bucket: "6-24h", leadTimeMinutes: 1440 });
    expect(getDailyForecastHorizon(Date.parse("2026-10-01T08:00:00.000Z"), validDate)?.bucket).toBe("1-3d");
  });

  it("records separate comparisons for supported variables only with qualified physical coverage", () => {
    const archive = buildForecastRunArchiveRows([makeForecast()], locationKey, validDate, issuedAt);
    const run = { ...archive[0], id: 101, capturedAt: new Date(issuedAt + 60_000) } as ForecastRun;
    const rows = buildDailyForecastObservationComparisons(locationKey, validDate, [run], snapshots());

    expect(rows.map((row) => row.variable).sort()).toEqual([
      "precipitation_sum",
      "temperature_max",
      "temperature_min",
      "wind_gust_max",
      "wind_speed_max",
    ]);
    expect(rows.every((row) => row.horizonBucket === "6-24h" && row.evidenceType === "physical_observation" && row.observationIsQualified === 1)).toBe(true);
    expect(rows.find((row) => row.variable === "precipitation_sum")?.observedValue).toBe(12);
    expect(rows.find((row) => row.variable === "precipitation_sum")?.observationCoverageHours).toBe(24);
    expect(rows.find((row) => row.variable === "temperature_max")).toMatchObject({ forecastValue: 20, signedError: 0.5 });

    expect(buildDailyForecastObservationComparisons(locationKey, validDate, [], snapshots())).toEqual([]);
    expect(buildDailyForecastObservationComparisons("autre-lieu", validDate, [run], snapshots())).toEqual([]);
  });

  it("ne transforme pas plusieurs captures d’un même jour en plusieurs jours indépendants", () => {
    const archive = buildForecastRunArchiveRows([makeForecast()], locationKey, validDate, issuedAt);
    const run = { ...archive[0], id: 101, capturedAt: new Date(issuedAt + 60_000) } as ForecastRun;
    const first = buildDailyForecastObservationComparisons(locationKey, validDate, [run], snapshots())
      .find((row) => row.variable === "temperature_max")!;
    const second = {
      ...first,
      forecastRunId: 102,
      comparisonKey: "102:temperature_max",
      forecastValue: Number(first.forecastValue) + 0.4,
      signedError: Number(first.signedError) + 0.4,
      absoluteError: Math.abs(Number(first.signedError) + 0.4),
    };
    const [score] = aggregateDailyForecastPerformance([first, second]);

    expect(score.comparisonCount).toBe(2);
    expect(score.sampleSize).toBe(1);
    expect(score.evaluatedDays).toBe(1);
    expect(score.signedBias).toBeCloseTo(0.7, 10);
    expect(score.latestScoreDate).toBe(validDate);
  });

  it("n’inclut dans les erreurs et effectifs que les paires antérieures et prouvées par une station physique", () => {
    const archive = buildForecastRunArchiveRows([makeForecast()], locationKey, validDate, issuedAt);
    const run = { ...archive[0], id: 101, capturedAt: new Date(issuedAt + 60_000) } as ForecastRun;
    const validPair = buildDailyForecastObservationComparisons(locationKey, validDate, [run], snapshots())
      .find((row) => row.variable === "temperature_max")!;
    const invalidPairs = [
      { ...validPair, forecastValue: 999, forecastAvailableAt: validPair.observationWindowStartAt },
      { ...validPair, forecastValue: 999, stationEvidence: [{ ...validPair.stationEvidence![0], stationId: "openmeteo-grid", source: "openmeteo" }] },
      { ...validPair, forecastValue: 999, stationEvidence: null },
      { ...validPair, forecastValue: 999, stationEvidence: [{ ...validPair.stationEvidence![0], observedAt: Date.parse("2026-10-01T20:00:00.000Z") }] },
    ];

    const [score] = aggregateDailyForecastPerformance([validPair, ...invalidPairs]);
    expect(score.comparisonCount).toBe(1);
    expect(score.sampleSize).toBe(1);
    expect(score.mae).toBeCloseTo(0.5);
  });

  it("conserve l’archive Best Match comme référence sans créer ni agréger sa preuve de fusion", () => {
    const forecasts = [
      ...OFFICIAL_HOURLY_MODELS.map((model) => ({ ...makeForecast(), serviceName: model.name })),
      { ...makeForecast(), serviceName: "Open-Meteo" },
    ];
    const archived = buildForecastRunArchiveRows(forecasts, locationKey, validDate, issuedAt);
    const targetRows = archived.filter((row) => row.validDate === validDate);
    const bestMatchArchive = targetRows.find((row) => row.serviceName === "Open-Meteo");
    const runs = targetRows.map((row, index) => ({ ...row, id: index + 1, capturedAt: new Date(issuedAt + 60_000) })) as ForecastRun[];
    const comparisons = buildDailyForecastObservationComparisons(locationKey, validDate, runs, snapshots());

    expect(targetRows).toHaveLength(8);
    expect(bestMatchArchive).toMatchObject({ serviceName: "Open-Meteo", modelId: "best_match" });
    expect(comparisons).toHaveLength(7 * 5);
    expect(comparisons.every((row) => row.serviceName !== "Open-Meteo" && row.modelId !== "best_match")).toBe(true);

    const legacyBestMatchProof = {
      ...comparisons[0]!,
      forecastRunId: 999,
      comparisonKey: "999:temperature_max",
      serviceName: "Open-Meteo",
      modelId: "best_match",
    };
    expect(aggregateDailyForecastPerformance([...comparisons, legacyBestMatchProof])).toEqual(
      aggregateDailyForecastPerformance(comparisons),
    );
    expect(aggregateDailyForecastPerformance([...comparisons, legacyBestMatchProof])
      .every((item) => item.serviceName !== "Open-Meteo" && item.modelId !== "best_match")).toBe(true);
  });
});
