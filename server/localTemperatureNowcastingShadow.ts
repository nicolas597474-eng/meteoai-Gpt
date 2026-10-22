import { and, desc, eq, gte } from "drizzle-orm";
import {
  qualifiedObservationSnapshots,
  shadowLocalTemperatureNowcasts,
} from "../drizzle/schema";
import {
  LOCAL_TEMPERATURE_NOWCASTING_SHADOW_VERSION,
  calculateLocalTemperatureNowcast,
} from "../shared/localTemperatureNowcastingShadow";
import { getDb, getHourlyForecastEvaluationHistory, getHourlyForecastRunValues } from "./db";
import { computeOfficialHourlyForecast, reconstructOfficialHourlyModelsFromArchive } from "./officialHourlyForecast";
import { parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";

const NOWCAST_HORIZONS = [0, 1, 2, 3, 4, 5, 6] as const;
const HOUR_MS = 60 * 60 * 1_000;

function shiftIsoDate(date: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays);
  return new Date(utc).toISOString().slice(0, 10);
}

function timestampOf(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

type LocalForecastEvidence = {
  version: string;
  baseline: "official_hourly_seven_models";
  baselineMode: "unavailable" | "official_historical_skill" | "seven_model_median_shadow";
  bestMatchIncluded: false;
  modelNames: string[];
  forecastAvailableAt: number | null;
  observationReferenceAt: number;
  historicalWeighting: string;
};

function emptyForecastEvidence(observationReferenceAt: number): LocalForecastEvidence {
  return {
    version: LOCAL_TEMPERATURE_NOWCASTING_SHADOW_VERSION,
    baseline: "official_hourly_seven_models",
    baselineMode: "unavailable",
    bestMatchIncluded: false,
    modelNames: [] as string[],
    forecastAvailableAt: null,
    observationReferenceAt,
    historicalWeighting: "unavailable",
  };
}

function median(values: readonly number[]): number | null {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (ordered.length === 0) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export type LocalTemperatureNowcastRefreshResult = {
  locationKey: string;
  observationDate: string;
  observationHour: number;
  persistedCount: number;
  statuses: Record<string, number>;
  reason?: string;
  productionReadsEnabled: 0;
  appliedToProduction: 0;
};

/**
 * Rebuilds one seven-hour candidate track from an already stored physical
 * snapshot. Forecast archives are restricted to runs available at or before
 * the snapshot reference hour; no live provider request is made.
 */
export async function rebuildLocalTemperatureNowcastForSnapshot(input: {
  locationKey: string;
  observationDate: string;
  observationHour: number;
  evaluatedAt?: number;
}): Promise<LocalTemperatureNowcastRefreshResult> {
  const db = await getDb();
  const evaluatedAt = input.evaluatedAt ?? Date.now();
  const empty: LocalTemperatureNowcastRefreshResult = {
    locationKey: input.locationKey,
    observationDate: input.observationDate,
    observationHour: input.observationHour,
    persistedCount: 0,
    statuses: {},
    productionReadsEnabled: 0,
    appliedToProduction: 0,
  };
  if (!db) return { ...empty, reason: "BASE_INDISPONIBLE" };

  const snapshots = await db.select().from(qualifiedObservationSnapshots).where(and(
    eq(qualifiedObservationSnapshots.locationKey, input.locationKey),
    eq(qualifiedObservationSnapshots.date, input.observationDate),
    eq(qualifiedObservationSnapshots.hour, input.observationHour),
  ));
  const snapshot = snapshots[0];
  if (!snapshot) return { ...empty, reason: "SNAPSHOT_PHYSIQUE_ABSENT" };

  const observationReferenceAt = parisLocalHourToUniqueEpochMs(snapshot.date, snapshot.hour);
  if (observationReferenceAt == null) {
    return { ...empty, reason: "HEURE_PARIS_AMBIGUE_OU_INEXISTANTE" };
  }
  const observationCollectedAt = timestampOf(snapshot.collectedAt) ?? evaluatedAt;
  const targetDates = Array.from(new Set(NOWCAST_HORIZONS.map((horizon) => {
    const point = new Date(observationReferenceAt + horizon * HOUR_MS);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(point);
  })));

  const historicalThroughDate = shiftIsoDate(snapshot.date, -1);
  const [history, archiveSets] = await Promise.all([
    getHourlyForecastEvaluationHistory(
      input.locationKey,
      shiftIsoDate(snapshot.date, -365),
      historicalThroughDate,
    ).catch(() => ({ available: false, rows: [] as Awaited<ReturnType<typeof getHourlyForecastEvaluationHistory>>["rows"] })),
    Promise.all(targetDates.map(async (targetDate) => ({
      targetDate,
      rows: await getHourlyForecastRunValues(input.locationKey, targetDate),
    }))),
  ]);

  const pointsByTime = new Map<number, ReturnType<typeof computeOfficialHourlyForecast>["hours"][number]>();
  const evidenceByTime = new Map<number, LocalForecastEvidence>();
  const medianTemperatureByTime = new Map<number, number>();
  const medianModelNamesByTime = new Map<number, string[]>();
  for (const { targetDate, rows } of archiveSets) {
    // This filter is the temporal firewall: later forecast runs are ignored even
    // when a historical replay occurs after they have been archived.
    const rowsAvailableAtObservation = rows.filter((row) => Number(row.availableAt) <= observationReferenceAt);
    const modelForecasts = reconstructOfficialHourlyModelsFromArchive(rowsAvailableAtObservation, targetDate);
    const computed = computeOfficialHourlyForecast(modelForecasts, history.rows, { historyAvailable: history.available });
    const availableAtByModel = new Map(modelForecasts.map((forecast) => [forecast.modelName, forecast.availableAt]));
    const temperaturesByTime = new Map<number, Array<{ modelName: string; temperature: number }>>();
    for (const forecast of modelForecasts) {
      for (const hour of forecast.hours) {
        if (!Number.isFinite(hour.validAt) || !Number.isFinite(hour.temperature)) continue;
        if (hour.validAt < observationReferenceAt || hour.validAt > observationReferenceAt + 6 * HOUR_MS) continue;
        const values = temperaturesByTime.get(hour.validAt) ?? [];
        values.push({ modelName: forecast.modelName, temperature: hour.temperature as number });
        temperaturesByTime.set(hour.validAt, values);
      }
    }
    for (const [validAt, temperatures] of Array.from(temperaturesByTime.entries())) {
      const value = median(temperatures.map((item) => item.temperature));
      if (value != null) medianTemperatureByTime.set(validAt, value);
      medianModelNamesByTime.set(validAt, temperatures.map((item) => item.modelName));
    }
    for (const point of computed.hours) {
      if (!Number.isFinite(point.validAt)) continue;
      const validAt = point.validAt as number;
      if (validAt < observationReferenceAt || validAt > observationReferenceAt + 6 * HOUR_MS) continue;
      const modelNames = point.forecastWeighting?.modelsWithData ?? [];
      const availability = modelNames
        .map((modelName) => availableAtByModel.get(modelName))
        .filter((value): value is number => Number.isFinite(value));
      pointsByTime.set(validAt, point);
      evidenceByTime.set(validAt, {
        version: LOCAL_TEMPERATURE_NOWCASTING_SHADOW_VERSION,
        baseline: "official_hourly_seven_models",
        baselineMode: point.temp == null ? "seven_model_median_shadow" : "official_historical_skill",
        bestMatchIncluded: false,
        modelNames,
        forecastAvailableAt: availability.length > 0 ? Math.max(...availability) : null,
        observationReferenceAt,
        historicalWeighting: point.forecastWeighting?.method ?? "unavailable",
      });
    }
  }

  const statuses: Record<string, number> = {};
  let persistedCount = 0;
  for (const horizon of NOWCAST_HORIZONS) {
    const validTime = observationReferenceAt + horizon * HOUR_MS;
    const point = pointsByTime.get(validTime);
    const medianBaseline = medianTemperatureByTime.get(validTime) ?? null;
    const evidence = evidenceByTime.get(validTime) ?? {
      ...emptyForecastEvidence(observationReferenceAt),
      baselineMode: medianBaseline == null ? "unavailable" as const : "seven_model_median_shadow" as const,
      modelNames: medianModelNamesByTime.get(validTime) ?? [],
    };
    const result = calculateLocalTemperatureNowcast({
      baselineTemperature: point?.temp ?? medianBaseline,
      observedTemperature: snapshot.temperature == null ? null : Number(snapshot.temperature),
      observationReferenceAt,
      forecastAvailableAt: evidence.forecastAvailableAt,
      validTime,
      evaluatedAt,
      stationCount: Number(snapshot.stationCount),
      confidenceScore: snapshot.confidenceScore == null ? null : Number(snapshot.confidenceScore),
    });
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    await db.insert(shadowLocalTemperatureNowcasts).values({
      locationKey: input.locationKey,
      observationDate: snapshot.date,
      observationHour: snapshot.hour,
      observationReferenceAt,
      observationCollectedAt,
      observedTemperature: snapshot.temperature == null ? null : Number(snapshot.temperature),
      stationCount: Number(snapshot.stationCount),
      confidenceScore: snapshot.confidenceScore == null ? null : Number(snapshot.confidenceScore),
      validTime,
      horizonMinutes: result.horizonMinutes,
      candidateStatus: result.status,
      baselineTemperature: result.baselineTemperature,
      rawResidual: result.rawResidual,
      boundedResidual: result.boundedResidual,
      correctionFactor: result.correctionFactor,
      appliedCorrection: result.appliedCorrection,
      correctedTemperature: result.correctedTemperature,
      correctionClamped: result.correctionClamped ? 1 : 0,
      forecastAvailableAt: evidence.forecastAvailableAt,
      forecastEvidence: evidence,
      reasons: result.reasons,
      productionReadsEnabled: 0,
      shadowMode: 1,
      appliedToProduction: 0,
      evaluatedAt,
    }).onDuplicateKeyUpdate({
      set: {
        horizonMinutes: result.horizonMinutes,
        candidateStatus: result.status,
        baselineTemperature: result.baselineTemperature,
        rawResidual: result.rawResidual,
        boundedResidual: result.boundedResidual,
        correctionFactor: result.correctionFactor,
        appliedCorrection: result.appliedCorrection,
        correctedTemperature: result.correctedTemperature,
        correctionClamped: result.correctionClamped ? 1 : 0,
        forecastAvailableAt: evidence.forecastAvailableAt,
        forecastEvidence: evidence,
        reasons: result.reasons,
        evaluatedAt,
      },
    });
    persistedCount += 1;
  }
  return { ...empty, persistedCount, statuses };
}

export async function buildLocalTemperatureNowcastingReport(locationKey?: string, lookbackDays = 7) {
  const db = await getDb();
  const empty = {
    version: LOCAL_TEMPERATURE_NOWCASTING_SHADOW_VERSION,
    candidateCount: 0,
    statuses: { READY: 0, BASELINE_ONLY: 0, STALE_OBSERVATION: 0, UNAVAILABLE: 0, LEAKAGE_BLOCKED: 0 },
    productionReadsEnabled: 0,
    appliedToProduction: 0,
    shadowModeViolations: 0,
    valid: true,
    latest: null as null | {
      locationKey: string; observationDate: string; observationHour: number; observationReferenceAt: number;
      observedTemperature: number | null; stationCount: number; confidenceScore: number | null;
      validTime: number; horizonMinutes: number | null; candidateStatus: string;
      baselineTemperature: number | null; rawResidual: number | null; appliedCorrection: number | null;
      correctedTemperature: number | null; correctionFactor: number; correctionClamped: boolean;
      forecastAvailableAt: number | null; forecastEvidence: unknown; reasons: unknown; evaluatedAt: number;
    },
  };
  if (!db) return empty;
  const filters = [gte(shadowLocalTemperatureNowcasts.evaluatedAt, Date.now() - Math.max(1, lookbackDays) * 86_400_000)];
  if (locationKey) filters.push(eq(shadowLocalTemperatureNowcasts.locationKey, locationKey));
  const rows = await db.select().from(shadowLocalTemperatureNowcasts)
    .where(and(...filters))
    .orderBy(desc(shadowLocalTemperatureNowcasts.evaluatedAt), shadowLocalTemperatureNowcasts.horizonMinutes);
  const statuses = { ...empty.statuses };
  let productionReadsEnabled = 0;
  let appliedToProduction = 0;
  let shadowModeViolations = 0;
  for (const row of rows) {
    if (row.candidateStatus in statuses) statuses[row.candidateStatus as keyof typeof statuses] += 1;
    productionReadsEnabled += Number(row.productionReadsEnabled);
    appliedToProduction += Number(row.appliedToProduction);
    if (Number(row.shadowMode) !== 1) shadowModeViolations += 1;
  }
  const latestRow = rows[0];
  const latest = latestRow ? {
    locationKey: latestRow.locationKey,
    observationDate: latestRow.observationDate,
    observationHour: Number(latestRow.observationHour),
    observationReferenceAt: Number(latestRow.observationReferenceAt),
    observedTemperature: latestRow.observedTemperature == null ? null : Number(latestRow.observedTemperature),
    stationCount: Number(latestRow.stationCount),
    confidenceScore: latestRow.confidenceScore == null ? null : Number(latestRow.confidenceScore),
    validTime: Number(latestRow.validTime),
    horizonMinutes: latestRow.horizonMinutes == null ? null : Number(latestRow.horizonMinutes),
    candidateStatus: latestRow.candidateStatus,
    baselineTemperature: latestRow.baselineTemperature == null ? null : Number(latestRow.baselineTemperature),
    rawResidual: latestRow.rawResidual == null ? null : Number(latestRow.rawResidual),
    appliedCorrection: latestRow.appliedCorrection == null ? null : Number(latestRow.appliedCorrection),
    correctedTemperature: latestRow.correctedTemperature == null ? null : Number(latestRow.correctedTemperature),
    correctionFactor: Number(latestRow.correctionFactor),
    correctionClamped: Number(latestRow.correctionClamped) === 1,
    forecastAvailableAt: latestRow.forecastAvailableAt == null ? null : Number(latestRow.forecastAvailableAt),
    forecastEvidence: latestRow.forecastEvidence,
    reasons: latestRow.reasons,
    evaluatedAt: Number(latestRow.evaluatedAt),
  } : null;
  return {
    version: LOCAL_TEMPERATURE_NOWCASTING_SHADOW_VERSION,
    candidateCount: rows.length,
    statuses,
    productionReadsEnabled,
    appliedToProduction,
    shadowModeViolations,
    valid: productionReadsEnabled === 0 && appliedToProduction === 0 && shadowModeViolations === 0,
    latest,
  } as const;
}
