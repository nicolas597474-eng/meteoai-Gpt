import { describe, expect, it } from "vitest";
import { evaluateHourlyForecastRuns, normalizeHourlyForecastVariable, type HourlyForecastRunValue, type HourlyPhysicalSnapshot } from "./hourlyForecastRunScoring";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";

const locationKey = "50.756_2.520";
const date = "2026-09-29";
const observedAt = (hour: number) => parisLocalHourToUniqueEpochMs(date, hour)!;
const hourlyVariables: HourlyForecastRunValue["variable"][] = ["temperature", "precipitation", "wind_speed", "wind_gust", "humidity", "pressure"];

const stationFields = ["temperature", "precipitation", "windSpeed", "windGust", "humidity", "pressure"];

function stationEvidence(
  validTime: number,
  overrides: { fieldWeights?: Record<string, number>; measurementTimes?: Record<string, unknown>; observedAt?: string } = {},
): unknown[] {
  const defaultMeasurementTime = new Date(validTime - 5 * 60_000).toISOString();
  return [{
    stationId: "station-a",
    observedAt: overrides.observedAt ?? defaultMeasurementTime,
    fieldWeights: overrides.fieldWeights ?? Object.fromEntries(stationFields.map((field) => [field, 1])),
    measurementTimes: overrides.measurementTimes ?? Object.fromEntries(stationFields.map((field) => [field, defaultMeasurementTime])),
  }];
}

function snapshot(
  hour: number,
  temperature = 10,
  options: { date?: string; stationsUsed?: unknown } = {},
): HourlyPhysicalSnapshot {
  const snapshotDate = options.date ?? date;
  const validTime = parisLocalHourToUniqueEpochMs(snapshotDate, hour) ?? Date.parse(`${snapshotDate}T00:00:00.000Z`);
  return {
    locationKey,
    date: snapshotDate,
    hour,
    stationCount: 2,
    temperature,
    precipitation: 0,
    windSpeed: 8,
    windGust: 12,
    humidity: 70,
    pressure: 1015,
    stationsUsed: options.stationsUsed === undefined ? stationEvidence(validTime) : options.stationsUsed,
  };
}

function forecast(input: Partial<HourlyForecastRunValue> & Pick<HourlyForecastRunValue, "captureRunId" | "validTime" | "availableAt" | "variable" | "value">): HourlyForecastRunValue {
  return {
    id: input.id,
    captureRunId: input.captureRunId,
    locationKey: input.locationKey ?? locationKey,
    targetDate: input.targetDate ?? date,
    sourceName: input.sourceName ?? "open-meteo",
    modelName: input.modelName ?? "ECMWF",
    modelId: input.modelId ?? "ecmwf_ifs025",
    requestStartedAt: input.requestStartedAt ?? input.availableAt - 30_000,
    availableAt: input.availableAt,
    validTime: input.validTime,
    variable: input.variable,
    value: input.value,
    unit: input.unit ?? "°C",
  };
}

function scoresFor(result: ReturnType<typeof evaluateHourlyForecastRuns>, variable = "temperature") {
  return result.scores.filter((score) => score.variable === variable);
}

describe("evaluateHourlyForecastRuns", () => {
  it("normalise l'alias archive surface_pressure avant le scoring physique de pression", () => {
    const validTime = observedAt(12);
    const variable = normalizeHourlyForecastVariable("surface_pressure");
    expect(variable).toBe("pressure");
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      forecast({
        captureRunId: "pressure-alias-run",
        validTime,
        availableAt: validTime - 60 * 60_000,
        variable: variable!,
        value: 1012,
        unit: "hPa",
      }),
    ]);

    expect(scoresFor(result, "pressure").find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 1, mae: 3 });
    expect(scoresFor(result, "pressure").find((score) => score.horizonBucket === "0_2h")?.scoringValidationVersion).toBe(HOURLY_SCORING_VALIDATION_VERSION);
    expect(result.exactScores[0]?.scoringValidationVersion).toBe(HOURLY_SCORING_VALIDATION_VERSION);
  });

  it("ignore un run reçu après l’observation et choisit le dernier run admissible", () => {
    const validTime = observedAt(12);
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      forecast({ captureRunId: "run-08", validTime, availableAt: validTime - 8 * 60 * 60_000, variable: "temperature", value: 8 }),
      forecast({ captureRunId: "run-10", validTime, availableAt: validTime - 4 * 60 * 60_000, variable: "temperature", value: 9 }),
      forecast({ captureRunId: "run-13", validTime, availableAt: validTime + 60_000, variable: "temperature", value: 100 }),
    ]);
    expect(scoresFor(result).find((score) => score.horizonBucket === "2_6h")).toMatchObject({ sampleSize: 1, mae: 1, bias: -1 });
    expect(scoresFor(result).find((score) => score.horizonBucket === "6_24h")?.sampleSize).toBe(0);
  });

  it("conserve les métriques existantes mais ne versionne pas un score issu d’un run antérieur à latestCompatibleRun", () => {
    const validTime = observedAt(12);
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      forecast({
        captureRunId: "older-temperature-run",
        validTime,
        availableAt: validTime - 3 * 60 * 60_000,
        variable: "temperature",
        value: 9,
      }),
      forecast({
        captureRunId: "latest-wind-run",
        validTime,
        availableAt: validTime - 60 * 60_000,
        variable: "wind_speed",
        value: 7,
      }),
    ]);
    const temperatureBucket = scoresFor(result, "temperature").find((score) => score.horizonBucket === "2_6h");
    const temperatureExact = result.exactScores.find((score) => score.variable === "temperature");
    const windExact = result.exactScores.find((score) => score.variable === "wind_speed");

    expect(temperatureBucket).toMatchObject({ sampleSize: 1, mae: 1, scoringValidationVersion: null });
    expect(temperatureExact).toMatchObject({ sampleSize: 1, mae: 1, scoringValidationVersion: null });
    expect(windExact).toMatchObject({ sampleSize: 1, scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION });
    expect(result.exactComparisons).toHaveLength(2);
  });

  it("conserve plusieurs exécutions dans la journée et sépare les horizons Phase 3", () => {
    const hours = [9, 10, 11];
    const forecasts = hours.map((hour, index) => {
      const validTime = observedAt(hour);
      const leadHours = [1, 4, 12][index];
      return forecast({ captureRunId: `four-hour-run-${index}`, validTime, availableAt: validTime - leadHours * 60 * 60_000, variable: "temperature", value: 10 + index });
    });
    const result = evaluateHourlyForecastRuns(hours.map((hour) => snapshot(hour)), forecasts);
    expect(scoresFor(result).filter((score) => score.sampleSize > 0).map((score) => score.horizonBucket)).toEqual(["0_2h", "2_6h", "6_24h"]);
    expect(scoresFor(result).filter((score) => score.sampleSize > 0).every((score) => score.coverageRatio === 1)).toBe(true);
    expect(scoresFor(result).filter((score) => score.sampleSize === 0).every((score) => score.evaluableObservationCount === 0)).toBe(true);
  });

  it("classe le bucket depuis la durée exacte, sans arrondir une échéance proche de la frontière", () => {
    const validTime = observedAt(12);
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      forecast({
        captureRunId: "run-119-6",
        validTime,
        availableAt: validTime - 119.6 * 60_000,
        variable: "temperature",
        value: 12,
      }),
    ]);

    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 1, mae: 2 });
    expect(scoresFor(result).find((score) => score.horizonBucket === "2_6h")?.sampleSize).toBe(0);
  });

  it("conserve le lead fractionnaire exact et la provenance du snapshot physique sans fusionner deux leads voisins", () => {
    const firstValidTime = observedAt(12);
    const secondValidTime = observedAt(13);
    const firstSnapshot: HourlyPhysicalSnapshot = {
      ...snapshot(12),
      id: 701,
      collectedAt: "2026-09-29T12:05:00.000Z",
      confidenceScore: 0.93,
      stationsUsed: stationEvidence(firstValidTime, { observedAt: new Date(firstValidTime - 120_000).toISOString() }),
    };
    const secondSnapshot: HourlyPhysicalSnapshot = {
      ...snapshot(13),
      id: 702,
      collectedAt: "2026-09-29T13:05:00.000Z",
      confidenceScore: 0.91,
      stationsUsed: stationEvidence(secondValidTime, { observedAt: new Date(secondValidTime - 120_000).toISOString() }),
    };
    const firstLead = 119.6 * 60_000;
    const secondLead = 119.7 * 60_000;
    const result = evaluateHourlyForecastRuns([firstSnapshot, secondSnapshot], [
      forecast({ id: 801, captureRunId: "fractional-lead-a", validTime: firstValidTime, availableAt: firstValidTime - firstLead, variable: "temperature", value: 12 }),
      forecast({ id: 802, captureRunId: "fractional-lead-b", validTime: secondValidTime, availableAt: secondValidTime - secondLead, variable: "temperature", value: 9 }),
    ]);

    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 2, mae: 1.5 });
    expect(result.exactScores).toHaveLength(2);
    expect(result.exactScores.every((score) => score.scoringValidationVersion === HOURLY_SCORING_VALIDATION_VERSION)).toBe(true);
    expect(result.exactScores.map((score) => score.horizonMilliseconds)).toEqual([firstLead, secondLead]);
    expect(result.exactScores.map((score) => score.horizonMinutes)).toEqual([119.6, 119.7]);
    expect(result.exactComparisons).toHaveLength(2);
    expect(result.exactComparisons[0]).toMatchObject({
      forecastRunValueId: 801,
      observationSnapshotId: 701,
      captureRunId: "fractional-lead-a",
      horizonMinutes: 119.6,
      availableAt: firstValidTime - firstLead,
      observationReferenceAt: firstValidTime,
      observationCollectedAt: Date.parse("2026-09-29T12:05:00.000Z"),
      stationCount: 2,
      confidenceScore: 0.93,
      observedUnit: "°C",
      signedError: 2,
      absoluteError: 2,
    });
    expect(result.exactComparisons[0]?.stationsUsed).toEqual(firstSnapshot.stationsUsed);
  });

  it("exclut du dénominateur évalué un run dont l'horizon dépasse les buckets scorables", () => {
    const validTime = observedAt(12);
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      forecast({
        captureRunId: "run-outside-scoring-window",
        validTime,
        availableAt: validTime - 16 * 24 * 60 * 60_000,
        variable: "temperature",
        value: 12,
      }),
    ]);

    expect(scoresFor(result).every((score) => score.sampleSize === 0 && score.evaluableObservationCount === 0 && score.coverageRatio === 0)).toBe(true);
  });

  it("ne surcompte pas les doublons et retombe sur une valeur admissible quand le run récent est manquant", () => {
    const validTime = observedAt(12);
    const old = forecast({ captureRunId: "run-old", validTime, availableAt: validTime - 90 * 60_000, variable: "temperature", value: 11 });
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      old,
      { ...old },
      forecast({ captureRunId: "run-without-temp", validTime, availableAt: validTime - 60 * 60_000, variable: "temperature", value: null }),
    ]);
    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 1, mae: 1, observationCount: 1 });
  });

  it("sépare la couverture des scores et exclut les échéances sans run exact du dénominateur", () => {
    const withValue = observedAt(12);
    const withNullValue = observedAt(13);
    const withoutRun = observedAt(14);
    const result = evaluateHourlyForecastRuns([snapshot(12), snapshot(13), snapshot(14)], [
      forecast({ captureRunId: "run-with-value", validTime: withValue, availableAt: withValue - 60 * 60_000, variable: "temperature", value: 12 }),
      forecast({ captureRunId: "run-with-null", validTime: withNullValue, availableAt: withNullValue - 60 * 60_000, variable: "temperature", value: null }),
    ]);
    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({
      observationCount: 3,
      evaluableObservationCount: 2,
      sampleSize: 1,
      coverageRatio: 0.5,
      mae: 2,
    });
  });

  it("écarte un instant d’observation ambigu à l’heure répétée d’Europe/Paris", () => {
    const fallDate = "2026-10-25";
    const fallObservation: HourlyPhysicalSnapshot = snapshot(2, 10, { date: fallDate });
    const result = evaluateHourlyForecastRuns([fallObservation], [
      forecast({ captureRunId: "first-02", targetDate: fallDate, validTime: Date.parse("2026-10-25T00:00:00Z"), availableAt: Date.parse("2026-10-24T20:00:00Z"), variable: "temperature", value: 10 }),
      forecast({ captureRunId: "second-02", targetDate: fallDate, validTime: Date.parse("2026-10-25T01:00:00Z"), availableAt: Date.parse("2026-10-24T21:00:00Z"), variable: "temperature", value: 12 }),
    ]);
    expect(scoresFor(result).every((score) => score.sampleSize === 0 && score.evaluableObservationCount === 0)).toBe(true);
  });

  it("produit des compteurs et des scores propres à chaque variable", () => {
    const validTime = observedAt(12);
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      forecast({ captureRunId: "run-var", validTime, availableAt: validTime - 30 * 60_000, variable: "temperature", value: 12 }),
      forecast({ captureRunId: "run-var", validTime, availableAt: validTime - 30 * 60_000, variable: "precipitation", value: 0.5, unit: "mm" }),
    ]);
    expect(scoresFor(result, "temperature").find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 1, observationCount: 1, evaluableObservationCount: 1, mae: 2 });
    expect(scoresFor(result, "precipitation").find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 1, mae: 0.5 });
  });

  it("rejette un forecast publié après la mesure réelle même s'il précède l'heure nominale", () => {
    const validTime = observedAt(12);
    const measurementTime = validTime - 15 * 60_000;
    const physical = snapshot(12, 10, {
      stationsUsed: stationEvidence(validTime, {
        fieldWeights: { temperature: 1 },
        measurementTimes: { temperature: new Date(measurementTime).toISOString() },
      }),
    });
    const result = evaluateHourlyForecastRuns([physical], [
      forecast({ captureRunId: "after-measurement", validTime, availableAt: validTime - 10 * 60_000, variable: "temperature", value: 100 }),
    ]);

    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({
      observationCount: 1,
      evaluableObservationCount: 0,
      sampleSize: 0,
      coverageRatio: 0,
      mae: null,
      scoringValidationVersion: null,
    });
  });

  it("admet une mesure postérieure à l'heure nominale tout en conservant le lead UTC nominal", () => {
    const validTime = observedAt(12);
    const physical = snapshot(12, 10, {
      stationsUsed: stationEvidence(validTime, {
        fieldWeights: { temperature: 1 },
        measurementTimes: { temperature: new Date(validTime + 5 * 60_000).toISOString() },
      }),
    });
    const result = evaluateHourlyForecastRuns([physical], [
      forecast({ captureRunId: "before-later-measurement", validTime, availableAt: validTime - 10 * 60_000, variable: "temperature", value: 12 }),
    ]);

    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 1, mae: 2 });
    expect(result.exactComparisons[0]).toMatchObject({ validTime, observationReferenceAt: validTime, horizonMilliseconds: 10 * 60_000 });
  });

  it("rejette strictement l'égalité entre availableAt et le premier horodatage contributeur", () => {
    const validTime = observedAt(12);
    const measurementTime = validTime - 10 * 60_000;
    const physical = snapshot(12, 10, {
      stationsUsed: stationEvidence(validTime, {
        fieldWeights: { temperature: 1 },
        measurementTimes: { temperature: new Date(measurementTime).toISOString() },
      }),
    });
    const result = evaluateHourlyForecastRuns([physical], [
      forecast({ captureRunId: "equal-time", validTime, availableAt: measurementTime, variable: "temperature", value: 12 }),
    ]);

    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({
      observationCount: 1,
      evaluableObservationCount: 0,
      sampleSize: 0,
      scoringValidationVersion: null,
    });
  });

  it("utilise le plus ancien horodatage des stations qui contribuent au champ", () => {
    const validTime = observedAt(12);
    const physical = snapshot(12, 10, {
      stationsUsed: [
        { stationId: "station-newer", fieldWeights: { temperature: 1 }, measurementTimes: { temperature: new Date(validTime - 5 * 60_000).toISOString() } },
        { stationId: "station-earliest", fieldWeights: { temperature: 1 }, measurementTimes: { temperature: new Date(validTime - 20 * 60_000).toISOString() } },
      ],
    });
    const result = evaluateHourlyForecastRuns([physical], [
      forecast({ captureRunId: "after-earliest", validTime, availableAt: validTime - 10 * 60_000, variable: "temperature", value: 100 }),
      forecast({ captureRunId: "before-all", validTime, availableAt: validTime - 25 * 60_000, variable: "temperature", value: 9 }),
    ]);

    expect(result.exactComparisons).toHaveLength(1);
    expect(result.exactComparisons[0]).toMatchObject({ captureRunId: "before-all", absoluteError: 1 });
    expect(result.exactScores[0]?.scoringValidationVersion).toBe(HOURLY_SCORING_VALIDATION_VERSION);
  });

  it("applique les heures propres au champ sans faire disparaître le vent quand la température est plus ancienne", () => {
    const validTime = observedAt(12);
    const physical = snapshot(12, 10, {
      stationsUsed: [{
        stationId: "station-field-times",
        observedAt: new Date(validTime - 20 * 60_000).toISOString(),
        fieldWeights: { temperature: 1, windSpeed: 1 },
        measurementTimes: {
          temperature: new Date(validTime - 20 * 60_000).toISOString(),
          windSpeed: new Date(validTime - 5 * 60_000).toISOString(),
        },
      }],
    });
    const result = evaluateHourlyForecastRuns([physical], [
      forecast({ captureRunId: "field-specific-run", validTime, availableAt: validTime - 10 * 60_000, variable: "temperature", value: 12 }),
      forecast({ captureRunId: "field-specific-run", validTime, availableAt: validTime - 10 * 60_000, variable: "wind_speed", value: 10 }),
    ]);

    expect(scoresFor(result, "temperature").find((score) => score.horizonBucket === "0_2h")).toMatchObject({ observationCount: 1, evaluableObservationCount: 0, sampleSize: 0 });
    expect(scoresFor(result, "wind_speed").find((score) => score.horizonBucket === "0_2h")).toMatchObject({ observationCount: 1, sampleSize: 1, mae: 2 });
  });

  it.each([
    ["metadata absent", null],
    ["horodatage corrompu", [{ stationId: "station-a", fieldWeights: { temperature: 1 }, measurementTimes: { temperature: "2026-09-29T11:45:00" } }]],
    ["snapshot legacy sans fieldWeights", [{ stationId: "station-a", observedAt: "2026-09-29T11:45:00.000Z", temperature: 10 }]],
  ])("exclut sans pénalité une observation dont les preuves sont %s", (_label, stationsUsed) => {
    const validTime = observedAt(12);
    const result = evaluateHourlyForecastRuns([snapshot(12, 10, { stationsUsed })], [
      forecast({ captureRunId: "unverifiable-snapshot", validTime, availableAt: validTime - 30 * 60_000, variable: "temperature", value: 12 }),
    ]);

    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({
      observationCount: 0,
      evaluableObservationCount: 0,
      sampleSize: 0,
      coverageRatio: 0,
      mae: null,
      rmse: null,
      bias: null,
      scoringValidationVersion: null,
    });
  });

  it("ne marque pas les agrégats issus d’un tie ambigu rejeté par latestCompatibleRun", () => {
    const validTime = observedAt(12);
    const shared = { validTime, availableAt: validTime - 30 * 60_000, requestStartedAt: validTime - 31 * 60_000 };
    const result = evaluateHourlyForecastRuns([snapshot(12)], [
      forecast({ ...shared, captureRunId: "ambiguous-a", variable: "temperature", value: 9 }),
      forecast({ ...shared, captureRunId: "ambiguous-b", variable: "temperature", value: 11 }),
    ]);

    expect(scoresFor(result).every((score) => score.scoringValidationVersion == null)).toBe(true);
    expect(result.exactComparisons).toHaveLength(0);
    expect(result.exactScores).toHaveLength(0);
  });

  it("protège latest-compatible par champ et conserve une variable vérifiable sans température", () => {
    const hours = Array.from({ length: 18 }, (_, hour) => hour);
    const snapshots = hours.map((hour) => {
      const validTime = observedAt(hour);
      return snapshot(hour, 10, {
        stationsUsed: stationEvidence(validTime, {
          fieldWeights: { windSpeed: 1 },
          measurementTimes: { windSpeed: new Date(validTime - 5 * 60_000).toISOString() },
        }),
      });
    });
    const values = hours.flatMap((hour) => {
      const validTime = observedAt(hour);
      const availableAt = validTime - 10 * 60_000;
      return [
        forecast({ captureRunId: `wind-only-${hour}`, validTime, availableAt, variable: "temperature", value: 100 }),
        forecast({ captureRunId: `wind-only-${hour}`, validTime, availableAt, variable: "wind_speed", value: 10 }),
      ];
    });
    const result = evaluateHourlyForecastRuns(snapshots, values);

    expect(result.compatibilityScores).toHaveLength(1);
    expect(result.compatibilityScores[0]).toMatchObject({
      sampleSize: 18,
      maeTemp: null,
      maeWind: 2,
      maePrecip: null,
      precipFalsePositives: null,
    });
  });

  it("n'autorise pas latest-compatible à réintroduire un forecast postérieur aux mesures", () => {
    const hours = Array.from({ length: 18 }, (_, hour) => hour);
    const snapshots = hours.map((hour) => snapshot(hour));
    const values = hours.flatMap((hour) => {
      const validTime = observedAt(hour);
      const availableAt = validTime - 60_000;
      return hourlyVariables.map((variable) => forecast({
        captureRunId: `after-measurement-${hour}`,
        validTime,
        availableAt,
        variable,
        value: 12,
      }));
    });
    const result = evaluateHourlyForecastRuns(snapshots, values);

    expect(result.compatibilityScores).toEqual([]);
  });

  it("décompte les étapes ordinaires et attribue un seul premier rejet par prévision archivée", () => {
    const validTime = observedAt(12);
    const measurementTime = validTime - 15 * 60_000;
    const physical = snapshot(12, 10, {
      stationsUsed: stationEvidence(validTime, {
        fieldWeights: { temperature: 1 },
        measurementTimes: { temperature: new Date(measurementTime).toISOString() },
      }),
    });
    const physicalWithoutFieldTime = snapshot(13, 10, { stationsUsed: [] });
    const result = evaluateHourlyForecastRuns([physical, physicalWithoutFieldTime], [
      forecast({ captureRunId: "kept-before-measurement", validTime, availableAt: validTime - 30 * 60_000, variable: "temperature", value: 9 }),
      forecast({ captureRunId: "after-measurement", validTime, availableAt: validTime - 10 * 60_000, variable: "temperature", value: 100 }),
      forecast({ captureRunId: "equal-measurement", validTime, availableAt: measurementTime, variable: "temperature", value: 100 }),
      forecast({ captureRunId: "missing-value", validTime, availableAt: validTime - 60 * 60_000, variable: "temperature", value: null }),
      forecast({ captureRunId: "no-location-match", locationKey: "49.000_1.000", validTime, availableAt: validTime - 30 * 60_000, variable: "temperature", value: 8 }),
      forecast({ captureRunId: "unqualified-observation", validTime: observedAt(13), availableAt: observedAt(13) - 30 * 60_000, variable: "temperature", value: 8 }),
    ]);
    const diagnostic = result.diagnostics.find(({ variable }) => variable === "temperature");

    expect(diagnostic).toMatchObject({
      path: "ordinary_hourly",
      archivedForecasts: 6,
      opportunitiesAtSameLocationAndValidTime: 5,
      qualifiedPhysicalObservationsPresent: 4,
      temporallyAdmissible: 2,
      admissiblePairs: 1,
      retainedComparisons: 1,
      firstRejectionCounts: {
        NO_MATCHING_LOCATION_VALID_TIME_OBSERVATION: 1,
        NO_QUALIFIED_PHYSICAL_OBSERVATION: 1,
        FORECAST_AVAILABLE_AT_OR_AFTER_MEASUREMENT_TIME: 2,
        FORECAST_VALUE_MISSING_OR_NONFINITE: 1,
      },
    });
    expect(diagnostic?.temporalRule).toContain("availableAt < earliest measurementTime");
    expect(result.exactComparisons).toHaveLength(1);
    expect(result.exactComparisons[0]).toMatchObject({ captureRunId: "kept-before-measurement", absoluteError: 1 });
    expect(scoresFor(result).find((score) => score.horizonBucket === "0_2h")).toMatchObject({ sampleSize: 1, mae: 1 });
  });
});
