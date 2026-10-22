/**
 * Weather Router — tRPC procedures for MeteoAI
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import {
  getForecastsByDate,
  getForecastsByDateRange,
  getObservationByDate,
  getObservationsByDateRange,
  getMeteoAIForecastByDate,
  getLatestMeteoAIForecasts,
  getMeteoAIForecastHistory,
  getRecentCollectionJobs,
  getRecentScheduledForecastCollectionJobs,
  getLatestHourlyForecastCollectionResults,
  getLatestHourlyProviderRunCaptures,
  getStoredHourlyForecasts,
  getHourlyForecastEvaluationHistory,
  getHourlyForecastRunValues,
  getLatestHourlyComparisonDiagnosticSnapshot,
  insertForecasts,
  insertForecastRuns,
  insertMeteoAIDailyFusionRun,
  insertObservation,
  insertReliabilityScores,
  upsertMeteoAIForecast,
  getLeadTimeScoresForLocation,
  getDailyFusionPerformanceEvidence,
  getDailyForecastVerificationSources,
  makeLocationKey,
  getPhysicalStationHistory,
  getStationCollectionSnapshots,
  getQualifiedObservationSnapshotsByDateRange,
  getStationCollectionSnapshotsByDateRange,
  getPhysicalSnapshotCollectionTracesByDateRange,
  getQualifiedEvidenceStatus,
  getStationQualityProfiles,
  getFavoriteLocations,
} from "../db";
import { collectCurrentWeatherSnapshot, collectExpertForecasts, collectObservations, collect15DayForecast, collectHourlyForecast, OFFICIAL_HOURLY_MODELS, WEATHER_SERVICES, VALIDATION_WEATHER_MODELS } from "../weatherServices";
import { summarizeDailyModelAgreement } from "../../shared/modelAgreement";
import { summarizePrecipitationModels } from "../../shared/precipitationConsensus";
import { legacyStabilityLabelForStorage } from "../legacyStabilityStorage";
import { collectNearbyStations, collectNearbyStationsWithDiagnostics, fetchCurrentModelReferences, getPhysicalActiveStations, rankStations, calculateGroundTruth, haversineKm, HONDEGHEM, getStationSourceKind, type StationData } from "../stationService";
import { getStationMeasurementAgeStates } from "../stationMeasurementFreshness";
import { calculateUltraLocal } from "../ultraLocalService";
import { calculateReliabilityScore, detectWeatherRegime, REGIME_DEFINITIONS, type WeatherRegime } from "../statsEngine";
import { detectExtendedRegime, detectMultiRegime, EXTENDED_REGIME_INFO, type ExtendedRegime, type MultiRegimeResult } from "../fusionEngine";
import { getParisDate, getParisDateDaysAgo, getParisHour, getNextParisForecastRun, getParisHourlyTimestamps } from "../weatherTime";
import { isCompleteStoredHourlyProjection } from "../hourlyForecastCompleteness";
import { getActiveParisForecastHours, getFavoritesForecastCadence, getFavoritesForecastScheduleLabel, getRequiredFavoritesForecastHeartbeatCron } from "../forecastScheduleConfig";
import { getForecastRunDisplayStatus } from "../forecastRunSummary";
import { buildRecentPhysicalSnapshotSlots } from "../physicalSnapshotHistory";
import { computeOfficialDailyForecast } from "../officialForecast";
import { buildForecastRunArchiveRows } from "../dailyForecastPerformance";
import { buildDailyForecastVerificationReadModel, buildMeteoAIDailyFusionArchiveRun } from "../dailyForecastVerification";
import { HOURLY_FORECAST_VARIABLES, MODEL_FORECAST_HORIZONS } from "../forecastVariableCoverage";
import { PROVIDER_RUN_MODEL_CAPABILITIES } from "../providerRunCapabilities";
import { compareTraceWeights } from "../weightComparison";
import { findActiveHourlyForecastIndex } from "../../shared/hourlyForecastTime";
import { buildOperationalRegime, findNextHourlyRegimeChange } from "../officialRegime";
import { buildLocalOfficialDeltaHistory, selectOfficialHourlyTemperaturesBeforeLocalMeasurements, selectedOfficialHourlyTemperaturePoints } from "../localOfficialHistory";
import { reconstructHistoricalOfficialTemperatures, reconstructHistoricalOfficialHours } from "../historicalOfficialForecast";
import { buildModelIndicator } from "../modelIndicator";
import { buildAppliedModelWeights, filterForecastTraceToModelNames } from "../aiLabTrace";
import { buildModelReferenceCoherence } from "../modelReferenceCoherence";
import { buildDatedDailyFusionFallback, resolveOfficialDailyForecastSnapshot, resolveOfficialWeatherSnapshot, withDeadline } from "../officialWeatherSnapshot";
import { projectHourlyForecastForDashboard, projectDailyForecastForDashboard } from "../forecastResponseProjection";
import { buildLiveAILabSnapshot, type LiveModelForecast } from "../aiLabLiveSnapshot";
import { buildAILabForecastComparisonReadModel, formatAILabLocationLabel } from "../aiLabForecastComparison";
import { getCollectedModelNames, getMissingModelNames } from "../stationCollectionModels";
import { isOperationalObservation } from "../observationProvenance";
import { latitudeSchema, longitudeSchema, optionalCoordinatesSchema, requiredCoordinatesSchema } from "../weatherInput";
import { buildReliabilityLaboratoryCached } from "../weatherReliabilityLab";
import { buildStationReliabilityOverviewCached, clearStationReliabilityOverviewCache } from "../stationReliabilityOverview";
import { getApparentAstronomyPosition, getEnvironmentalSnapshot, getTerrainHorizonProfile } from "../environmentalData";
import { refreshManualFusionForFavorite } from "../manualFusion";
import { getLocalEclipseCircumstances } from "../eclipseVisibility";
import { getWeatherProviderDiagnostics, fetchWeather } from "../weatherFetch";
import { buildWeatherProvenance } from "../weatherProvenance";
import { buildEveningEvidence } from "../historyEvidence";
import { collectPhysicalObservationSnapshotsForFavorites } from "../scheduledHandlers";
import { buildForecastFlowStatuses } from "../forecastFlowStatus";
import { buildLocalTemperatureNowcastingReport } from "../localTemperatureNowcastingShadow";
import { buildLocalPrecipitationNowcastingReport } from "../localPrecipitationNowcastingShadow";
import { deriveStationPerformanceProfiles } from "../stationPerformanceService";
import { getStationRankingContract } from "../stationRankingContract";
import { runHondeghemAromeShadowComparison, verifyHondeghemAromeWindDirectionAvailability } from "../aromeHondeghemShadow";
import { compareOpenWeatherForecastWithOfficial } from "../openWeatherShadow";
import { fillOpenWeatherHourlyGaps } from "../openWeatherHourlyFallback";
import { computeOfficialHourlyForecast, OFFICIAL_HOURLY_HISTORY_DAYS, reconstructOfficialHourlyModelsFromArchive } from "../officialHourlyForecast";
import { buildStationForecastComparison24h, qualifyStationForecastReadings } from "../stationForecastComparison";
import { dailyPhysicalComparisonsRouter } from "./dailyPhysicalComparisons";
import { loadDetailedForecastSources } from "../detailedForecastLoading";

function getTodayParis(): string {
  return getParisDate();
}

export function getCurrentHourlyRegimeInput(hours: Array<any>, currentHour = getParisHour(), selectionUpdatedAt?: Date | string, sourceLabel?: string, sourceComputedAt?: Date | string | null) {
  const hourNumber = Number(currentHour);
  const updatedAt = selectionUpdatedAt == null ? new Date() : new Date(selectionUpdatedAt);
  const activeIndex = Number.isFinite(updatedAt.getTime())
    ? findActiveHourlyForecastIndex(hours, updatedAt.getTime())
    : -1;
  const current = hours[activeIndex] ?? hours.find((hour) => {
    const match = String(hour?.hour ?? "").match(/^(\d{1,2}):/);
    return match != null && Number(match[1]) === hourNumber;
  }) ?? null;
  if (!current) return null;
  return {
    temp: current.temp ?? null,
    precipitation: current.precipitation ?? null,
    windSpeed: current.windSpeed ?? null,
    humidity: current.humidity ?? null,
    cloudCover: current.cloudCover ?? null,
    visibilityKm: current.visibility ?? null,
    validAt: typeof current.validAt === "number" ? current.validAt : null,
    updatedAt,
    sourceUpdatedAt: sourceComputedAt ?? null,
    sourceLabel: sourceLabel ?? null,
  };
}

function getPersistedForecastTrace(weights: unknown, computedAt?: Date | null) {
  let normalizedWeights = weights;
  if (typeof normalizedWeights === "string") {
    try {
      normalizedWeights = JSON.parse(normalizedWeights);
    } catch {
      normalizedWeights = null;
    }
  }
  const record = normalizedWeights && typeof normalizedWeights === "object" ? normalizedWeights as Record<string, any> : null;
  if (!record) return null;
  if (record.trace) return record.trace;

  // Les snapshots précédant la traçabilité v1 contiennent déjà les poids finaux
  // par service. On les expose sans inventer les facteurs intermédiaires.
  const weightByService = record.weightByService && typeof record.weightByService === "object"
    ? record.weightByService as Record<string, any>
    : record;
  const services = Object.entries(weightByService);
  if (services.length === 0) return null;

  const hasParameterWeights = services.some(([, weight]) =>
    weight && typeof weight === "object" &&
    (typeof weight.tempWeight === "number" || typeof weight.precipWeight === "number" || typeof weight.windWeight === "number")
  );

  if (!hasParameterWeights) {
    const numericServices = services.filter(([, weight]) => typeof weight === "number");
    const total = numericServices.reduce((sum, [, weight]) => sum + Number(weight), 0);
    if (numericServices.length === 0 || total <= 0) return null;
    const globalSources = numericServices.map(([name, weight]) => ({
      id: `model:${name}`,
      name,
      type: "model" as const,
      finalWeight: Number(weight) / total,
    }));
    return {
      version: 0,
      issuedAt: computedAt?.toISOString?.() ?? null,
      method: "Fusion officielle — archive de pondérations globales",
      sourceCount: globalSources.length,
      parameterSources: {
        temperature: globalSources,
        precipitation: globalSources,
        wind: globalSources,
      },
      excludedSources: [],
    };
  }

  const parameterServices = services.filter(([, weight]) =>
    weight && typeof weight === "object" &&
    (typeof weight.tempWeight === "number" || typeof weight.precipWeight === "number" || typeof weight.windWeight === "number")
  );

  const parameterSources = (field: "tempWeight" | "precipWeight" | "windWeight") => parameterServices
    .filter(([, weight]) => typeof weight[field] === "number")
    .map(([name, weight]) => ({
      id: `model:${name}`,
      name,
      type: "model" as const,
      finalWeight: weight[field],
    }));

  return {
    version: 0,
    issuedAt: computedAt?.toISOString?.() ?? null,
    method: "Fusion officielle — archive de pondérations",
    sourceCount: parameterServices.length,
    parameterSources: {
      temperature: parameterSources("tempWeight"),
      precipitation: parameterSources("precipWeight"),
      wind: parameterSources("windWeight"),
    },
    excludedSources: [],
  };
}

const detailedForecastInputSchema = z.object({
  lat: latitudeSchema.optional(),
  lon: longitudeSchema.optional(),
  includeExtendedPeriods: z.boolean().optional(),
}).refine(
  ({ lat, lon }) => (lat === undefined) === (lon === undefined),
  { message: "Les coordonnées latitude et longitude doivent être fournies ensemble." },
);

export const weatherRouter = router({
  /** Fast model-current read used to make the Dashboard useful before the seven-model horizon finishes. */
  getCurrentModelSnapshot: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(({ input }) => collectCurrentWeatherSnapshot(
      input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : HONDEGHEM,
    )),

  /** Catalogue descriptif des régimes : il n’altère jamais le régime détecté. */
  getRegimeCatalogue: publicProcedure.query(() => (
    Object.entries(EXTENDED_REGIME_INFO).map(([id, info]) => ({
      id,
      label: info.label,
      emoji: info.emoji,
      description: info.description,
      weights: {
        temp: info.weights.temp,
        precip: info.weights.precip,
        wind: info.weights.wind,
        condition: info.weights.condition,
      },
    }))
  )),

  /**
   * Dashboard: today's MeteoAI forecast and descriptive regime context
   */
  getDashboard: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
    const today = getTodayParis();
    const locKey = input?.lat != null && input?.lon != null ? makeLocationKey(input.lat, input.lon) : "default";

    // Snapshot, observation et prévision horaire actualisée sont comparés par
    // le sélecteur partagé.
    const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : undefined;
    const [meteoAI, observation, officialSnapshot] = await Promise.all([
      getMeteoAIForecastByDate(today, locKey),
      getObservationByDate(today, locKey),
      resolveOfficialWeatherSnapshot(coords ?? HONDEGHEM, { includeDaily: false }),
    ]);
    const hourly = officialSnapshot.hourly;

    // Get all forecasts for today
    const forecasts = await getForecastsByDate(today, locKey);

    // Get recent forecasts if no today data
    const recentForecasts = await getLatestMeteoAIForecasts(7, locKey);
    const dailyFallbackSource = meteoAI ?? recentForecasts[0];
    const dailyFallbackTrace = getPersistedForecastTrace(dailyFallbackSource?.weights, dailyFallbackSource?.computedAt);
    const dailyFallback = officialSnapshot.hourly.length === 0
      ? buildDatedDailyFusionFallback(dailyFallbackSource, dailyFallbackTrace?.precipitationConsensus ?? null)
      : null;

    const officialRegime = buildOperationalRegime(meteoAI, observation, getCurrentHourlyRegimeInput(hourly, getParisHour(), new Date(officialSnapshot.computedAt), "Prévision horaire officielle · 7 modèles", officialSnapshot.hourlyComputedAt));
    const trace = getPersistedForecastTrace(meteoAI?.weights, meteoAI?.computedAt);
    const modelIndicator = buildModelIndicator(trace);

    return {
      today,
      currentSnapshot: officialSnapshot.currentSnapshot,
      meteoAI: meteoAI ? {
        date: meteoAI.date,
        tempMax: meteoAI.tempMax,
        tempMin: meteoAI.tempMin,
        precipitation: meteoAI.precipitation,
        windSpeed: meteoAI.windSpeed,
        humidity: meteoAI.humidity,
        condition: meteoAI.condition,
        computedAt: meteoAI.computedAt,
        explanation: meteoAI.explanation,
      } : null,
      trace,
      modelIndicator,
      forecastCount: forecasts.length,
      recentForecasts: recentForecasts.map((forecast) => ({
        date: forecast.date,
        tempMax: forecast.tempMax,
        tempMin: forecast.tempMin,
        precipitation: forecast.precipitation,
        windSpeed: forecast.windSpeed,
        condition: forecast.condition,
        computedAt: forecast.computedAt,
        explanation: forecast.explanation,
      })),
      allServices: WEATHER_SERVICES.expert,
      totalServices: WEATHER_SERVICES.expert.length,
      dailyFallback,
      regime: officialRegime.primary ? {
        id: officialRegime.primary.id,
        label: officialRegime.primary.label,
        emoji: officialRegime.primary.emoji,
        description: officialRegime.description,
        weights: officialRegime.blendedWeights,
      } : null,
      multiRegime: {
        status: officialRegime.status,
        activeRegimes: officialRegime.active,
        confidenceScore: officialRegime.confidence,
        blendedWeights: officialRegime.blendedWeights,
        description: officialRegime.description,
      },
      officialRegime,
    };
  }),

  /** Snapshots successifs pouvant être comparés dans la vue des pondérations. */
  getWeightTraceHistory: publicProcedure
    .input(z.object({ lat: latitudeSchema.optional(), lon: longitudeSchema.optional(), limit: z.number().min(2).max(60).optional() }).optional())
    .query(async ({ input }) => {
      const locationKey = input?.lat != null && input?.lon != null ? makeLocationKey(input.lat, input.lon) : "default";
      const snapshots = await getMeteoAIForecastHistory(locationKey, input?.limit ?? 30);
      return snapshots
        .map((snapshot) => ({
          id: snapshot.id,
          date: snapshot.date,
          computedAt: snapshot.computedAt,
          trace: getPersistedForecastTrace(snapshot.weights, snapshot.computedAt),
        }))
        .filter((snapshot) => snapshot.trace != null);
    }),

  /** Série horaire vérifiable pour le graphique local/officiel du Dashboard. */
  getLocalOfficialDeltaHistory: publicProcedure
    .input(requiredCoordinatesSchema)
    .query(async ({ input }) => {
      const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
      const locationKey = makeLocationKey(input.lat, input.lon);
      const today = getTodayParis();
      const yesterday = getParisDateDaysAgo(1);
      const [physicalHistory, todayRows, yesterdayRows, hourlyScoreHistory] = await Promise.all([
        getPhysicalStationHistory(input.lat, input.lon, sinceMs),
        getHourlyForecastRunValues(locationKey, today),
        getHourlyForecastRunValues(locationKey, yesterday),
        getHourlyForecastEvaluationHistory(
          locationKey,
          getParisDateDaysAgo(OFFICIAL_HOURLY_HISTORY_DAYS),
          getParisDateDaysAgo(1),
        ),
      ]);
      const readings = physicalHistory.stations.flatMap((station) => station.readings.flatMap((reading) => {
        const raw = reading.measurementTimes?.temperature;
        const measuredAt = typeof raw === "string" ? Date.parse(raw) : NaN;
        if (!Number.isFinite(measuredAt) || measuredAt > Date.now() || measuredAt > reading.observedAt) return [];
        return [{ stationId: station.stationId, observedAt: measuredAt, temperature: reading.temperature,
          distanceKm: Number(station.distanceKm), reliabilityScore: Number(station.reliabilityScore) }];
      }));
      const candidates = reconstructHistoricalOfficialTemperatures(readings, [...todayRows, ...yesterdayRows], hourlyScoreHistory.rows);
      const selections = selectOfficialHourlyTemperaturesBeforeLocalMeasurements(readings, candidates);
      return buildLocalOfficialDeltaHistory(readings, selectedOfficialHourlyTemperaturePoints(selections));
    }),

  /** Écarts de poids, source par source, entre deux snapshots du même lieu. */
  compareWeightSnapshots: publicProcedure
    .input(z.object({
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      beforeId: z.number().int().positive(),
      afterId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const locationKey = input.lat != null && input.lon != null ? makeLocationKey(input.lat, input.lon) : "default";
      const snapshots = await getMeteoAIForecastHistory(locationKey, 60);
      const beforeSnapshot = snapshots.find((snapshot) => snapshot.id === input.beforeId);
      const afterSnapshot = snapshots.find((snapshot) => snapshot.id === input.afterId);
      if (!beforeSnapshot || !afterSnapshot) return null;

      const beforeTrace = getPersistedForecastTrace(beforeSnapshot.weights, beforeSnapshot.computedAt);
      const afterTrace = getPersistedForecastTrace(afterSnapshot.weights, afterSnapshot.computedAt);
      if (!beforeTrace?.parameterSources || !afterTrace?.parameterSources) return null;

      return {
        before: {
          id: beforeSnapshot.id,
          date: beforeSnapshot.date,
          computedAt: beforeSnapshot.computedAt,
          trace: beforeTrace,
        },
        after: {
          id: afterSnapshot.id,
          date: afterSnapshot.date,
          computedAt: afterSnapshot.computedAt,
          trace: afterTrace,
        },
        parameters: compareTraceWeights(beforeTrace, afterTrace),
      };
    }),

  /**
   * Full ranking of all services with cumulative scores
   */
  getRanking: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
    const today = getTodayParis();
    const locKey = input?.lat != null && input?.lon != null ? makeLocationKey(input.lat, input.lon) : "default";
    const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : undefined;
    const [meteoAI, observation, hourly] = await Promise.all([
      getMeteoAIForecastByDate(today, locKey),
      getObservationByDate(today, locKey),
      collectHourlyForecast(today, coords),
    ]);
    const officialRegime = buildOperationalRegime(meteoAI, observation, getCurrentHourlyRegimeInput(hourly));
    const regimeParams = officialRegime.params;
    const multiRegime = {
      primaryRegime: officialRegime.primary,
      activeRegimes: officialRegime.active,
      blendedWeights: officialRegime.blendedWeights,
      confidenceScore: officialRegime.confidence,
      description: officialRegime.description,
    };

    // All 12 extended regime definitions for the UI
    const allRegimes = (Object.keys(EXTENDED_REGIME_INFO) as ExtendedRegime[]).map(key => ({
      id: key,
      ...EXTENDED_REGIME_INFO[key],
    }));

    // Preserve missing source fields; displayed parameters remain null rather than synthetic values.
    const currentParams = {
      temperature: regimeParams.temperature,
      precipitation: regimeParams.precipitation,
      windSpeed: regimeParams.windSpeed,
      humidity: regimeParams.humidity,
      cloudCover: regimeParams.cloudCover,
      visibilityKm: regimeParams.visibilityKm,
      pressure: regimeParams.pressure,
    };

    // Determine impact level per parameter based on regime weights
    const getImpact = (weight: number): "Faible" | "Modéré" | "Élevé" | "Critique" => {
      if (weight >= 0.30) return "Critique";
      if (weight >= 0.20) return "Élevé";
      if (weight >= 0.12) return "Modéré";
      return "Faible";
    };

    const paramImpacts = multiRegime.blendedWeights ? {
      temperature: getImpact(multiRegime.blendedWeights.temp),
      precipitation: getImpact(multiRegime.blendedWeights.precip),
      wind: getImpact(multiRegime.blendedWeights.wind),
      cloudCover: getImpact(multiRegime.blendedWeights.condition),
      humidity: getImpact(multiRegime.blendedWeights.humidity),
      pressure: getImpact(multiRegime.blendedWeights.pressure),
    } : null;

    // Key factors of the moment (top 5 based on current conditions)
    const keyFactors: Array<{ label: string; icon: string }> = [];
    if (currentParams.cloudCover != null && currentParams.cloudCover > 70) keyFactors.push({ label: "Haute couverture nuageuse", icon: "☁️" });
    if (currentParams.humidity != null && currentParams.humidity > 75) keyFactors.push({ label: "Humidité élevée", icon: "💧" });
    if (currentParams.pressure != null && currentParams.pressure >= 1010 && currentParams.pressure <= 1020) keyFactors.push({ label: "Pression stable", icon: "🌀" });
    if (currentParams.precipitation != null && currentParams.precipitation > 0.5) keyFactors.push({ label: "Averses possibles", icon: "🌧️" });
    if (currentParams.windSpeed != null && currentParams.windSpeed > 15 && currentParams.windSpeed <= 40) keyFactors.push({ label: `Vent modéré`, icon: "💨" });
    if (currentParams.windSpeed != null && currentParams.windSpeed > 40) keyFactors.push({ label: "Vent fort", icon: "🌬️" });
    if (currentParams.temperature != null && currentParams.temperature > 30) keyFactors.push({ label: "Forte chaleur", icon: "🌡️" });
    if (currentParams.temperature != null && currentParams.temperature < 5) keyFactors.push({ label: "Froid marqué", icon: "❄️" });
    if (currentParams.cloudCover != null && currentParams.cloudCover < 30) keyFactors.push({ label: "Ciel dégagé", icon: "☀️" });
    if (currentParams.pressure != null && currentParams.pressure < 1005) keyFactors.push({ label: "Dépression active", icon: "🌀" });
    // Keep top 5
    const topFactors = keyFactors.slice(0, 5);

    return {
      officialRegime,
      // Legacy single-regime field (kept for backward compat)
      regime: multiRegime.primaryRegime ? {
        id: multiRegime.primaryRegime.id,
        label: multiRegime.primaryRegime.label,
        emoji: multiRegime.primaryRegime.emoji,
        description: multiRegime.description,
        weights: multiRegime.blendedWeights ? {
          temp: multiRegime.blendedWeights.temp,
          precip: multiRegime.blendedWeights.precip,
          wind: multiRegime.blendedWeights.wind,
          condition: multiRegime.blendedWeights.condition,
        } : null,
      } : null,
      // New multi-regime data
      multiRegime: {
        status: officialRegime.status,
        primaryRegime: multiRegime.primaryRegime,
        activeRegimes: multiRegime.activeRegimes,
        blendedWeights: multiRegime.blendedWeights,
        confidenceScore: multiRegime.confidenceScore,
        description: multiRegime.description,
      },
      allRegimes,
      // New fields for the redesigned UI
      currentParams,
      paramImpacts,
      keyFactors: topFactors,
    };
  }),

  /**
   * History: forecast vs observation comparison over date range
   */
  getHistory: publicProcedure
    .input(
      z.object({
        days: z.number().min(1).max(30).default(7),
        lat: latitudeSchema.optional(),
        lon: longitudeSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const endDate = getTodayParis();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      const startStr = startDate.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
      const locKey = input.lat != null && input.lon != null ? makeLocationKey(input.lat, input.lon) : "default";

      const forecasts = await getForecastsByDateRange(startStr, endDate, locKey);
      const observations = await getObservationsByDateRange(startStr, endDate, locKey);
      const meteoAIForecasts = (await getLatestMeteoAIForecasts(input.days, locKey)).map((forecast) => ({
        date: forecast.date,
        tempMax: forecast.tempMax,
        tempMin: forecast.tempMin,
        precipitation: forecast.precipitation,
        windSpeed: forecast.windSpeed,
        condition: forecast.condition,
        computedAt: forecast.computedAt,
      }));
      const [physicalSnapshots, collectionSnapshots, physicalCollectionTraces] = await Promise.all([
        getQualifiedObservationSnapshotsByDateRange(locKey, startStr, endDate),
        getStationCollectionSnapshotsByDateRange(locKey, startStr, endDate),
        getPhysicalSnapshotCollectionTracesByDateRange(locKey, startStr, endDate),
      ]);

      return {
        forecasts,
        observations,
        meteoAIForecasts,
        eveningEvidence: buildEveningEvidence(physicalSnapshots, collectionSnapshots, physicalCollectionTraces),
        startDate: startStr,
        endDate,
      };
    }),

  /**
   * Detailed report for a specific date
   */
  getReport: publicProcedure
    .input(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        lat: latitudeSchema.optional(),
        lon: longitudeSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const date = input.date || getTodayParis();
      const locKey = input.lat != null && input.lon != null ? makeLocationKey(input.lat, input.lon) : "default";

      const forecasts = await getForecastsByDate(date, locKey);
      const observation = await getObservationByDate(date, locKey);
      const meteoAI = await getMeteoAIForecastByDate(date, locKey);
      const independentModelNames = WEATHER_SERVICES.expert
        .filter((model) => model.modelId !== "best_match")
        .map((model) => model.name);
      const independentForecasts = forecasts.filter((forecast) => independentModelNames.includes(forecast.serviceName));
      const modelAgreement = summarizeDailyModelAgreement(independentForecasts.map((forecast) => ({
        modelName: forecast.serviceName,
        tempMax: forecast.tempMax,
        tempMin: forecast.tempMin,
        precipitation: forecast.precipitation,
        windSpeed: forecast.windSpeed,
        windGust: forecast.windGust,
        humidity: forecast.humidity,
        cloudCover: forecast.cloudCover,
      })), independentModelNames, null);
      const precipitationConsensus = summarizePrecipitationModels(
        independentForecasts.map((forecast) => ({ modelName: forecast.serviceName, amountMm: forecast.precipitation })),
        independentModelNames,
      );
      const finiteNumber = (value: unknown): number | null => {
        if (value == null || value === "") return null;
        const numeric = typeof value === "number" ? value : Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };
      const dailyError = (forecastValue: unknown, observedValue: unknown) => {
        const forecastNumber = finiteNumber(forecastValue);
        const observedNumber = finiteNumber(observedValue);
        if (forecastNumber == null || observedNumber == null) return { comparisonCount: 0, signedDifference: null, absoluteError: null };
        const signedDifference = forecastNumber - observedNumber;
        return { comparisonCount: 1, signedDifference, absoluteError: Math.abs(signedDifference) };
      };
      const observationComparisons = observation ? independentForecasts.map((forecast) => ({
        modelName: forecast.serviceName,
        targetDate: date,
        horizonDays: null,
        temperatureMax: dailyError(forecast.tempMax, observation.tempMax),
        temperatureMin: dailyError(forecast.tempMin, observation.tempMin),
        precipitation: dailyError(forecast.precipitation, observation.precipitation),
        windSpeed: dailyError(forecast.windSpeed, observation.windSpeed),
        windGust: dailyError(forecast.windGust, observation.windGust),
        cloudCover: dailyError(forecast.cloudCover, observation.cloudCover),
      })) : [];

      return {
        date,
        forecasts: independentForecasts.map((forecast) => ({
          serviceName: forecast.serviceName,
          serviceCategory: forecast.serviceCategory,
          tempMax: forecast.tempMax,
          tempMin: forecast.tempMin,
          precipitation: forecast.precipitation,
          windSpeed: forecast.windSpeed,
          windGust: forecast.windGust,
        })),
        observation,
        meteoAI: meteoAI ? {
          tempMax: meteoAI.tempMax,
          tempMin: meteoAI.tempMin,
          precipitation: meteoAI.precipitation,
          windSpeed: meteoAI.windSpeed,
          explanation: meteoAI.explanation,
        } : null,
        modelAgreement,
        precipitationConsensus,
        observationComparisons,
      };
    }),

  /**
   * 15-day MeteoAI forecast from multiple models
   */
  get15DayForecast: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input, signal }) => {
      const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : undefined;
      const [snapshot, daily] = await Promise.all([resolveOfficialWeatherSnapshot(coords ?? HONDEGHEM, { includeDaily: false, signal }), resolveOfficialDailyForecastSnapshot(coords ?? HONDEGHEM, { signal })]);
      return { today: snapshot.weatherDate, currentSnapshot: snapshot.currentSnapshot, days: daily.daily, modelsUsed: daily.modelsUsed, dailyStatus: daily.dailyStatus, officialSnapshot: { validAt: snapshot.validAt, computedAt: snapshot.computedAt, sourceKind: snapshot.sourceKind, source: snapshot.source } };
    }),

  /** Daily horizon loaded after the Dashboard's critical current-weather response. */
  getDashboardDailyForecast: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input, signal }) => {
      const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : HONDEGHEM;
      const daily = await resolveOfficialDailyForecastSnapshot(coords, { signal });
      return { days: projectDailyForecastForDashboard(daily.daily), modelsUsed: daily.modelsUsed, dailyStatus: daily.dailyStatus };
    }),

  /**
   * Hourly forecast for today
   */
  getHourlyForecast: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
      const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : undefined;
      const snapshot = await resolveOfficialWeatherSnapshot(coords ?? HONDEGHEM, { includeDaily: false });
      return { today: snapshot.weatherDate, currentSnapshot: snapshot.currentSnapshot, hours: snapshot.hourly, officialSnapshot: { validAt: snapshot.validAt, computedAt: snapshot.computedAt, sourceKind: snapshot.sourceKind, source: snapshot.source, hourlyWeighting: snapshot.hourlyWeighting } };
    }),

  /** Comparaison manuelle AROME en lecture seule, limitée à Hondeghem et sans effet sur la production. AROME vient uniquement d’Open-Meteo (sans clé); le WCS authentifié ne part que si AROME_WCS_ENABLED=true côté serveur. */
  compareHondeghemAromeShadow: adminProcedure
    .mutation(async () => runHondeghemAromeShadowComparison()),
  /** Chemin hérité uniquement (AROME_WCS_ENABLED=true) : vérification des candidats DD(10 m) du catalogue WCS. Désactivé par défaut — la direction est comparée via wind_direction_10m Open-Meteo; sans le flag, aucune clé n’est lue et aucune requête n’est envoyée. */
  verifyHondeghemAromeWindDirection: adminProcedure
    .mutation(async () => verifyHondeghemAromeWindDirectionAvailability()),
  /** OpenWeather est un comparateur shadow manuel; il ne participe pas au moteur et ne persiste rien. */
  compareOpenWeatherShadow: adminProcedure
    .input(z.object({
      lat: latitudeSchema,
      lon: longitudeSchema,
      officialHours: z.array(z.object({
        validAt: z.number().int().positive(),
        temp: z.number().finite().nullable(),
        windSpeed: z.number().finite().nullable(),
        windDirection: z.number().finite().nullable(),
        humidity: z.number().finite().nullable(),
        cloudCover: z.number().finite().nullable(),
      }).strict()).max(96),
    }).strict())
    .mutation(async ({ input }) => compareOpenWeatherForecastWithOfficial({
      apiKey: ENV.openWeatherMapApiKey,
      lat: input.lat,
      lon: input.lon,
      officialHours: input.officialHours,
    })),

  /** Provenance commune : horaires, repli quotidien réel ou indisponibilité explicite. */
  getForecastProvenance: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
      const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : undefined;
      const locationKey = input?.lat != null && input?.lon != null ? makeLocationKey(input.lat, input.lon) : "default";
      const snapshot = await resolveOfficialWeatherSnapshot(coords ?? HONDEGHEM, { includeDaily: false });
      const currentFusion = snapshot.hourly.length === 0
        ? await getMeteoAIForecastByDate(snapshot.weatherDate, locationKey)
        : null;
      const latestFusion = snapshot.hourly.length === 0 && !currentFusion
        ? (await getLatestMeteoAIForecasts(1, locationKey))[0] ?? null
        : null;
      const dailyFallbackSource = currentFusion ?? latestFusion;
      const dailyFallbackTrace = getPersistedForecastTrace(dailyFallbackSource?.weights, dailyFallbackSource?.computedAt);
      const dailyFallback = snapshot.hourly.length === 0
        ? buildDatedDailyFusionFallback(dailyFallbackSource, dailyFallbackTrace?.precipitationConsensus ?? null)
        : null;
      return buildWeatherProvenance(snapshot, dailyFallback);
    }),

  /** Bilan des lots planifiés favoris, distinct des snapshots des stations physiques. */
  getForecastCollectionReport: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
      const locationKey = input?.lat != null && input?.lon != null ? makeLocationKey(input.lat, input.lon) : "default";
      const [recentCollections, physicalTraces, recentJobs] = await Promise.all([
        getStationCollectionSnapshots(locationKey, 8),
        getPhysicalSnapshotCollectionTracesByDateRange(locationKey, getParisDateDaysAgo(1), getTodayParis()),
        getRecentScheduledForecastCollectionJobs(2),
      ]);
      const [latestHourlyModelCollection, currentHourlyProjectionRows, providerRunCollection] = await Promise.all([
        getLatestHourlyForecastCollectionResults(locationKey),
        getStoredHourlyForecasts(locationKey, getParisDate()),
        getLatestHourlyProviderRunCaptures(locationKey),
      ]);
      const projectionMeasuredAt = Date.now();
      const expectedProjectionTimes = getParisHourlyTimestamps(getParisDate());
      const requiredProjectionFields = HOURLY_FORECAST_VARIABLES
        .filter((variable) => variable.consumerProjected)
        .map((variable) => variable.valueField);
      const projectionRowsByModel = new Map<string, typeof currentHourlyProjectionRows>();
      for (const row of currentHourlyProjectionRows) {
        const modelRows = projectionRowsByModel.get(row.modelName) ?? [];
        modelRows.push(row);
        projectionRowsByModel.set(row.modelName, modelRows);
      }
      const currentProjectionByModel = new Map<string, { rowCount: number; collectedAtMs: number; complete: boolean }>();
      projectionRowsByModel.forEach((rows, modelName) => {
        const collectedTimes = rows.map((row) => row.collectedAt instanceof Date ? row.collectedAt.getTime() : new Date(row.collectedAt as unknown as string).getTime()).filter(Number.isFinite);
        if (collectedTimes.length === 0) return;
        currentProjectionByModel.set(modelName, {
          rowCount: rows.length,
          collectedAtMs: Math.min(...collectedTimes),
          complete: isCompleteStoredHourlyProjection({ rows, expectedValidTimes: expectedProjectionTimes, requiredValueFields: requiredProjectionFields }),
        });
      });
      const getCurrentProjectionSummary = (modelName: string) => {
        const projection = currentProjectionByModel.get(modelName);
        return projection ? {
          rowCount: projection.rowCount,
          collectedAtMs: projection.collectedAtMs,
          ageMs: Math.max(0, projectionMeasuredAt - projection.collectedAtMs),
          complete: projection.complete,
        } : null;
      };
      const latestCollection = recentCollections[0] ?? null;
      const recentForecastRuns = recentJobs.map((job) => ({
        status: getForecastRunDisplayStatus(job),
        startedAt: job.startedAt,
        collectedAt: job.completedAt ?? job.startedAt,
        durationMs: job.completedAt && job.startedAt
          ? Math.max(0, job.completedAt.getTime() - job.startedAt.getTime())
          : null,
        locationsProcessed: job.servicesCollected ?? 0,
        dailyModelsCollected: job.dailyModelsCollected ?? 0,
        dailyModelsExpected: job.dailyModelsExpected ?? 0,
        hourlyModelsCollected: job.hourlyModelsCollected ?? 0,
        hourlyModelsExpected: job.hourlyModelsExpected ?? 0,
        errorMessage: job.errorMessage,
      }));
      const latestForecastJob = recentForecastRuns[0] ?? null;
      const cadence = getFavoritesForecastCadence();
      const activeForecastHours = getActiveParisForecastHours();
      const scheduleLabel = getFavoritesForecastScheduleLabel();
      // Le dernier état de couverture par modèle vient du snapshot spécifique
      // au lieu; les nouveaux jobs gardent aussi leurs compteurs propres au lot.
      const lastForecastCoverage = recentCollections.find((collection) => collection.status !== "failed") ?? null;
      const lastPhysicalCollection = physicalTraces.find((trace) => trace.status !== "failed") ?? null;
      const hourlyHistory = buildRecentPhysicalSnapshotSlots(physicalTraces);
      const consecutiveTechnicalFailures = hourlyHistory.reduce((count, trace) => {
        if (count === -1) return -1;
        return trace.status === "failed" ? count + 1 : -1;
      }, 0);
      const technicalFailureStreak = consecutiveTechnicalFailures === -1 ? 0 : consecutiveTechnicalFailures;
      const noQualifiedStationSlots = hourlyHistory
        .filter((trace) => trace.status === "no_station")
        .slice(0, 3)
        .map((trace) => ({ date: trace.date, hour: trace.hour, attempts: trace.attempts, reason: trace.reason }));
      const missingSnapshotSlots = hourlyHistory.filter((trace) => trace.status === "missing").length;
      const expectedModels = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
      const expectedHourlyModels = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
      const dailyMissingModels = latestCollection ? getMissingModelNames(latestCollection.dailyMissingModels) : [];
      const hourlyMissingModels = latestCollection ? getMissingModelNames(latestCollection.hourlyMissingModels) : [];
      const dailyCollectedModels = latestCollection ? getCollectedModelNames(expectedModels, dailyMissingModels) : [];
      const hourlyCollectedModels = latestCollection ? getCollectedModelNames(expectedHourlyModels, hourlyMissingModels) : [];
      const bestMatchAudit = latestHourlyModelCollection.results.find((result) => result.modelName === "best_match");
      const dailyCoverageRecords = Array.isArray(latestCollection?.dailyVariableCoverage)
        ? latestCollection.dailyVariableCoverage as Array<Record<string, unknown>>
        : [];
      const bestMatchDailyAudit = dailyCoverageRecords.find((record) => record.modelName === "Open-Meteo") ?? null;
      const flowStatuses = buildForecastFlowStatuses({
        expectedModels,
        dailyCollectedModels,
        hourlyCollectedModels,
        collectedAt: latestCollection?.collectedAt ?? null,
      });

      return {
        scheduledAt: cadence === "every-4-hours" ? "toutes les 4 h" : "05:00",
        scheduledTimes: scheduleLabel,
        forecastCadence: cadence,
        scheduleTimeZone: "Europe/Paris",
        nextForecastRun: getNextParisForecastRun(new Date(), activeForecastHours).toISOString(),
        requiredHeartbeatCronUtc: cadence === "every-4-hours" ? getRequiredFavoritesForecastHeartbeatCron() : null,
        scheduleManagedExternally: true,
        scheduleCoverage: cadence === "every-4-hours"
          ? `Mode applicatif 4 h actif : ${scheduleLabel} heure de Paris. Le Heartbeat externe doit utiliser ${getRequiredFavoritesForecastHeartbeatCron()} UTC et être mis à jour séparément; son état live n’est pas vérifiable depuis ce dépôt. Les appels hors créneaux parisiens autorisés sont ignorés.`
          : "Override explicite en mode quotidien 05:00 Europe/Paris. Le Heartbeat est configuré hors dépôt; retirer cet override et utiliser la cadence UTC documentée après déploiement pour activer les six créneaux.",
        lastForecastRun: latestForecastJob ? {
          status: latestForecastJob.status,
          startedAt: latestForecastJob.startedAt,
          collectedAt: latestForecastJob.collectedAt,
          durationMs: latestForecastJob.durationMs,
          servicesCollected: latestForecastJob.locationsProcessed,
          errorMessage: latestForecastJob.errorMessage,
        } : null,
        recentForecastRuns,
        expectedModels,
        expectedHourlyModels,
        hourlyModelCollectionAvailable: latestHourlyModelCollection.available,
        hourlyModelCollection: latestHourlyModelCollection.results.map((result) => ({
          model: result.modelName === "best_match" ? "Open-Meteo" : result.modelName,
          modelId: result.modelId,
          isOfficialModel: result.isOfficialModel === 1,
          status: result.status,
          requestAttempts: result.requestAttempts,
          hoursReceived: result.hoursReceived,
          valuesReceived: result.valuesReceived,
          expectedValueCount: result.expectedValueCount,
          archiveRowsWritten: result.archiveRowsWritten,
          projectionRowsWritten: result.projectionRowsWritten,
          currentProjection: getCurrentProjectionSummary(result.modelName),
          variableCoverage: (() => {
            const currentProjection = getCurrentProjectionSummary(result.modelName);
            return result.variableCoverage && typeof result.variableCoverage === "object"
              ? { ...(result.variableCoverage as Record<string, unknown>), currentProjection }
              : result.variableCoverage ?? null;
          })(),
          maximumDocumentedDays: MODEL_FORECAST_HORIZONS[result.modelName]?.maximumDocumentedDays ?? null,
          horizonSourceUrl: MODEL_FORECAST_HORIZONS[result.modelName]?.sourceUrl ?? null,
          errorCode: result.errorCode,
          attemptedAt: result.attemptedAt,
          completedAt: result.completedAt,
        })),
        providerRunSupport: PROVIDER_RUN_MODEL_CAPABILITIES.map((capability) => ({
          model: capability.modelName,
          forecastModelId: capability.forecastModelId,
          openMeteoModelId: capability.openMeteoModelId,
          appIdMatchesDocumentedId: capability.appIdMatchesDocumentedId,
          singleRunModelId: capability.singleRunModelId,
          singleRunEndpointSupportedForDocumentedId: capability.singleRunEndpointSupportedForDocumentedId,
          metadataMappingVerified: capability.metadataMappingVerified,
          maximumDocumentedForecastDays: capability.maximumDocumentedForecastDays,
          horizonDescription: capability.horizonDescription,
          documentedCalibrationVariables: capability.documentedCalibrationVariables,
          modelDocumentationUrl: capability.modelDocumentationUrl,
          singleRunsDocumentationUrl: capability.singleRunsDocumentationUrl,
          captureUnavailableReason: capability.captureUnavailableReason,
        })),
        providerRunCollectionAvailable: providerRunCollection.available,
        providerRunCollection: providerRunCollection.results.map((result) => ({
          model: result.modelName,
          modelId: result.modelId,
          status: result.status,
          reasonCode: result.reasonCode,
          leadBasis: result.leadBasis,
          metadataHttpStatus: result.metadataHttpStatus,
          metadataAvailableAt: result.metadataAvailableAt,
          providerRunAt: result.providerRunAt,
          requestStartedAt: result.requestStartedAt,
          availableAt: result.availableAt,
          responseStatus: result.responseStatus,
          collectionLatencyMilliseconds: result.collectionLatencyMilliseconds,
          valuesStored: result.valuesStored,
          minimumForecastLeadMilliseconds: result.minimumForecastLeadMilliseconds,
          maximumForecastLeadMilliseconds: result.maximumForecastLeadMilliseconds,
          capturedAt: result.capturedAt,
        })),
        flowStatuses,
        bestMatchReference: {
          model: "Open-Meteo · Best Match",
          daily: bestMatchDailyAudit,
          hourly: bestMatchAudit ? {
            status: bestMatchAudit.status,
            requestAttempts: bestMatchAudit.requestAttempts,
            hoursReceived: bestMatchAudit.hoursReceived,
            archiveRowsWritten: bestMatchAudit.archiveRowsWritten,
            variableCoverage: bestMatchAudit.variableCoverage ?? null,
          } : null,
        },
        lastForecastSuccess: lastForecastCoverage ? {
          status: lastForecastCoverage.status,
          collectedAt: lastForecastCoverage.collectedAt,
          dailyModelCount: lastForecastCoverage.dailyModelCount,
          hourlyModelCount: lastForecastCoverage.hourlyModelCount,
        } : null,
        lastPhysicalCollection: lastPhysicalCollection ? {
          status: lastPhysicalCollection.status,
          date: lastPhysicalCollection.date,
          hour: lastPhysicalCollection.hour,
          attempts: lastPhysicalCollection.attempts,
          stationCount: lastPhysicalCollection.stationCount,
          reason: lastPhysicalCollection.reason,
        } : null,
        hourlyHistory,
        technicalFailureStreak,
        noQualifiedStationSlots,
        missingSnapshotSlots,
        snapshot: latestCollection ? {
          status: latestCollection.status,
          collectedAt: latestCollection.collectedAt,
          dailyModelCount: latestCollection.dailyModelCount,
          hourlyModelCount: latestCollection.hourlyModelCount,
          dailyCollectedModels,
          hourlyCollectedModels,
          dailyMissingModels,
          hourlyMissingModels,
          dailyVariableCoverage: latestCollection.dailyVariableCoverage ?? null,
        } : null,
      };
    }),

  /** Historique filtrable des comparaisons physiques de production, protégé dans son sous-routeur. */
  dailyPhysicalComparisons: dailyPhysicalComparisonsRouter,

  /** Rapports administrateur des nowcastings locaux, indépendants de P1–P8. */
  getLocalNowcastingReports: adminProcedure
    .input(z.object({
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      lookbackDays: z.number().int().min(1).max(30).default(7),
    }).optional())
    .query(async ({ input }) => {
      const locationKey = input?.lat != null && input?.lon != null
        ? makeLocationKey(input.lat, input.lon)
        : undefined;
      const lookbackDays = input?.lookbackDays ?? 7;
      return {
        temperature: await buildLocalTemperatureNowcastingReport(locationKey, lookbackDays),
        precipitation: await buildLocalPrecipitationNowcastingReport(locationKey, lookbackDays),
      };
    }),

  /** Diagnostics éphémères des appels fournisseurs, sans persistance en base. */
  getProviderDiagnostics: publicProcedure
    .query(() => getWeatherProviderDiagnostics()),

  /** Qualité de l’air et éphémérides réelles pour le lieu actif. */
  getEnvironmentalSnapshot: publicProcedure
    .input(requiredCoordinatesSchema)
    .query(({ input }) => getEnvironmentalSnapshot({ lat: input.lat, lon: input.lon })),

  /** Coordonnées apparentes actualisées des astres pour l'arche Soleil & Lune. */
  getApparentAstronomyPosition: publicProcedure
    .input(requiredCoordinatesSchema)
    .query(({ input }) => getApparentAstronomyPosition({ lat: input.lat, lon: input.lon })),

  /** Profil de relief local pour la superposition terrain de l'arche. */
  getTerrainHorizonProfile: publicProcedure
    .input(requiredCoordinatesSchema)
    .query(({ input }) => getTerrainHorizonProfile({ lat: input.lat, lon: input.lon })),

  /** Circonstances calculées pour une position choisie sur la carte d’éclipse. */
  getEclipseCircumstances: publicProcedure
    .input(z.object({
      eventId: z.enum(["lunar_partial_2026_08_28", "solar_partial_2027_08_02"]),
      lat: latitudeSchema,
      lon: longitudeSchema,
    }))
    .query(({ input }) => getLocalEclipseCircumstances(input)),

  /**
   * Detailed forecast page: 48h hourly + 15-day daily + regime and raw evidence
   */
  getDetailedForecast: publicProcedure
    .input(detailedForecastInputSchema.optional())
    .query(async ({ input, signal }) => {
      const deadlineAt = Date.now() + 7_200;
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
      const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : undefined;
      const locKey = input?.lat != null && input?.lon != null ? makeLocationKey(input.lat, input.lon) : "default";
      const includeExtendedPeriods = input?.includeExtendedPeriods !== false;

      const { snapshot, periodHours, metadata: [meteoAI, observation, recentForecasts], hourlyFallback } = await loadDetailedForecastSources({
        loadSnapshot: async () => {
          const [snapshot, daily] = await Promise.all([
            resolveOfficialWeatherSnapshot(coords ?? HONDEGHEM, { hourlyForecastDays: includeExtendedPeriods ? 16 : 2, includeDaily: false, signal }),
            includeExtendedPeriods ? resolveOfficialDailyForecastSnapshot(coords ?? HONDEGHEM, { signal }) : Promise.resolve(null),
          ]);
          return daily ? { ...snapshot, daily: daily.daily, modelsUsed: daily.modelsUsed, dailyStatus: daily.dailyStatus } : { ...snapshot, dailyStatus: "not_requested" as const };
        },
        includeExtendedPeriods,
        loadExtendedPeriods: () => withDeadline(collectHourlyForecast(today, coords, 16, { signal, timeoutMs: 7_000 }), 7_000, []),
        loadMetadata: () => withDeadline(Promise.all([
          getMeteoAIForecastByDate(today, locKey).then(value => value ?? null),
          getObservationByDate(today, locKey).then(value => value ?? null),
          getLatestMeteoAIForecasts(1, locKey),
        ]), 2_000, [null, null, []]),
        loadHourlyFallback: (officialHours) => fillOpenWeatherHourlyGaps({
          apiKey: ENV.openWeatherMapApiKey,
          lat: (coords ?? HONDEGHEM).lat,
          lon: (coords ?? HONDEGHEM).lon,
          hours: officialHours,
          fetchImpl: (url, init) => {
            const remainingMs = deadlineAt - Date.now();
            if (remainingMs <= 0) return Promise.reject(new DOMException("Forecast response budget exhausted", "AbortError"));
            return fetchWeather(url, { ...init, signal }, { timeoutMs: remainingMs, attempts: 1 });
          },
        }),
      });
      const officialHours = snapshot.hourly;
      // Historical weighting traces remain available in Prévisions. They are
      // not rendered in Dashboard, where omitting them removes several MB from
      // the mobile response without changing forecasts or model agreement.
      const hours = includeExtendedPeriods
        ? hourlyFallback.hours
        : projectHourlyForecastForDashboard(hourlyFallback.hours);
      const days = snapshot.daily;
      const modelsUsed = snapshot.modelsUsed;
      const dailyFallbackSource = meteoAI ?? recentForecasts[0];
      const dailyFallbackTrace = getPersistedForecastTrace(dailyFallbackSource?.weights, dailyFallbackSource?.computedAt);
      const dailyFallback = hours.length === 0
        ? buildDatedDailyFusionFallback(dailyFallbackSource, dailyFallbackTrace?.precipitationConsensus ?? null)
        : null;
      const officialRegime = buildOperationalRegime(meteoAI, observation, getCurrentHourlyRegimeInput(officialHours, getParisHour(), new Date(snapshot.computedAt), "Prévision horaire officielle · 7 modèles", snapshot.hourlyComputedAt));
      const activeForecast = officialHours[findActiveHourlyForecastIndex(officialHours, new Date(snapshot.computedAt).getTime())];
      const nextRegimeChange = officialRegime.primary
        ? findNextHourlyRegimeChange(officialHours, `${getParisHour()}:00`, officialRegime.primary.id, activeForecast?.validAt)
        : null;

      const trace = getPersistedForecastTrace(meteoAI?.weights, meteoAI?.computedAt);

      return {
        today: snapshot.weatherDate,
        currentSnapshot: snapshot.currentSnapshot,
        officialSnapshot: { validAt: snapshot.validAt, computedAt: snapshot.computedAt, hourlyComputedAt: snapshot.hourlyComputedAt, sourceKind: snapshot.sourceKind, source: snapshot.source, hourlyWeighting: snapshot.hourlyWeighting, hourlyStatus: snapshot.hourlyStatus, snapshotStatus: snapshot.snapshotStatus, staleReason: snapshot.staleReason },
        dailyStatus: snapshot.dailyStatus,
        hours,
        ...(includeExtendedPeriods ? {
          hourlyFallbackDiagnostics: hourlyFallback.diagnostics,
          periodHours,
          periodHoursSource: "open_meteo_best_match_reference" as const,
        } : {}),
        days,
        modelsUsed,
        dailyFallback,
        regime: {
          primary: officialRegime.primary,
          active: officialRegime.active,
          confidence: officialRegime.confidence,
          description: officialRegime.description,
          snapshotComputedAt: officialRegime.snapshotComputedAt,
          source: officialRegime.source,
          sourceLabel: officialRegime.sourceLabel,
          sourceUpdatedAt: officialRegime.sourceUpdatedAt,
          sourceAgeMinutes: officialRegime.sourceAgeMinutes,
          dataCoverage: officialRegime.dataCoverage,
          inputDiagnostics: officialRegime.inputDiagnostics,
        },
        nextRegimeChange,
        trace: trace
          ? { ...trace, snapshotComputedAt: meteoAI?.computedAt?.toISOString?.() ?? null }
          : {
              available: false,
              issuedAt: meteoAI?.computedAt?.toISOString?.() ?? null,
              message: "La traçabilité détaillée sera disponible après la prochaine collecte officielle.",
            },
      };
    }),

  /**
   * Admin: Manual trigger for forecast collection (for testing)
   */
  triggerCollection: adminProcedure
    .input(
      z.object({
        type: z.enum(["forecast", "observation"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const targetDate = input.date || getTodayParis();

      if (input.type === "forecast") {
        const { HONDEGHEM, collectExpertForecastsWithDiagnostics } = await import("../weatherServices");
        const locationKey = makeLocationKey(HONDEGHEM.lat, HONDEGHEM.lon);
        const dailyCollection = await collectExpertForecastsWithDiagnostics(targetDate);
        const expertData = dailyCollection.forecasts;
        const forecastRows = expertData.map((f) => ({
          locationKey,
          date: targetDate,
          serviceName: f.serviceName,
          serviceCategory: f.serviceCategory,
          tempMax: f.tempMax,
          tempMin: f.tempMin,
          precipitation: f.precipitation,
          windSpeed: f.windSpeed,
          windGust: f.windGust,
          humidity: f.humidity,
          cloudCover: f.cloudCover,
          condition: f.condition,
          rawData: f.rawData as any,
        }));
        await insertForecasts(forecastRows);
        const issuedAt = Date.now();

        // Compute MeteoAI
        await insertForecastRuns(buildForecastRunArchiveRows(expertData, locationKey, targetDate, issuedAt));
        const officialRuns = expertData.filter((forecast) => forecast.serviceName !== "Best Match");
        const fusionEvidence = await getDailyFusionPerformanceEvidence(locationKey, targetDate, officialRuns.flatMap((forecast) => forecast.availableAt == null ? [] : [forecast.availableAt]));
        const meteoAI = computeOfficialDailyForecast(expertData, {
          locationKey,
          targetDate,
          issuedAt,
          referenceAt: issuedAt,
          evidenceStoreAvailable: fusionEvidence.available,
          evidence: fusionEvidence.evidence,
          availabilityReasonByModel: dailyCollection.availabilityReasonByModel,
        });
        const condition = null;

        await upsertMeteoAIForecast({
          locationKey,
          date: targetDate,
          tempMax: meteoAI.tempMax,
          tempMin: meteoAI.tempMin,
          precipitation: meteoAI.precipitation,
          windSpeed: meteoAI.windSpeed,
          condition,
          stabilityLabel: legacyStabilityLabelForStorage(expertData),
          weights: { version: 2, weightByService: meteoAI.weights, trace: meteoAI.trace } as any,
          explanation: meteoAI.coreCalibrationComplete
            ? "Prévision calibrée à partir de preuves physiques récentes par modèle, variable et horizon."
            : `${meteoAI.methodNote} Les valeurs réellement disponibles restent publiées avec leur statut robuste ou partiellement calibré; seule une absence de donnée bloque un champ.`,
        });
        const fusionAvailableAt = Date.now();
        const fusionArchive = buildMeteoAIDailyFusionArchiveRun({
          locationKey,
          targetDate,
          availableAt: fusionAvailableAt,
          forecast: { ...meteoAI, condition, weights: meteoAI.weights, trace: meteoAI.trace },
        });
        if (fusionArchive) await insertMeteoAIDailyFusionRun(fusionArchive);

        return { success: true, collected: forecastRows.length, date: targetDate };
      } else {
        // Observation collection
        const obsData = await collectObservations(targetDate);
        if (!obsData) return { success: false, error: "No observation data available" };

        await insertObservation({
          date: obsData.date,
          tempMax: obsData.tempMax,
          tempMin: obsData.tempMin,
          precipitation: obsData.precipitation,
          windSpeed: obsData.windSpeed,
          windGust: obsData.windGust,
          humidity: obsData.humidity,
          cloudCover: obsData.cloudCover,
          condition: obsData.condition,
          source: obsData.source,
          provenanceType: obsData.provenanceType,
          isQualified: obsData.isQualified,
          rawData: obsData.rawData as any,
        });

        if (!isOperationalObservation(obsData)) {
          return { success: true, date: targetDate, scoreSkipped: true, reason: "Référence de modèle archivée : aucune observation physique qualifiée disponible" };
        }

        // Compute reliability scores
        const dayForecasts = await getForecastsByDate(targetDate);
        const observation = await getObservationByDate(targetDate);

        if (dayForecasts.length > 0 && observation) {
          // Detect regime from actual observation
          const regimeInfo = detectWeatherRegime({
            precipitation: observation.precipitation,
            windSpeed: observation.windSpeed,
            tempMax: observation.tempMax,
            tempMin: observation.tempMin,
            humidity: observation.humidity ?? null,
            cloudCover: observation.cloudCover ?? null,
            visibilityKm: null,
          });

          const scoreRows = dayForecasts.map((f) => {
            const score = calculateReliabilityScore(
              [{ tempMax: f.tempMax, tempMin: f.tempMin, precipitation: f.precipitation, windSpeed: f.windSpeed }],
              [{ tempMax: observation.tempMax, tempMin: observation.tempMin, precipitation: observation.precipitation, windSpeed: observation.windSpeed, humidity: observation.humidity ?? null, cloudCover: observation.cloudCover ?? null, visibilityKm: null }],
              regimeInfo?.regime ?? undefined
            );
            const d = score.dimensions;
            return {
              date: targetDate,
              serviceName: f.serviceName,
              // Legacy flat fields
              maeTemp: score.maeTemp,
              maePrecip: score.maePrecip,
              maeWind: score.maeWind,
              rmseTemp: score.rmseTemp,
              rmsePrecip: score.rmsePrecip,
              rmseWind: score.rmseWind,
              biasTemp: score.biasTemp,
              biasPrecip: score.biasPrecip,
              biasWind: score.biasWind,
              conditionAccuracy: score.conditionAccuracy,
              weightedScore: score.weightedScore,
              regime: score.regime,
              // 🌡️ Temperature dimension
              tempScore: d.temperature.score,
              tempMaxError: d.temperature.maxError,
              // 🌧️ Precipitation dimension
              precipScore: d.precipitation.score,
              precipPod: d.precipitation.pod,
              precipFar: d.precipitation.far,
              precipCsi: d.precipitation.csi,
              precipFalsePositives: d.precipitation.falsePositives,
              precipFalseNegatives: d.precipitation.falseNegatives,
              // 💨 Wind dimension
              windScore: d.wind.score,
              windMaeGusts: d.wind.maeGusts,
              // ☁️ Condition dimension
              condScore: d.condition.score,
              condConcordance: d.condition.concordance,
              condMaeCloud: d.condition.maeCloudCover,
            };
          });
          await insertReliabilityScores(scoreRows);
        }

        return { success: true, date: targetDate };
      }
    }),

  /**
   * Get collection job history
   */
  getJobs: adminProcedure.query(async () => {
    return getRecentCollectionJobs(20);
  }),

  /** Relance ponctuelle réservée à l’utilisateur propriétaire du lieu favori. */
  refreshManualFusion: protectedProcedure
    .input(z.object({ favoriteId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const favorite = (await getFavoriteLocations(ctx.user.id)).find((entry) => entry.id === input.favoriteId);
      if (!favorite) throw new Error("Ce lieu favori est introuvable ou ne vous appartient pas.");
      return refreshManualFusionForFavorite(favorite);
    }),

  /** Relance ponctuelle et additive des relevés physiques du lieu possédé par l’utilisateur. */
  refreshPhysicalStationSnapshots: protectedProcedure
    .input(z.object({ favoriteId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const favorite = (await getFavoriteLocations(ctx.user.id)).find((entry) => entry.id === input.favoriteId);
      if (!favorite) throw new Error("Ce lieu favori est introuvable ou ne vous appartient pas.");
      const result = await collectPhysicalObservationSnapshotsForFavorites([favorite], "manual");
      // La relance vient d'écrire de nouveaux relevés qualifiés : le cache de
      // l'aperçu ne doit pas masquer ces preuves après l'invalidation client.
      clearStationReliabilityOverviewCache();
      return result;
    }),

  /** Read-only view of the last scheduled hourly-comparison diagnostic cycle. */
  getHourlyComparisonDiagnostics: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
      const lat = input?.lat ?? HONDEGHEM.lat;
      const lon = input?.lon ?? HONDEGHEM.lon;
      return getLatestHourlyComparisonDiagnosticSnapshot(makeLocationKey(lat, lon));
    }),

  /**
   * Weather AI Lab — full transparency data for the AI Lab page
   */
  getAILab: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
    const today = getTodayParis();
    const coords = input?.lat != null && input?.lon != null ? { lat: input.lat, lon: input.lon } : null;
    const locationKey = coords ? makeLocationKey(coords.lat, coords.lon) : undefined;
    const observation = locationKey
      ? await getObservationByDate(today, locationKey)
      : await getObservationByDate(today);
    const currentMeteoAI = locationKey
      ? await getMeteoAIForecastByDate(today, locationKey)
      : await getMeteoAIForecastByDate(today);
    const archivedMeteoAI = !currentMeteoAI && locationKey
      ? (await getLatestMeteoAIForecasts(1, locationKey))[0] ?? null
      : null;
    const persistedMeteoAI = currentMeteoAI ?? archivedMeteoAI;
    const liveForecasts: LiveModelForecast[] = !persistedMeteoAI && coords
      ? await collectExpertForecasts(today, coords)
      : [];
    const liveMeteoAI = !persistedMeteoAI
      ? buildLiveAILabSnapshot(today, liveForecasts)
      : null;
    const meteoAI = persistedMeteoAI ?? liveMeteoAI;
    const snapshotStatus = currentMeteoAI ? "current" : archivedMeteoAI ? "archived" : liveMeteoAI ? "live" : "unavailable";
    const snapshotDate = meteoAI?.date ?? null;
    const forecasts = liveForecasts.length > 0
      ? liveForecasts
      : snapshotDate
      ? (locationKey ? await getForecastsByDate(snapshotDate, locationKey) : await getForecastsByDate(snapshotDate))
      : (locationKey ? await getForecastsByDate(today, locationKey) : await getForecastsByDate(today));
    const jobs = await getRecentCollectionJobs(5);

    // 1. Régime opérationnel partagé avec le Dashboard. Une observation ne peut
    // remplacer la fusion officielle que si elle est plus récente, fraîche et
    // couvre notamment la nébulosité.
    const officialSnapshot = await resolveOfficialWeatherSnapshot(coords ?? HONDEGHEM);
    const liveHours = officialSnapshot.hourly;
    const operationalRegime = buildOperationalRegime(currentMeteoAI, observation, getCurrentHourlyRegimeInput(liveHours, getParisHour(), new Date(officialSnapshot.computedAt), "Prévision horaire officielle · 7 modèles", officialSnapshot.hourlyComputedAt));
    const regime = operationalRegime.primary?.id ?? null;
    const regimeDef = operationalRegime.primary;
    const weights = operationalRegime.blendedWeights;

    // La trace persistée est la source de vérité des modèles réellement
    // contributeurs. Les prévisions archivées ne sont pas présentées comme
    // appliquées si elles n'apparaissent pas dans cette trace.
    const officialForecastNames = new Set<string>(OFFICIAL_HOURLY_MODELS.map((model) => model.name));
    const persistedTrace = getPersistedForecastTrace(meteoAI?.weights, meteoAI?.computedAt);
    const trace = filterForecastTraceToModelNames(persistedTrace, officialForecastNames);
    const appliedModelWeights = buildAppliedModelWeights(trace);
    const contributingNames = new Set(appliedModelWeights.map((model) => model.name));
    const appliedForecasts = forecasts.filter((forecast) => officialForecastNames.has(forecast.serviceName)
      && (contributingNames.size === 0 || contributingNames.has(forecast.serviceName)));
    const modelIndicator = buildModelIndicator(trace);

    // Détails des prévisions quotidiennes persistées.
    const allServicesList = WEATHER_SERVICES.expert;
    const modelDetails = appliedForecasts.map(f => {
      const service = allServicesList.find((s: { name: string }) => s.name === f.serviceName);
      const applied = appliedModelWeights.find((model) => model.name === f.serviceName);
      return {
        name: f.serviceName,
        label: service?.name ?? f.serviceName,
        tempMax: f.tempMax,
        tempMin: f.tempMin,
        precipitation: f.precipitation,
        windSpeed: f.windSpeed,
        cloudCover: f.cloudCover,
        condition: f.condition,
        averageWeight: applied?.averageWeight ?? null,
      };
    });

    // L'accord décrit la dispersion des modèles indépendants reçus. Best Match
    // et les autres agrégateurs sont exclus; une valeur absente ne devient pas 0.
    const independentModelNames = WEATHER_SERVICES.expert
      .filter((model) => model.modelId !== "best_match")
      .map((model) => model.name);
    const independentForecasts = forecasts.filter((forecast) => independentModelNames.includes(forecast.serviceName));
    const modelAgreement = summarizeDailyModelAgreement(independentForecasts.map((forecast) => ({
      modelName: forecast.serviceName,
      tempMax: forecast.tempMax,
      tempMin: forecast.tempMin,
      precipitation: forecast.precipitation,
      windSpeed: forecast.windSpeed,
      windGust: forecast.windGust,
      humidity: forecast.humidity,
      cloudCover: forecast.cloudCover,
    })), independentModelNames, null);
    const precipitationConsensus = summarizePrecipitationModels(
      independentForecasts.map((forecast) => ({ modelName: forecast.serviceName, amountMm: forecast.precipitation })),
      independentModelNames,
    );
    const divergence = {
      tempRange: modelAgreement.tempMax.range,
      tempMax: modelAgreement.tempMax,
      tempMin: modelAgreement.tempMin,
      precipRange: modelAgreement.precipitation.range,
      precipitation: modelAgreement.precipitation,
      windRange: modelAgreement.windSpeed.range,
      windSpeed: modelAgreement.windSpeed,
      windGust: modelAgreement.windGust,
      expectedModelCount: modelAgreement.expectedModelCount,
    };

    // 7. AI Analysis text
    const activeForecasts = forecasts.filter((forecast) => forecast.serviceCategory === "expert");
    const aggregatorCount = activeForecasts.some((forecast) => forecast.serviceName === "Open-Meteo") ? 1 : 0;
    const namedModelCount = Math.max(0, activeForecasts.length - aggregatorCount);
    const sourceComposition = aggregatorCount > 0
      ? `${namedModelCount} modèle(s) numérique(s) + 1 agrégateur Best Match`
      : `${namedModelCount} modèle(s) numérique(s)`;
    const aiAnalysis = [
      `MeteoAI synthétise ${sourceComposition} pour ${formatAILabLocationLabel(coords)}.`,
      modelAgreement.tempMax.range == null
        ? `Dispersion Tmax indisponible : ${modelAgreement.tempMax.availableModelCount}/${modelAgreement.expectedModelCount} modèles nommés ont une valeur exploitable (au moins deux sont nécessaires pour une étendue).`
        : `L’étendue Tmax entre modèles nommés est de ${modelAgreement.tempMax.range.toFixed(1)} °C (${modelAgreement.tempMax.availableModelCount}/${modelAgreement.expectedModelCount} disponibles).`,
      regimeDef && weights
        ? `Le régime détecté est "${regimeDef.label}" ${regimeDef.emoji} — les précipitations sont pondérées à ${Math.round(weights.precip * 100)}%, la température à ${Math.round(weights.temp * 100)}%.`
        : "Régime indisponible : des champs météo requis sont absents ou invalides; aucune pondération de régime n’est affichée.",
      "La fiabilité historique reste une mesure distincte, disponible uniquement par modèle, variable et horizon lorsque les preuves qualifiées atteignent leurs seuils.",
    ].join(" ");

    const officialPrecipitationSummary = meteoAI?.precipitation == null
      ? "indisponibles"
      : `${meteoAI.precipitation} mm`;

    // 9. Replay steps (7 étapes de la synthèse IA)
    const replaySteps = [
      { step: 1, title: "Collecte des flux", description: `${activeForecasts.length} flux collectés lors du dernier batch planifié via Open-Meteo API (${sourceComposition})`, icon: "📡" },
      { step: 2, title: "Détection du régime", description: regimeDef && weights ? `Régime "${regimeDef.label}" détecté — poids contextuels appliqués` : "Données requises absentes ou invalides — régime et poids non calculés", icon: "🔍" },
      { step: 3, title: "Mesures par variable", description: "Les étendues restent en unités physiques et chaque effectif est indiqué séparément.", icon: "📐" },
      { step: 4, title: "Pondération de fusion", description: "Les poids du régime sont des paramètres de calcul, pas une probabilité ni une note de fiabilité.", icon: "⚖️" },
      { step: 5, title: "Accord inter-modèles", description: modelAgreement.tempMax.range == null ? "Étendue Tmax indisponible : effectif inférieur à deux ou valeurs manquantes." : `Étendue Tmax : ${modelAgreement.tempMax.range.toFixed(1)} °C (${modelAgreement.tempMax.availableModelCount} modèles).`, icon: "📊" },
      { step: 6, title: "Synthèse MeteoAI", description: `Prévision finale : ${meteoAI?.tempMax ?? "—"}°C max, ${meteoAI?.tempMin ?? "—"}°C min, ${officialPrecipitationSummary}`, icon: "🤖" },
      { step: 7, title: "Fiabilité historique", description: "Aucun score global : MAE, RMSE, biais, effectifs et récence doivent rester séparés par modèle × variable × horizon.", icon: "✅" },
    ];

    // 10. Sources with freshness info
    const lastForecastJob = jobs.find(j => j.jobType === "forecast");
    const lastObsJob = jobs.find(j => j.jobType === "observation");

    const sources = [
      { name: "Open-Meteo API", type: "7 modèles + 1 agrégateur", models: WEATHER_SERVICES.expert.map((model) => model.name), updateFrequency: "Selon le modèle", lastSync: lastForecastJob?.startedAt ? new Date(lastForecastJob.startedAt).toISOString() : null, quality: "Flux de prévision, pas observations" },
      { name: "Modèles en validation", type: "Prévisions candidates", models: VALIDATION_WEATHER_MODELS.map((model) => model.name), updateFrequency: "Collecte quotidienne", lastSync: lastForecastJob?.startedAt ? new Date(lastForecastJob.startedAt).toISOString() : null, quality: "Hors fusion officielle" },
      { name: "Stations physiques", type: "Observations locales", models: [], updateFrequency: "Selon la dernière collecte", lastSync: lastObsJob?.startedAt ? new Date(lastObsJob.startedAt).toISOString() : null, quality: "Netatmo actif ; autres sources seulement si réellement collectées" },
      { name: "Preuves de fiabilité", type: "Comparaisons qualifiées", models: [], updateFrequency: "Après observation physique", lastSync: lastObsJob?.startedAt ? new Date(lastObsJob.startedAt).toISOString() : null, quality: "Métriques brutes séparées; statut indisponible tant que le seuil propre au modèle, à la variable et à l’horizon n’est pas atteint" },
    ];
    const latestStationCollection = (await getStationCollectionSnapshots(locationKey ?? "default", 1))[0] ?? null;
    const activeModelNames = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
    const dailyMissingModels = latestStationCollection ? getMissingModelNames(latestStationCollection.dailyMissingModels) : [];
    const hourlyMissingModels = latestStationCollection ? getMissingModelNames(latestStationCollection.hourlyMissingModels) : [];

    return {
      date: today,
      regime,
      regimeStatus: operationalRegime.status,
      regimeLabel: regimeDef?.label ?? null,
      regimeEmoji: regimeDef?.emoji ?? null,
      regimeDescription: regimeDef?.description ?? operationalRegime.description,
      weights: weights ?? null,
      allRegimes: EXTENDED_REGIME_INFO,
      modelDetails,
      divergence,
      modelAgreement,
      precipitationConsensus,
      trace,
      modelIndicator,
      appliedModelWeights,
      officialForecast: {
        tempMax: meteoAI?.tempMax ?? null,
        tempMin: meteoAI?.tempMin ?? null,
        precipitation: meteoAI?.precipitation ?? null,
        windSpeed: meteoAI?.windSpeed ?? null,
        computedAt: meteoAI?.computedAt ?? null,
      },
      latestStationCollection: latestStationCollection ? {
        physicalStationCount: latestStationCollection.physicalStationCount,
        radiusKm: latestStationCollection.radiusKm,
        dailyModelCount: latestStationCollection.dailyModelCount,
        hourlyModelCount: latestStationCollection.hourlyModelCount,
        dailyMissingModels,
        hourlyMissingModels,
        dailyCollectedModels: getCollectedModelNames(activeModelNames, dailyMissingModels),
        hourlyCollectedModels: getCollectedModelNames(activeModelNames, hourlyMissingModels),
        dailyVariableCoverage: latestStationCollection.dailyVariableCoverage ?? null,
        status: latestStationCollection.status,
        collectedAt: latestStationCollection.collectedAt,
      } : null,
      aiAnalysis,
      replaySteps,
      sources,
      forecastComparison: buildAILabForecastComparisonReadModel(officialSnapshot, coords ?? HONDEGHEM),
      engineVersion: "MeteoAI v2.0 — Multi-Dimension",
      calculatedAt: meteoAI?.computedAt ?? null,
      snapshotStatus,
      snapshotDate,
      regimeSource: operationalRegime.source,
      regimeSourceLabel: operationalRegime.sourceLabel,
      regimeSourceUpdatedAt: operationalRegime.sourceUpdatedAt,
      regimeSourceAgeMinutes: operationalRegime.sourceAgeMinutes,
      regimeDataCoverage: operationalRegime.dataCoverage,
      modelsUsed: appliedModelWeights.length || modelDetails.length,
    };
  }),

  /** Couverture des observations physiques requise avant tout score qualifié. */
  getEvidenceStatus: publicProcedure
    .input(z.object({ lat: latitudeSchema.optional(), lon: longitudeSchema.optional() }))
    .query(async ({ input }) => {
      const lat = input.lat ?? HONDEGHEM.lat;
      const lon = input.lon ?? HONDEGHEM.lon;
      const evidence = await getQualifiedEvidenceStatus(makeLocationKey(lat, lon));
      return {
        ...evidence,
        requiredCoverageHours: 18,
        isEligible: evidence.coverageHours >= 18,
        evidenceTimeZone: "Europe/Paris",
        snapshotCadence: "Chaque heure à :20 UTC",
        dailyScoringSchedule: "22:30 UTC, sur la journée Europe/Paris précédente",
      };
    }),

  /**
   * Search nearby weather stations from all sources within a configurable radius.
   */
  searchStations: publicProcedure
    .input(z.object({
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      radiusKm: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const lat = input.lat ?? HONDEGHEM.lat;
      const lon = input.lon ?? HONDEGHEM.lon;
      const radiusKm = input.radiusKm;

      let netatmoStatus: import("../netatmoService").NetatmoAvailability = "not_connected";
      const [stationCollection, currentModelReferences] = await Promise.all([
        collectNearbyStationsWithDiagnostics(lat, lon, radiusKm, "Local", {
          netatmoUserId: ctx.user?.id,
          onNetatmoStatus: (status) => { netatmoStatus = status; },
        }),
        fetchCurrentModelReferences(lat, lon),
      ]);
      const stations = stationCollection.stations;
      const ranked = rankStations(stations);
      const physicalStations = getPhysicalActiveStations(ranked);
      const discoveredPhysicalStations = ranked.filter((station) => getStationSourceKind(station.source, station.stationId) === "physical");
      const excludedPhysicalStations = discoveredPhysicalStations.filter((station) => !station.isActive);
      // La synthèse locale reste strictement physique : seules les stations
      // officielles et Netatmo collectées participent à la fusion.
      const ultraResult = calculateUltraLocal(physicalStations, "local", lat, lon, null, null);
      const modelReferences = buildModelReferenceCoherence(
        currentModelReferences,
        physicalStations
          .map((station) => station.temperature)
          .filter((temperature): temperature is number => temperature !== null),
      );
      const groundTruth = {
        temperature: ultraResult.temperature,
        humidity: ultraResult.humidity,
        pressure: ultraResult.pressure,
        windSpeed: ultraResult.windSpeed,
        windGust: ultraResult.windGust,
        precipitation: ultraResult.precipitation,
        altitudeCorrection: ultraResult.altitudeCorrection,
        stationsUsed: ultraResult.stationsUsed.map(s => ({
          stationId: s.stationId,
          name: s.name,
          source: s.source,
          observedAt: s.observedAt,
          measurementTimes: s.measurementTimes,
          measurementAgeByField: s.measurementAgeByField,
          fieldWeights: s.fieldWeights,
          distanceKm: s.distanceKm,
          weight: s.weight,
          distanceWeight: s.distanceWeight,
          qualityWeight: s.qualityWeight,
          freshnessWeight: s.freshnessWeight,
          temperature: s.temperature,
          humidity: s.humidity,
          pressure: s.pressure,
          windSpeed: s.windSpeed,
          precipitation: s.precipitation,
        })),
        stationsIgnored: ultraResult.stationsIgnored.map(s => ({
          stationId: s.stationId,
          name: s.name,
          source: s.source,
          distanceKm: s.distanceKm,
          reason: s.reason,
        })),
        stationCount: ultraResult.stationCount,
        confidenceScore: ultraResult.confidenceScore,
      };

      return {
        lat,
        lon,
        radiusKm,
        stations: ranked.map(s => {
          return {
            stationId: s.stationId,
            source: s.source,
            sourceKind: getStationSourceKind(s.source, s.stationId),
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            altitude: s.altitude,
            distanceKm: s.distanceKm,
            temperature: s.temperature,
            humidity: s.humidity,
            pressure: s.pressure,
            windSpeed: s.windSpeed,
            windGust: s.windGust,
            windDirection: s.windDirection,
            precipitation: s.precipitation,
            updatedAt: s.updatedAt,
            measurementTimes: s.measurementTimes ?? null,
            measurementAgeByField: getStationMeasurementAgeStates(s.measurementTimes),
            reliabilityScore: s.reliabilityScore,
            updateFrequencyMin: s.updateFrequencyMin,
            dataAvailability: s.dataAvailability,
            isActive: s.isActive,
            exclusionReason: s.exclusionReason,
          };
        }),
        modelReferences,
        groundTruth,
        totalFound: stations.length,
        activeCount: physicalStations.length,
        ignoredCount: stations.filter(s => !s.isActive).length,
        physicalStationCount: physicalStations.length,
        physicalStationDiagnostics: {
          netatmoStatus,
          discoveredCount: discoveredPhysicalStations.length,
          activeCount: physicalStations.length,
          exclusionReasons: Array.from(new Set(excludedPhysicalStations.map((station) => station.exclusionReason).filter((reason): reason is string => Boolean(reason)))).slice(0, 3),
        },
        sourceDiagnostics: stationCollection.sourceDiagnostics,
        sourceDiagnosticsFromCache: stationCollection.cacheHit,
        referenceSourceCount: modelReferences.length,
        fetchedAt: new Date().toISOString(),
      };
    }),

  /**
   * Get ground truth for a location (weighted average from nearby stations).
   */
  getGroundTruth: publicProcedure
    .input(z.object({
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      radiusKm: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const lat = input.lat ?? HONDEGHEM.lat;
      const lon = input.lon ?? HONDEGHEM.lon;

      const stations = await collectNearbyStations(lat, lon, input.radiusKm);
      const ranked = rankStations(stations);
      // Unified engine — same as Mode Local in Dashboard
      const result = calculateUltraLocal(getPhysicalActiveStations(ranked), "local", lat, lon, null, null);
      return {
        temperature: result.temperature,
        humidity: result.humidity,
        pressure: result.pressure,
        windSpeed: result.windSpeed,
        windGust: result.windGust,
        precipitation: result.precipitation,
        altitudeCorrection: result.altitudeCorrection,
        stationsUsed: result.stationsUsed.map(s => ({
          stationId: s.stationId,
          name: s.name,
          source: s.source,
          observedAt: s.observedAt,
          measurementTimes: s.measurementTimes,
          measurementAgeByField: s.measurementAgeByField,
          fieldWeights: s.fieldWeights,
          distanceKm: s.distanceKm,
          weight: s.weight,
          distanceWeight: s.distanceWeight,
          qualityWeight: s.qualityWeight,
          freshnessWeight: s.freshnessWeight,
          temperature: s.temperature,
          humidity: s.humidity,
          pressure: s.pressure,
          windSpeed: s.windSpeed,
          precipitation: s.precipitation,
        })),
        stationsIgnored: result.stationsIgnored.map(s => ({
          stationId: s.stationId,
          name: s.name,
          source: s.source,
          distanceKm: s.distanceKm,
          reason: s.reason,
        })),
        stationCount: result.stationCount,
        confidenceScore: result.confidenceScore,
      };
    }),

  /**
   * Get ranking criteria explanation for a set of stations.
   */
  getStationRankingCriteria: publicProcedure.query(() => getStationRankingContract()),

  /**
   * Get full details for a single station by ID, including live data refresh.
   */
  getStationDetail: publicProcedure
    .input(z.object({
      stationId: z.string(),
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      radiusKm: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const lat = input.lat ?? HONDEGHEM.lat;
      const lon = input.lon ?? HONDEGHEM.lon;
      const stations = await collectNearbyStations(lat, lon, input.radiusKm);
      const station = stations.find(s => s.stationId === input.stationId);
      if (!station) return null;
      const ranked = rankStations(stations);
      // Unified engine — same as Mode Local in Dashboard
      const gt = calculateUltraLocal(getPhysicalActiveStations(ranked), "local", lat, lon, null, null);
      const used = gt.stationsUsed.find(s => s.stationId === input.stationId);
      return {
        ...station,
        groundTruthContribution: used ? {
          weight: used.weight,
          distanceWeight: used.distanceWeight,
          qualityWeight: used.qualityWeight,
          freshnessWeight: used.freshnessWeight,
          altitudeCorrection: gt.altitudeCorrection,
        } : null,
      };
    }),

  /**
   * Get lead-time scores (MAE/RMSE/biais par échéance) for a location.
   * Returns per-service, per-bucket (0-6h, 6-24h, 1-3d, 4-7d, 8-15d) averages.
   */
  getLeadTimeScores: publicProcedure
    .input(z.object({
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      days: z.number().min(1).max(90).default(14),
    }).optional())
    .query(async ({ input }) => {
      const lat = input?.lat ?? HONDEGHEM.lat;
      const lon = input?.lon ?? HONDEGHEM.lon;
      const locKey = makeLocationKey(lat, lon);
      const days = input?.days ?? 14;
      const scores = await getLeadTimeScoresForLocation(locKey, days);
      return { locationKey: locKey, days, scores };
    }),

  /** Physical station evidence and official forecast, aligned by Paris hour. */
  getStationReliabilityOverview: publicProcedure
    .input(z.object({
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      periodDays: z.union([z.literal(1), z.literal(7)]).optional(),
      radiusKm: z.number().min(5).max(50).optional(),
    }).optional())
    .query(async ({ input }) => buildStationReliabilityOverviewCached({
      lat: input?.lat ?? HONDEGHEM.lat,
      lon: input?.lon ?? HONDEGHEM.lon,
      periodDays: input?.periodDays ?? 1,
      radiusKm: input?.radiusKm,
    })),

  /**
   * Laboratory: a strict read-model over qualified physical evidence only.
   * It never ranks legacy/model-reference scores as if they were observations.
   */
  getReliabilityLaboratory: publicProcedure
    .input(z.object({
      lat: latitudeSchema.optional(),
      lon: longitudeSchema.optional(),
      period: z.enum(["24h", "7d", "30d", "90d", "365d"]).default("30d"),
      horizon: z.enum(["0-6h", "6-24h", "24-48h", "2-3d", "4-7d", "8-10d", "11-15d"]).default("6-24h"),
    }).optional())
    .query(async ({ input }) => buildReliabilityLaboratoryCached({
      lat: input?.lat ?? HONDEGHEM.lat,
      lon: input?.lon ?? HONDEGHEM.lon,
      period: input?.period ?? "30d",
      horizon: input?.horizon ?? "6-24h",
    })),

  /** Direct answer for yesterday, computed only from immutable runs and qualified physical snapshots. */
  getYesterdayForecastObservation: publicProcedure
    .input(optionalCoordinatesSchema.optional())
    .query(async ({ input }) => {
      const locationKey = makeLocationKey(input?.lat ?? HONDEGHEM.lat, input?.lon ?? HONDEGHEM.lon);
      const validDate = getParisDateDaysAgo(1);
      const sources = await getDailyForecastVerificationSources(locationKey, validDate);
      if (!sources.available) {
        const empty = buildDailyForecastVerificationReadModel(locationKey, validDate, [], []);
        const reason = sources.reason === "database_unavailable"
          ? "Base de données indisponible : la comparaison n’est pas calculée."
          : "Archives de prévision ou de stations indisponibles : aucune métrique n’est estimée.";
        return { ...empty, reason, meteoai: { ...empty.meteoai, reason } };
      }
      return buildDailyForecastVerificationReadModel(locationKey, validDate, sources.runs, sources.snapshots);
    }),
});
