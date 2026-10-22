/**
 * Aperçu de fiabilité des stations : preuves physiques et prévision officielle
 * alignées par heure de Paris, pour le graphique « Annoncé contre constaté »
 * de la page Fiabilité et la page Classement. Le modèle de lecture reste
 * strictement en lecture seule : aucune écriture n'y est jamais effectuée.
 */
import {
  getHourlyForecastEvaluationHistory,
  getHourlyForecastRunValues,
  getLatestMeteoAIForecasts,
  getPhysicalStationHistory,
  getStationCollectionSnapshots,
  getStationQualityProfiles,
  makeLocationKey,
} from "./db";
import { deriveStationPerformanceProfiles } from "./stationPerformanceService";
import {
  computeOfficialHourlyForecast,
  OFFICIAL_HOURLY_HISTORY_DAYS,
  reconstructOfficialHourlyModelsFromArchive,
} from "./officialHourlyForecast";
import { reconstructHistoricalOfficialHours } from "./historicalOfficialForecast";
import {
  buildStationForecastComparison24h,
  qualifyStationForecastReadings,
} from "./stationForecastComparison";
import { getParisDate, getParisDateDaysAgo } from "./weatherTime";
import { LRUCache } from "./_core/cache";

export type StationReliabilityOverviewInput = {
  lat: number;
  lon: number;
  periodDays: 1 | 7;
  radiusKm?: number;
};

/**
 * Lecture complète de l'aperçu pour un lieu et une période : historique des
 * relevés des stations sur 30 jours, profils de performance, runs horaires du
 * jour, historique de scores et comparaisons 24 h / 7 jours. La disponibilité de
 * l'historique de scores est remontée séparément : une lecture illisible ne
 * doit jamais être mise en cache.
 */
async function readStationReliabilityOverview(input: StationReliabilityOverviewInput) {
  const { lat, lon, periodDays } = input;
  const now = Date.now();
  const sinceMs = now - periodDays * 24 * 60 * 60 * 1000;
  const performanceWindowDays = 30;
  const performanceSinceMs = now - performanceWindowDays * 24 * 60 * 60 * 1000;
  const locationKey = makeLocationKey(lat, lon);
  const date = getParisDate();
  const [stationData, hourlyRunValues, collectionSnapshots] = await Promise.all([
    getPhysicalStationHistory(lat, lon, performanceSinceMs),
    getHourlyForecastRunValues(locationKey, date),
    getStationCollectionSnapshots(locationKey, 14),
  ]);
  const radiusKm = input.radiusKm ?? stationData.latestGroundTruth?.radiusKm ?? 20;
  const stationPerformanceById = deriveStationPerformanceProfiles({
    stations: stationData.stations.map((station) => ({
      stationId: station.stationId,
      source: station.source,
      qualificationStatus: station.qualificationStatus,
      isActive: station.isActive,
      lat: station.lat,
      lon: station.lon,
      distanceKm: station.distanceKm,
      readings: station.readings.map((reading) => ({
        ...reading,
        measurementTimes: reading.measurementTimes ?? null,
      })),
    })),
    maxDistanceKm: radiusKm,
    asOf: now,
  });
  const qualityProfiles = await getStationQualityProfiles(stationData.stations.map((station) => station.stationId));
  const qualityByStationId = new Map(qualityProfiles.map((profile) => [profile.stationId, profile]));
  const archivedOfficialModels = reconstructOfficialHourlyModelsFromArchive(hourlyRunValues, date);
  const hourlyScoreHistory = await getHourlyForecastEvaluationHistory(
    locationKey,
    getParisDateDaysAgo(OFFICIAL_HOURLY_HISTORY_DAYS),
    getParisDateDaysAgo(1),
  );
  const officialHourlyForecast = computeOfficialHourlyForecast(
    archivedOfficialModels,
    hourlyScoreHistory.rows,
    { historyAvailable: hourlyScoreHistory.available },
  );
  const stationHourlyReadings = qualifyStationForecastReadings(stationData.stations.flatMap((station) => station.readings.filter((reading) => reading.observedAt >= sinceMs)), now);
  const historicalHours = reconstructHistoricalOfficialHours(
    stationHourlyReadings.map(reading => Math.floor(Number(reading.observedAt) / 3_600_000) * 3_600_000),
    hourlyRunValues,
    hourlyScoreHistory.rows,
  ).map(point => point.hour);
  const comparison24h = buildStationForecastComparison24h(date, historicalHours, stationHourlyReadings);

  const parisDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });
  const dateFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "short" });
  const stationByDate = new Map<string, Array<{ temperature: number | null; windSpeed: number | null; precipitation: number | null }>>();
  for (const station of stationData.stations) {
    for (const reading of station.readings) {
      if (reading.observedAt < sinceMs) continue;
      const key = parisDate.format(new Date(reading.observedAt));
      const list = stationByDate.get(key) ?? [];
      list.push(reading);
      stationByDate.set(key, list);
    }
  }
  const officialHistory = await getLatestMeteoAIForecasts(7, locationKey);
  const officialByDate = new Map(officialHistory.map((forecast) => [forecast.date, forecast]));
  const comparison7d = Array.from({ length: 7 }, (_, index) => {
    const targetDate = getParisDateDaysAgo(6 - index);
    const readings = stationByDate.get(targetDate) ?? [];
    const stationTemps = readings.map((reading) => reading.temperature).filter((value): value is number => value !== null);
    const official = officialByDate.get(targetDate);
    const officialTemperature = official && official.tempMax !== null && official.tempMin !== null
      ? Math.round(((official.tempMax + official.tempMin) / 2) * 10) / 10
      : null;
    return {
      label: dateFormatter.format(new Date(`${targetDate}T12:00:00+02:00`)),
      stationTemperature: stationTemps.length ? Math.round((stationTemps.reduce((sum, value) => sum + value, 0) / stationTemps.length) * 10) / 10 : null,
      officialTemperature,
      stationSampleCount: readings.length,
    };
  });

  const currentUtcHour = Math.floor(now / (60 * 60_000)) * 60 * 60_000;
  const instant = comparison24h.find((point) => point.validAt === currentUtcHour);
  const instantDeltaC = instant && instant.stationTemperature !== null && instant.officialTemperature !== null
    ? Math.round((instant.stationTemperature - instant.officialTemperature) * 10) / 10
    : null;

  const overview = {
    locationKey,
    center: { lat, lon },
    periodDays,
    radiusKm,
    performanceWindowDays,
    collectedAt: stationData.latestGroundTruth?.computedAt ?? null,
    latestGroundTruth: stationData.latestGroundTruth,
    latestCollection: collectionSnapshots[0] ?? null,
    availabilityHistory: [...collectionSnapshots].reverse().map((snapshot) => ({
      date: snapshot.date,
      collectedAt: snapshot.collectedAt,
      radiusKm: snapshot.radiusKm,
      physicalStationCount: snapshot.physicalStationCount,
      dailyModelCount: snapshot.dailyModelCount,
      hourlyModelCount: snapshot.hourlyModelCount,
      dailyMissingModels: snapshot.dailyMissingModels,
      hourlyMissingModels: snapshot.hourlyMissingModels,
      status: snapshot.status,
    })),
    stations: stationData.stations.map((station) => {
      const currentPeriodReadings = station.readings.filter((reading) => reading.observedAt >= sinceMs);
      const latest = currentPeriodReadings.at(-1) ?? null;
      const qualityProfile = qualityByStationId.get(station.stationId) ?? null;
      return {
        stationId: station.stationId,
        name: station.name,
        source: station.source,
        lat: station.lat,
        lon: station.lon,
        distanceKm: station.distanceKm,
        reliabilityScore: station.reliabilityScore,
        updateFrequencyMin: station.updateFrequencyMin,
        latest,
        ageMinutes: latest ? Math.max(0, Math.round((now - latest.observedAt) / 60000)) : null,
        readings: currentPeriodReadings,
        qualityProfile,
        stationPerformance: stationPerformanceById.get(station.stationId) ?? null,
      };
    }),
    comparison24h,
    officialHourlyWeighting: officialHourlyForecast.weighting,
    comparison7d,
    instantDeltaC,
  };
  return { overview, scoreHistoryAvailable: hourlyScoreHistory.available };
}
type StationReliabilityOverviewReadModel = Awaited<ReturnType<typeof readStationReliabilityOverview>>["overview"];

/**
 * Clé de cache de la maille lieu × période × rayon demandé. Le rayon reste
 * « auto » quand l'appelant laisse le serveur le déduire de la vérité terrain.
 */
export function stationReliabilityOverviewCacheKey(
  input: StationReliabilityOverviewInput,
): string {
  return `${makeLocationKey(input.lat, input.lon)}:${input.periodDays}:${input.radiusKm ?? "auto"}`;
}

const STATION_RELIABILITY_OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const STATION_RELIABILITY_OVERVIEW_CACHE_MAX_ENTRIES = 64;

const stationReliabilityOverviewCache = new LRUCache<string, StationReliabilityOverviewReadModel>(
  STATION_RELIABILITY_OVERVIEW_CACHE_MAX_ENTRIES,
  STATION_RELIABILITY_OVERVIEW_CACHE_TTL_MS,
);

/**
 * Vide le cache des aperçus de fiabilité : à appeler après l'écriture de
 * nouveaux relevés (relance manuelle), pour que l'invalidation client qui
 * suit ne relise jamais un aperçu périmé.
 */
export function clearStationReliabilityOverviewCache(): void {
  stationReliabilityOverviewCache.clear();
}

/**
 * Point d'entrée mis en cache de l'aperçu de fiabilité des stations : une
 * même maille lieu × période × rayon n'est recalculée qu'une fois par fenêtre
 * de cinq minutes, exactement comme le laboratoire de fiabilité. Un historique
 * de scores illisible n'est jamais mis en cache, pour qu'une panne transitoire
 * de la base ne masque pas sa reprise.
 */
export async function buildStationReliabilityOverviewCached(
  input: StationReliabilityOverviewInput,
): Promise<StationReliabilityOverviewReadModel> {
  const cacheKey = stationReliabilityOverviewCacheKey(input);
  const cached = stationReliabilityOverviewCache.get(cacheKey);
  if (cached) return cached;
  const { overview, scoreHistoryAvailable } = await readStationReliabilityOverview(input);
  if (scoreHistoryAvailable) {
    stationReliabilityOverviewCache.set(cacheKey, overview);
  }
  return overview;
}
