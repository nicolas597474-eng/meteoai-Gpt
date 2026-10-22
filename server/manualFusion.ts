import { randomUUID } from "node:crypto";
import { getParisDate } from "./weatherTime";
import { getParisHourlyTimestamps } from "./weatherTime";
import { isCompleteHourlyForecastBatch, isCompleteStoredHourlyProjection } from "./hourlyForecastCompleteness";
import { computeOfficialDailyForecast } from "./officialForecast";
import { legacyStabilityLabelForStorage } from "./legacyStabilityStorage";
import { collectExpertForecastsWithDiagnostics } from "./weatherServices";
import { buildForecastRunArchiveRows } from "./dailyForecastPerformance";
import { buildMeteoAIDailyFusionArchiveRun } from "./dailyForecastVerification";
import { collectOfficialHourlyForecast, OFFICIAL_HOURLY_MODEL_NAMES } from "./officialHourlyForecast";
import { getParisDateAndHour } from "./parisHourlyTime";
import { cacheManualHourlyForecast } from "./officialWeatherSnapshot";
import { acquireForecastRefreshLock, getDailyFusionPerformanceEvidence, getMeteoAIForecastByDate, getStoredHourlyForecasts, insertForecastRuns, insertMeteoAIDailyFusionRun, insertForecasts, insertHourlyForecasts, makeLocationKey, releaseForecastRefreshLock, upsertLocationForecast, upsertMeteoAIForecast } from "./db";
import { getLocationForecastRefreshLockKey } from "./forecastRefreshLock";
import { HOURLY_FORECAST_VARIABLES } from "./forecastVariableCoverage";

type ManualFusionFavorite = {
  id: number;
  userId: number;
  lat: number;
  lon: number;
  name: string;
  customName: string | null;
};

export const MANUAL_FUSION_COOLDOWN_MS = 90_000;

type GranularityStatus = "succeeded" | "partial" | "failed";
type GranularityResult = {
  status: GranularityStatus;
  modelCount: number;
  expectedModelCount: number;
  updatedAt: string | null;
  error?: string;
  projectionRetainedModelCount?: number;
  retainedProjectionAgeMs?: number | null;
};

type ManualRefreshResult = {
  status: "refreshed" | "partial" | "failed";
  location: { lat: number; lon: number };
  daily: GranularityResult;
  hourly: GranularityResult;
};

const inFlightRefreshes = new Set<string>();
const OFFICIAL_DAILY_MODEL_NAME_SET = new Set<string>(OFFICIAL_HOURLY_MODEL_NAMES);

export function isManualFusionCoolingDown(computedAt: Date | null | undefined, now = Date.now()) {
  return computedAt != null && now - computedAt.getTime() < MANUAL_FUSION_COOLDOWN_MS;
}

function granularityResult(modelCount: number, expectedModelCount: number, updatedAt: Date | null, error?: string): GranularityResult {
  const status: GranularityStatus = modelCount === 0 ? "failed" : modelCount < expectedModelCount ? "partial" : "succeeded";
  return {
    status,
    modelCount,
    expectedModelCount,
    updatedAt: status === "failed" ? null : updatedAt?.toISOString() ?? null,
    ...(error ? { error } : {}),
  };
}

function timestampValue(value: unknown): number | null {
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  const timestamp = date?.getTime();
  return timestamp != null && Number.isFinite(timestamp) ? timestamp : null;
}

function nearlyEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  const left = Number(a);
  const right = Number(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.01;
}

function persistedHourlySeriesMatches(
  expected: Array<Record<string, unknown>>,
  stored: Array<Record<string, unknown>>,
  collectedAt: Date,
): boolean {
  const freshRows = stored
    .filter((row) => timestampValue(row.collectedAt) != null && timestampValue(row.collectedAt)! >= collectedAt.getTime() - 1_000)
    .slice()
    .sort((a, b) => Number(a.hour) - Number(b.hour));
  const expectedRows = expected.slice().sort((a, b) => Number(a.hour) - Number(b.hour));
  if (freshRows.length !== expectedRows.length) return false;

  const fields = [
    "hour", "temperature", "apparentTemperature", "precipitation", "windSpeed", "windGusts",
    "windDirection", "humidity", "pressure", "cloudCover", "weatherCode",
  ];
  return expectedRows.every((expectedRow, index) => fields.every((field) => {
    if (field === "hour") return Number(freshRows[index][field]) === Number(expectedRow[field]);
    return nearlyEqual(freshRows[index][field], expectedRow[field]);
  }));
}

async function refreshDailyForecast(favorite: ManualFusionFavorite, today: string, locationKey: string): Promise<GranularityResult> {
  const expectedModelCount = OFFICIAL_HOURLY_MODEL_NAMES.length;
  try {
    const { forecasts: expertData, availabilityReasonByModel } = await collectExpertForecastsWithDiagnostics(today, { lat: favorite.lat, lon: favorite.lon });
    const officialDailyForecasts = expertData.filter((forecast) => OFFICIAL_DAILY_MODEL_NAME_SET.has(forecast.serviceName));
    if (officialDailyForecasts.length === 0) {
      return granularityResult(0, expectedModelCount, null, "Aucun des sept modèles quotidiens officiels n’a renvoyé de prévision.");
    }
    const issuedAt = Date.now();

    const rawForecasts = officialDailyForecasts.map((entry) => ({ ...entry, windGust: entry.windGust ?? null }));
    const fusionEvidence = await getDailyFusionPerformanceEvidence(
      locationKey,
      today,
      officialDailyForecasts.flatMap((entry) => entry.availableAt == null ? [] : [entry.availableAt]),
    );
    const meteoAI = computeOfficialDailyForecast(rawForecasts, {
      locationKey,
      targetDate: today,
      issuedAt,
      referenceAt: issuedAt,
      evidenceStoreAvailable: fusionEvidence.available,
      evidence: fusionEvidence.evidence,
      availabilityReasonByModel,
    });
    const condition = null;
    const explanation = meteoAI.coreCalibrationComplete
      ? `Prévision quotidienne calibrée relancée pour ${favorite.customName ?? favorite.name}, avec des preuves physiques récentes par modèle, variable et horizon. La météo actuelle observée reste séparée et n’est pas modifiée par cette action.`
      : `${meteoAI.methodNote} Les valeurs robustes disponibles sont conservées et marquées non calibrées; aucune valeur de comparaison ne remplace la fusion. La météo actuelle observée reste séparée et n’est pas modifiée par cette action.`;

    await insertForecasts(expertData.map((entry) => ({
      locationKey,
      date: today,
      serviceName: entry.serviceName,
      serviceCategory: entry.serviceCategory,
      tempMax: entry.tempMax,
      tempMin: entry.tempMin,
      precipitation: entry.precipitation,
      windSpeed: entry.windSpeed,
      windGust: entry.windGust,
      humidity: entry.humidity,
      cloudCover: entry.cloudCover,
      condition: entry.condition,
      rawData: entry.rawData as any,
    })));
    await insertForecastRuns(buildForecastRunArchiveRows(expertData, locationKey, today, issuedAt));
    await upsertLocationForecast({
      favoriteLocationId: favorite.id,
      userId: favorite.userId,
      lat: favorite.lat,
      lon: favorite.lon,
      date: today,
      tempMax: meteoAI.tempMax,
      tempMin: meteoAI.tempMin,
      precipitation: meteoAI.precipitation,
      windSpeed: meteoAI.windSpeed,
      condition,
      modelsData: expertData as any,
      explanation,
    });

    // The daily timestamp is committed last, so a failed earlier write does not
    // start the cooldown or announce a completed refresh.
    const updatedAt = new Date();
    await upsertMeteoAIForecast({
      locationKey,
      date: today,
      tempMax: meteoAI.tempMax,
      tempMin: meteoAI.tempMin,
      precipitation: meteoAI.precipitation,
      windSpeed: meteoAI.windSpeed,
      condition,
      stabilityLabel: legacyStabilityLabelForStorage(expertData),
      weights: { version: 3, weightByService: meteoAI.weights, trace: meteoAI.trace, trigger: "manual" } as any,
      explanation,
      computedAt: updatedAt,
    }, { refreshComputedAt: true });

    const persistedSnapshot = await getMeteoAIForecastByDate(today, locationKey);
    const persistedAt = timestampValue(persistedSnapshot?.computedAt);
    const persistedWeights = typeof persistedSnapshot?.weights === "string"
      ? (() => { try { return JSON.parse(persistedSnapshot.weights as string); } catch { return null; } })()
      : persistedSnapshot?.weights;
    if (!persistedSnapshot || persistedAt == null || Math.abs(persistedAt - updatedAt.getTime()) > 2_000 || (persistedWeights as any)?.trigger !== "manual") {
      return granularityResult(0, expectedModelCount, null, "La fusion quotidienne n’a pas pu être confirmée après son enregistrement.");
    }

    const fusionArchive = buildMeteoAIDailyFusionArchiveRun({
      locationKey,
      targetDate: today,
      availableAt: Date.now(),
      forecast: { ...meteoAI, condition, weights: meteoAI.weights, trace: meteoAI.trace },
    });
    if (fusionArchive) await insertMeteoAIDailyFusionRun(fusionArchive, { requireDatabase: true });

    const dailyResult = granularityResult(officialDailyForecasts.length, expectedModelCount, new Date(persistedAt));
    if (!meteoAI.coreCalibrationComplete) {
      dailyResult.status = "partial";
      dailyResult.error = meteoAI.methodNote;
    }
    return dailyResult;
  } catch (error) {
    console.error("[ManualFusion] Daily refresh failed:", error);
    return granularityResult(0, expectedModelCount, null, "La collecte ou l’enregistrement quotidien a échoué.");
  }
}

function toHourlyRows(
  locationKey: string,
  date: string,
  modelName: string,
  hours: Array<Record<string, any>>,
  collectedAt: Date,
  captureRun: { captureRunId: string; sourceName: string; modelId: string | null; requestStartedAt: number; availableAt: number; units?: Record<string, string | null | undefined> },
) {
  return hours.map((hour) => ({
    locationKey,
    date,
    hour: Number(hour.hour),
    validTime: Number(hour.validAt),
    captureRun,
    archiveValues: hour,
    modelName,
    temperature: hour.temperature ?? null,
    apparentTemperature: hour.apparentTemperature ?? null,
    precipitation: hour.precipitation ?? null,
    windSpeed: hour.windSpeed ?? null,
    windGusts: hour.windGusts ?? null,
    windDirection: hour.windDirection ?? null,
    humidity: hour.humidity ?? null,
    pressure: hour.pressure ?? null,
    cloudCover: hour.cloudCover ?? null,
    weatherCode: hour.weatherCode ?? null,
    collectedAt,
  }));
}

async function refreshHourlyForecast(favorite: ManualFusionFavorite, today: string, locationKey: string): Promise<GranularityResult> {
  const expectedModelCount = OFFICIAL_HOURLY_MODEL_NAMES.length;
  try {
    const coords = { lat: favorite.lat, lon: favorite.lon };
    const officialHourly = await collectOfficialHourlyForecast(today, coords);
    const hourlyModels = officialHourly.modelForecasts;
    const collectedAt = new Date();
    const expectedValidTimes = getParisHourlyTimestamps(today);
    const requiredProjectionFields = HOURLY_FORECAST_VARIABLES
      .filter((variable) => variable.consumerProjected)
      .map((variable) => variable.valueField);
    const candidates = hourlyModels
      .filter((model) => (OFFICIAL_HOURLY_MODEL_NAMES as readonly string[]).includes(model.modelName))
      .map((model) => {
        const modelHours = model.hours.filter((hour) => hour.validAt != null && getParisDateAndHour(hour.validAt)?.date === today);
        const captureRun = {
          captureRunId: model.captureRunId ?? randomUUID(),
          sourceName: model.sourceName ?? "open-meteo",
          modelId: model.modelId ?? null,
          requestStartedAt: model.requestStartedAt ?? collectedAt.getTime(),
          availableAt: model.availableAt ?? collectedAt.getTime(),
          units: model.sourceMetadata?.units ?? {},
        };
        return {
          modelName: model.modelName,
          projectionReady: isCompleteHourlyForecastBatch({
            rows: modelHours,
            expectedValidTimes,
            requiredValueFields: requiredProjectionFields,
          }),
          rows: toHourlyRows(locationKey, today, model.modelName, modelHours as Array<Record<string, any>>, collectedAt, captureRun),
        };
      })
      .filter((candidate) => candidate.rows.length > 0);

    if (candidates.length === 0) {
      const storedRows = await getStoredHourlyForecasts(locationKey, today);
      const projectionPreserved = new Set<string>(OFFICIAL_HOURLY_MODEL_NAMES.filter((modelName) => isCompleteStoredHourlyProjection({
        rows: storedRows.filter((row) => row.modelName === modelName),
        expectedValidTimes,
        requiredValueFields: requiredProjectionFields,
      })));
      const result = granularityResult(
        0,
        expectedModelCount,
        null,
        projectionPreserved.size > 0
          ? "Aucun modèle horaire n’a renvoyé de prévision exploitable; les projections précédentes existantes restent disponibles."
          : "Aucun modèle horaire n’a renvoyé de prévision exploitable et aucune projection précédente n’existe.",
      );
      if (projectionPreserved.size > 0) {
        result.projectionRetainedModelCount = projectionPreserved.size;
        const preservedRows = storedRows.filter((row) => projectionPreserved.has(row.modelName));
        const measuredTimes = preservedRows.map((row) => timestampValue(row.collectedAt)).filter((time): time is number => time != null);
        result.retainedProjectionAgeMs = measuredTimes.length > 0 ? Math.max(0, Date.now() - Math.min(...measuredTimes)) : null;
      }
      return result;
    }

    const writeFailures: string[] = [];
    const incompleteAttemptsArchived = new Set<string>();
    for (const candidate of candidates) {
      try {
        await insertHourlyForecasts(candidate.rows, { refreshProjection: candidate.projectionReady });
        if (!candidate.projectionReady) {
          incompleteAttemptsArchived.add(candidate.modelName);
        }
      } catch (error) {
        console.warn(`[ManualFusion] Hourly write failed for ${candidate.modelName}:`, error);
        writeFailures.push(candidate.modelName);
      }
    }

    const storedRows = await getStoredHourlyForecasts(locationKey, today);
    const persistedModels = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.projectionReady || writeFailures.includes(candidate.modelName)) continue;
      const modelRows = storedRows.filter((row) => row.modelName === candidate.modelName) as Array<Record<string, unknown>>;
      if (persistedHourlySeriesMatches(candidate.rows as Array<Record<string, unknown>>, modelRows, collectedAt)) {
        persistedModels.add(candidate.modelName);
      }
    }

    const projectionPreserved = new Set<string>(OFFICIAL_HOURLY_MODEL_NAMES.filter(
      (modelName) => !persistedModels.has(modelName) && isCompleteStoredHourlyProjection({
        rows: storedRows.filter((row) => row.modelName === modelName),
        expectedValidTimes,
        requiredValueFields: requiredProjectionFields,
      }),
    ));

    const updatedAt = persistedModels.size > 0 ? new Date() : null;
    if (persistedModels.size > 0 && updatedAt) {
      cacheManualHourlyForecast(
        coords,
        today,
        officialHourly.hours,
        updatedAt,
        officialHourly.weighting,
        "Relance manuelle demandée explicitement; série recalculée par le moteur officiel avec les seuls runs horaires disponibles.",
      );
    }
    const error = writeFailures.length > 0
      ? "Certaines tentatives n’ont pas pu être confirmées en base; aucune nouvelle projection n’est annoncée pour ces sources."
      : incompleteAttemptsArchived.size > 0
        ? projectionPreserved.size > 0
          ? "Certaines tentatives incomplètes ont été archivées; les projections précédentes existantes ont été conservées."
          : "Certaines tentatives incomplètes ont été archivées; aucune projection précédente n’existait pour les sources concernées."
        : persistedModels.size === 0 && projectionPreserved.size === 0
          ? "Les données horaires n’ont pas pu être confirmées après leur enregistrement."
          : persistedModels.size < expectedModelCount
            ? "Certaines sources n’ont pas confirmé un lot complet; les projections précédentes éventuellement présentes restent disponibles."
            : undefined;
    const result = granularityResult(persistedModels.size, expectedModelCount, updatedAt, error);
    if (projectionPreserved.size > 0) {
      if (incompleteAttemptsArchived.size > 0) result.status = "partial";
      result.projectionRetainedModelCount = projectionPreserved.size;
      const preservedRows = storedRows.filter((row) => projectionPreserved.has(row.modelName));
      const measuredTimes = preservedRows.map((row) => timestampValue(row.collectedAt)).filter((time): time is number => time != null);
      result.retainedProjectionAgeMs = measuredTimes.length > 0 ? Math.max(0, Date.now() - Math.min(...measuredTimes)) : null;
      result.error = error ?? "La série horaire incomplète a été archivée sans remplacer la projection existante.";
    }
    return result;
  } catch (error) {
    console.error("[ManualFusion] Hourly refresh failed:", error);
    return granularityResult(0, expectedModelCount, null, "La collecte ou l’enregistrement horaire a échoué.");
  }
}

/**
 * Refreshes the daily fusion and hourly model archive once for an owner-verified
 * favorite. The cooldown, location key and idempotent replacement paths remain
 * shared with the existing data model; the official current-weather snapshot is
 * not written by this operation.
 */
export async function refreshManualFusionForFavorite(favorite: ManualFusionFavorite) {
  const locationKey = makeLocationKey(favorite.lat, favorite.lon);
  if (inFlightRefreshes.has(locationKey)) return { status: "in_progress" as const };

  inFlightRefreshes.add(locationKey);
  const lockKey = getLocationForecastRefreshLockKey(locationKey);
  const lockOwnerToken = randomUUID();
  let lockAcquired = false;
  try {
    lockAcquired = await acquireForecastRefreshLock(lockKey, lockOwnerToken);
    if (!lockAcquired) return { status: "in_progress" as const };
    const today = getParisDate();
    const currentSnapshot = await getMeteoAIForecastByDate(today, locationKey);
    if (isManualFusionCoolingDown(currentSnapshot?.computedAt)) {
      return {
        status: "cooldown" as const,
        retryAfterSeconds: Math.ceil((MANUAL_FUSION_COOLDOWN_MS - (Date.now() - currentSnapshot!.computedAt.getTime())) / 1000),
      };
    }

    const [daily, hourly] = await Promise.all([
      refreshDailyForecast(favorite, today, locationKey),
      refreshHourlyForecast(favorite, today, locationKey),
    ]);
    const status = daily.status === "succeeded" && hourly.status === "succeeded"
      ? "refreshed"
      : daily.status !== "failed" || hourly.status !== "failed"
        ? "partial"
        : "failed";
    const result: ManualRefreshResult = {
      status,
      location: { lat: favorite.lat, lon: favorite.lon },
      daily,
      hourly,
    };
    return result;
  } finally {
    inFlightRefreshes.delete(locationKey);
    if (lockAcquired) {
      try {
        await releaseForecastRefreshLock(lockKey, lockOwnerToken);
      } catch (error) {
        console.warn(`[ManualFusion] Could not release refresh lease for ${locationKey}:`, error);
      }
    }
  }
}
