/**
 * Station Service — Multi-source weather station discovery and ground truth calculation
 *
 * Sources interrogated:
 * 1. Open-Meteo grid point (best-match model, always available)
 * 2. OpenDataSoft SYNOP (Météo-France official network, real data, free/no-key)
 * 3. Netatmo public stations (OAuth, when a user connection is active)
 * 4. Open-Meteo multi-point grid references (clearly not physical stations)
 *
 * Ground truth weighting:
 *   50% distance normalisée (IDW quadratique, closer = more weight)
 *   30% prior de priorité réseau/source normalisé (valeur fixe du mapper)
 *   20% data freshness normalisée (how recent the last reading is)
 * Les trois composantes sont normalisées entre les stations actives AVANT
 * la combinaison, puis le poids final est normalisé à 1. Cela empêche une
 * distance brute de contourner les proportions annoncées.
 */

import { WEATHER_SERVICES } from "./weatherServices";
import type { CurrentModelReference } from "./modelReferenceCoherence";
import {
  buildNormalizedSpatialWeights,
  SPATIAL_FUSION_COMPONENT_SHARES,
  SPATIAL_FUSION_DISTANCE_EPSILON_KM,
  SPATIAL_FUSION_IDW_EXPONENT,
} from "./spatialFusionCore";
import { getStationRankingScore } from "./stationRankingScore";
import { evaluateStationFieldQuality, getStationMeasurementAgeState, getStationMeasurementAgeStates, getValidStationMeasurementTimestamp, hasFreshStationMeasurement, type StationFieldQualityResult, type StationMeasurementField, type StationMeasurementTimes } from "./stationMeasurementFreshness";
import { getStationSourceDiagnosticReason, StationSourceCollectionError, type StationSourceDiagnosticReason } from "./stationSourceDiagnostics";

export const HONDEGHEM = { lat: 50.7567, lon: 2.5204 };

export type StationSource =
  | "meteofrance"
  | "netatmo"
  | "wunderground"
  | "noaa"
  | "openmeteo"
  | "synop"
  | "davis"
  | "infoclimat";

export type StationData = {
  stationId: string;
  source: StationSource;
  name: string;
  lat: number;
  lon: number;
  altitude: number | null;
  distanceKm: number;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  precipitation: number | null;
  updatedAt: string | null; // ISO timestamp
  /** Provider-reported measurement time per variable where available. */
  measurementTimes?: StationMeasurementTimes;
  reliabilityScore: number; // 0-100
  updateFrequencyMin: number;
  dataAvailability: number; // 0-1
  isActive: boolean;
  exclusionReason?: string;
};

export type StationCollectionSource = "meteofrance" | "netatmo";
export type StationSourceDiagnosticStatus = "success_with_data" | "success_empty" | "error" | "not_configured";
export type StationSourceDiagnostic = {
  source: StationCollectionSource;
  status: StationSourceDiagnosticStatus;
  stationCount: number;
  /** Safe normalized category only; raw provider errors and responses are never exposed. */
  reason?: StationSourceDiagnosticReason;
};
export type NearbyStationsCollection = {
  stations: StationData[];
  sourceDiagnostics: StationSourceDiagnostic[];
  /** True when these source results were served from the existing short-lived cache. */
  cacheHit: boolean;
};
type CachedNearbyStationsCollection = Pick<NearbyStationsCollection, "stations" | "sourceDiagnostics">;

/**
 * Sources dont les relevés sont associés à une station physique identifiée.
 * Les réseaux personnels simulés et points de grille restent des références de
 * modèle : ils ne doivent jamais être persistés comme observations de station.
 */
// METAR retiré définitivement : la source aéroportuaire en échec n'entre plus
// dans aucune méthode de calcul (fusion, vérité terrain, vérification, ranking).
export const PHYSICAL_STATION_SOURCES: ReadonlySet<StationSource> = new Set<StationSource>(["meteofrance", "netatmo"]);

export type StationSourceKind = "physical" | "reference";

export function getStationSourceKind(source: StationSource, stationId?: string): StationSourceKind {
  if (source === "netatmo" && stationId && !stationId.startsWith("netatmo-")) {
    return "reference";
  }
  return PHYSICAL_STATION_SOURCES.has(source) ? "physical" : "reference";
}

export function getPhysicalActiveStations(stations: StationData[]): StationData[] {
  return stations.filter((station) => station.isActive && getStationSourceKind(station.source, station.stationId) === "physical");
}

function getStationFreshnessExclusionReason(station: StationData, nowMs: number): string | null {
  const ageMin = station.updatedAt
    ? (nowMs - new Date(station.updatedAt).getTime()) / 60000
    : 999;
  if (!Number.isFinite(ageMin)) return "Date de mise à jour invalide";
  if (ageMin > 180) return `Données trop anciennes (${Math.round(ageMin)} min)`;
  return null;
}

function revalidateStationFreshnessAt(station: StationData, nowMs: number): StationData {
  const exclusionReason = getStationFreshnessExclusionReason(station, nowMs);
  if (!exclusionReason) return station;
  if (exclusionReason === "Date de mise à jour invalide" && !station.isActive) return station;
  return { ...station, isActive: false, exclusionReason };
}

export function revalidateStationFreshness(stations: StationData[], nowMs = Date.now()): StationData[] {
  return stations.map((station) => revalidateStationFreshnessAt(station, nowMs));
}

export type GroundTruthResult = {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  precipitation: number | null;
  stationsUsed: StationContribution[];
  stationsIgnored: StationExclusion[];
  stationCount: number;
  confidenceScore: number | null;
};

export type StationContribution = {
  stationId: string;
  name: string;
  source: string;
  /** Source-reported measurement time; never the snapshot collection/archive time. */
  observedAt: string | null;
  measurementTimes: StationData["measurementTimes"] | null;
  measurementAgeByField?: ReturnType<typeof getStationMeasurementAgeStates>;
  /** Weights keyed by the field whose own observation time qualified it. */
  fieldWeights?: Partial<Record<StationMeasurementField, number>>;
  distanceKm: number;
  weight: number; // 0-1 final weight
  distanceWeight: number; // part normalisée de la composante distance
  qualityWeight: number; // part normalisée de la composante qualité
  freshnessWeight: number; // part normalisée de la composante fraîcheur
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  precipitation: number | null;
};

export type StationExclusion = {
  stationId: string;
  name: string;
  source: string;
  distanceKm: number;
  reason: string;
};

// ─── Haversine distance ───────────────────────────────────────────────────────

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Source reliability defaults ─────────────────────────────────────────────

const SOURCE_DEFAULTS: Record<StationSource, { reliability: number; updateFreqMin: number; availability: number }> = {
  meteofrance:  { reliability: 92, updateFreqMin: 60, availability: 0.98 },
  synop:        { reliability: 88, updateFreqMin: 60, availability: 0.95 },
  noaa:         { reliability: 85, updateFreqMin: 60, availability: 0.93 },
  infoclimat:   { reliability: 82, updateFreqMin: 30, availability: 0.88 },
  openmeteo:    { reliability: 80, updateFreqMin: 60, availability: 0.90 },
  davis:        { reliability: 78, updateFreqMin: 10, availability: 0.85 },
  netatmo:      { reliability: 65, updateFreqMin: 10, availability: 0.75 },
  wunderground: { reliability: 58, updateFreqMin: 5,  availability: 0.65 },
};

/** Read-only copy of a mapper's existing source-level prioritization defaults. */
export function getStationSourcePriorityDefaults(source: StationSource) {
  const defaults = SOURCE_DEFAULTS[source];
  return {
    reliability: defaults.reliability,
    updateFreqMin: defaults.updateFreqMin,
    availability: defaults.availability,
  };
}

// La même collecte de stations alimente les modes Local et Ultra-local. Un cache
// très court évite de solliciter les deux fournisseurs à chaque changement de filtre,
// sans masquer un relevé durablement obsolète.
export const NEARBY_STATIONS_CACHE_TTL_MS = 90_000;
type NearbyStationsCacheEntry = {
  expiresAt: number;
  result?: CachedNearbyStationsCollection;
  pending?: Promise<CachedNearbyStationsCollection>;
};
const nearbyStationsCache = new Map<string, NearbyStationsCacheEntry>();

function makeNearbyStationsCacheKey(
  lat: number,
  lon: number,
  radiusKm: number,
  netatmoUserId?: number,
) {
  return [lat.toFixed(4), lon.toFixed(4), radiusKm.toFixed(1), netatmoUserId ?? "public"].join(":");
}

// ─── Helper: fetch one Open-Meteo grid point ──────────────────────────────────

async function fetchOpenMeteoPoint(lat: number, lon: number, model?: string): Promise<{
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  precipitation: number | null;
  elevation: number | null;
  time: string | null;
} | null> {
  try {
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      current: "temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation",
      timezone: "Europe/Paris",
    });
    if (model) params.set("models", model);
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    if (!c) return null;
    return {
      temperature: c.temperature_2m ?? null,
      humidity: c.relative_humidity_2m ?? null,
      pressure: c.surface_pressure ?? null,
      windSpeed: c.wind_speed_10m ?? null,
      windGust: c.wind_gusts_10m ?? null,
      windDirection: c.wind_direction_10m ?? null,
      precipitation: c.precipitation ?? null,
      elevation: data.elevation ?? null,
      time: c.time ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Références des modèles au point demandé : elles ne sont jamais des stations.
 * Un point de grille évolue peu d'une minute à l'autre : les huit lectures
 * Open-Meteo ne sont donc payées qu'une fois par point et par fenêtre de cinq
 * minutes, et une réponse vide (échec amont) n'est jamais mise en cache.
 */
const MODEL_REFERENCES_CACHE_TTL_MS = 5 * 60 * 1000;
const MODEL_REFERENCES_CACHE_MAX_ENTRIES = 64;
const modelReferencesCache = new Map<string, { collectedAt: number; references: CurrentModelReference[] }>();

function modelReferencesCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

export async function fetchCurrentModelReferences(lat: number, lon: number): Promise<CurrentModelReference[]> {
  const cacheKey = modelReferencesCacheKey(lat, lon);
  const cached = modelReferencesCache.get(cacheKey);
  if (cached && Date.now() - cached.collectedAt < MODEL_REFERENCES_CACHE_TTL_MS) {
    return cached.references;
  }
  const responses = await Promise.allSettled(
    WEATHER_SERVICES.expert.map(async (service) => {
      const point = await fetchOpenMeteoPoint(lat, lon, service.modelId === "best_match" ? undefined : service.modelId);
      if (!point) return null;
      return {
        id: `model-${service.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: service.name,
        temperature: point.temperature,
        humidity: point.humidity,
        pressure: point.pressure,
        windSpeed: point.windSpeed,
        windGust: point.windGust,
        windDirection: point.windDirection,
        precipitation: point.precipitation,
        updatedAt: point.time ? `${point.time}:00` : null,
      } satisfies CurrentModelReference;
    }),
  );

  const references = responses
    .filter((response): response is PromiseFulfilledResult<CurrentModelReference | null> => response.status === "fulfilled")
    .map((response) => response.value)
    .filter((reference): reference is CurrentModelReference => reference !== null);
  if (references.length > 0) {
    modelReferencesCache.set(cacheKey, { collectedAt: Date.now(), references });
    while (modelReferencesCache.size > MODEL_REFERENCES_CACHE_MAX_ENTRIES) {
      const oldestKey = modelReferencesCache.keys().next().value;
      if (oldestKey === undefined) break;
      modelReferencesCache.delete(oldestKey);
    }
  }
  return references;
}

// ─── 1. Open-Meteo reference grid point ──────────────────────────────────────

async function fetchOpenMeteoNearbyStations(
  lat: number,
  lon: number,
  _radiusKm: number
): Promise<StationData[]> {
  const pt = await fetchOpenMeteoPoint(lat, lon);
  if (!pt) return [];
  return [{
    stationId: `openmeteo-${lat.toFixed(4)}-${lon.toFixed(4)}`,
    source: "openmeteo" as StationSource,
    name: `Open-Meteo (point de grille ${lat.toFixed(3)}°N)`,
    lat,
    lon,
    altitude: pt.elevation,
    distanceKm: 0,
    temperature: pt.temperature,
    humidity: pt.humidity,
    pressure: pt.pressure,
    windSpeed: pt.windSpeed,
    windGust: pt.windGust,
    windDirection: pt.windDirection,
    precipitation: pt.precipitation,
    updatedAt: pt.time ? `${pt.time}:00` : null,
    reliabilityScore: SOURCE_DEFAULTS.openmeteo.reliability,
    updateFrequencyMin: SOURCE_DEFAULTS.openmeteo.updateFreqMin,
    dataAvailability: SOURCE_DEFAULTS.openmeteo.availability,
    isActive: true,
  }];
}

// ─── 2. OpenDataSoft SYNOP — real Météo-France official stations ──────────────

function parseFiniteSynopNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundFiniteSynopValue(value: number, decimalPlaces: number): number | null {
  const scale = 10 ** decimalPlaces;
  const rounded = Math.round(value * scale) / scale;
  return Number.isFinite(rounded) ? rounded : null;
}

function hasFiniteActivationMeasurement(
  station: Pick<StationData, "temperature" | "windSpeed" | "precipitation">,
): boolean {
  return Number.isFinite(station.temperature)
    || Number.isFinite(station.windSpeed)
    || Number.isFinite(station.precipitation);
}

function normalizeStationMeasurements(station: StationData): StationData {
  return {
    ...station,
    temperature: Number.isFinite(station.temperature) ? station.temperature : null,
    humidity: Number.isFinite(station.humidity) ? station.humidity : null,
    pressure: Number.isFinite(station.pressure) ? station.pressure : null,
    windSpeed: Number.isFinite(station.windSpeed) ? station.windSpeed : null,
    windGust: Number.isFinite(station.windGust) ? station.windGust : null,
    windDirection: Number.isFinite(station.windDirection) ? station.windDirection : null,
    precipitation: Number.isFinite(station.precipitation) ? station.precipitation : null,
  };
}

/** Pure SYNOP record mapper so parsing can be tested without a provider request. */
export function mapSynopRecord(
  record: Record<string, unknown>,
  lat: number,
  lon: number,
  radiusKm: number,
): StationData | null {
  const stationLat = parseFiniteSynopNumber(record.latitude);
  const stationLon = parseFiniteSynopNumber(record.longitude);
  if (stationLat == null || stationLon == null || !stationLat || !stationLon) return null;

  const distanceKm = haversineKm(lat, lon, stationLat, stationLon);
  if (!Number.isFinite(distanceKm) || distanceKm > radiusKm) return null;

  const temperatureKelvin = parseFiniteSynopNumber(record.t);
  const windMetersPerSecond = parseFiniteSynopNumber(record.ff);
  const gustMetersPerSecond = parseFiniteSynopNumber(record.raf10);
  const pressurePascals = parseFiniteSynopNumber(record.pres);
  const observationTime = typeof record.date === "string" ? record.date : null;
  const stationId = `mf-${String(record.numer_sta ?? "unknown")}`;
  const station: StationData = {
    stationId,
    source: "meteofrance",
    name: typeof record.nom === "string" ? record.nom : `Station MF ${String(record.numer_sta ?? "unknown")}`,
    lat: stationLat,
    lon: stationLon,
    altitude: parseFiniteSynopNumber(record.altitude),
    distanceKm: Math.round(distanceKm * 10) / 10,
    temperature: temperatureKelvin == null ? null : roundFiniteSynopValue(temperatureKelvin - 273.15, 1),
    humidity: parseFiniteSynopNumber(record.u),
    pressure: pressurePascals == null ? null : roundFiniteSynopValue(pressurePascals / 100, 0),
    windSpeed: windMetersPerSecond == null ? null : roundFiniteSynopValue(windMetersPerSecond * 3.6, 1),
    windGust: gustMetersPerSecond == null ? null : roundFiniteSynopValue(gustMetersPerSecond * 3.6, 1),
    windDirection: parseFiniteSynopNumber(record.dd),
    precipitation: parseFiniteSynopNumber(record.rr1),
    updatedAt: observationTime,
    measurementTimes: {
      temperature: observationTime,
      humidity: observationTime,
      pressure: observationTime,
      windSpeed: observationTime,
      windGust: observationTime,
      windDirection: observationTime,
      precipitation: observationTime,
    },
    reliabilityScore: SOURCE_DEFAULTS.meteofrance.reliability,
    updateFrequencyMin: SOURCE_DEFAULTS.meteofrance.updateFreqMin,
    dataAvailability: SOURCE_DEFAULTS.meteofrance.availability,
    isActive: false,
  };
  const isActive = hasFiniteActivationMeasurement(station);
  return {
    ...station,
    isActive,
    ...(isActive ? {} : { exclusionReason: "Aucune donnée disponible" }),
  };
}

async function fetchMeteoFranceStations(
  lat: number,
  lon: number,
  radiusKm: number
): Promise<StationData[]> {
  // OpenDataSoft SYNOP dataset — correct field names: latitude, longitude, altitude (not lat/lon/alti)
  const bbox = Math.max(radiusKm / 80, 0.5); // degrees, ~111km per degree
  const where = `latitude>${(lat - bbox).toFixed(4)} AND latitude<${(lat + bbox).toFixed(4)} AND longitude>${(lon - bbox).toFixed(4)} AND longitude<${(lon + bbox).toFixed(4)}`;
  const params = new URLSearchParams({
    select: "numer_sta,nom,latitude,longitude,altitude,t,u,pres,ff,raf10,rr1,dd,date",
    where,
    order_by: "date desc",
    limit: "30",
    timezone: "UTC",
  });
  const url = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/donnees-synop-essentielles-omm/records?${params}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new StationSourceCollectionError("provider_http_error");
  const data = await res.json() as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new StationSourceCollectionError("invalid_response");
  const records = (data as { results?: unknown }).results ?? [];
  if (!Array.isArray(records) || records.some((record: unknown) => !record || typeof record !== "object" || Array.isArray(record))) {
    throw new StationSourceCollectionError("invalid_response");
  }

  const results: StationData[] = [];
  const seenStations = new Set<string>();

  for (const r of records as Record<string, unknown>[]) {
    const stId = `mf-${r.numer_sta}`;
    // Only take the most recent record per station
    if (seenStations.has(stId)) continue;
    seenStations.add(stId);

    const station = mapSynopRecord(r, lat, lon, radiusKm);
    if (station) results.push(station);
  }
  return results;
}

// ─── 4. Multi-point Open-Meteo grid references (not physical stations) ─────────
//
// We query Open-Meteo at several geographic offsets around the target location.
// Each offset uses a different NWP model to add diversity. These entries remain
// clearly labeled as model-grid references until a provider returns real station data.

// ─── 5. ECMWF IFS reference point (labeled as SYNOP/WMO) ─────────────────────

async function fetchSYNOPReference(
  lat: number,
  lon: number,
): Promise<StationData[]> {
  const pt = await fetchOpenMeteoPoint(lat, lon, "ecmwf_ifs025");
  if (!pt) return [];
  return [{
    stationId: `synop-ecmwf-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    source: "synop" as StationSource,
    name: `Référence de grille ECMWF IFS`,
    lat,
    lon,
    altitude: pt.elevation,
    distanceKm: 0.2,
    temperature: pt.temperature,
    humidity: pt.humidity,
    pressure: pt.pressure,
    windSpeed: pt.windSpeed,
    windGust: pt.windGust,
    windDirection: pt.windDirection,
    precipitation: pt.precipitation,
    updatedAt: pt.time ? `${pt.time}:00` : null,
    reliabilityScore: SOURCE_DEFAULTS.synop.reliability,
    updateFrequencyMin: SOURCE_DEFAULTS.synop.updateFreqMin,
    dataAvailability: SOURCE_DEFAULTS.synop.availability,
    isActive: true,
  }];
}

// ─── Main: collect all stations ───────────────────────────────────────────────

function makeSourceDiagnostic<T extends readonly unknown[]>(
  source: StationCollectionSource,
  outcome: PromiseSettledResult<T>,
  netatmoStatus?: import("./netatmoService").NetatmoAvailability,
): StationSourceDiagnostic {
  if (outcome.status === "rejected") {
    return { source, status: "error", stationCount: 0, reason: getStationSourceDiagnosticReason(outcome.reason) };
  }

  const stationCount = outcome.value.length;
  if (source === "netatmo" && stationCount === 0) {
    if (netatmoStatus === "not_connected") return { source, status: "not_configured", stationCount };
    if (netatmoStatus === "temporarily_unavailable") {
      return { source, status: "error", stationCount, reason: "source_unavailable" };
    }
  }
  return { source, status: stationCount > 0 ? "success_with_data" : "success_empty", stationCount };
}

async function collectNearbyStationsUncached(
  lat: number,
  lon: number,
  radiusKm: number = 20,
  townName: string = "Local",
  options: { netatmoUserId?: number; onNetatmoStatus?: (status: import("./netatmoService").NetatmoAvailability) => void } = {},
): Promise<CachedNearbyStationsCollection> {
  const { fetchNetatmoPublicStations } = await import("./netatmoService");
  // Seules les observations de station sont assemblées ici.
  // Les modèles sont exposés séparément par fetchCurrentModelReferences().
  let netatmoStatus: import("./netatmoService").NetatmoAvailability | undefined;
  const [meteoFrance, netatmo] = await Promise.allSettled([
    fetchMeteoFranceStations(lat, lon, radiusKm),
    fetchNetatmoPublicStations(options.netatmoUserId, lat, lon, radiusKm, {
      onStatus: (status) => {
        netatmoStatus = status;
        options.onNetatmoStatus?.(status);
      },
    }),
  ]);

  const sourceDiagnostics = [
    makeSourceDiagnostic("meteofrance", meteoFrance),
    makeSourceDiagnostic("netatmo", netatmo, netatmoStatus),
  ];

  const all: StationData[] = [
    ...(meteoFrance.status === "fulfilled" ? meteoFrance.value : []),
    ...(netatmo.status === "fulfilled" ? netatmo.value : []),
  ];

  // Deduplicate by stationId
  const seen = new Set<string>();
  const unique = all.filter(s => {
    if (seen.has(s.stationId)) return false;
    seen.add(s.stationId);
    return true;
  });

  // Filter to radius
  const inRadius = unique
    .map(normalizeStationMeasurements)
    .filter(s => s.distanceKm <= radiusKm);

  // Apply quality exclusion rules
  const stations = inRadius.map(s => {
    if (!hasFiniteActivationMeasurement(s)) {
      return { ...s, isActive: false, exclusionReason: "Aucune donnée disponible" };
    }
    const freshnessChecked = revalidateStationFreshnessAt(s, Date.now());
    if (freshnessChecked !== s) return freshnessChecked;
    if (s.reliabilityScore < 40) {
      return { ...s, isActive: false, exclusionReason: `Priorité technique de source trop basse (${s.reliabilityScore}/100)` };
    }
    return s;
  });
  return { stations, sourceDiagnostics };
}

export async function collectNearbyStationsWithDiagnostics(
  lat: number,
  lon: number,
  radiusKm: number = 20,
  townName: string = "Local",
  options: { netatmoUserId?: number; onNetatmoStatus?: (status: import("./netatmoService").NetatmoAvailability) => void } = {},
): Promise<NearbyStationsCollection> {
  const cacheKey = makeNearbyStationsCacheKey(lat, lon, radiusKm, options.netatmoUserId);
  const now = Date.now();
  const cached = nearbyStationsCache.get(cacheKey);
  if (cached?.result && cached.expiresAt > now) {
    options.onNetatmoStatus?.(options.netatmoUserId === undefined ? "not_connected" : "fresh_cache");
    return {
      ...cached.result,
      stations: revalidateStationFreshness(cached.result.stations, now),
      cacheHit: true,
    };
  }
  if (cached?.pending) return { ...(await cached.pending), cacheHit: false };

  const pending = collectNearbyStationsUncached(lat, lon, radiusKm, townName, options);
  nearbyStationsCache.set(cacheKey, { expiresAt: now + NEARBY_STATIONS_CACHE_TTL_MS, pending });
  try {
    const result = await pending;
    nearbyStationsCache.set(cacheKey, { expiresAt: Date.now() + NEARBY_STATIONS_CACHE_TTL_MS, result });
    return { ...result, cacheHit: false };
  } catch (error) {
    nearbyStationsCache.delete(cacheKey);
    throw error;
  }
}

export async function collectNearbyStations(
  lat: number,
  lon: number,
  radiusKm: number = 20,
  townName: string = "Local",
  options: { netatmoUserId?: number; onNetatmoStatus?: (status: import("./netatmoService").NetatmoAvailability) => void } = {},
): Promise<StationData[]> {
  return (await collectNearbyStationsWithDiagnostics(lat, lon, radiusKm, townName, options)).stations;
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

export function rankStations(stations: StationData[], nowMs = Date.now()): StationData[] {
  const scoreByStation = new Map<StationData, number>();
  for (const station of stations) scoreByStation.set(station, getStationRankingScore(station, nowMs));

  return [...stations].sort((a, b) => {
    // Active first
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;

    return scoreByStation.get(b)! - scoreByStation.get(a)!;
  });
}

// ─── Ground truth calculation ─────────────────────────────────────────────────

export const GROUND_TRUTH_COMPONENT_SHARES = SPATIAL_FUSION_COMPONENT_SHARES;
export const GROUND_TRUTH_IDW_EXPONENT = SPATIAL_FUSION_IDW_EXPONENT;
export const GROUND_TRUTH_DISTANCE_EPSILON_KM = SPATIAL_FUSION_DISTANCE_EPSILON_KM;

export function calculateGroundTruth(stations: StationData[]): GroundTruthResult {
  const active = stations.filter(s => s.isActive).map(normalizeStationMeasurements);
  const ignored: StationExclusion[] = stations
    .filter(s => !s.isActive)
    .map(s => ({
      stationId: s.stationId,
      name: s.name,
      source: s.source,
      distanceKm: s.distanceKm,
      reason: s.exclusionReason ?? "Raison inconnue",
    }));

  const now = Date.now();
  const fields = ["temperature", "humidity", "pressure", "windSpeed", "windGust", "precipitation"] as const;
  type GroundTruthField = (typeof fields)[number];
  type GroundTruthSpatialSource = StationData & { id: string };
  const sourceById = new Map(active.map((station) => [station.stationId, station]));
  const spatialSources = active.map((station) => ({ ...station, id: station.stationId }));
  // Le Ground Truth conserve le cutoff existant de 180 min et les filtres
  // distance/fiabilité/cohérence; seul le champ dont la date est testée change.
  const qcByField = new Map<GroundTruthField, Map<string, StationFieldQualityResult<GroundTruthSpatialSource>>>();
  type FieldWeight = { finalWeight: number; distanceWeight: number; qualityWeight: number; freshnessWeight: number };
  const weightsByField = new Map<GroundTruthField, Map<string, FieldWeight>>();
  const qualifiedByField = new Map<GroundTruthField, Set<string>>();
  const qcOptions = {
    now,
    maxDistanceKm: Math.max(...active.map((station) => station.distanceKm), 0),
    maxFreshnessMin: 180,
    minReliabilityScore: 40,
    maxTempDeviationC: 8,
  };

  for (const field of fields) {
    const qc = evaluateStationFieldQuality(spatialSources, field, qcOptions);
    qcByField.set(field, new Map(qc.map((result) => [result.source.stationId, result])));
    const passed = qc.filter((result) => result.passed);
    const timedSources = passed.map((result) => ({
      ...result.source,
      updatedAt: getValidStationMeasurementTimestamp(result.source.measurementTimes, field, now),
    }));
    const weights = buildNormalizedSpatialWeights(timedSources, { now });
    weightsByField.set(field, new Map(weights.map((weight) => [weight.source.stationId, {
      finalWeight: weight.finalWeight,
      distanceWeight: weight.distanceWeight,
      qualityWeight: weight.qualityWeight,
      freshnessWeight: weight.freshnessWeight,
    }])));
    qualifiedByField.set(field, new Set(passed.map((result) => result.source.stationId)));
  }

  const usedStationIds = new Set(Array.from(qualifiedByField.values()).flatMap((ids) => Array.from(ids)));
  const temperatureIds = qualifiedByField.get("temperature") ?? new Set<string>();
  for (const station of active) {
    if (usedStationIds.has(station.stationId)) continue;
    const reasons: string[] = [];
    for (const field of fields) {
      const value = station[field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (!hasFreshStationMeasurement(station.measurementTimes, field, 180, now)) {
        const age = getStationMeasurementAgeState(station.measurementTimes, field, now);
        reasons.push(`${field}: ${age.status === "unknown" ? "âge inconnu" : `âge ${age.ageMinutes} min, au-delà de 180 min`}`);
        continue;
      }
      const failed = qcByField.get(field)?.get(station.stationId);
      if (failed && !failed.passed) reasons.push(`${field}: ${failed.checks.filter((check) => !check.passed).map((check) => check.reason).join(", ")}`);
    }
    const activationDataExists = Number.isFinite(station.temperature) || Number.isFinite(station.windSpeed) || Number.isFinite(station.precipitation);
    ignored.push({
      stationId: station.stationId,
      name: station.name,
      source: station.source,
      distanceKm: station.distanceKm,
      reason: !activationDataExists
        ? "Aucune mesure exploitable"
        : reasons.join(" ; ") || "Aucune mesure datée et fraîche qualifiée par variable.",
    });
  }

  function weightedAvg(field: GroundTruthField): number | null {
    let sum = 0;
    let weightSum = 0;
    const fieldWeights = weightsByField.get(field);
    fieldWeights?.forEach((weight, stationId) => {
      const value = sourceById.get(stationId)?.[field];
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      sum += value * weight.finalWeight;
      weightSum += weight.finalWeight;
    });
    return weightSum > 0 ? Math.round((sum / weightSum) * 10) / 10 : null;
  }

  const contributions: StationContribution[] = Array.from(usedStationIds).map((stationId) => {
    const station = sourceById.get(stationId)!;
    const tempWeight = weightsByField.get("temperature")?.get(stationId);
    const fieldWeights = Object.fromEntries(
      fields.flatMap((field) => {
        const weight = weightsByField.get(field)?.get(stationId);
        return weight == null ? [] : [[field, Math.round(weight.finalWeight * 1000) / 1000]];
      }),
    ) as Partial<Record<StationMeasurementField, number>>;
    return {
      stationId: station.stationId,
      name: station.name,
      source: station.source,
      observedAt: getValidStationMeasurementTimestamp(station.measurementTimes, "temperature", now),
      measurementTimes: station.measurementTimes ?? null,
      measurementAgeByField: getStationMeasurementAgeStates(station.measurementTimes, now),
      fieldWeights,
      distanceKm: station.distanceKm,
      weight: Math.round((tempWeight?.finalWeight ?? 0) * 1000) / 1000,
      distanceWeight: tempWeight?.distanceWeight ?? 0,
      qualityWeight: tempWeight?.qualityWeight ?? 0,
      freshnessWeight: tempWeight?.freshnessWeight ?? 0,
      temperature: station.temperature,
      humidity: station.humidity,
      pressure: station.pressure,
      windSpeed: station.windSpeed,
      windGust: station.windGust,
      precipitation: station.precipitation,
    };
  });

  // Confidence remains temperature-specific; other variables cannot supply it.
  const temperatureStations = Array.from(temperatureIds).flatMap((id) => {
    const station = sourceById.get(id);
    return station && typeof station.temperature === "number" && Number.isFinite(station.temperature) ? [station] : [];
  });
  const temps = temperatureStations.map((station) => station.temperature!);
  const tempMean = temps.length > 0 ? temps.reduce((a, b) => a + b) / temps.length : 0;
  const tempStd = temps.length > 1
    ? Math.sqrt(temps.reduce((s, v) => s + (v - tempMean) ** 2, 0) / temps.length)
    : 0;
  const confidenceScore = temperatureStations.length === 0 ? null : Math.max(0, Math.min(100, Math.round(
    100 - tempStd * 10 - Math.max(0, 5 - temperatureStations.length) * 5
  )));

  return {
    temperature: weightedAvg("temperature"),
    humidity: weightedAvg("humidity"),
    pressure: weightedAvg("pressure"),
    windSpeed: weightedAvg("windSpeed"),
    windGust: weightedAvg("windGust"),
    precipitation: weightedAvg("precipitation"),
    stationsUsed: contributions,
    stationsIgnored: ignored,
    stationCount: temperatureIds.size,
    confidenceScore,
  };
}
