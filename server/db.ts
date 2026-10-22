import { eq, desc, and, gte, lte, lt, sql, isNull, isNotNull, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createHash } from "node:crypto";
import { acquireForecastLease, decideScheduledForecastJobDisposition, FORECAST_REFRESH_LOCK_LEASE_MS, renewForecastLease } from "./forecastRefreshLock";
import { getParisDate } from "./weatherTime";
import { buildHourlyArchiveValues } from "./forecastVariableCoverage";
import {
  InsertUser,
  users,
  forecasts,
  forecastRuns,
  dailyForecastObservationComparisons,
  dailyForecastObservationComparisonRevisions,
  observations,
  reliabilityScores,
  meteoaiForecast,
  collectionJobs,
  forecastRefreshLocks,
  favoriteLocations,
  locationForecasts,
  hourlyForecasts,
  hourlyForecastRunValues,
  hourlyForecastEvaluationScores,
  hourlyForecastExactComparisons,
  hourlyForecastExactEvaluationScores,
  hourlyForecastCollectionResults,
  hourlyForecastProviderRunCaptures,
  hourlyForecastProviderRunValues,
  hourlyForecastProviderRunComparisons,
  hourlyForecastProviderRunScores,
  hourlyComparisonDiagnosticSnapshots,
  leadTimeScores,
  InsertForecast,
  InsertForecastRun,
  InsertDailyForecastObservationComparison,
  type DailyForecastObservationComparisonRevision,
  InsertObservation,
  InsertReliabilityScore,
  InsertMeteoAIForecast,
  InsertCollectionJob,
  InsertFavoriteLocation,
  InsertLocationForecast,
  InsertHourlyForecast,
  InsertHourlyForecastRunValue,
  InsertHourlyForecastEvaluationScore,
  InsertHourlyForecastExactComparison,
  InsertHourlyForecastExactEvaluationScore,
  InsertHourlyForecastCollectionResult,
  InsertHourlyForecastProviderRunCapture,
  InsertHourlyForecastProviderRunValue,
  InsertHourlyForecastProviderRunComparison,
  InsertHourlyForecastProviderRunScore,
  InsertLeadTimeScore,
  weatherStations,
  stationObservations,
  stationQualityProfiles,
  groundTruth,
  stationCollectionSnapshots,
  physicalSnapshotCollectionTraces,
  qualifiedObservationSnapshots,
  netatmoOAuthTokens,
  netatmoOAuthStates,
  personalWeatherObservations,
  personalModelObservationScores,
  personalModelCalibrations,
  InsertWeatherStation,
  InsertStationObservation,
  InsertStationQualityProfile,
  InsertGroundTruth,
  InsertStationCollectionSnapshot,
  InsertPhysicalSnapshotCollectionTrace,
  InsertQualifiedObservationSnapshot,
  InsertPersonalWeatherObservation,
  InsertPersonalModelObservationScore,
  InsertPersonalModelCalibration,
} from "../drizzle/schema";
import type { HourlyComparisonDiagnostic } from "./hourlyComparisonDiagnostics";
import { ENV } from "./_core/env";
import { selectLatestForecasts } from "./forecastSelection";
import { buildForecastUpdateSet } from "./forecastWrite";
import { deriveStationQualityProfile } from "./stationQualityService";
import { getGroundTruthReferenceBounds } from "./groundTruthReference";
import { PUBLIC_RANKING_EVIDENCE_THRESHOLDS } from "./weatherReliabilityConfig";
import { HourlyForecastPersistenceError, withHourlyForecastPersistenceStages } from "./hourlyForecastPersistence";
import { aggregateDailyForecastPerformance, getDailyForecastHorizon } from "./dailyForecastPerformance";
import { buildDailyForecastObservationComparisonRevision } from "./dailyForecastComparisonRevisions";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";
import type { DailyFusionHorizon, ModelPerformanceEvidence } from "./fusionPerformance";
import {
  buildDailyPhysicalComparisonHistoryPage,
  normalizeDailyComparisonPageSize,
  unavailableDailyPhysicalComparisonHistory,
  type DailyPhysicalComparisonHistoryFilters,
} from "./dailyPhysicalComparisonHistory";
export { HourlyForecastPersistenceError } from "./hourlyForecastPersistence";

let _db: ReturnType<typeof drizzle> | null = null;

export const REFERENCE_COORDINATE_TOLERANCE = 0.0001;
/** Seuils minimaux avant d'exposer un classement de performance au public. */
export const MINIMUM_PUBLIC_RELIABILITY_SAMPLES = 30;
export const MINIMUM_PUBLIC_RELIABILITY_DAYS = 7;

export function referenceCoordinateBounds(value: number) {
  return {
    min: value - REFERENCE_COORDINATE_TOLERANCE,
    max: value + REFERENCE_COORDINATE_TOLERANCE,
  };
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── USER HELPERS ───────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── FORECAST HELPERS ───────────────────────────────────────────────────────

// ─── LOCATION KEY HELPERS ──────────────────────────────────────────────────

/** Make a stable location key from lat/lon (3dp precision ≈ 111m). */
export function makeLocationKey(lat: number, lon: number): string {
  const latR = Math.round(lat * 1000) / 1000;
  const lonR = Math.round(lon * 1000) / 1000;
  return `${latR}_${lonR}`;
}

// ─── FORECAST HELPERS ───────────────────────────────────────────────────────

export function requireDatabaseForWrite(db: unknown, operation: string): asserts db {
  if (!db) throw new Error(`Base de données indisponible : impossible de ${operation}.`);
}

export async function insertForecasts(
  data: InsertForecast[],
  options: { requireDatabase?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (options.requireDatabase) requireDatabaseForWrite(db, "enregistrer les prévisions quotidiennes");
    return;
  }
  if (data.length === 0) return;
  await db.transaction(async (tx) => {
    for (const row of data) {
      await tx.insert(forecasts).values(row).onDuplicateKeyUpdate({
        set: buildForecastUpdateSet(row, new Date()),
      });
    }
  });
}

/** Persist an immutable forecast emission for reproducible lead-time scoring. */
export async function insertForecastRuns(
  data: InsertForecastRun[],
  options: { requireDatabase?: boolean } = {},
): Promise<number> {
  const db = await getDb();
  if (!db) {
    if (options.requireDatabase) requireDatabaseForWrite(db, "archiver les émissions de prévisions");
    return 0;
  }
  if (data.length === 0) return 0;
  let confirmedRows = 0;
  for (const row of data) {
    try {
      await db.insert(forecastRuns).values(row);
      confirmedRows += 1;
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) continue;
      throw error;
    }
  }
  return confirmedRows;
}

/** Insert-only archive for one emitted MeteoAI fusion; duplicate emissions are never updated. */
export async function insertMeteoAIDailyFusionRun(
  row: InsertForecastRun,
  options: { requireDatabase?: boolean } = {},
): Promise<boolean> {
  if (row.sourceKind !== "service_forecast" || row.serviceName !== "MeteoAI" || row.provider !== "meteoai" || row.modelId !== "meteoai-official-daily-v2") {
    throw new Error("L’archive de fusion accepte uniquement une émission quotidienne MeteoAI identifiée.");
  }
  const db = await getDb();
  if (!db) {
    if (options.requireDatabase) requireDatabaseForWrite(db, "archiver la fusion quotidienne MeteoAI");
    return false;
  }
  try {
    await db.insert(forecastRuns).values(row);
    return true;
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) return false;
    throw error;
  }
}

export async function getForecastsByDate(date: string, locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(forecasts).where(
    and(eq(forecasts.date, date), eq(forecasts.locationKey, locationKey))
  );
  return selectLatestForecasts(rows);
}

export async function getForecastsByDateRange(startDate: string, endDate: string, locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(forecasts)
    .where(and(gte(forecasts.date, startDate), lte(forecasts.date, endDate), eq(forecasts.locationKey, locationKey)))
    .orderBy(forecasts.date);
  return selectLatestForecasts(rows);
}

export async function getForecastsByService(serviceName: string, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(forecasts)
    .where(eq(forecasts.serviceName, serviceName))
    .orderBy(desc(forecasts.date))
    .limit(limit);
}

// ─── OBSERVATION HELPERS ────────────────────────────────────────────────────

export async function insertObservation(data: InsertObservation): Promise<void> {
  const db = await getDb();
  requireDatabaseForWrite(db, "enregistrer l'observation quotidienne qualifiée");
  // Upsert: if observation for this date+location exists, update it
  await db.insert(observations).values(data).onDuplicateKeyUpdate({
    set: {
      tempMax: data.tempMax,
      tempMin: data.tempMin,
      precipitation: data.precipitation,
      windSpeed: data.windSpeed,
      windGust: data.windGust,
      humidity: data.humidity,
      cloudCover: data.cloudCover,
      condition: data.condition,
      source: data.source,
      provenanceType: data.provenanceType,
      isQualified: data.isQualified,
      rawData: data.rawData,
    },
  });
}

export async function getObservationByDate(date: string, locationKey = "default") {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(observations).where(
    and(
      eq(observations.date, date),
      eq(observations.locationKey, locationKey),
      eq(observations.provenanceType, "physical_observation"),
      eq(observations.isQualified, 1),
    )
  ).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getObservationsByDateRange(startDate: string, endDate: string, locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(observations)
    .where(and(
      gte(observations.date, startDate),
      lte(observations.date, endDate),
      eq(observations.locationKey, locationKey),
      eq(observations.provenanceType, "physical_observation"),
      eq(observations.isQualified, 1),
    ))
    .orderBy(observations.date);
}

// ─── RELIABILITY SCORE HELPERS ──────────────────────────────────────────────

export async function insertReliabilityScores(data: InsertReliabilityScore[]): Promise<void> {
  const db = await getDb();
  if (!db || data.length === 0) return;
  await db.insert(reliabilityScores).values(data);
}

/** Idempotent compatibility write for hourly scores recomputed from immutable runs. */
export async function upsertHourlyCompatibilityReliabilityScores(data: InsertReliabilityScore[]): Promise<void> {
  const db = await getDb();
  if (!db || data.length === 0) return;
  for (const row of data) {
    const updateSet = Object.fromEntries(Object.entries(row).filter(([key, value]) =>
      !["id", "locationKey", "date", "serviceName", "evidenceType", "computedAt"].includes(key)
      && value !== undefined,
    ));
    updateSet.computedAt = new Date();
    await db.insert(reliabilityScores).values(row).onDuplicateKeyUpdate({ set: updateSet });
  }
}

export async function getLatestReliabilityScores(locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(reliabilityScores)
    .where(and(
      eq(reliabilityScores.locationKey, locationKey),
      eq(reliabilityScores.evidenceType, "physical_observation"),
    ))
    .orderBy(desc(reliabilityScores.date), desc(reliabilityScores.weightedScore));
}

export async function getReliabilityScoresByService(serviceName: string, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(reliabilityScores)
    .where(and(
      eq(reliabilityScores.serviceName, serviceName),
      eq(reliabilityScores.evidenceType, "physical_observation"),
    ))
    .orderBy(desc(reliabilityScores.date))
    .limit(limit);
}

export async function getCumulativeRanking() {
  const db = await getDb();
  if (!db) return [];
  // Les références de modèle et les lignes legacy ne constituent jamais une
  // vérité terrain utilisable pour un classement public.
  const result = await db
    .select({
      serviceName: reliabilityScores.serviceName,
      avgScore: sql<number>`AVG(${reliabilityScores.weightedScore})`,
      // Legacy flat metrics
      avgMaeTemp: sql<number>`AVG(${reliabilityScores.maeTemp})`,
      avgMaePrecip: sql<number>`AVG(${reliabilityScores.maePrecip})`,
      avgMaeWind: sql<number>`AVG(${reliabilityScores.maeWind})`,
      avgRmseTemp: sql<number>`AVG(${reliabilityScores.rmseTemp})`,
      avgBiasTemp: sql<number>`AVG(${reliabilityScores.biasTemp})`,
      avgBiasPrecip: sql<number>`AVG(${reliabilityScores.biasPrecip})`,
      daysTracked: sql<number>`COUNT(*)`,
      totalSamples: sql<number>`SUM(${reliabilityScores.sampleSize})`,
      evaluatedDays: sql<number>`COUNT(DISTINCT ${reliabilityScores.date})`,
      latestScoreDate: sql<string>`MAX(${reliabilityScores.date})`,
      // 🌡️ Temperature dimension
      avgTempScore: sql<number>`AVG(${reliabilityScores.tempScore})`,
      avgTempMae: sql<number>`AVG(${reliabilityScores.maeTemp})`,
      avgTempBias: sql<number>`AVG(${reliabilityScores.biasTemp})`,
      avgTempMaxError: sql<number>`AVG(${reliabilityScores.tempMaxError})`,
      // 🌧️ Precipitation dimension
      avgPrecipScore: sql<number>`AVG(${reliabilityScores.precipScore})`,
      avgPrecipPod: sql<number>`AVG(${reliabilityScores.precipPod})`,
      avgPrecipFar: sql<number>`AVG(${reliabilityScores.precipFar})`,
      avgPrecipCsi: sql<number>`AVG(${reliabilityScores.precipCsi})`,
      totalPrecipFalsePos: sql<number>`SUM(${reliabilityScores.precipFalsePositives})`,
      totalPrecipFalseNeg: sql<number>`SUM(${reliabilityScores.precipFalseNegatives})`,
      // 💨 Wind dimension
      avgWindScore: sql<number>`AVG(${reliabilityScores.windScore})`,
      avgWindMaeGusts: sql<number>`AVG(${reliabilityScores.windMaeGusts})`,
      // ☁️ Condition dimension
      avgCondScore: sql<number>`AVG(${reliabilityScores.condScore})`,
      avgCondConcordance: sql<number>`AVG(${reliabilityScores.condConcordance})`,
      avgCondMaeCloud: sql<number>`AVG(${reliabilityScores.condMaeCloud})`,
    })
    .from(reliabilityScores)
    .where(eq(reliabilityScores.evidenceType, "physical_observation"))
    .groupBy(reliabilityScores.serviceName)
    .having(sql`SUM(${reliabilityScores.sampleSize}) >= ${PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons} AND COUNT(DISTINCT ${reliabilityScores.date}) >= ${PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays}`)
    .orderBy(sql`AVG(${reliabilityScores.weightedScore}) DESC`);
  return result;
}

export async function getCumulativeRankingForLocation(locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  const result = await db
    .select({
      serviceName: reliabilityScores.serviceName,
      avgScore: sql<number>`AVG(${reliabilityScores.weightedScore})`,
      avgMaeTemp: sql<number>`AVG(${reliabilityScores.maeTemp})`,
      avgMaePrecip: sql<number>`AVG(${reliabilityScores.maePrecip})`,
      avgMaeWind: sql<number>`AVG(${reliabilityScores.maeWind})`,
      avgRmseTemp: sql<number>`AVG(${reliabilityScores.rmseTemp})`,
      avgBiasTemp: sql<number>`AVG(${reliabilityScores.biasTemp})`,
      avgBiasPrecip: sql<number>`AVG(${reliabilityScores.biasPrecip})`,
      daysTracked: sql<number>`COUNT(*)`,
      totalSamples: sql<number>`SUM(${reliabilityScores.sampleSize})`,
      evaluatedDays: sql<number>`COUNT(DISTINCT ${reliabilityScores.date})`,
      latestScoreDate: sql<string>`MAX(${reliabilityScores.date})`,
      avgTempScore: sql<number>`AVG(${reliabilityScores.tempScore})`,
      avgTempMae: sql<number>`AVG(${reliabilityScores.maeTemp})`,
      avgTempBias: sql<number>`AVG(${reliabilityScores.biasTemp})`,
      avgTempMaxError: sql<number>`AVG(${reliabilityScores.tempMaxError})`,
      avgPrecipScore: sql<number>`AVG(${reliabilityScores.precipScore})`,
      avgPrecipPod: sql<number>`AVG(${reliabilityScores.precipPod})`,
      avgPrecipFar: sql<number>`AVG(${reliabilityScores.precipFar})`,
      avgPrecipCsi: sql<number>`AVG(${reliabilityScores.precipCsi})`,
      totalPrecipFalsePos: sql<number>`SUM(${reliabilityScores.precipFalsePositives})`,
      totalPrecipFalseNeg: sql<number>`SUM(${reliabilityScores.precipFalseNegatives})`,
      avgWindScore: sql<number>`AVG(${reliabilityScores.windScore})`,
      avgWindMaeGusts: sql<number>`AVG(${reliabilityScores.windMaeGusts})`,
      avgCondScore: sql<number>`AVG(${reliabilityScores.condScore})`,
      avgCondConcordance: sql<number>`AVG(${reliabilityScores.condConcordance})`,
      avgCondMaeCloud: sql<number>`AVG(${reliabilityScores.condMaeCloud})`,
    })
    .from(reliabilityScores)
    .where(and(
      eq(reliabilityScores.locationKey, locationKey),
      eq(reliabilityScores.evidenceType, "physical_observation"),
    ))
    .groupBy(reliabilityScores.serviceName)
    .having(sql`SUM(${reliabilityScores.sampleSize}) >= ${PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons} AND COUNT(DISTINCT ${reliabilityScores.date}) >= ${PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays}`)
    .orderBy(sql`AVG(${reliabilityScores.weightedScore}) DESC`);
  return result;
}

/** Les poids opérationnels exigent une observation physique explicitement qualifiée. */
export async function getQualifiedCumulativeRankingForLocation(locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      serviceName: reliabilityScores.serviceName,
      avgScore: sql<number>`AVG(${reliabilityScores.weightedScore})`,
      avgMaeTemp: sql<number>`AVG(${reliabilityScores.maeTemp})`,
      avgMaePrecip: sql<number>`AVG(${reliabilityScores.maePrecip})`,
      avgMaeWind: sql<number>`AVG(${reliabilityScores.maeWind})`,
      avgMaeHumidity: sql<number>`AVG(${reliabilityScores.humidityMae})`,
      avgBiasTemp: sql<number>`AVG(${reliabilityScores.biasTemp})`,
      avgBiasPrecip: sql<number>`AVG(${reliabilityScores.biasPrecip})`,
      daysTracked: sql<number>`COUNT(*)`,
      totalSamples: sql<number>`SUM(${reliabilityScores.sampleSize})`,
      evaluatedDays: sql<number>`COUNT(DISTINCT ${reliabilityScores.date})`,
      latestScoreDate: sql<string>`MAX(${reliabilityScores.date})`,
      avgCondMaeCloud: sql<number>`AVG(${reliabilityScores.condMaeCloud})`,
    })
    .from(reliabilityScores)
    .where(and(
      eq(reliabilityScores.locationKey, locationKey),
      eq(reliabilityScores.evidenceType, "physical_observation"),
    ))
    .groupBy(reliabilityScores.serviceName)
    .having(sql`SUM(${reliabilityScores.sampleSize}) >= ${PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons} AND COUNT(DISTINCT ${reliabilityScores.date}) >= ${PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays}`)
    .orderBy(sql`AVG(${reliabilityScores.weightedScore}) DESC`);
}

// ─── METEOAI FORECAST HELPERS ───────────────────────────────────────────────

export async function upsertMeteoAIForecast(
  data: InsertMeteoAIForecast,
  options: { refreshComputedAt?: boolean; requireDatabase?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (options.requireDatabase) requireDatabaseForWrite(db, "enregistrer la fusion MeteoAI");
    return;
  }
  // Keep one current fusion per location/date; completed manual and scheduled refreshes may bump computedAt.
  // Legacy stabilityIndex/Label/ConfidenceScore are intentionally omitted from
  // updates; stabilityLabel remains required only on inserts by the old schema.
  const update: Partial<InsertMeteoAIForecast> = {
    tempMax: data.tempMax,
    tempMin: data.tempMin,
    precipitation: data.precipitation,
    windSpeed: data.windSpeed,
    condition: data.condition,
    weights: data.weights,
    explanation: data.explanation,
  };
  if (options.refreshComputedAt) update.computedAt = data.computedAt ?? new Date();
  await db.insert(meteoaiForecast).values(data).onDuplicateKeyUpdate({
    set: update,
  });
}

export function hideUncalibratedCurrentDailyForecast<T extends { date: string; weights: unknown }>(row: T, today = getParisDate()): T {
  if (row.date !== today) return row;
  const weights = row.weights && typeof row.weights === "object" ? row.weights as Record<string, any> : null;
  const statuses = weights?.version === 2 && weights.trace && typeof weights.trace === "object"
    ? weights.trace.calibrationStatus as Record<string, unknown> | undefined
    : undefined;
  const hasQualifiedCore = statuses?.tempMax === "calibrated"
    && statuses.tempMin === "calibrated"
    && statuses.precipitation === "calibrated"
    && statuses.windSpeed === "calibrated"
    && (row as any).tempMax != null
    && (row as any).tempMin != null
    && (row as any).precipitation != null
    && (row as any).windSpeed != null;
  if (hasQualifiedCore) return row;
  return {
    ...row,
    tempMax: null,
    tempMin: null,
    precipitation: null,
    windSpeed: null,
    windGust: null,
    humidity: null,
    cloudCover: null,
    condition: null,
    confidenceScore: null,
  };
}

export async function getMeteoAIForecastByDate(date: string, locationKey = "default") {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(meteoaiForecast)
    .where(and(eq(meteoaiForecast.date, date), eq(meteoaiForecast.locationKey, locationKey)))
    .orderBy(desc(meteoaiForecast.computedAt))
    .limit(1);
  return result.length > 0 ? hideUncalibratedCurrentDailyForecast(result[0]) : null;
}

export async function getLatestMeteoAIForecasts(limit = 7, locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(meteoaiForecast)
    .where(eq(meteoaiForecast.locationKey, locationKey))
    .orderBy(desc(meteoaiForecast.date))
    .limit(limit);
  return rows.map((row) => hideUncalibratedCurrentDailyForecast(row));
}

/** Get successive MeteoAI snapshots for trace and weight comparisons. */
export async function getMeteoAIForecastHistory(locationKey = "default", limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(meteoaiForecast)
    .where(eq(meteoaiForecast.locationKey, locationKey))
    .orderBy(desc(meteoaiForecast.computedAt))
    .limit(limit);
}

/**
 * Get daily weighted scores per service for the last N days (for AI Lab historical chart)
 */
export async function getHistoricalScoreTimeSeries(days = 14, locationKey = "default") {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      date: reliabilityScores.date,
      serviceName: reliabilityScores.serviceName,
      weightedScore: reliabilityScores.weightedScore,
      tempScore: reliabilityScores.tempScore,
      precipScore: reliabilityScores.precipScore,
      windScore: reliabilityScores.windScore,
      condScore: reliabilityScores.condScore,
    })
    .from(reliabilityScores)
    .where(
      and(
        eq(reliabilityScores.locationKey, locationKey),
        eq(reliabilityScores.evidenceType, "physical_observation"),
        sql`${reliabilityScores.date} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`
      )
    )
    .orderBy(desc(reliabilityScores.date), reliabilityScores.serviceName)
    .limit(days * 20); // up to 20 services per day
}

// ─── COLLECTION JOB HELPERS ─────────────────────────────────────────────────

export async function createCollectionJob(
  data: InsertCollectionJob,
  options: { requireDatabase?: boolean } = {},
): Promise<number> {
  const db = await getDb();
  if (!db) {
    if (options.requireDatabase) requireDatabaseForWrite(db, "créer le journal de collecte");
    return -1;
  }
  const result = await db.insert(collectionJobs).values(data);
  return (result as any)[0]?.insertId ?? -1;
}

export async function updateCollectionJob(
  id: number,
  updates: Partial<Pick<InsertCollectionJob, "status" | "servicesCollected" | "dailyModelsCollected" | "dailyModelsExpected" | "hourlyModelsCollected" | "hourlyModelsExpected" | "errorMessage" | "completedAt">>,
  options: { requireDatabase?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  if (!db) {
    if (options.requireDatabase) requireDatabaseForWrite(db, "mettre à jour le journal de collecte");
    return;
  }
  await db.update(collectionJobs).set(updates).where(eq(collectionJobs.id, id));
}

export async function getRecentCollectionJobs(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(collectionJobs)
    .orderBy(desc(collectionJobs.startedAt))
    .limit(limit);
}

export async function getRecentScheduledForecastCollectionJobs(limit = 2) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectionJobs)
    .where(and(eq(collectionJobs.jobType, "forecast"), isNotNull(collectionJobs.scheduleRunKey)))
    .orderBy(desc(collectionJobs.startedAt))
    .limit(limit);
}

function isDuplicateKeyError(error: unknown): boolean {
  const candidates = [error, (error as any)?.cause, (error as any)?.driverError];
  return candidates.some((candidate: any) => candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062);
}

function affectedRows(result: unknown): number {
  const first = Array.isArray(result) ? (result as any[])[0] : result as any;
  return Number(first?.affectedRows ?? 0);
}

/** Persistent lease shared by the scheduled batch and manual AI Lab refresh. */
export async function acquireForecastRefreshLock(
  lockKey: string,
  ownerToken: string,
  now = new Date(),
  leaseMs = FORECAST_REFRESH_LOCK_LEASE_MS,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while acquiring forecast refresh lock.");

  return acquireForecastLease({
    async insertIfAbsent(input) {
      try {
        await db.insert(forecastRefreshLocks).values(input);
        return true;
      } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        throw error;
      }
    },
    async claimIfExpired(input) {
      const result = await db.update(forecastRefreshLocks)
        .set({ ownerToken: input.ownerToken, leaseExpiresAt: input.leaseExpiresAt })
        .where(and(
          eq(forecastRefreshLocks.lockKey, input.lockKey),
          lte(forecastRefreshLocks.leaseExpiresAt, input.now),
        ));
      return affectedRows(result) > 0;
    },
    async renewIfOwned() {
      // Cette opération n'est jamais appelée lors de l'acquisition.
      return false;
    },
  }, { lockKey, ownerToken, now, leaseMs });
}

/** Release only the lease still owned by this invocation. */
export async function releaseForecastRefreshLock(lockKey: string, ownerToken: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(forecastRefreshLocks).where(and(
    eq(forecastRefreshLocks.lockKey, lockKey),
    eq(forecastRefreshLocks.ownerToken, ownerToken),
  ));
}

/** Prolonge atomiquement un lease vivant détenu par cette invocation uniquement. */
export async function renewForecastRefreshLock(
  lockKey: string,
  ownerToken: string,
  now = new Date(),
  leaseMs = FORECAST_REFRESH_LOCK_LEASE_MS,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while renewing forecast refresh lock.");
  return renewForecastLease({
    async insertIfAbsent() { return false; },
    async claimIfExpired() { return false; },
    async renewIfOwned(input) {
      const result = await db.update(forecastRefreshLocks)
        .set({ leaseExpiresAt: input.leaseExpiresAt })
        .where(and(
          eq(forecastRefreshLocks.lockKey, input.lockKey),
          eq(forecastRefreshLocks.ownerToken, input.ownerToken),
          sql`${forecastRefreshLocks.leaseExpiresAt} > ${input.now}`,
        ));
      return affectedRows(result) > 0;
    },
  }, { lockKey, ownerToken, now, leaseMs });
}

export type ScheduledForecastJobClaim =
  | { claimed: true; jobId: number }
  | { claimed: false; reason: "already-completed" | "in-progress" };

/** One durable collection_jobs row per Paris slot; failed/stale slots may be retried. */
export async function claimScheduledForecastCollectionJob(
  scheduleRunKey: string,
  scheduleCronTaskUid: string,
  now = new Date(),
): Promise<ScheduledForecastJobClaim> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while claiming scheduled forecast collection.");

  let existing = (await db.select().from(collectionJobs)
    .where(eq(collectionJobs.scheduleRunKey, scheduleRunKey)).limit(1))[0];

  if (!existing) {
    try {
      const result = await db.insert(collectionJobs).values({
        jobType: "forecast",
        status: "running",
        scheduleCronTaskUid,
        scheduleRunKey,
        servicesCollected: 0,
        dailyModelsCollected: 0,
        dailyModelsExpected: 0,
        hourlyModelsCollected: 0,
        hourlyModelsExpected: 0,
        startedAt: now,
      });
      const jobId = Number((result as any)[0]?.insertId ?? 0);
      if (jobId > 0) return { claimed: true, jobId };
      throw new Error("Scheduled collection job insert returned no id.");
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      existing = (await db.select().from(collectionJobs)
        .where(eq(collectionJobs.scheduleRunKey, scheduleRunKey)).limit(1))[0];
      if (!existing) throw new Error("Duplicate scheduled collection slot exists but could not be read.");
    }
  }

  const disposition = decideScheduledForecastJobDisposition(existing, now);
  if (disposition !== "retry") return { claimed: false, reason: disposition };
  const staleBefore = now.getTime() - FORECAST_REFRESH_LOCK_LEASE_MS;

  const result = await db.update(collectionJobs).set({
    status: "running",
    scheduleCronTaskUid,
    servicesCollected: 0,
    dailyModelsCollected: 0,
    dailyModelsExpected: 0,
    hourlyModelsCollected: 0,
    hourlyModelsExpected: 0,
    errorMessage: null,
    startedAt: now,
    completedAt: null,
  }).where(and(
    eq(collectionJobs.id, existing.id),
    or(
      eq(collectionJobs.status, "pending"),
      eq(collectionJobs.status, "failed"),
      and(eq(collectionJobs.status, "running"), lte(collectionJobs.startedAt, new Date(staleBefore))),
    ),
  ));

  return affectedRows(result) > 0
    ? { claimed: true, jobId: existing.id }
    : { claimed: false, reason: "in-progress" };
}

export type ScheduledObservationJobClaim =
  | { claimed: true; jobId: number }
  | { claimed: false; reason: "already-completed" | "in-progress" };

/** Un cycle persistant de scoring par date civile Paris, reprenable après abandon. */
export async function claimScheduledObservationCollectionJob(
  dateParis: string,
  scheduleCronTaskUid: string,
  now = new Date(),
): Promise<ScheduledObservationJobClaim> {
  const scheduleRunKey = `observations:${dateParis}`;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while claiming scheduled observation collection.");

  let existing = (await db.select().from(collectionJobs)
    .where(eq(collectionJobs.scheduleRunKey, scheduleRunKey)).limit(1))[0];
  if (!existing) {
    try {
      const result = await db.insert(collectionJobs).values({
        jobType: "observation",
        status: "running",
        scheduleCronTaskUid,
        scheduleRunKey,
        servicesCollected: 0,
        dailyModelsCollected: 0,
        dailyModelsExpected: 0,
        hourlyModelsCollected: 0,
        hourlyModelsExpected: 0,
        startedAt: now,
      });
      const jobId = Number((result as any)[0]?.insertId ?? 0);
      if (jobId > 0) return { claimed: true, jobId };
      throw new Error("Scheduled observation collection job insert returned no id.");
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      existing = (await db.select().from(collectionJobs)
        .where(eq(collectionJobs.scheduleRunKey, scheduleRunKey)).limit(1))[0];
      if (!existing) throw new Error("Duplicate observation collection cycle exists but could not be read.");
    }
  }

  const disposition = decideScheduledForecastJobDisposition(existing, now);
  if (disposition !== "retry") return { claimed: false, reason: disposition };
  const staleBefore = new Date(now.getTime() - FORECAST_REFRESH_LOCK_LEASE_MS);
  const result = await db.update(collectionJobs).set({
    status: "running",
    scheduleCronTaskUid,
    servicesCollected: 0,
    dailyModelsCollected: 0,
    dailyModelsExpected: 0,
    hourlyModelsCollected: 0,
    hourlyModelsExpected: 0,
    errorMessage: null,
    startedAt: now,
    completedAt: null,
  }).where(and(
    eq(collectionJobs.id, existing.id),
    or(
      eq(collectionJobs.status, "pending"),
      eq(collectionJobs.status, "failed"),
      and(eq(collectionJobs.status, "running"), lte(collectionJobs.startedAt, staleBefore)),
    ),
  ));
  return affectedRows(result) > 0
    ? { claimed: true, jobId: existing.id }
    : { claimed: false, reason: "in-progress" };
}


// ─── Favorite Locations ──────────────────────────────────────────────────────

/**
 * Get ALL favorite locations across all users (used by cron jobs for bulk collection)
 */
export async function getAllFavoriteLocations() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(favoriteLocations)
    .orderBy(favoriteLocations.userId, favoriteLocations.position);
}

export async function getFavoriteLocations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(favoriteLocations)
    .where(eq(favoriteLocations.userId, userId))
    .orderBy(favoriteLocations.position);
}

const MAX_FAVORITE_LOCATIONS = 8;

export async function addFavoriteLocation(data: InsertFavoriteLocation) {
  const db = await getDb();
  if (!db) return null;
  // Check max 8
  const existing = await db
    .select({ count: sql<number>`count(*)` })
    .from(favoriteLocations)
    .where(eq(favoriteLocations.userId, data.userId));
  if (existing[0]?.count >= MAX_FAVORITE_LOCATIONS) return null;
  const result = await db.insert(favoriteLocations).values(data);
  return result[0].insertId;
}

export async function updateFavoriteLocation(id: number, userId: number, data: Partial<InsertFavoriteLocation>) {
  const db = await getDb();
  if (!db) return false;
  await db
    .update(favoriteLocations)
    .set(data)
    .where(and(eq(favoriteLocations.id, id), eq(favoriteLocations.userId, userId)));
  return true;
}

export async function deleteFavoriteLocation(id: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  await db
    .delete(favoriteLocations)
    .where(and(eq(favoriteLocations.id, id), eq(favoriteLocations.userId, userId)));
  return true;
}

export async function setDefaultFavorite(id: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  // Clear all defaults for this user
  await db
    .update(favoriteLocations)
    .set({ isDefault: 0 })
    .where(eq(favoriteLocations.userId, userId));
  // Set the new default
  await db
    .update(favoriteLocations)
    .set({ isDefault: 1 })
    .where(and(eq(favoriteLocations.id, id), eq(favoriteLocations.userId, userId)));
  return true;
}

// ─── Physical station snapshots ─────────────────────────────────────────────

/** Upsert the immutable identity and latest metadata of a station candidate or validated. */
export async function upsertWeatherStation(data: InsertWeatherStation): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(weatherStations).values(data).onDuplicateKeyUpdate({
    set: {
      source: data.source,
      name: data.name,
      lat: data.lat,
      lon: data.lon,
      altitude: data.altitude ?? null,
      refLat: data.refLat,
      refLon: data.refLon,
      distanceKm: data.distanceKm,
      reliabilityScore: data.reliabilityScore ?? null,
      updateFrequencyMin: data.updateFrequencyMin ?? null,
      dataAvailability: data.dataAvailability ?? null,
      isActive: data.isActive ?? 1,
      exclusionReason: data.exclusionReason ?? null,
      qualificationStatus: data.qualificationStatus ?? "validated",
      sourceTier: data.sourceTier ?? null,
      lastSeen: new Date(),
    },
  });
}

/**
 * Compatibilité historique : l'observation brute est insert-only. Un doublon
 * (stationId, observedAt) laisse intacts le premier payload et collectedAt.
 */
export async function upsertStationObservation(data: InsertStationObservation): Promise<void> {
  await insertStationObservationIfMissing(data);
}

/**
 * Écriture strictement additive pour une relance manuelle. Lorsqu'une station a
 * déjà livré une mesure pour le même instant, celle-ci demeure intacte : la
 * relance ne peut donc ni modifier ni réécrire le relevé déjà archivé.
 */
export async function insertStationObservationIfMissing(data: InsertStationObservation): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = await db
    .select({ id: stationObservations.id })
    .from(stationObservations)
    .where(and(
      eq(stationObservations.stationId, data.stationId),
      eq(stationObservations.observedAt, data.observedAt),
    ))
    .limit(1);
  if (existing[0]) return false;
  try {
    await db.insert(stationObservations).values(data);
    return true;
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) return false;
    throw error;
  }
}

/**
 * Rebuild quality metadata from archived observations. The profile is evidence
 * only: it never writes reliabilityScore, qualificationStatus or isActive.
 */
export async function refreshStationQualityProfiles(stationIds: string[], nowMs = Date.now()): Promise<void> {
  const db = await getDb();
  const uniqueIds = Array.from(new Set(stationIds));
  if (!db || uniqueIds.length === 0) return;
  const refreshIntervalMs = 6 * 60 * 60 * 1000;
  const existingProfiles = await db.select({
    stationId: stationQualityProfiles.stationId,
    evaluatedAt: stationQualityProfiles.evaluatedAt,
  }).from(stationQualityProfiles).where(inArray(stationQualityProfiles.stationId, uniqueIds));
  const evaluatedAtByStation = new Map(existingProfiles.map((profile) => [profile.stationId, profile.evaluatedAt.getTime()]));
  const dueIds = uniqueIds.filter((stationId) => nowMs - (evaluatedAtByStation.get(stationId) ?? 0) >= refreshIntervalMs);
  if (dueIds.length === 0) return;
  const sinceMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  const readings = await db.select().from(stationObservations).where(and(
    inArray(stationObservations.stationId, dueIds),
    gte(stationObservations.observedAt, sinceMs),
  )).orderBy(stationObservations.observedAt);
  const byStation = new Map<string, typeof readings>();
  for (const reading of readings) byStation.set(reading.stationId, [...(byStation.get(reading.stationId) ?? []), reading]);

  const writeConcurrency = 12;
  for (let index = 0; index < dueIds.length; index += writeConcurrency) {
    await Promise.all(dueIds.slice(index, index + writeConcurrency).map(async (stationId) => {
      const profile = deriveStationQualityProfile({ stationId, nowMs, observations: byStation.get(stationId) ?? [] });
      const data: InsertStationQualityProfile = { ...profile, firstObservedAt: profile.firstObservedAt ?? null, lastObservedAt: profile.lastObservedAt ?? null };
      await db.insert(stationQualityProfiles).values(data).onDuplicateKeyUpdate({
        set: { ...data, evaluatedAt: new Date() },
      });
    }));
  }
}

export async function getStationQualityProfiles(stationIds: string[]) {
  const db = await getDb();
  const uniqueIds = Array.from(new Set(stationIds));
  if (!db || uniqueIds.length === 0) return [];
  return db.select().from(stationQualityProfiles).where(inArray(stationQualityProfiles.stationId, uniqueIds));
}

/**
 * Read the latest fresh, explicitly validated Netatmo observations without
 * exposing OAuth credentials. Used only when Netatmo's public endpoint is
 * temporarily unavailable to the Dashboard.
 */
export async function getRecentValidatedNetatmoObservations(sinceMs: number) {
  const db = await getDb();
  if (!db) return [];
  const stations = await db
    .select()
    .from(weatherStations)
    .where(and(
      eq(weatherStations.source, "netatmo"),
      eq(weatherStations.isActive, 1),
      eq(weatherStations.qualificationStatus, "validated"),
    ));
  if (stations.length === 0) return [];

  const readings = await db
    .select()
    .from(stationObservations)
    .where(and(
      inArray(stationObservations.stationId, stations.map((station) => station.stationId)),
      gte(stationObservations.observedAt, sinceMs),
    ))
    .orderBy(desc(stationObservations.observedAt));

  const latestByStation = new Map<number | string, typeof readings[number]>();
  for (const reading of readings) {
    if (!latestByStation.has(reading.stationId)) latestByStation.set(reading.stationId, reading);
  }
  return stations.flatMap((station) => {
    const observation = latestByStation.get(station.stationId);
    return observation ? [{ station, observation }] : [];
  });
}

/** Idempotent physical synthesis for one location and Paris hour. */
export async function upsertQualifiedObservationSnapshot(data: InsertQualifiedObservationSnapshot): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select({ id: qualifiedObservationSnapshots.id })
    .from(qualifiedObservationSnapshots)
    .where(and(
      eq(qualifiedObservationSnapshots.locationKey, data.locationKey),
      eq(qualifiedObservationSnapshots.date, data.date),
      eq(qualifiedObservationSnapshots.hour, data.hour),
    ))
    .limit(1);
  if (existing[0]) {
    await db.update(qualifiedObservationSnapshots).set({ ...data, collectedAt: new Date() }).where(eq(qualifiedObservationSnapshots.id, existing[0].id));
    return;
  }
  await db.insert(qualifiedObservationSnapshots).values(data);
}

/**
 * Conserve le premier snapshot qualifié d'un lieu pour une heure de Paris.
 * Utilisé lors d'une relance manuelle afin de préserver sans exception les
 * snapshots précédemment archivés.
 */
export async function insertQualifiedObservationSnapshotIfMissing(data: InsertQualifiedObservationSnapshot): Promise<boolean> {
  const db = await getDb();
  requireDatabaseForWrite(db, "archiver le snapshot physique qualifié");
  try {
    await db.insert(qualifiedObservationSnapshots).values(data);
    return true;
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) return false;
    throw error;
  }
}

export async function getQualifiedObservationSnapshotsForDate(locationKey: string, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(qualifiedObservationSnapshots).where(and(
    eq(qualifiedObservationSnapshots.locationKey, locationKey),
    eq(qualifiedObservationSnapshots.date, date),
  )).orderBy(qualifiedObservationSnapshots.hour);
}
/** Read qualified physical snapshots over a bounded date range for historical evidence. */
export async function getQualifiedObservationSnapshotsByDateRange(locationKey: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(qualifiedObservationSnapshots).where(and(
    eq(qualifiedObservationSnapshots.locationKey, locationKey),
    gte(qualifiedObservationSnapshots.date, startDate),
    lte(qualifiedObservationSnapshots.date, endDate),
  )).orderBy(desc(qualifiedObservationSnapshots.date), qualifiedObservationSnapshots.hour);
}
export async function getQualifiedEvidenceStatus(locationKey: string) {
  const db = await getDb();
  if (!db) return { date: null, coverageHours: 0, lastCollectedAt: null, qualifiedScoreCount: 0, lastQualifiedScoreAt: null };
  const latest = await db.select().from(qualifiedObservationSnapshots)
    .where(eq(qualifiedObservationSnapshots.locationKey, locationKey))
    .orderBy(desc(qualifiedObservationSnapshots.date), desc(qualifiedObservationSnapshots.hour))
    .limit(1);
  if (!latest[0]) return { date: null, coverageHours: 0, lastCollectedAt: null, qualifiedScoreCount: 0, lastQualifiedScoreAt: null };
  const date = latest[0].date;
  const snapshots = await getQualifiedObservationSnapshotsForDate(locationKey, date);
  const scores = await db.select().from(reliabilityScores).where(and(
    eq(reliabilityScores.locationKey, locationKey),
    eq(reliabilityScores.date, date),
    eq(reliabilityScores.evidenceType, "physical_observation"),
  ));
  return {
    date,
    coverageHours: snapshots.length,
    lastCollectedAt: latest[0].collectedAt,
    latestQualifiedStationCount: latest[0].stationCount,
    qualifiedScoreCount: scores.length,
    lastQualifiedScoreAt: scores.reduce<Date | null>((current, score) => !current || score.computedAt > current ? score.computedAt : current, null),
  };
}

/** Read only the latest persisted station evidence for a forecast-collection report. */
export async function getStationEvidenceSummary(locationKey: string, refLat: number, refLon: number) {
  const db = await getDb();
  if (!db) {
    return {
      validatedStationCount: 0,
      candidateStationCount: 0,
      excludedStationCount: 0,
      evidence: await getQualifiedEvidenceStatus(locationKey),
    };
  }
  const latBounds = referenceCoordinateBounds(refLat);
  const lonBounds = referenceCoordinateBounds(refLon);
  const stations = await db.select({
    isActive: weatherStations.isActive,
    qualificationStatus: weatherStations.qualificationStatus,
  }).from(weatherStations).where(and(
    gte(weatherStations.refLat, latBounds.min),
    lte(weatherStations.refLat, latBounds.max),
    gte(weatherStations.refLon, lonBounds.min),
    lte(weatherStations.refLon, lonBounds.max),
    // Les lignes de capteurs citoyens historisées restent en base mais ne
    // comptent plus : seules les stations collectées alimentent la preuve.
    inArray(weatherStations.source, ["meteofrance", "netatmo"]),
  ));
  return {
    validatedStationCount: stations.filter((station) => station.isActive === 1 && station.qualificationStatus === "validated").length,
    candidateStationCount: stations.filter((station) => station.qualificationStatus === "candidate").length,
    excludedStationCount: stations.filter((station) => station.isActive !== 1 || station.qualificationStatus === "excluded").length,
    evidence: await getQualifiedEvidenceStatus(locationKey),
  };
}

/** Immutable forecast emissions targeting one daily observation. */
export async function getForecastRunsForValidDate(locationKey: string, validDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(forecastRuns).where(and(
    eq(forecastRuns.locationKey, locationKey),
    eq(forecastRuns.validDate, validDate),
  )).orderBy(desc(forecastRuns.issuedAt));
}

/** Read only the immutable model/fusion runs and qualified physical snapshots for one exact valid date. */
export async function getDailyForecastVerificationSources(locationKey: string, validDate: string) {
  const db = await getDb();
  if (!db) return { available: false as const, reason: "database_unavailable" as const, runs: [], snapshots: [] };
  try {
    const [runs, snapshots] = await Promise.all([
      db.select().from(forecastRuns).where(and(
        eq(forecastRuns.locationKey, locationKey),
        eq(forecastRuns.validDate, validDate),
      )).orderBy(desc(forecastRuns.issuedAt)),
      db.select().from(qualifiedObservationSnapshots).where(and(
        eq(qualifiedObservationSnapshots.locationKey, locationKey),
        eq(qualifiedObservationSnapshots.date, validDate),
      )).orderBy(qualifiedObservationSnapshots.hour),
    ]);
    return { available: true as const, reason: null, runs, snapshots };
  } catch (error) {
    console.warn("[MeteoAI] Sources de comparaison quotidiennes indisponibles.", error);
    return { available: false as const, reason: "archive_unavailable" as const, runs: [], snapshots: [] };
  }
}

let dailyComparisonTableWarningLogged = false;

function isDailyComparisonTableUnavailable(error: unknown): boolean {
  let current: any = error;
  for (let depth = 0; current && depth < 4; depth++, current = current.cause) {
    const code = String(current.code ?? current.sqlState ?? "");
    const message = String(current.message ?? "").toLowerCase();
    if (code === "ER_NO_SUCH_TABLE" || code === "42S02" || current.errno === 1146) return true;
    if ((code === "ER_BAD_FIELD_ERROR" || code === "42S22" || current.errno === 1054)
      && (message.includes("daily_forecast_observation_comparisons")
        || message.includes("daily_forecast_observation_comparison_revisions")
        || message.includes("forecastAvailableAt".toLowerCase())
        || message.includes("observationWindowStartAt".toLowerCase())
        || message.includes("observationWindowEndAt".toLowerCase())
        || message.includes("stationEvidence".toLowerCase()))) return true;
  }
  return false;
}

function warnDailyComparisonTableUnavailable(): void {
  if (dailyComparisonTableWarningLogged) return;
  dailyComparisonTableWarningLogged = true;
  console.warn("[MeteoAI] L’archive quotidienne ou son journal de révisions n’est pas migré; aucune projection de comparaison n’est mise à jour sans journal append-only.");
}

/**
 * Append each distinct exact payload to the revision archive, then update the
 * legacy current projection used by existing scoring readers. Both writes are
 * atomic; without the additive revision table, no potentially destructive
 * projection update is made.
 */
export async function upsertDailyForecastObservationComparisons(
  rows: InsertDailyForecastObservationComparison[],
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  if (rows.length === 0) return true;
  try {
    await db.transaction(async (tx) => {
      for (const row of rows) {
        try {
          await tx.insert(dailyForecastObservationComparisonRevisions)
            .values(buildDailyForecastObservationComparisonRevision(row));
        } catch (error: any) {
          if (error?.code !== "ER_DUP_ENTRY" && error?.errno !== 1062) throw error;
        }
        await tx.insert(dailyForecastObservationComparisons).values(row).onDuplicateKeyUpdate({
          set: {
            forecastRunId: row.forecastRunId,
            locationKey: row.locationKey,
            validDate: row.validDate,
            serviceName: row.serviceName,
            provider: row.provider,
            modelId: row.modelId,
            horizonBucket: row.horizonBucket,
            leadTimeMinutes: row.leadTimeMinutes,
            variable: row.variable,
            forecastValue: row.forecastValue,
            observedValue: row.observedValue,
            signedError: row.signedError,
            absoluteError: row.absoluteError,
            evidenceType: row.evidenceType,
            observationIsQualified: row.observationIsQualified,
            observationCoverageHours: row.observationCoverageHours,
            forecastAvailableAt: row.forecastAvailableAt ?? null,
            observationWindowStartAt: row.observationWindowStartAt ?? null,
            observationWindowEndAt: row.observationWindowEndAt ?? null,
            stationEvidence: row.stationEvidence ?? null,
          },
        });
      }
    });
    return true;
  } catch (error) {
    if (!isDailyComparisonTableUnavailable(error)) throw error;
    warnDailyComparisonTableUnavailable();
    return false;
  }
}

/** Read-only latest projection used for scoring/history display; use the revision reader for captured versions. */
export async function getDailyPhysicalComparisonHistory(
  filters: DailyPhysicalComparisonHistoryFilters,
) {
  const db = await getDb();
  if (!db) return unavailableDailyPhysicalComparisonHistory("database_unavailable");

  const pageSize = normalizeDailyComparisonPageSize(filters.pageSize);
  const conditions = [
    eq(dailyForecastObservationComparisons.locationKey, filters.locationKey),
    eq(dailyForecastObservationComparisons.evidenceType, "physical_observation"),
    eq(dailyForecastObservationComparisons.observationIsQualified, 1),
    isNotNull(dailyForecastObservationComparisons.forecastAvailableAt),
    isNotNull(dailyForecastObservationComparisons.observationWindowStartAt),
    isNotNull(dailyForecastObservationComparisons.observationWindowEndAt),
    isNotNull(dailyForecastObservationComparisons.stationEvidence),
    lt(dailyForecastObservationComparisons.forecastAvailableAt, dailyForecastObservationComparisons.observationWindowStartAt),
  ];
  if (filters.validDateFrom) conditions.push(gte(dailyForecastObservationComparisons.validDate, filters.validDateFrom));
  if (filters.validDateTo) conditions.push(lte(dailyForecastObservationComparisons.validDate, filters.validDateTo));
  if (filters.serviceName) conditions.push(eq(dailyForecastObservationComparisons.serviceName, filters.serviceName));
  if (filters.variable) conditions.push(eq(dailyForecastObservationComparisons.variable, filters.variable));
  if (filters.horizonBucket) conditions.push(eq(dailyForecastObservationComparisons.horizonBucket, filters.horizonBucket));
  if (filters.cursor) {
    const cursorCondition = or(
      lt(dailyForecastObservationComparisons.validDate, filters.cursor.validDate),
      and(
        eq(dailyForecastObservationComparisons.validDate, filters.cursor.validDate),
        lt(dailyForecastObservationComparisons.id, filters.cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  try {
    const rows = await db.select().from(dailyForecastObservationComparisons)
      .where(and(...conditions))
      .orderBy(desc(dailyForecastObservationComparisons.validDate), desc(dailyForecastObservationComparisons.id))
      .limit(pageSize + 1);
    return buildDailyPhysicalComparisonHistoryPage(rows, { ...filters, pageSize });
  } catch (error) {
    if (!isDailyComparisonTableUnavailable(error)) throw error;
    warnDailyComparisonTableUnavailable();
    return unavailableDailyPhysicalComparisonHistory("table_unavailable");
  }
}

/** Read only explicitly captured revisions; legacy rows are intentionally not backfilled or inferred. */
export async function getDailyPhysicalComparisonRevisionHistory(
  filters: DailyPhysicalComparisonHistoryFilters,
) {
  const db = await getDb();
  if (!db) return unavailableDailyPhysicalComparisonHistory<DailyForecastObservationComparisonRevision>("database_unavailable");

  const pageSize = normalizeDailyComparisonPageSize(filters.pageSize);
  const conditions = [
    eq(dailyForecastObservationComparisonRevisions.locationKey, filters.locationKey),
    eq(dailyForecastObservationComparisonRevisions.evidenceType, "physical_observation"),
    eq(dailyForecastObservationComparisonRevisions.observationIsQualified, 1),
    isNotNull(dailyForecastObservationComparisonRevisions.forecastAvailableAt),
    isNotNull(dailyForecastObservationComparisonRevisions.observationWindowStartAt),
    isNotNull(dailyForecastObservationComparisonRevisions.observationWindowEndAt),
    isNotNull(dailyForecastObservationComparisonRevisions.stationEvidence),
    lt(dailyForecastObservationComparisonRevisions.forecastAvailableAt, dailyForecastObservationComparisonRevisions.observationWindowStartAt),
  ];
  if (filters.validDateFrom) conditions.push(gte(dailyForecastObservationComparisonRevisions.validDate, filters.validDateFrom));
  if (filters.validDateTo) conditions.push(lte(dailyForecastObservationComparisonRevisions.validDate, filters.validDateTo));
  if (filters.serviceName) conditions.push(eq(dailyForecastObservationComparisonRevisions.serviceName, filters.serviceName));
  if (filters.variable) conditions.push(eq(dailyForecastObservationComparisonRevisions.variable, filters.variable));
  if (filters.horizonBucket) conditions.push(eq(dailyForecastObservationComparisonRevisions.horizonBucket, filters.horizonBucket));
  if (filters.cursor) {
    const cursorCondition = or(
      lt(dailyForecastObservationComparisonRevisions.validDate, filters.cursor.validDate),
      and(
        eq(dailyForecastObservationComparisonRevisions.validDate, filters.cursor.validDate),
        lt(dailyForecastObservationComparisonRevisions.id, filters.cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  try {
    const rows = await db.select().from(dailyForecastObservationComparisonRevisions)
      .where(and(...conditions))
      .orderBy(desc(dailyForecastObservationComparisonRevisions.validDate), desc(dailyForecastObservationComparisonRevisions.id))
      .limit(pageSize + 1);
    return buildDailyPhysicalComparisonHistoryPage(rows, { ...filters, pageSize });
  } catch (error) {
    if (!isDailyComparisonTableUnavailable(error)) throw error;
    warnDailyComparisonTableUnavailable();
    return unavailableDailyPhysicalComparisonHistory<DailyForecastObservationComparisonRevision>("table_unavailable");
  }
}

/**
 * Exact location/horizon evidence from the unchanged current projection; the
 * append-only revision ledger is deliberately not aggregated into scores.
 */
export async function getDailyFusionPerformanceEvidence(
  locationKey: string,
  targetDate: string,
  availableAtByModel: readonly number[],
): Promise<{ available: boolean; evidence: ModelPerformanceEvidence[]; horizonBucket: DailyFusionHorizon | null; horizonBuckets: DailyFusionHorizon[] }> {
  const db = await getDb();
  if (!db) return { available: false, evidence: [], horizonBucket: null, horizonBuckets: [] };
  const horizonBuckets = Array.from(new Set(availableAtByModel.flatMap((availableAt) => {
    if (!Number.isFinite(availableAt)) return [];
    const horizon = getDailyForecastHorizon(availableAt, targetDate);
    return horizon ? [horizon.bucket] : [];
  })));
  if (horizonBuckets.length === 0) return { available: true, evidence: [], horizonBucket: null, horizonBuckets: [] };
  const from = new Date(`${targetDate}T12:00:00.000Z`);
  if (Number.isNaN(from.getTime())) return { available: false, evidence: [], horizonBucket: null, horizonBuckets };
  from.setUTCDate(from.getUTCDate() - 120);
  const fromDate = from.toISOString().slice(0, 10);
  try {
    const rows = await db.select().from(dailyForecastObservationComparisons).where(and(
      eq(dailyForecastObservationComparisons.locationKey, locationKey),
      gte(dailyForecastObservationComparisons.validDate, fromDate),
      lt(dailyForecastObservationComparisons.validDate, targetDate),
      inArray(dailyForecastObservationComparisons.horizonBucket, horizonBuckets),
      eq(dailyForecastObservationComparisons.evidenceType, "physical_observation"),
      eq(dailyForecastObservationComparisons.observationIsQualified, 1),
      isNotNull(dailyForecastObservationComparisons.forecastAvailableAt),
      isNotNull(dailyForecastObservationComparisons.observationWindowStartAt),
      isNotNull(dailyForecastObservationComparisons.observationWindowEndAt),
      lt(dailyForecastObservationComparisons.forecastAvailableAt, dailyForecastObservationComparisons.observationWindowStartAt),
    ));
    return {
      available: true,
      evidence: aggregateDailyForecastPerformance(rows),
      horizonBucket: horizonBuckets.length === 1 ? horizonBuckets[0]! : null,
      horizonBuckets,
    };
  } catch (error) {
    if (!isDailyComparisonTableUnavailable(error)) throw error;
    warnDailyComparisonTableUnavailable();
    return { available: false, evidence: [], horizonBucket: horizonBuckets.length === 1 ? horizonBuckets[0]! : null, horizonBuckets };
  }
}

/** Upsert the daily local synthesis for one reference location. */
export async function upsertGroundTruthSnapshot(data: InsertGroundTruth): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select({ id: groundTruth.id })
    .from(groundTruth)
    .where(and(
      eq(groundTruth.date, data.date),
      eq(groundTruth.refLat, data.refLat),
      eq(groundTruth.refLon, data.refLon),
    ))
    .limit(1);

  if (existing[0]) {
    await db.update(groundTruth).set({ ...data, computedAt: new Date() }).where(eq(groundTruth.id, existing[0].id));
    return;
  }
  await db.insert(groundTruth).values(data);
}

/**
 * Read physical station evidence collected for one reference location. Each
 * station keeps its own history so the UI can disclose freshness and compare
 * observations to the official forecast without inventing measurements.
 */
export async function getPhysicalStationHistory(
  refLat: number,
  refLon: number,
  sinceMs: number,
) {
  const db = await getDb();
  if (!db) return { stations: [], latestGroundTruth: null };
  const latBounds = referenceCoordinateBounds(refLat);
  const lonBounds = referenceCoordinateBounds(refLon);
  const groundTruthLatBounds = getGroundTruthReferenceBounds(refLat);
  const groundTruthLonBounds = getGroundTruthReferenceBounds(refLon);

  const stations = await db
    .select()
    .from(weatherStations)
    .where(and(
      gte(weatherStations.refLat, latBounds.min),
      lte(weatherStations.refLat, latBounds.max),
      gte(weatherStations.refLon, lonBounds.min),
      lte(weatherStations.refLon, lonBounds.max),
      eq(weatherStations.isActive, 1),
      // Les lignes de capteurs citoyens historisées restent en base mais ne
      // comptent plus : seules les stations collectées alimentent l'historique.
      inArray(weatherStations.source, ["meteofrance", "netatmo"]),
    ))
    .orderBy(desc(weatherStations.reliabilityScore));

  // Une seule lecture groupée remplace une requête par station : la latence
  // de l'API de données est payée une fois, pas une fois par station.
  // L'ordre par station est conservé (tri global sur observedAt, puis
  // regroupement séquentiel stable).
  const stationIds = stations.map((station) => station.stationId);
  const readingsByStationId = new Map<string, (typeof stationObservations.$inferSelect)[]>();
  if (stationIds.length > 0) {
    const observationRows = await db
      .select()
      .from(stationObservations)
      .where(and(
        inArray(stationObservations.stationId, stationIds),
        gte(stationObservations.observedAt, sinceMs),
      ))
      .orderBy(stationObservations.observedAt);
    for (const row of observationRows) {
      const readings = readingsByStationId.get(row.stationId);
      if (readings) readings.push(row);
      else readingsByStationId.set(row.stationId, [row]);
    }
  }
  const stationSeries = stations.map((station) => ({
    ...station,
    readings: readingsByStationId.get(station.stationId) ?? [],
  }));

  const latestGroundTruth = await db
    .select()
    .from(groundTruth)
    .where(and(
      gte(groundTruth.refLat, groundTruthLatBounds.min),
      lte(groundTruth.refLat, groundTruthLatBounds.max),
      gte(groundTruth.refLon, groundTruthLonBounds.min),
      lte(groundTruth.refLon, groundTruthLonBounds.max),
    ))
    .orderBy(desc(groundTruth.computedAt))
    .limit(1);

  return { stations: stationSeries, latestGroundTruth: latestGroundTruth[0] ?? null };
}

/** Persist one collection coverage result, including a zero-station discovery. */
export async function insertStationCollectionSnapshot(data: InsertStationCollectionSnapshot): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(stationCollectionSnapshots).values(data).onDuplicateKeyUpdate({
    set: { ...data, collectedAt: new Date() },
  });
}

/** Read latest availability/coverage attempts for a reference location. */
export async function getStationCollectionSnapshots(locationKey: string, limit = 14) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(stationCollectionSnapshots)
    .where(eq(stationCollectionSnapshots.locationKey, locationKey))
    .orderBy(desc(stationCollectionSnapshots.collectedAt))
    .limit(limit);
}
/** Read station-collection traces over the selected history period. */
export async function getStationCollectionSnapshotsByDateRange(locationKey: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(stationCollectionSnapshots).where(and(
    eq(stationCollectionSnapshots.locationKey, locationKey),
    gte(stationCollectionSnapshots.date, startDate),
    lte(stationCollectionSnapshots.date, endDate),
  )).orderBy(desc(stationCollectionSnapshots.date));
}

/** Persist one per-location hourly collection trace for future auditability. */
export async function upsertPhysicalSnapshotCollectionTrace(data: InsertPhysicalSnapshotCollectionTrace): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(physicalSnapshotCollectionTraces).values(data).onDuplicateKeyUpdate({
    set: { ...data, collectedAt: new Date() },
  });
}

/** Insère une trace seulement si ce créneau n’est pas déjà documenté. */
export async function insertPhysicalSnapshotCollectionTraceIfMissing(data: InsertPhysicalSnapshotCollectionTrace): Promise<boolean> {
  const db = await getDb();
  requireDatabaseForWrite(db, "archiver la trace de collecte physique");
  try {
    await db.insert(physicalSnapshotCollectionTraces).values(data);
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/** Read per-hour physical snapshot collection traces over the selected history period. */
export async function getPhysicalSnapshotCollectionTracesByDateRange(locationKey: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(physicalSnapshotCollectionTraces).where(and(
    eq(physicalSnapshotCollectionTraces.locationKey, locationKey),
    gte(physicalSnapshotCollectionTraces.date, startDate),
    lte(physicalSnapshotCollectionTraces.date, endDate),
  )).orderBy(desc(physicalSnapshotCollectionTraces.date), desc(physicalSnapshotCollectionTraces.hour));
}
// ─── Netatmo OAuth tokens ───────────────────────────────────────────────────

export async function upsertNetatmoOAuthToken(userId: number, encryptedRefreshToken: string, scopes = "read_station") {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for Netatmo OAuth connection");
  await db.insert(netatmoOAuthTokens).values({ userId, encryptedRefreshToken, scopes }).onDuplicateKeyUpdate({
    set: { encryptedRefreshToken, scopes, updatedAt: new Date() },
  });
}

export async function getNetatmoOAuthToken(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(netatmoOAuthTokens).where(eq(netatmoOAuthTokens.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function createNetatmoOAuthState(stateHash: string, userId: number, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for Netatmo OAuth state");
  await db.insert(netatmoOAuthStates).values({ stateHash, userId, expiresAt });
}

export async function hasActiveNetatmoOAuthState(stateHash: string, now = new Date()) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ stateHash: netatmoOAuthStates.stateHash })
    .from(netatmoOAuthStates)
    .where(and(
      eq(netatmoOAuthStates.stateHash, stateHash),
      gte(netatmoOAuthStates.expiresAt, now),
      isNull(netatmoOAuthStates.consumedAt),
    ))
    .limit(1);
  return Boolean(rows[0]);
}

/**
 * Consume an OAuth state by its unguessable signed-state hash.
 * The callback already verifies the signed user ID before this write; adding a
 * second user ID predicate here can reject a valid round trip if authentication
 * context changes between authorization and the provider callback.
 */
export async function consumeNetatmoOAuthState(stateHash: string, now = new Date()) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(netatmoOAuthStates)
    .set({ consumedAt: now })
    .where(and(
      eq(netatmoOAuthStates.stateHash, stateHash),
      gte(netatmoOAuthStates.expiresAt, now),
      isNull(netatmoOAuthStates.consumedAt),
    ));
  return (result as unknown as { affectedRows?: number }).affectedRows === 1;
}

// ─── Location Forecasts (pre-fetched per favorite) ───────────────────────────

/**
 * Upsert a pre-fetched forecast for a favorite location.
 * If a row for (favoriteLocationId, date) already exists, update it.
 */
export function buildLocationForecastUpdateData(data: InsertLocationForecast, updatedAt = new Date()) {
  const updateData: Partial<InsertLocationForecast> & { updatedAt: Date } = { ...data, updatedAt };
  delete updateData.tempCurrent;
  return updateData;
}

export async function upsertLocationForecast(data: InsertLocationForecast) {
  const db = await getDb();
  if (!db) return;
  const updateData = buildLocationForecastUpdateData(data);
  // Try update first
  const existing = await db
    .select({ id: locationForecasts.id })
    .from(locationForecasts)
    .where(
      and(
        eq(locationForecasts.favoriteLocationId, data.favoriteLocationId),
        eq(locationForecasts.date, data.date)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(locationForecasts)
      .set(updateData)
      .where(eq(locationForecasts.id, existing[0].id));
  } else {
    await db.insert(locationForecasts).values(data);
  }
}

/**
 * Get the latest pre-fetched forecast for a favorite location.
 */
export async function getLocationForecast(favoriteLocationId: number, date: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(locationForecasts)
    .where(
      and(
        eq(locationForecasts.favoriteLocationId, favoriteLocationId),
        eq(locationForecasts.date, date)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get all pre-fetched forecasts for a user's favorite locations (latest date).
 */
export async function getLocationForecastsForUser(userId: number, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(locationForecasts)
    .where(
      and(
        eq(locationForecasts.userId, userId),
        eq(locationForecasts.date, date)
      )
    );
}

// ─── HOURLY FORECASTS HELPERS ────────────────────────────────────────────────

type HourlyForecastCapture = {
  captureRunId: string;
  sourceName: string;
  modelId: string | null;
  requestStartedAt: number;
  availableAt: number;
  units?: Record<string, string | null | undefined>;
};

type InsertHourlyForecastWithCapture = InsertHourlyForecast & {
  validTime?: number;
  captureRun?: HourlyForecastCapture;
  archiveValues?: Record<string, unknown>;
};

/**
 * Insert a batch of hourly forecast rows for a location/date/model.
 * Preserves the current latest-series behavior while first appending verified
 * UTC-timed values to the immutable capture archive when run metadata is present.
 */
export async function insertHourlyForecasts(rows: InsertHourlyForecastWithCapture[], options: { refreshProjection?: boolean } = {}): Promise<{
  archiveRowsWritten: number;
  projectionRowsWritten: number;
}> {
  if (!rows.length) return { archiveRowsWritten: 0, projectionRowsWritten: 0 };
  const db = await getDb();
  if (!db) throw new HourlyForecastPersistenceError("database_unavailable", 0, 0);

  const captures = new Map<string, InsertHourlyForecastWithCapture[]>();
  for (const row of rows) {
    if (!row.captureRun || !Number.isFinite(row.validTime)) continue;
    const current = captures.get(row.captureRun.captureRunId) ?? [];
    captures.set(row.captureRun.captureRunId, [...current, row]);
  }
  return withHourlyForecastPersistenceStages(async (confirmCommittedRows) => {
    for (const [captureRunId, captureRows] of Array.from(captures.entries())) {
      const capture = captureRows[0].captureRun!;
      const runValues: InsertHourlyForecastRunValue[] = captureRows.flatMap((row) => {
        if (row.captureRun?.captureRunId !== captureRunId) return [];
        const values: Array<{ variable: string; value: number | null; unit: string | null }> = row.archiveValues
          ? buildHourlyArchiveValues({ values: row.archiveValues, units: capture.units })
          : [
              { variable: "temperature", value: row.temperature ?? null, unit: capture.units?.temperature ?? "°C" },
              { variable: "precipitation", value: row.precipitation ?? null, unit: capture.units?.precipitation ?? "mm" },
              { variable: "wind_speed", value: row.windSpeed ?? null, unit: capture.units?.windSpeed ?? "km/h" },
              { variable: "wind_gust", value: row.windGusts ?? null, unit: capture.units?.windGusts ?? "km/h" },
              { variable: "humidity", value: row.humidity ?? null, unit: capture.units?.humidity ?? "%" },
              { variable: "pressure", value: row.pressure ?? null, unit: capture.units?.pressure ?? "hPa" },
            ];
        return values.map(({ variable, value, unit }) => ({
          captureRunId,
          locationKey: row.locationKey,
          targetDate: row.date,
          sourceName: capture.sourceName,
          modelName: row.modelName,
          modelId: capture.modelId,
          requestStartedAt: capture.requestStartedAt,
          availableAt: capture.availableAt,
          validTime: row.validTime!,
          variable,
          value: value != null && Number.isFinite(value) ? value : null,
          unit,
        }));
      });
      if (runValues.length > 0) {
        await db.transaction(async (tx) => {
          for (let i = 0; i < runValues.length; i += 100) {
            await tx.insert(hourlyForecastRunValues).values(runValues.slice(i, i + 100));
          }
        });
        confirmCommittedRows(runValues.length);
      }
    }
  }, async (confirmCommittedRows) => {
    const { locationKey, date, modelName } = rows[0];
    await db.transaction(async (tx) => {
      await tx.delete(hourlyForecasts).where(and(
        eq(hourlyForecasts.locationKey, locationKey),
        eq(hourlyForecasts.date, date),
        eq(hourlyForecasts.modelName, modelName),
      ));
      for (let i = 0; i < rows.length; i += 50) {
        const activeRows = rows.slice(i, i + 50).map(({ validTime: _validTime, captureRun: _captureRun, archiveValues: _archiveValues, ...row }) => row);
        await tx.insert(hourlyForecasts).values(activeRows);
      }
    });
    confirmCommittedRows(rows.length);
  }, { skipProjection: options.refreshProjection === false });
}

/**
 * Get stored hourly forecasts for a location and date (all models).
 */
export async function getStoredHourlyForecasts(locationKey: string, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(hourlyForecasts)
    .where(
      and(
        eq(hourlyForecasts.locationKey, locationKey),
        eq(hourlyForecasts.date, date)
      )
    )
    .orderBy(hourlyForecasts.modelName, hourlyForecasts.hour);
}

/** Read immutable hourly forecast values for one location and Paris forecast day. */
export async function getHourlyForecastRunValues(locationKey: string, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hourlyForecastRunValues).where(and(
    eq(hourlyForecastRunValues.locationKey, locationKey),
    eq(hourlyForecastRunValues.targetDate, date),
  )).orderBy(hourlyForecastRunValues.modelName, hourlyForecastRunValues.validTime, hourlyForecastRunValues.variable, hourlyForecastRunValues.availableAt);
}

/** Read immutable run values over a bounded target-date window (single indexed scan). */
export async function getHourlyForecastRunValuesByDateRange(locationKey: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hourlyForecastRunValues).where(and(
    eq(hourlyForecastRunValues.locationKey, locationKey),
    gte(hourlyForecastRunValues.targetDate, startDate),
    lte(hourlyForecastRunValues.targetDate, endDate),
  )).orderBy(hourlyForecastRunValues.targetDate, hourlyForecastRunValues.modelName, hourlyForecastRunValues.validTime, hourlyForecastRunValues.variable, hourlyForecastRunValues.availableAt);
}

let hourlyComparisonDiagnosticsStorageWarningLogged = false;
function warnHourlyComparisonDiagnosticsStorage(error?: unknown) {
  if (hourlyComparisonDiagnosticsStorageWarningLogged) return;
  hourlyComparisonDiagnosticsStorageWarningLogged = true;
  console.warn("[HourlyComparisonDiagnostics] Snapshot storage is unavailable; verify additive migration 0057.", error ?? "");
}

/** Replace the one latest diagnostic snapshot for a location after its scheduled evaluation. */
export async function upsertHourlyComparisonDiagnosticSnapshot(input: {
  locationKey: string;
  cycleDate: string;
  diagnostics: HourlyComparisonDiagnostic[];
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const capturedAt = new Date();
  try {
    await db.insert(hourlyComparisonDiagnosticSnapshots).values({ ...input, capturedAt }).onDuplicateKeyUpdate({
      set: {
        cycleDate: input.cycleDate,
        diagnostics: input.diagnostics,
        capturedAt,
      },
    });
    return true;
  } catch (error) {
    warnHourlyComparisonDiagnosticsStorage(error);
    return false;
  }
}

/** Read the latest persisted diagnostic snapshot only; this function never evaluates forecasts. */
export async function getLatestHourlyComparisonDiagnosticSnapshot(locationKey: string) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [snapshot] = await db.select().from(hourlyComparisonDiagnosticSnapshots)
      .where(eq(hourlyComparisonDiagnosticSnapshots.locationKey, locationKey))
      .limit(1);
    return snapshot ?? null;
  } catch (error) {
    warnHourlyComparisonDiagnosticsStorage(error);
    return null;
  }
}

/** Limite physique de la colonne `errorCode` du journal horaire (varchar(32)). */
export const HOURLY_COLLECTION_ERROR_CODE_MAX_LENGTH = 32;

/**
 * Idempotently records one model result for a scheduled batch attempt.
 * `errorCode` est tronqué à la limite de la colonne : un code trop long ne doit
 * jamais faire échouer l'écriture du journal de collecte (ER_DATA_TOO_LONG).
 */
export async function upsertHourlyForecastCollectionResults(rows: InsertHourlyForecastCollectionResult[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while recording hourly collection evidence.");
  for (const row of rows) {
    const errorCode = row.errorCode ? row.errorCode.slice(0, HOURLY_COLLECTION_ERROR_CODE_MAX_LENGTH) : null;
    await db.insert(hourlyForecastCollectionResults).values({ ...row, errorCode }).onDuplicateKeyUpdate({
      set: {
        status: row.status,
        requestAttempts: row.requestAttempts,
        hoursReceived: row.hoursReceived,
        valuesReceived: row.valuesReceived,
        expectedValueCount: row.expectedValueCount,
        archiveRowsWritten: row.archiveRowsWritten,
        projectionRowsWritten: row.projectionRowsWritten,
        variableCoverage: row.variableCoverage ?? null,
        errorCode,
        completedAt: row.completedAt,
      },
    });
  }
}

/** Read all model outcomes from the latest scheduled batch attempt for one location. */
export async function getLatestHourlyForecastCollectionResults(locationKey: string) {
  try {
    const db = await getDb();
    if (!db) return { available: false, results: [] };
    const latest = await db.select({ batchAttemptId: hourlyForecastCollectionResults.batchAttemptId })
      .from(hourlyForecastCollectionResults)
      .where(eq(hourlyForecastCollectionResults.locationKey, locationKey))
      .orderBy(desc(hourlyForecastCollectionResults.attemptedAt), desc(hourlyForecastCollectionResults.id))
      .limit(1);
    if (!latest[0]) return { available: true, results: [] };
    const results = await db.select().from(hourlyForecastCollectionResults).where(and(
      eq(hourlyForecastCollectionResults.locationKey, locationKey),
      eq(hourlyForecastCollectionResults.batchAttemptId, latest[0].batchAttemptId),
    )).orderBy(hourlyForecastCollectionResults.modelName);
    return { available: true, results };
  } catch {
    console.warn("[HourlyAudit] Detailed collection report is unavailable; verify database migration status.");
    return { available: false, results: [] };
  }
}

let providerRunSchemaWarningLogged = false;
function warnProviderRunSchema(error?: unknown) {
  if (!providerRunSchemaWarningLogged) {
    console.warn("[ProviderRunHorizon] Additive provider-run migration is unavailable; existing forecast and bucket-score flows remain unchanged.", error ?? "");
    providerRunSchemaWarningLogged = true;
  }
}

/** Append a request manifest and its Single Runs values atomically; never updates an existing capture. */
export async function persistHourlyProviderRunCaptureBatch(
  captures: InsertHourlyForecastProviderRunCapture[],
  values: InsertHourlyForecastProviderRunValue[],
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.transaction(async (tx) => {
      if (captures.length > 0) await tx.insert(hourlyForecastProviderRunCaptures).values(captures);
      for (let offset = 0; offset < values.length; offset += 100) {
        const batch = values.slice(offset, offset + 100);
        await tx.insert(hourlyForecastProviderRunValues).values(batch);
      }
    });
    return true;
  } catch (error) {
    warnProviderRunSchema(error);
    return false;
  }
}

/** Latest append-only attempt per model for the AI Lab's separate Single Runs evidence panel. */
export async function getLatestHourlyProviderRunCaptures(locationKey: string) {
  try {
    const db = await getDb();
    if (!db) return { available: false, results: [] };
    const rows = await db.select({
      id: hourlyForecastProviderRunCaptures.id,
      modelName: hourlyForecastProviderRunCaptures.modelName,
      modelId: hourlyForecastProviderRunCaptures.modelId,
      status: hourlyForecastProviderRunCaptures.status,
      reasonCode: hourlyForecastProviderRunCaptures.reasonCode,
      leadBasis: hourlyForecastProviderRunCaptures.leadBasis,
      metadataHttpStatus: hourlyForecastProviderRunCaptures.metadataHttpStatus,
      metadataAvailableAt: hourlyForecastProviderRunCaptures.metadataAvailableAt,
      providerRunAt: hourlyForecastProviderRunCaptures.providerRunAt,
      requestStartedAt: hourlyForecastProviderRunCaptures.requestStartedAt,
      availableAt: hourlyForecastProviderRunCaptures.availableAt,
      responseStatus: hourlyForecastProviderRunCaptures.responseStatus,
      collectionLatencyMilliseconds: hourlyForecastProviderRunCaptures.collectionLatencyMilliseconds,
      valuesStored: hourlyForecastProviderRunCaptures.valuesStored,
      minimumForecastLeadMilliseconds: hourlyForecastProviderRunCaptures.minimumForecastLeadMilliseconds,
      maximumForecastLeadMilliseconds: hourlyForecastProviderRunCaptures.maximumForecastLeadMilliseconds,
      capturedAt: hourlyForecastProviderRunCaptures.capturedAt,
    }).from(hourlyForecastProviderRunCaptures)
      .where(eq(hourlyForecastProviderRunCaptures.locationKey, locationKey))
      .orderBy(desc(hourlyForecastProviderRunCaptures.id))
      .limit(21);
    const latestByModel = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latestByModel.has(row.modelName)) latestByModel.set(row.modelName, row);
    return { available: true, results: Array.from(latestByModel.values()).sort((left, right) => left.modelName.localeCompare(right.modelName)) };
  } catch (error) {
    warnProviderRunSchema(error);
    return { available: false, results: [] };
  }
}

/** Read immutable values for one Paris observation date, retaining exact run and receipt timestamps. */
export async function getHourlyProviderRunValues(locationKey: string, targetDate: string) {
  try {
    const db = await getDb();
    if (!db) return { available: false, values: [] };
    const values = await db.select().from(hourlyForecastProviderRunValues).where(and(
      eq(hourlyForecastProviderRunValues.locationKey, locationKey),
      eq(hourlyForecastProviderRunValues.targetDate, targetDate),
    ));
    return { available: true, values };
  } catch (error) {
    warnProviderRunSchema(error);
    return { available: false, values: [] };
  }
}

/** Store immutable provider-run comparisons and refresh only their deterministic aggregate rows. */
export async function persistHourlyProviderRunEvaluation(input: {
  comparisons: InsertHourlyForecastProviderRunComparison[];
  scores: InsertHourlyForecastProviderRunScore[];
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.transaction(async (tx) => {
      const comparisons = input.comparisons.filter((row) => Number.isSafeInteger(row.forecastRunValueId) && row.forecastRunValueId > 0
        && Number.isSafeInteger(row.observationSnapshotId) && row.observationSnapshotId > 0);
      for (let offset = 0; offset < comparisons.length; offset += 100) {
        const batch = comparisons.slice(offset, offset + 100);
        await tx.insert(hourlyForecastProviderRunComparisons).values(batch).onDuplicateKeyUpdate({
          set: { forecastRunValueId: sql`${hourlyForecastProviderRunComparisons.forecastRunValueId}` },
        });
      }
      for (const row of input.scores) {
        await tx.insert(hourlyForecastProviderRunScores).values(row).onDuplicateKeyUpdate({
          set: {
            observationCount: row.observationCount,
            evaluableObservationCount: row.evaluableObservationCount,
            sampleSize: row.sampleSize,
            coverageRatio: row.coverageRatio,
            mae: row.mae,
            rmse: row.rmse,
            bias: row.bias,
            computedAt: new Date(),
          },
        });
      }
    });
    return true;
  } catch (error) {
    warnProviderRunSchema(error);
    return false;
  }
}

/** Insert or deterministically refresh detailed scores for one observation day. */
export async function persistHourlyForecastEvaluationScores(rows: InsertHourlyForecastEvaluationScore[]): Promise<void> {
  const db = await getDb();
  const completeRows = rows.filter((row) =>
    typeof row.sampleSize === "number" && row.sampleSize > 0
    && row.mae != null && Number.isFinite(row.mae)
    && row.rmse != null && Number.isFinite(row.rmse)
    && row.bias != null && Number.isFinite(row.bias));
  const validatedRows = completeRows.filter((row) => row.scoringValidationVersion === HOURLY_SCORING_VALIDATION_VERSION);
  const unvalidatedRows = completeRows.filter((row) => row.scoringValidationVersion !== HOURLY_SCORING_VALIDATION_VERSION);
  if (!db || completeRows.length === 0) return;
  try {
    for (const row of validatedRows) {
      await db.insert(hourlyForecastEvaluationScores).values(row).onDuplicateKeyUpdate({
        set: {
          modelId: row.modelId,
          observationCount: row.observationCount,
          evaluableObservationCount: row.evaluableObservationCount,
          sampleSize: row.sampleSize,
          coverageRatio: row.coverageRatio,
          mae: row.mae,
          rmse: row.rmse,
          bias: row.bias,
          scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION,
          computedAt: new Date(),
        },
      });
    }
    // Les lignes complètes non validées sont archivées avec une version de
    // validation NULL : elles restent consultables comme données brutes
    // dans le labo, sans jamais remplacer une ligne validée (la mise à
    // jour de conflit est sans effet sur les valeurs existantes).
    for (const row of unvalidatedRows) {
      await db.insert(hourlyForecastEvaluationScores).values(row).onDuplicateKeyUpdate({
        set: { modelId: row.modelId },
      });
    }
  } catch (error) {
    if (isMissingHourlyScoringValidationVersionColumn(error)) {
      console.warn("[HourlyScoringValidation] Migration 0055 is not applied; no unversioned bucket scores were written.");
      return;
    }
    throw error;
  }
}

export type HourlyExactHorizonHistoryKey = {
  modelName: string;
  modelId: string;
  variable: string;
  horizonMilliseconds: number;
};

function isMissingHourlyScoringValidationVersionColumn(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown };
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  const missingColumnError = candidate?.code === "ER_BAD_FIELD_ERROR" || candidate?.errno === 1054
    || /unknown column|doesn't exist|does not exist/i.test(message);
  return /scoringValidationVersion/i.test(message) && missingColumnError;
}

let exactHorizonSchemaWarningLogged = false;
function warnExactHorizonPersistence(error: unknown) {
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown };
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  const missingTable = candidate?.code === "ER_NO_SUCH_TABLE" || candidate?.errno === 1146
    || (/hourly_forecast_exact_(comparisons|evaluation_scores)/i.test(message) && /(doesn't exist|does not exist|unknown table|no such table)/i.test(message));
  const missingVersionColumn = isMissingHourlyScoringValidationVersionColumn(error);
  if (missingVersionColumn) {
    console.warn("[HourlyScoringValidation] Migration 0055 is not applied; no unversioned exact scores were written.");
    return;
  }
  if (missingTable) {
    if (!exactHorizonSchemaWarningLogged) {
      console.warn("[HourlyExactCalibration] Additive exact-horizon migration is not applied; bucket calibration remains active.");
      exactHorizonSchemaWarningLogged = true;
    }
    return;
  }
  console.warn("[HourlyExactCalibration] Exact-horizon persistence/read failed; bucket calibration remains active.", error);
}

/** Store comparison evidence once; conflicts leave the original run/station snapshot unchanged. */
export async function persistHourlyForecastExactComparisons(rows: InsertHourlyForecastExactComparison[]): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const eligible = rows.filter((row) => Number.isSafeInteger(row.forecastRunValueId) && row.forecastRunValueId > 0
    && Number.isSafeInteger(row.observationSnapshotId) && row.observationSnapshotId > 0);
  if (eligible.length === 0) return true;
  try {
    for (let offset = 0; offset < eligible.length; offset += 100) {
      const batch = eligible.slice(offset, offset + 100);
      await db.insert(hourlyForecastExactComparisons).values(batch).onDuplicateKeyUpdate({
        set: { forecastRunValueId: sql`${hourlyForecastExactComparisons.forecastRunValueId}` },
      });
    }
    return true;
  } catch (error) {
    warnExactHorizonPersistence(error);
    return false;
  }
}

/** Upsert daily exact-lead metrics; this table never replaces bucket score rows. */
export async function persistHourlyForecastExactEvaluationScores(rows: InsertHourlyForecastExactEvaluationScore[]): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const validatedRows = rows.filter((row) => row.scoringValidationVersion === HOURLY_SCORING_VALIDATION_VERSION
    && typeof row.sampleSize === "number" && row.sampleSize > 0
    && row.mae != null && Number.isFinite(row.mae)
    && row.rmse != null && Number.isFinite(row.rmse)
    && row.bias != null && Number.isFinite(row.bias));
  if (validatedRows.length === 0) return true;
  try {
    for (const row of validatedRows) {
      await db.insert(hourlyForecastExactEvaluationScores).values(row).onDuplicateKeyUpdate({
        set: {
          modelId: row.modelId,
          horizonMinutes: row.horizonMinutes,
          horizonBucket: row.horizonBucket,
          observationCount: row.observationCount,
          evaluableObservationCount: row.evaluableObservationCount,
          sampleSize: row.sampleSize,
          coverageRatio: row.coverageRatio,
          mae: row.mae,
          rmse: row.rmse,
          bias: row.bias,
          scoringValidationVersion: HOURLY_SCORING_VALIDATION_VERSION,
          computedAt: new Date(),
        },
      });
    }
    return true;
  } catch (error) {
    warnExactHorizonPersistence(error);
    return false;
  }
}

/** Retrieve model/variable/horizon scores for a location and observation date. */
export async function getHourlyForecastEvaluationScores(locationKey: string, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(hourlyForecastEvaluationScores).where(and(
    eq(hourlyForecastEvaluationScores.locationKey, locationKey),
    eq(hourlyForecastEvaluationScores.date, date),
  )).orderBy(hourlyForecastEvaluationScores.sourceName, hourlyForecastEvaluationScores.modelName, hourlyForecastEvaluationScores.variable, hourlyForecastEvaluationScores.horizonBucket);
}

/** Read bucket history once and exact history in one tuple-batched query for a bounded lead list. */
export async function getHourlyForecastEvaluationHistory(
  locationKey: string,
  fromDate: string,
  throughDate: string,
  exactHorizonKeys: readonly HourlyExactHorizonHistoryKey[] = [],
  options: { includeLegacy?: boolean } = {},
) {
  const db = await getDb();
  if (!db) return { available: false as const, rows: [], legacyRows: [], exactAvailable: false, exactRows: [] };
  try {
    const bucketProjection = {
      date: hourlyForecastEvaluationScores.date,
      sourceName: hourlyForecastEvaluationScores.sourceName,
      modelName: hourlyForecastEvaluationScores.modelName,
      modelId: hourlyForecastEvaluationScores.modelId,
      variable: hourlyForecastEvaluationScores.variable,
      horizonBucket: hourlyForecastEvaluationScores.horizonBucket,
      sampleSize: hourlyForecastEvaluationScores.sampleSize,
      mae: hourlyForecastEvaluationScores.mae,
      rmse: hourlyForecastEvaluationScores.rmse,
      bias: hourlyForecastEvaluationScores.bias,
      computedAt: hourlyForecastEvaluationScores.computedAt,
      scoringValidationVersion: hourlyForecastEvaluationScores.scoringValidationVersion,
    };
    const baseBucketPredicates = [
      eq(hourlyForecastEvaluationScores.locationKey, locationKey),
      gte(hourlyForecastEvaluationScores.date, fromDate),
      lte(hourlyForecastEvaluationScores.date, throughDate),
    ];
    const rows = await db.select(bucketProjection).from(hourlyForecastEvaluationScores).where(and(
      ...baseBucketPredicates,
      eq(hourlyForecastEvaluationScores.scoringValidationVersion, HOURLY_SCORING_VALIDATION_VERSION),
    )).orderBy(hourlyForecastEvaluationScores.date, hourlyForecastEvaluationScores.modelName);
    const legacyRows = options.includeLegacy
      ? await db.select(bucketProjection).from(hourlyForecastEvaluationScores).where(and(
          ...baseBucketPredicates,
          isNull(hourlyForecastEvaluationScores.scoringValidationVersion),
        )).orderBy(hourlyForecastEvaluationScores.date, hourlyForecastEvaluationScores.modelName)
      : [];

    type ExactHistoryRow = Pick<typeof hourlyForecastExactEvaluationScores.$inferSelect,
      "date" | "sourceName" | "modelName" | "modelId" | "variable" | "horizonBucket"
      | "horizonMilliseconds" | "sampleSize" | "mae" | "rmse" | "bias" | "computedAt" | "scoringValidationVersion"
    >;
    let exactRows: ExactHistoryRow[] = [];
    let exactAvailable = false;
    const byModelVariable = new Map<string, { modelName: string; modelId: string; variable: string; horizons: Set<number> }>();
    for (const key of exactHorizonKeys) {
      if (!key.modelName || !key.modelId || !key.variable || !Number.isSafeInteger(key.horizonMilliseconds) || key.horizonMilliseconds <= 0) continue;
      const groupKey = `${key.modelName}|${key.modelId}|${key.variable}`;
      const group = byModelVariable.get(groupKey) ?? {
        modelName: key.modelName,
        modelId: key.modelId,
        variable: key.variable,
        horizons: new Set<number>(),
      };
      group.horizons.add(key.horizonMilliseconds);
      byModelVariable.set(groupKey, group);
    }
    if (byModelVariable.size > 0) {
      try {
        const exactPredicates = Array.from(byModelVariable.values()).map((group) => and(
          eq(hourlyForecastExactEvaluationScores.modelName, group.modelName),
          eq(hourlyForecastExactEvaluationScores.modelId, group.modelId),
          eq(hourlyForecastExactEvaluationScores.variable, group.variable),
          inArray(hourlyForecastExactEvaluationScores.horizonMilliseconds, Array.from(group.horizons)),
        ));
        exactRows = await db.select({
          date: hourlyForecastExactEvaluationScores.date,
          sourceName: hourlyForecastExactEvaluationScores.sourceName,
          modelName: hourlyForecastExactEvaluationScores.modelName,
          modelId: hourlyForecastExactEvaluationScores.modelId,
          variable: hourlyForecastExactEvaluationScores.variable,
          horizonBucket: hourlyForecastExactEvaluationScores.horizonBucket,
          horizonMilliseconds: hourlyForecastExactEvaluationScores.horizonMilliseconds,
          sampleSize: hourlyForecastExactEvaluationScores.sampleSize,
          mae: hourlyForecastExactEvaluationScores.mae,
          rmse: hourlyForecastExactEvaluationScores.rmse,
          bias: hourlyForecastExactEvaluationScores.bias,
          computedAt: hourlyForecastExactEvaluationScores.computedAt,
          scoringValidationVersion: hourlyForecastExactEvaluationScores.scoringValidationVersion,
        }).from(hourlyForecastExactEvaluationScores).where(and(
          eq(hourlyForecastExactEvaluationScores.locationKey, locationKey),
          eq(hourlyForecastExactEvaluationScores.sourceName, "open-meteo"),
          gte(hourlyForecastExactEvaluationScores.date, fromDate),
          lte(hourlyForecastExactEvaluationScores.date, throughDate),
          eq(hourlyForecastExactEvaluationScores.scoringValidationVersion, HOURLY_SCORING_VALIDATION_VERSION),
          or(...exactPredicates),
        )).orderBy(hourlyForecastExactEvaluationScores.date, hourlyForecastExactEvaluationScores.modelName, hourlyForecastExactEvaluationScores.variable, hourlyForecastExactEvaluationScores.horizonMilliseconds);
        exactAvailable = true;
      } catch (error) {
        warnExactHorizonPersistence(error);
      }
    }
    return { available: true as const, rows, legacyRows, exactAvailable, exactRows };
  } catch (error) {
    console.warn("[Database] Unable to read hourly forecast evaluation history:", error);
    return { available: false as const, rows: [], legacyRows: [], exactAvailable: false, exactRows: [] };
  }
}

// ─── OBSERVATIONS PERSONNELLES ET CALIBRATION ──────────────────────────────

export async function insertPersonalWeatherObservation(data: InsertPersonalWeatherObservation): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(personalWeatherObservations).values(data);
  return Number((result as any)[0]?.insertId ?? 0) || null;
}

export async function insertPersonalModelObservationScores(rows: InsertPersonalModelObservationScore[]): Promise<void> {
  const db = await getDb();
  if (!db || rows.length === 0) return;
  await db.insert(personalModelObservationScores).values(rows);
}

export async function upsertPersonalModelCalibration(data: InsertPersonalModelCalibration): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(personalModelCalibrations).values(data).onDuplicateKeyUpdate({
    set: {
      comparisonCount: data.comparisonCount,
      scoreEma: data.scoreEma,
      temperatureMaeEma: data.temperatureMaeEma,
      conditionScoreEma: data.conditionScoreEma,
      precipitationScoreEma: data.precipitationScoreEma,
      windScoreEma: data.windScoreEma,
      weightMultiplier: data.weightMultiplier,
      evidenceState: data.evidenceState,
      lastObservationAt: data.lastObservationAt,
    },
  });
}

export async function getPersonalModelCalibrations(userId: number, locationKey: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(personalModelCalibrations)
    .where(and(eq(personalModelCalibrations.userId, userId), eq(personalModelCalibrations.locationKey, locationKey)))
    .orderBy(desc(personalModelCalibrations.scoreEma), personalModelCalibrations.modelName);
}

export async function getRecentPersonalWeatherObservations(userId: number, locationKey: string, limit = 5) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(personalWeatherObservations)
    .where(and(eq(personalWeatherObservations.userId, userId), eq(personalWeatherObservations.locationKey, locationKey)))
    .orderBy(desc(personalWeatherObservations.observedAt))
    .limit(limit);
}

export async function getAllPersonalWeatherObservations(userId: number, locationKey: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(personalWeatherObservations)
    .where(and(eq(personalWeatherObservations.userId, userId), eq(personalWeatherObservations.locationKey, locationKey)))
    .orderBy(personalWeatherObservations.observedAt);
}

export async function getPersonalWeatherObservationById(userId: number, id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(personalWeatherObservations)
    .where(and(eq(personalWeatherObservations.userId, userId), eq(personalWeatherObservations.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updatePersonalWeatherObservation(userId: number, id: number, data: Pick<InsertPersonalWeatherObservation, "temperature" | "condition" | "windSpeed" | "precipitation">) {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(personalWeatherObservations)
    .set(data)
    .where(and(eq(personalWeatherObservations.userId, userId), eq(personalWeatherObservations.id, id)));
  return Number((result as any)[0]?.affectedRows ?? 0) > 0;
}

export async function deletePersonalWeatherObservation(userId: number, id: number) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(personalModelObservationScores).where(eq(personalModelObservationScores.observationId, id));
  const result = await db
    .delete(personalWeatherObservations)
    .where(and(eq(personalWeatherObservations.userId, userId), eq(personalWeatherObservations.id, id)));
  return Number((result as any)[0]?.affectedRows ?? 0) > 0;
}

export async function getPersonalModelObservationScores(observationIds: number[]) {
  const db = await getDb();
  if (!db || observationIds.length === 0) return [];
  return db.select().from(personalModelObservationScores).where(inArray(personalModelObservationScores.observationId, observationIds));
}

export async function replacePersonalModelObservationScores(observationIds: number[], rows: InsertPersonalModelObservationScore[]) {
  const db = await getDb();
  if (!db || observationIds.length === 0) return;
  await db.delete(personalModelObservationScores).where(inArray(personalModelObservationScores.observationId, observationIds));
  if (rows.length > 0) await db.insert(personalModelObservationScores).values(rows);
}

export async function clearPersonalModelCalibrations(userId: number, locationKey: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(personalModelCalibrations).where(and(eq(personalModelCalibrations.userId, userId), eq(personalModelCalibrations.locationKey, locationKey)));
}

// ─── LEAD TIME SCORES HELPERS ────────────────────────────────────────────────

/**
 * Insert a batch of lead-time score rows.
 * Replaces existing rows for the same locationKey+date+serviceName combination.
 */
export async function insertLeadTimeScores(rows: InsertLeadTimeScore[]): Promise<void> {
  if (!rows.length) return;
  const db = await getDb();
  if (!db) return;
  // Delete existing rows for this locationKey + date + serviceName
  const locKey = rows[0].locationKey ?? "default";
  const dt = rows[0].date;
  const svc = rows[0].serviceName;
  await db
    .delete(leadTimeScores)
    .where(
      and(
        eq(leadTimeScores.locationKey, locKey),
        eq(leadTimeScores.date, dt),
        eq(leadTimeScores.serviceName, svc)
      )
    );
  await db.insert(leadTimeScores).values(rows);
}

/**
 * Get lead-time scores for a location over the last N days.
 * Returns per-service, per-bucket averages.
 */
export async function getLeadTimeScoresForLocation(locationKey: string, days = 14) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      serviceName: leadTimeScores.serviceName,
      bucket: leadTimeScores.bucket,
      avgMaeTemp: sql<number>`AVG(${leadTimeScores.maeTemp})`.as("avgMaeTemp"),
      avgRmseTemp: sql<number>`AVG(${leadTimeScores.rmseTemp})`.as("avgRmseTemp"),
      avgBiasTemp: sql<number>`AVG(${leadTimeScores.biasTemp})`.as("avgBiasTemp"),
      avgMaePrecip: sql<number>`AVG(${leadTimeScores.maePrecip})`.as("avgMaePrecip"),
      avgRmsePrecip: sql<number>`SQRT(AVG(POWER(${leadTimeScores.rmsePrecip}, 2)))`.as("avgRmsePrecip"),
      avgMaeWind: sql<number>`AVG(${leadTimeScores.maeWind})`.as("avgMaeWind"),
      avgRmseWind: sql<number>`SQRT(AVG(POWER(${leadTimeScores.rmseWind}, 2)))`.as("avgRmseWind"),
      totalSamples: sql<number>`SUM(${leadTimeScores.sampleSize})`.as("totalSamples"),
      latestScoreDate: sql<string>`MAX(${leadTimeScores.date})`.as("latestScoreDate"),
    })
    .from(leadTimeScores)
    .where(
      and(
        eq(leadTimeScores.locationKey, locationKey),
        sql`${leadTimeScores.date} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`
      )
    )
    .groupBy(sql`${leadTimeScores.serviceName}`, sql`${leadTimeScores.bucket}`)
    .orderBy(sql`${leadTimeScores.serviceName}`, sql`${leadTimeScores.bucket}`);
}

export async function getQualifiedLeadTimeScoresForLocation(locationKey: string, days = 14) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      serviceName: leadTimeScores.serviceName,
      bucket: leadTimeScores.bucket,
      avgMaeTemp: sql<number>`AVG(${leadTimeScores.maeTemp})`.as("avgMaeTemp"),
      avgMaePrecip: sql<number>`AVG(${leadTimeScores.maePrecip})`.as("avgMaePrecip"),
      avgMaeWind: sql<number>`AVG(${leadTimeScores.maeWind})`.as("avgMaeWind"),
      totalSamples: sql<number>`SUM(${leadTimeScores.sampleSize})`.as("totalSamples"),
      latestScoreDate: sql<string>`MAX(${leadTimeScores.date})`.as("latestScoreDate"),
    })
    .from(leadTimeScores)
    .where(and(
      eq(leadTimeScores.locationKey, locationKey),
      eq(leadTimeScores.evidenceType, "physical_observation"),
      sql`${leadTimeScores.date} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`,
    ))
    .groupBy(sql`${leadTimeScores.serviceName}`, sql`${leadTimeScores.bucket}`)
    .orderBy(sql`${leadTimeScores.serviceName}`, sql`${leadTimeScores.bucket}`);
}

// ─── Reliability laboratory read models ──────────────────────────────────────

/**
 * Aggregate only score rows based on explicitly qualified physical observations.
 * Legacy and model-reference rows are intentionally excluded from the laboratory.
 */
export async function getLaboratoryModelAggregates(locationKey: string, startDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      serviceName: reliabilityScores.serviceName,
      evaluatedDays: sql<number>`COUNT(DISTINCT ${reliabilityScores.date})`.as("evaluatedDays"),
      scoreRows: sql<number>`COUNT(*)`.as("scoreRows"),
      comparisons: sql<number>`SUM(COALESCE(${reliabilityScores.sampleSize}, 0))`.as("comparisons"),
      latestScoreDate: sql<string>`MAX(${reliabilityScores.date})`.as("latestScoreDate"),
      averageNormalizedScore: sql<number>`AVG(${reliabilityScores.normalizedScore})`.as("averageNormalizedScore"),
      averageOperationalScore: sql<number>`AVG(${reliabilityScores.weightedScore})`.as("averageOperationalScore"),
      averageMaeTemp: sql<number>`AVG(${reliabilityScores.maeTemp})`.as("averageMaeTemp"),
      averageRmseTemp: sql<number>`AVG(${reliabilityScores.rmseTemp})`.as("averageRmseTemp"),
      averageBiasTemp: sql<number>`AVG(${reliabilityScores.biasTemp})`.as("averageBiasTemp"),
      averagePrecipScore: sql<number>`AVG(${reliabilityScores.precipScore})`.as("averagePrecipScore"),
      averagePrecipPod: sql<number>`AVG(${reliabilityScores.precipPod})`.as("averagePrecipPod"),
      averagePrecipFar: sql<number>`AVG(${reliabilityScores.precipFar})`.as("averagePrecipFar"),
      falsePositives: sql<number>`SUM(COALESCE(${reliabilityScores.precipFalsePositives}, 0))`.as("falsePositives"),
      falseNegatives: sql<number>`SUM(COALESCE(${reliabilityScores.precipFalseNegatives}, 0))`.as("falseNegatives"),
      averageMaeWind: sql<number>`AVG(${reliabilityScores.maeWind})`.as("averageMaeWind"),
      averageMaeGusts: sql<number>`AVG(${reliabilityScores.windMaeGusts})`.as("averageMaeGusts"),
      averageHumidityScore: sql<number>`AVG(${reliabilityScores.humidityScore})`.as("averageHumidityScore"),
      averageHumidityMae: sql<number>`AVG(${reliabilityScores.humidityMae})`.as("averageHumidityMae"),
      averagePressureScore: sql<number>`AVG(${reliabilityScores.pressureScore})`.as("averagePressureScore"),
    })
    .from(reliabilityScores)
    .where(and(
      eq(reliabilityScores.locationKey, locationKey),
      eq(reliabilityScores.evidenceType, "physical_observation"),
      gte(reliabilityScores.date, startDate),
    ))
    .groupBy(reliabilityScores.serviceName)
    .orderBy(sql`AVG(${reliabilityScores.normalizedScore}) DESC`);
}

/** Daily qualified score points for the evolution chart, without legacy evidence. */
export async function getLaboratoryScoreTimeline(locationKey: string, startDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      date: reliabilityScores.date,
      serviceName: reliabilityScores.serviceName,
      comparisons: reliabilityScores.sampleSize,
      normalizedScore: reliabilityScores.normalizedScore,
      operationalScore: reliabilityScores.weightedScore,
      maeTemp: reliabilityScores.maeTemp,
      rmseTemp: reliabilityScores.rmseTemp,
      maeWind: reliabilityScores.maeWind,
      humidityScore: reliabilityScores.humidityScore,
      humidityMae: reliabilityScores.humidityMae,
    })
    .from(reliabilityScores)
    .where(and(
      eq(reliabilityScores.locationKey, locationKey),
      eq(reliabilityScores.evidenceType, "physical_observation"),
      gte(reliabilityScores.date, startDate),
    ))
    .orderBy(reliabilityScores.date, reliabilityScores.serviceName);
}

/** Immutable emissions are the factual archive used to disclose model coverage. */
export async function getLaboratoryModelArchive(locationKey: string, startDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      serviceName: forecastRuns.serviceName,
      provider: forecastRuns.provider,
      modelId: forecastRuns.modelId,
      archivedRuns: sql<number>`COUNT(*)`.as("archivedRuns"),
      firstValidDate: sql<string>`MIN(${forecastRuns.validDate})`.as("firstValidDate"),
      latestValidDate: sql<string>`MAX(${forecastRuns.validDate})`.as("latestValidDate"),
    })
    .from(forecastRuns)
    .where(and(
      eq(forecastRuns.locationKey, locationKey),
      eq(forecastRuns.sourceKind, "model_forecast"),
      gte(forecastRuns.validDate, startDate),
    ))
    .groupBy(forecastRuns.serviceName, forecastRuns.provider, forecastRuns.modelId)
    .orderBy(forecastRuns.serviceName);
}
