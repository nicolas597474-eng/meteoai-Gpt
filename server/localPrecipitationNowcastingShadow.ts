import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  qualifiedObservationSnapshots,
  shadowLocalPrecipitationForecastEmissions,
  shadowLocalPrecipitationForecastOutcomes,
  shadowLocalPrecipitationNowcasts,
  stationObservations,
} from "../drizzle/schema";
import {
  LOCAL_PRECIPITATION_NOWCASTING_SHADOW_VERSION,
  calculateLocalPrecipitationNowcast,
} from "../shared/localPrecipitationNowcastingShadow";
import {
  buildLocalPrecipitationVerificationReport,
  canTransitionLocalPrecipitationOutcome,
  evaluateLocalPrecipitationNowcastOutcome,
  makeLocalPrecipitationEmissionNaturalKey,
  type LocalPrecipitationEmissionEvidence,
  type LocalPrecipitationFutureSnapshotEvidence,
  type LocalPrecipitationOutcomeEvidence,
  type LocalPrecipitationSourceObservation,
} from "../shared/localPrecipitationNowcastVerification";
import { getDb, getHourlyForecastRunValues } from "./db";
import { reconstructOfficialHourlyModelsFromArchive } from "./officialHourlyForecast";
import { getParisDateAndHour, parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";

const NOWCAST_HORIZONS = [0, 1, 2] as const;
const SCORE_HORIZONS_MINUTES = [60, 120] as const;
const HOUR_MS = 60 * 60 * 1_000;

function timestampOf(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parisDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(timestamp));
}

function median(values: readonly number[]): number | null {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (ordered.length === 0) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function isDuplicateKey(error: unknown): boolean {
  const candidate = error as { code?: string; errno?: number } | null;
  return candidate?.code === "ER_DUP_ENTRY" || candidate?.errno === 1062;
}

function parseStationIds(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return Array.from(new Set(parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const stationId = (entry as Record<string, unknown>).stationId;
    return typeof stationId === "string" && stationId.length > 0 ? [stationId] : [];
  })));
}

function asBoolean(value: number | boolean | null | undefined): boolean | null {
  if (value == null) return null;
  return Number(value) === 1;
}

type ModelProvenance = {
  modelName: string;
  modelId: string;
  sourceName: string;
  captureRunId: string;
  requestStartedAt: number;
  availableAt: number;
  precipitation: number;
};

type PrecipitationForecastEvidence = {
  version: string;
  baseline: "seven_model_precipitation_median_shadow";
  baselineMode: "unavailable" | "seven_model_median_shadow";
  bestMatchIncluded: false;
  modelNames: string[];
  models: ModelProvenance[];
  forecastAvailableAt: number | null;
  forecastAccumulationWindow: null;
  observationReferenceAt: number;
  amountAdjustment: "forbidden";
  stationIntervalSemantics: "not_normalized";
};

function emptyForecastEvidence(observationReferenceAt: number): PrecipitationForecastEvidence {
  return {
    version: LOCAL_PRECIPITATION_NOWCASTING_SHADOW_VERSION,
    baseline: "seven_model_precipitation_median_shadow",
    baselineMode: "unavailable",
    bestMatchIncluded: false,
    modelNames: [],
    models: [],
    forecastAvailableAt: null,
    forecastAccumulationWindow: null,
    observationReferenceAt,
    amountAdjustment: "forbidden",
    stationIntervalSemantics: "not_normalized",
  };
}

export type LocalPrecipitationNowcastRefreshResult = {
  locationKey: string;
  observationDate: string;
  observationHour: number;
  persistedCount: number;
  statuses: Record<string, number>;
  reason?: string;
  productionReadsEnabled: 0;
  appliedToProduction: 0;
};

async function insertImmutableEmission(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  values: typeof shadowLocalPrecipitationForecastEmissions.$inferInsert,
): Promise<number> {
  const naturalKey = makeLocalPrecipitationEmissionNaturalKey({
    locationKey: values.locationKey,
    observationReferenceAt: Number(values.observationReferenceAt),
    validTime: Number(values.validTime),
  });
  const existing = await db.select({
    id: shadowLocalPrecipitationForecastEmissions.id,
  }).from(shadowLocalPrecipitationForecastEmissions).where(and(
    eq(shadowLocalPrecipitationForecastEmissions.locationKey, values.locationKey),
    eq(shadowLocalPrecipitationForecastEmissions.observationReferenceAt, Number(values.observationReferenceAt)),
    eq(shadowLocalPrecipitationForecastEmissions.validTime, Number(values.validTime)),
  )).limit(1);
  if (existing[0]) return Number(existing[0].id);

  try {
    await db.insert(shadowLocalPrecipitationForecastEmissions).values(values);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  const insertedOrConcurrent = await db.select({
    id: shadowLocalPrecipitationForecastEmissions.id,
  }).from(shadowLocalPrecipitationForecastEmissions).where(and(
    eq(shadowLocalPrecipitationForecastEmissions.locationKey, values.locationKey),
    eq(shadowLocalPrecipitationForecastEmissions.observationReferenceAt, Number(values.observationReferenceAt)),
    eq(shadowLocalPrecipitationForecastEmissions.validTime, Number(values.validTime)),
  )).limit(1);
  if (!insertedOrConcurrent[0]) throw new Error(`Émission shadow non confirmée pour ${naturalKey}`);
  return Number(insertedOrConcurrent[0].id);
}

async function ensurePendingOutcome(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  emission: { id: number; locationKey: string; validTime: number; horizonMinutes: number; emittedAt: number },
): Promise<void> {
  if (!(SCORE_HORIZONS_MINUTES as readonly number[]).includes(emission.horizonMinutes)) return;
  const existing = await db.select({
    id: shadowLocalPrecipitationForecastOutcomes.id,
  }).from(shadowLocalPrecipitationForecastOutcomes)
    .where(eq(shadowLocalPrecipitationForecastOutcomes.emissionId, emission.id)).limit(1);
  if (existing[0]) return;
  try {
    await db.insert(shadowLocalPrecipitationForecastOutcomes).values({
      emissionId: emission.id,
      locationKey: emission.locationKey,
      validTime: emission.validTime,
      horizonMinutes: emission.horizonMinutes,
      outcomeStatus: "PENDING_FUTURE",
      futureSnapshotId: null,
      futureReferenceAt: null,
      futureCollectedAt: null,
      futureObservedAt: null,
      sourceObservationIds: [],
      sourceObservations: [],
      observedPrecipitation: null,
      observedWet: null,
      accumulationWindow: null,
      unavailabilityReason: null,
      productionReadsEnabled: 0,
      shadowMode: 1,
      appliedToProduction: 0,
      evaluatedAt: emission.emittedAt,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

/**
 * Rebuilds three occurrence-only precipitation candidates from one stored
 * physical snapshot. It uses only forecast archives present before the snapshot
 * reference time; no provider request, production reader or millimetre correction is used.
 * Candidate rows remain diagnostic/upserted; a separate immutable emission archive
 * captures what was actually composed and available at the time.
 */
export async function rebuildLocalPrecipitationNowcastForSnapshot(input: {
  locationKey: string;
  observationDate: string;
  observationHour: number;
  evaluatedAt?: number;
}): Promise<LocalPrecipitationNowcastRefreshResult> {
  const db = await getDb();
  const evaluatedAt = input.evaluatedAt ?? Date.now();
  const empty: LocalPrecipitationNowcastRefreshResult = {
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
  if (observationReferenceAt == null) return { ...empty, reason: "HEURE_PARIS_AMBIGUE_OU_INEXISTANTE" };
  const observationCollectedAt = timestampOf(snapshot.collectedAt);
  if (observationCollectedAt == null) return { ...empty, reason: "HEURE_COLLECTE_REFERENCE_INDISPONIBLE" };
  const targetDates = Array.from(new Set(NOWCAST_HORIZONS.map((horizon) => parisDate(observationReferenceAt + horizon * HOUR_MS))));
  const archiveSets = await Promise.all(targetDates.map(async (targetDate) => ({
    targetDate,
    rows: await getHourlyForecastRunValues(input.locationKey, targetDate),
  })));

  const baselineByTime = new Map<number, number>();
  const evidenceByTime = new Map<number, PrecipitationForecastEvidence>();
  for (const { targetDate, rows } of archiveSets) {
    // Temporal firewall: any run archived after the physical observation is rejected.
    const availableRows = rows.filter((row) => {
      if (row.availableAt == null) return false;
      const availableAt = Number(row.availableAt);
      return Number.isFinite(availableAt) && availableAt <= observationReferenceAt;
    });
    const modelForecasts = reconstructOfficialHourlyModelsFromArchive(availableRows, targetDate)
      .filter((forecast) => forecast.modelName !== "best_match");
    for (const horizon of NOWCAST_HORIZONS) {
      const validTime = observationReferenceAt + horizon * HOUR_MS;
      const models: ModelProvenance[] = modelForecasts.flatMap((forecast) => {
        const validHour = forecast.hours.find((hour) => hour.validAt === validTime);
        if (!validHour || typeof validHour.precipitation !== "number" || !Number.isFinite(validHour.precipitation)
          || typeof forecast.modelId !== "string" || !forecast.modelId
          || typeof forecast.sourceName !== "string" || !forecast.sourceName
          || typeof forecast.captureRunId !== "string" || !forecast.captureRunId
          || typeof forecast.requestStartedAt !== "number" || !Number.isFinite(forecast.requestStartedAt)
          || typeof forecast.availableAt !== "number" || !Number.isFinite(forecast.availableAt)) return [];
        return [{
          modelName: forecast.modelName,
          modelId: forecast.modelId,
          sourceName: forecast.sourceName,
          captureRunId: forecast.captureRunId,
          requestStartedAt: forecast.requestStartedAt,
          availableAt: forecast.availableAt,
          precipitation: validHour.precipitation,
        }];
      });
      const baseline = median(models.map((model) => model.precipitation));
      if (baseline != null) baselineByTime.set(validTime, baseline);
      const forecastAvailableAt = models.length > 0 ? Math.max(...models.map((model) => model.availableAt)) : null;
      evidenceByTime.set(validTime, {
        version: LOCAL_PRECIPITATION_NOWCASTING_SHADOW_VERSION,
        baseline: "seven_model_precipitation_median_shadow",
        baselineMode: baseline == null ? "unavailable" : "seven_model_median_shadow",
        bestMatchIncluded: false,
        modelNames: models.map((model) => model.modelName),
        models,
        forecastAvailableAt,
        forecastAccumulationWindow: null,
        observationReferenceAt,
        amountAdjustment: "forbidden",
        stationIntervalSemantics: "not_normalized",
      });
    }
  }

  const emittedAt = Date.now();
  const referenceSnapshot = {
    id: Number(snapshot.id),
    locationKey: snapshot.locationKey,
    date: snapshot.date,
    hour: Number(snapshot.hour),
    referenceAt: observationReferenceAt,
    collectedAt: observationCollectedAt,
    precipitation: snapshot.precipitation == null ? null : Number(snapshot.precipitation),
    stationCount: Number(snapshot.stationCount),
    confidenceScore: snapshot.confidenceScore == null ? null : Number(snapshot.confidenceScore),
    stationsUsed: snapshot.stationsUsed ?? null,
  };
  const statuses: Record<string, number> = {};
  let persistedCount = 0;
  for (const horizon of NOWCAST_HORIZONS) {
    const validTime = observationReferenceAt + horizon * HOUR_MS;
    const evidence = evidenceByTime.get(validTime) ?? emptyForecastEvidence(observationReferenceAt);
    const result = calculateLocalPrecipitationNowcast({
      baselinePrecipitation: baselineByTime.get(validTime) ?? null,
      observedPrecipitation: snapshot.precipitation == null ? null : Number(snapshot.precipitation),
      observationReferenceAt,
      forecastAvailableAt: evidence.forecastAvailableAt,
      validTime,
      evaluatedAt,
      stationCount: Number(snapshot.stationCount),
      confidenceScore: snapshot.confidenceScore == null ? null : Number(snapshot.confidenceScore),
    });
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    await db.insert(shadowLocalPrecipitationNowcasts).values({
      locationKey: input.locationKey,
      observationDate: snapshot.date,
      observationHour: snapshot.hour,
      observationReferenceAt,
      observationCollectedAt,
      observedPrecipitation: snapshot.precipitation == null ? null : Number(snapshot.precipitation),
      stationCount: Number(snapshot.stationCount),
      confidenceScore: snapshot.confidenceScore == null ? null : Number(snapshot.confidenceScore),
      validTime,
      horizonMinutes: result.horizonMinutes,
      candidateStatus: result.status,
      baselinePrecipitation: result.baselinePrecipitation,
      baselineWet: result.baselineWet == null ? null : result.baselineWet ? 1 : 0,
      observedWet: result.observedWet == null ? null : result.observedWet ? 1 : 0,
      localWetSignal: result.localWetSignal ? 1 : 0,
      continuationFactor: result.continuationFactor,
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
        baselinePrecipitation: result.baselinePrecipitation,
        baselineWet: result.baselineWet == null ? null : result.baselineWet ? 1 : 0,
        observedWet: result.observedWet == null ? null : result.observedWet ? 1 : 0,
        localWetSignal: result.localWetSignal ? 1 : 0,
        continuationFactor: result.continuationFactor,
        forecastAvailableAt: evidence.forecastAvailableAt,
        forecastEvidence: evidence,
        reasons: result.reasons,
        evaluatedAt,
      },
    });

    const baselineWet = result.baselineWet;
    const candidateWet = baselineWet == null ? null : baselineWet || result.localWetSignal;
    const emissionId = await insertImmutableEmission(db, {
      locationKey: input.locationKey,
      observationDate: snapshot.date,
      observationHour: Number(snapshot.hour),
      observationReferenceAt,
      referenceSnapshotId: Number(snapshot.id),
      referenceCollectedAt: observationCollectedAt,
      referenceSnapshot,
      emittedAt,
      availableAt: emittedAt,
      validTime,
      horizonMinutes: result.horizonMinutes ?? horizon * 60,
      candidateStatus: result.status,
      baselinePrecipitation: result.baselinePrecipitation,
      baselineWet: baselineWet == null ? null : baselineWet ? 1 : 0,
      localWetSignal: result.localWetSignal ? 1 : 0,
      candidateWet: candidateWet == null ? null : candidateWet ? 1 : 0,
      continuationFactor: result.continuationFactor,
      forecastAvailableAt: evidence.forecastAvailableAt,
      forecastAccumulationWindow: evidence.forecastAccumulationWindow,
      forecastProvenance: evidence,
      productionReadsEnabled: 0,
      shadowMode: 1,
      appliedToProduction: 0,
    });
    await ensurePendingOutcome(db, {
      id: emissionId,
      locationKey: input.locationKey,
      validTime,
      horizonMinutes: result.horizonMinutes ?? horizon * 60,
      emittedAt,
    });
    persistedCount += 1;
  }
  return { ...empty, persistedCount, statuses };
}

/**
 * Evaluates pending emissions only when the ordinary physical-snapshot path
 * reaches/passes their valid hour. It does not fetch stations or schedule work.
 */
export async function evaluateLocalPrecipitationNowcastOutcomesForSnapshot(input: {
  locationKey: string;
  observationDate: string;
  observationHour: number;
}): Promise<{ evaluatedCount: number; statuses: Record<string, number>; reason?: string; productionReadsEnabled: 0; appliedToProduction: 0 }> {
  const empty = { evaluatedCount: 0, statuses: {} as Record<string, number>, productionReadsEnabled: 0 as const, appliedToProduction: 0 as const };
  const db = await getDb();
  if (!db) return { ...empty, reason: "BASE_INDISPONIBLE" };
  const currentRows = await db.select().from(qualifiedObservationSnapshots).where(and(
    eq(qualifiedObservationSnapshots.locationKey, input.locationKey),
    eq(qualifiedObservationSnapshots.date, input.observationDate),
    eq(qualifiedObservationSnapshots.hour, input.observationHour),
  ));
  const currentSnapshot = currentRows[0];
  if (!currentSnapshot) return { ...empty, reason: "SNAPSHOT_PHYSIQUE_FUTUR_ABSENT" };
  const currentReferenceAt = parisLocalHourToUniqueEpochMs(currentSnapshot.date, currentSnapshot.hour);
  if (currentReferenceAt == null) return { ...empty, reason: "HEURE_PARIS_FUTURE_AMBIGUE_OU_INEXISTANTE" };

  const pendingRows = await db.select().from(shadowLocalPrecipitationForecastOutcomes).where(and(
    eq(shadowLocalPrecipitationForecastOutcomes.locationKey, input.locationKey),
    eq(shadowLocalPrecipitationForecastOutcomes.outcomeStatus, "PENDING_FUTURE"),
    lte(shadowLocalPrecipitationForecastOutcomes.validTime, currentReferenceAt),
  ));
  if (pendingRows.length === 0) return empty;
  const emissions = await db.select().from(shadowLocalPrecipitationForecastEmissions).where(inArray(
    shadowLocalPrecipitationForecastEmissions.id,
    pendingRows.map((outcome) => Number(outcome.emissionId)),
  ));
  const emissionsById = new Map(emissions.map((emission) => [Number(emission.id), emission]));
  const statuses: Record<string, number> = {};
  let evaluatedCount = 0;

  for (const pending of pendingRows) {
    const row = emissionsById.get(Number(pending.emissionId));
    if (!row) continue;
    const emissionEvidence: LocalPrecipitationEmissionEvidence = {
      id: Number(row.id),
      locationKey: row.locationKey,
      observationReferenceAt: Number(row.observationReferenceAt),
      emittedAt: Number(row.emittedAt),
      availableAt: Number(row.availableAt),
      validTime: Number(row.validTime),
      horizonMinutes: Number(row.horizonMinutes),
      baselineWet: asBoolean(row.baselineWet),
      candidateWet: asBoolean(row.candidateWet),
      forecastAccumulationWindow: null,
      productionReadsEnabled: Number(row.productionReadsEnabled),
      shadowMode: Number(row.shadowMode),
      appliedToProduction: Number(row.appliedToProduction),
    };
    const targetParisTime = getParisDateAndHour(emissionEvidence.validTime);
    const targetReferenceAt = targetParisTime
      ? parisLocalHourToUniqueEpochMs(targetParisTime.date, targetParisTime.hour)
      : null;
    let futureSnapshot: LocalPrecipitationFutureSnapshotEvidence | null = null;
    let sourceObservations: LocalPrecipitationSourceObservation[] = [];
    if (targetParisTime && targetReferenceAt === emissionEvidence.validTime) {
      const futureRows = await db.select().from(qualifiedObservationSnapshots).where(and(
        eq(qualifiedObservationSnapshots.locationKey, input.locationKey),
        eq(qualifiedObservationSnapshots.date, targetParisTime.date),
        eq(qualifiedObservationSnapshots.hour, targetParisTime.hour),
      ));
      const futureRow = futureRows[0];
      if (futureRow) {
        const futureCollectedAt = timestampOf(futureRow.collectedAt);
        futureSnapshot = {
          id: Number(futureRow.id),
          locationKey: futureRow.locationKey,
          referenceAt: targetReferenceAt,
          collectedAt: futureCollectedAt ?? Number.NaN,
          stationCount: Number(futureRow.stationCount),
          precipitation: futureRow.precipitation == null ? null : Number(futureRow.precipitation),
          stationsUsed: futureRow.stationsUsed,
        };
        const stationIds = parseStationIds(futureRow.stationsUsed);
        if (stationIds.length > 0 && futureCollectedAt != null) {
          const sourceRows = await db.select().from(stationObservations).where(and(
            inArray(stationObservations.stationId, stationIds),
            gte(stationObservations.observedAt, emissionEvidence.validTime),
            lte(stationObservations.observedAt, futureCollectedAt),
            lte(stationObservations.collectedAt, new Date(futureCollectedAt)),
          ));
          sourceObservations = sourceRows.map((source) => ({
            id: Number(source.id),
            stationId: source.stationId,
            observedAt: Number(source.observedAt),
            collectedAt: timestampOf(source.collectedAt) ?? Number.NaN,
            precipitation: source.precipitation == null ? null : Number(source.precipitation),
            accumulationWindow: null,
          }));
        }
      }
    }

    let outcome = evaluateLocalPrecipitationNowcastOutcome({
      emission: emissionEvidence,
      evaluationReferenceAt: currentReferenceAt,
      futureSnapshot,
      sourceObservations,
      evaluatedAt: Date.now(),
    });
    if (outcome && targetReferenceAt == null) {
      outcome = {
        ...outcome,
        outcomeStatus: "UNAVAILABLE_FUTURE_HOUR_AMBIGUOUS",
        unavailabilityReason: "HEURE_PARIS_DE_L_ECHEANCE_NON_UNIQUE",
      };
    }
    if (!outcome || !canTransitionLocalPrecipitationOutcome(
      pending.outcomeStatus as LocalPrecipitationOutcomeEvidence["outcomeStatus"],
      outcome.outcomeStatus,
    )) continue;
    await db.update(shadowLocalPrecipitationForecastOutcomes).set({
      outcomeStatus: outcome.outcomeStatus,
      futureSnapshotId: outcome.futureSnapshotId,
      futureReferenceAt: outcome.futureReferenceAt,
      futureCollectedAt: outcome.futureCollectedAt,
      futureObservedAt: outcome.futureObservedAt,
      sourceObservationIds: outcome.sourceObservationIds,
      sourceObservations: outcome.sourceObservations,
      observedPrecipitation: outcome.observedPrecipitation,
      observedWet: outcome.observedWet == null ? null : outcome.observedWet ? 1 : 0,
      accumulationWindow: outcome.accumulationWindow,
      unavailabilityReason: outcome.unavailabilityReason,
      productionReadsEnabled: 0,
      shadowMode: 1,
      appliedToProduction: 0,
      evaluatedAt: outcome.evaluatedAt,
    }).where(and(
      eq(shadowLocalPrecipitationForecastOutcomes.emissionId, Number(row.id)),
      eq(shadowLocalPrecipitationForecastOutcomes.outcomeStatus, "PENDING_FUTURE"),
    ));
    statuses[outcome.outcomeStatus] = (statuses[outcome.outcomeStatus] ?? 0) + 1;
    evaluatedCount += 1;
  }
  return { ...empty, evaluatedCount, statuses };
}

function accumulationWindowOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const startAt = Number(record.startAt);
  const endAt = Number(record.endAt);
  const durationMinutes = Number(record.durationMinutes);
  return Number.isFinite(startAt) && Number.isFinite(endAt) && Number.isFinite(durationMinutes)
    ? { startAt, endAt, durationMinutes }
    : null;
}

function jsonNumberArray(value: unknown): number[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
}

async function buildVerificationReport(locationKey: string | undefined, lookbackDays: number) {
  const db = await getDb();
  if (!db) {
    return buildLocalPrecipitationVerificationReport({
      emissions: [], outcomes: [], schemaAvailable: false, unavailableReason: "BASE_INDISPONIBLE",
    });
  }
  const cutoff = Date.now() - Math.max(1, lookbackDays) * 86_400_000;
  try {
    const emissions = locationKey
      ? await db.select().from(shadowLocalPrecipitationForecastEmissions).where(and(
          eq(shadowLocalPrecipitationForecastEmissions.locationKey, locationKey),
          gte(shadowLocalPrecipitationForecastEmissions.emittedAt, cutoff),
        ))
      : await db.select().from(shadowLocalPrecipitationForecastEmissions).where(
          gte(shadowLocalPrecipitationForecastEmissions.emittedAt, cutoff),
        );
    const emissionIds = emissions.map((emission) => Number(emission.id));
    const outcomes = emissionIds.length > 0
      ? await db.select().from(shadowLocalPrecipitationForecastOutcomes).where(inArray(
          shadowLocalPrecipitationForecastOutcomes.emissionId,
          emissionIds,
        ))
      : [];
    const emissionEvidence: LocalPrecipitationEmissionEvidence[] = emissions.map((row) => ({
      id: Number(row.id),
      locationKey: row.locationKey,
      observationReferenceAt: Number(row.observationReferenceAt),
      emittedAt: Number(row.emittedAt),
      availableAt: Number(row.availableAt),
      validTime: Number(row.validTime),
      horizonMinutes: Number(row.horizonMinutes),
      baselineWet: asBoolean(row.baselineWet),
      candidateWet: asBoolean(row.candidateWet),
      forecastAccumulationWindow: accumulationWindowOf(row.forecastAccumulationWindow),
      productionReadsEnabled: Number(row.productionReadsEnabled),
      shadowMode: Number(row.shadowMode),
      appliedToProduction: Number(row.appliedToProduction),
    }));
    const outcomeEvidence: LocalPrecipitationOutcomeEvidence[] = outcomes.map((row) => ({
      emissionId: Number(row.emissionId),
      locationKey: row.locationKey,
      validTime: Number(row.validTime),
      horizonMinutes: Number(row.horizonMinutes),
      outcomeStatus: row.outcomeStatus as LocalPrecipitationOutcomeEvidence["outcomeStatus"],
      futureSnapshotId: row.futureSnapshotId == null ? null : Number(row.futureSnapshotId),
      futureReferenceAt: row.futureReferenceAt == null ? null : Number(row.futureReferenceAt),
      futureCollectedAt: row.futureCollectedAt == null ? null : Number(row.futureCollectedAt),
      futureObservedAt: row.futureObservedAt == null ? null : Number(row.futureObservedAt),
      sourceObservationIds: jsonNumberArray(row.sourceObservationIds),
      sourceObservations: [],
      observedPrecipitation: row.observedPrecipitation == null ? null : Number(row.observedPrecipitation),
      observedWet: asBoolean(row.observedWet),
      accumulationWindow: accumulationWindowOf(row.accumulationWindow),
      unavailabilityReason: row.unavailabilityReason,
      productionReadsEnabled: Number(row.productionReadsEnabled) as 0,
      shadowMode: Number(row.shadowMode) as 1,
      appliedToProduction: Number(row.appliedToProduction) as 0,
      evaluatedAt: Number(row.evaluatedAt),
    }));
    return buildLocalPrecipitationVerificationReport({ emissions: emissionEvidence, outcomes: outcomeEvidence });
  } catch {
    // A deployment may have the application code before the additive migration.
    // Keep AI Lab available and report that verification storage is not installed.
    return buildLocalPrecipitationVerificationReport({
      emissions: [], outcomes: [], schemaAvailable: false, unavailableReason: "TABLES_DE_VERIFICATION_NON_DISPONIBLES",
    });
  }
}

export async function buildLocalPrecipitationNowcastingReport(locationKey?: string, lookbackDays = 7) {
  const db = await getDb();
  const empty = {
    version: LOCAL_PRECIPITATION_NOWCASTING_SHADOW_VERSION,
    candidateCount: 0,
    statuses: { WET_SIGNAL: 0, BASELINE_WET: 0, BASELINE_DRY: 0, STALE_OBSERVATION: 0, UNAVAILABLE: 0, LEAKAGE_BLOCKED: 0 },
    productionReadsEnabled: 0,
    appliedToProduction: 0,
    shadowModeViolations: 0,
    valid: true,
    latest: null as null | {
      locationKey: string; observationDate: string; observationHour: number; observationReferenceAt: number;
      observedPrecipitation: number | null; stationCount: number; confidenceScore: number | null;
      validTime: number; horizonMinutes: number | null; candidateStatus: string;
      baselinePrecipitation: number | null; baselineWet: boolean | null; observedWet: boolean | null;
      localWetSignal: boolean; continuationFactor: number; forecastAvailableAt: number | null;
      forecastEvidence: unknown; reasons: unknown; evaluatedAt: number;
    },
    verification: buildLocalPrecipitationVerificationReport({
      emissions: [], outcomes: [], schemaAvailable: false, unavailableReason: "BASE_INDISPONIBLE",
    }),
  };
  if (!db) return empty;
  const filters = [gte(shadowLocalPrecipitationNowcasts.evaluatedAt, Date.now() - Math.max(1, lookbackDays) * 86_400_000)];
  if (locationKey) filters.push(eq(shadowLocalPrecipitationNowcasts.locationKey, locationKey));
  const rows = await db.select().from(shadowLocalPrecipitationNowcasts)
    .where(and(...filters))
    .orderBy(
      desc(shadowLocalPrecipitationNowcasts.observationReferenceAt),
      shadowLocalPrecipitationNowcasts.horizonMinutes,
      desc(shadowLocalPrecipitationNowcasts.evaluatedAt),
    );
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
  const row = rows[0];
  const latest = row ? {
    locationKey: row.locationKey,
    observationDate: row.observationDate,
    observationHour: Number(row.observationHour),
    observationReferenceAt: Number(row.observationReferenceAt),
    observedPrecipitation: row.observedPrecipitation == null ? null : Number(row.observedPrecipitation),
    stationCount: Number(row.stationCount),
    confidenceScore: row.confidenceScore == null ? null : Number(row.confidenceScore),
    validTime: Number(row.validTime),
    horizonMinutes: row.horizonMinutes == null ? null : Number(row.horizonMinutes),
    candidateStatus: row.candidateStatus,
    baselinePrecipitation: row.baselinePrecipitation == null ? null : Number(row.baselinePrecipitation),
    baselineWet: row.baselineWet == null ? null : Number(row.baselineWet) === 1,
    observedWet: row.observedWet == null ? null : Number(row.observedWet) === 1,
    localWetSignal: Number(row.localWetSignal) === 1,
    continuationFactor: Number(row.continuationFactor),
    forecastAvailableAt: row.forecastAvailableAt == null ? null : Number(row.forecastAvailableAt),
    forecastEvidence: row.forecastEvidence,
    reasons: row.reasons,
    evaluatedAt: Number(row.evaluatedAt),
  } : null;
  const verification = await buildVerificationReport(locationKey, lookbackDays);
  return {
    version: LOCAL_PRECIPITATION_NOWCASTING_SHADOW_VERSION,
    candidateCount: rows.length,
    statuses,
    productionReadsEnabled,
    appliedToProduction,
    shadowModeViolations: shadowModeViolations + verification.shadowModeViolations,
    valid: productionReadsEnabled === 0 && appliedToProduction === 0 && shadowModeViolations === 0 && verification.valid,
    latest,
    verification,
  } as const;
}
