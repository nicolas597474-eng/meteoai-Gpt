import { getNetatmoOAuthToken, getRecentValidatedNetatmoObservations, upsertNetatmoOAuthToken } from "./db";
import { decryptNetatmoRefreshToken, encryptNetatmoRefreshToken } from "./netatmoOAuth";
import { haversineKm, type StationData } from "./stationService";

type NetatmoModule = {
  type?: string;
  dashboard_data?: Record<string, unknown>;
  measures?: Record<string, unknown>;
};

type NetatmoPublicMeasure = {
  type?: string[];
  res?: Record<string, unknown>;
  rain_60min?: number;
  rain_live?: number;
  rain_utc?: number;
  wind_strength?: number;
  wind_angle?: number;
  gust_strength?: number;
  gust_angle?: number;
  wind_timeutc?: number;
};

type NetatmoPublicStation = {
  _id?: string;
  type?: string;
  station_name?: string;
  place?: { location?: [number, number]; altitude?: number; city?: string };
  dashboard_data?: Record<string, unknown>;
  measures?: Record<string, NetatmoPublicMeasure>;
  modules?: NetatmoModule[];
};

const pendingAccessTokenRefreshes = new Map<number, Promise<string | null>>();
const NETATMO_DASHBOARD_FALLBACK_MAX_AGE_MINUTES = 30;

export type NetatmoAvailability = "not_connected" | "temporarily_unavailable" | "fresh_cache" | "live" | "connected_empty";
export type NetatmoFetchOptions = { onStatus?: (status: NetatmoAvailability) => void };

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dashboardNumber(module: NetatmoModule | NetatmoPublicStation | undefined, ...keys: string[]) {
  const source = module?.dashboard_data ?? module?.measures;
  if (!source) return null;
  for (const key of keys) {
    const value = numberValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function updatedAtFrom(station: NetatmoPublicStation, modules: NetatmoModule[]) {
  const candidates = [station, ...modules];
  for (const candidate of candidates) {
    const raw = dashboardNumber(candidate, "time_utc", "Time_UTC");
    if (raw !== null) return new Date(raw * 1000).toISOString();
  }
  return null;
}

function measurementTimeFrom(module: NetatmoModule | NetatmoPublicStation | undefined): string | null {
  const raw = dashboardNumber(module, "time_utc", "Time_UTC");
  return raw !== null ? new Date(raw * 1000).toISOString() : null;
}

function normalizeMeasureType(type: string) {
  return type.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function latestSeriesValue(measure: NetatmoPublicMeasure, expectedTypes: string[]) {
  const index = (measure.type ?? []).findIndex((type) => expectedTypes.includes(normalizeMeasureType(type)));
  if (index < 0 || !measure.res) return { value: null, timestamp: null };
  const rows: Array<{ timestamp: number; values: unknown[] }> = Object.entries(measure.res).flatMap(([timestamp, values]) => {
    const parsedTimestamp = Number(timestamp);
    if (!Number.isFinite(parsedTimestamp) || !Array.isArray(values)) return [];
    return [{ timestamp: parsedTimestamp, values }];
  }).sort((a, b) => b.timestamp - a.timestamp);
  for (const row of rows) {
    const value = numberValue(row.values[index]);
    if (value !== null) return { value, timestamp: row.timestamp };
  }
  return { value: null, timestamp: null };
}

function extractPublicMeasures(station: NetatmoPublicStation) {
  const result = {
    temperature: null as number | null,
    humidity: null as number | null,
    pressure: null as number | null,
    windSpeed: null as number | null,
    windGust: null as number | null,
    windDirection: null as number | null,
    precipitation: null as number | null,
    updatedAt: null as string | null,
    measurementTimes: {
      temperature: null as string | null,
      humidity: null as string | null,
      pressure: null as string | null,
      windSpeed: null as string | null,
      windGust: null as string | null,
      windDirection: null as string | null,
      precipitation: null as string | null,
    },
  };
  let latestTimestamp: number | null = null;
  const setTimestamp = (timestamp: number | null) => {
    if (timestamp !== null && (latestTimestamp === null || timestamp > latestTimestamp)) latestTimestamp = timestamp;
  };

  for (const measure of Object.values(station.measures ?? {})) {
    const temperature = latestSeriesValue(measure, ["temperature"]);
    const humidity = latestSeriesValue(measure, ["humidity"]);
    const pressure = latestSeriesValue(measure, ["pressure", "absolutepressure"]);
    if (result.temperature === null) result.temperature = temperature.value;
    if (result.humidity === null) result.humidity = humidity.value;
    if (result.pressure === null) result.pressure = pressure.value;
    if (result.measurementTimes.temperature === null && temperature.timestamp !== null) result.measurementTimes.temperature = new Date(temperature.timestamp * 1000).toISOString();
    if (result.measurementTimes.humidity === null && humidity.timestamp !== null) result.measurementTimes.humidity = new Date(humidity.timestamp * 1000).toISOString();
    if (result.measurementTimes.pressure === null && pressure.timestamp !== null) result.measurementTimes.pressure = new Date(pressure.timestamp * 1000).toISOString();
    setTimestamp(temperature.timestamp);
    setTimestamp(humidity.timestamp);
    setTimestamp(pressure.timestamp);

    if (result.windSpeed === null) result.windSpeed = numberValue(measure.wind_strength);
    if (result.windGust === null) result.windGust = numberValue(measure.gust_strength);
    if (result.windDirection === null) result.windDirection = numberValue(measure.wind_angle);
    if (result.precipitation === null) result.precipitation = numberValue(measure.rain_60min) ?? numberValue(measure.rain_live);
    setTimestamp(numberValue(measure.wind_timeutc));
    setTimestamp(numberValue(measure.rain_utc));
    const windTime = numberValue(measure.wind_timeutc);
    const rainTime = numberValue(measure.rain_utc);
    if (windTime !== null) {
      const iso = new Date(windTime * 1000).toISOString();
      if (result.measurementTimes.windSpeed === null) result.measurementTimes.windSpeed = iso;
      if (result.measurementTimes.windGust === null) result.measurementTimes.windGust = iso;
      if (result.measurementTimes.windDirection === null) result.measurementTimes.windDirection = iso;
    }
    if (rainTime !== null && result.measurementTimes.precipitation === null) result.measurementTimes.precipitation = new Date(rainTime * 1000).toISOString();
  }
  if (latestTimestamp !== null) result.updatedAt = new Date(latestTimestamp * 1000).toISOString();
  return result;
}

export function mapNetatmoPublicStation(station: NetatmoPublicStation, refLat: number, refLon: number): StationData | null {
  const coordinates = station.place?.location;
  if (!station._id || !coordinates || coordinates.length !== 2) return null;
  const [lon, lat] = coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const modules = station.modules ?? [];
  const outdoor = modules.find((module) => module.type === "NAModule1")
    ?? (station.type === "NAModule1" ? station : undefined);
  const anemometer = modules.find((module) => module.type === "NAModule2");
  const rainGauge = modules.find((module) => module.type === "NAModule3");
  const publicMeasures = extractPublicMeasures(station);
  const temperature = dashboardNumber(outdoor, "Temperature", "temperature") ?? publicMeasures.temperature;
  const humidity = dashboardNumber(outdoor, "Humidity", "humidity") ?? publicMeasures.humidity;
  const pressure = dashboardNumber(station, "Pressure", "pressure") ?? publicMeasures.pressure;
  const windSpeed = dashboardNumber(anemometer, "WindStrength", "wind_strength") ?? publicMeasures.windSpeed;
  const windGust = dashboardNumber(anemometer, "GustStrength", "gust_strength") ?? publicMeasures.windGust;
  const windDirection = dashboardNumber(anemometer, "WindAngle", "wind_angle") ?? publicMeasures.windDirection;
  const precipitation = dashboardNumber(rainGauge, "sum_rain_1", "Rain") ?? publicMeasures.precipitation;
  if (temperature === null && windSpeed === null && precipitation === null) return null;
  return {
    stationId: `netatmo-${station._id}`,
    source: "netatmo",
    name: station.station_name?.trim() || station.place?.city || "Station Netatmo publique",
    lat,
    lon,
    altitude: numberValue(station.place?.altitude) ?? null,
    distanceKm: haversineKm(refLat, refLon, lat, lon),
    temperature,
    humidity,
    pressure,
    windSpeed,
    windGust,
    windDirection,
    precipitation,
    updatedAt: updatedAtFrom(station, modules) ?? publicMeasures.updatedAt,
    measurementTimes: {
      temperature: measurementTimeFrom(outdoor) ?? publicMeasures.measurementTimes.temperature,
      humidity: measurementTimeFrom(outdoor) ?? publicMeasures.measurementTimes.humidity,
      pressure: measurementTimeFrom(station) ?? publicMeasures.measurementTimes.pressure,
      windSpeed: measurementTimeFrom(anemometer) ?? publicMeasures.measurementTimes.windSpeed,
      windGust: measurementTimeFrom(anemometer) ?? publicMeasures.measurementTimes.windGust,
      windDirection: measurementTimeFrom(anemometer) ?? publicMeasures.measurementTimes.windDirection,
      precipitation: measurementTimeFrom(rainGauge) ?? publicMeasures.measurementTimes.precipitation,
    },
    reliabilityScore: 72,
    updateFrequencyMin: 10,
    dataAvailability: 0.75,
    isActive: true,
  };
}

type PersistedNetatmoObservation = {
  station: {
    stationId: string;
    source: string;
    name: string;
    lat: number;
    lon: number;
    altitude: number | null;
    reliabilityScore: number | null;
    updateFrequencyMin: number | null;
    dataAvailability: number | null;
    isActive: number | null;
    qualificationStatus: string;
    sourceTier: number | null;
  };
  observation: {
    observedAt: number;
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
    windSpeed: number | null;
    windGust: number | null;
    windDirection: number | null;
    precipitation: number | null;
  };
};

/** Map a fresh persisted Netatmo observation back to the same physical-station contract. */
export function mapPersistedNetatmoObservation(
  input: PersistedNetatmoObservation,
  refLat: number,
  refLon: number,
  radiusKm: number,
  nowMs = Date.now(),
): StationData | null {
  const { station, observation } = input;
  const ageMinutes = (nowMs - observation.observedAt) / 60_000;
  if (
    station.source !== "netatmo" ||
    !station.stationId.startsWith("netatmo-") ||
    station.isActive !== 1 ||
    station.qualificationStatus !== "validated" ||
    !Number.isFinite(observation.observedAt) ||
    ageMinutes < 0 ||
    ageMinutes > NETATMO_DASHBOARD_FALLBACK_MAX_AGE_MINUTES
  ) return null;
  const distanceKm = haversineKm(refLat, refLon, station.lat, station.lon);
  if (distanceKm > radiusKm) return null;
  if (observation.temperature === null && observation.windSpeed === null && observation.precipitation === null) return null;
  return {
    stationId: station.stationId,
    source: "netatmo",
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    altitude: station.altitude,
    distanceKm,
    temperature: observation.temperature,
    humidity: observation.humidity,
    pressure: observation.pressure,
    windSpeed: observation.windSpeed,
    windGust: observation.windGust,
    windDirection: observation.windDirection,
    precipitation: observation.precipitation,
    updatedAt: new Date(observation.observedAt).toISOString(),
    reliabilityScore: station.reliabilityScore ?? 72,
    updateFrequencyMin: station.updateFrequencyMin ?? 10,
    dataAvailability: station.dataAvailability ?? 0.75,
    isActive: true,
  };
}

async function fetchPersistedNetatmoFallback(lat: number, lon: number, radiusKm: number, onStatus?: NetatmoFetchOptions["onStatus"]) {
  const sinceMs = Date.now() - NETATMO_DASHBOARD_FALLBACK_MAX_AGE_MINUTES * 60_000;
  const persisted = await getRecentValidatedNetatmoObservations(sinceMs);
  const stations = persisted
    .map((entry) => mapPersistedNetatmoObservation(entry, lat, lon, radiusKm))
    .filter((station): station is StationData => station !== null);
  if (stations.length > 0) {
    console.info(`[Netatmo] ${stations.length} station(s) persistée(s) fraîche(s) utilisée(s) pendant l’indisponibilité de getpublicdata`);
    onStatus?.("fresh_cache");
  } else {
    onStatus?.("temporarily_unavailable");
  }
  return stations;
}

async function refreshNetatmoAccessToken(userId: number) {
  const stored = await getNetatmoOAuthToken(userId);
  if (!stored) return null;
  try {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.NETATMO_CLIENT_ID ?? "",
      client_secret: process.env.NETATMO_CLIENT_SECRET ?? "",
      refresh_token: decryptNetatmoRefreshToken(stored.encryptedRefreshToken),
    });
    const response = await fetch("https://api.netatmo.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json() as { access_token?: string; refresh_token?: string };
    if (!response.ok || !body.access_token || !body.refresh_token) {
      console.warn(`[Netatmo] Renouvellement du jeton indisponible (${response.status})`);
      return null;
    }
    await upsertNetatmoOAuthToken(userId, encryptNetatmoRefreshToken(body.refresh_token), stored.scopes);
    return body.access_token;
  } catch {
    console.warn("[Netatmo] Renouvellement du jeton impossible");
    return null;
  }
}

async function getNetatmoAccessToken(userId: number) {
  const pending = pendingAccessTokenRefreshes.get(userId);
  if (pending) return pending;

  const refresh = refreshNetatmoAccessToken(userId);
  pendingAccessTokenRefreshes.set(userId, refresh);
  try {
    return await refresh;
  } finally {
    pendingAccessTokenRefreshes.delete(userId);
  }
}

export async function fetchNetatmoPublicStations(
  userId: number | undefined,
  lat: number,
  lon: number,
  radiusKm: number,
  options: NetatmoFetchOptions = {},
) {
  if (!userId) {
    options.onStatus?.("not_connected");
    return [];
  }
  const accessToken = await getNetatmoAccessToken(userId);
  if (!accessToken) {
    options.onStatus?.("not_connected");
    return [];
  }
  const deltaLat = radiusKm / 111.32;
  const deltaLon = radiusKm / Math.max(111.32 * Math.cos((lat * Math.PI) / 180), 1);
  const query = new URLSearchParams({
    lat_ne: (lat + deltaLat).toFixed(6),
    lon_ne: (lon + deltaLon).toFixed(6),
    lat_sw: (lat - deltaLat).toFixed(6),
    lon_sw: (lon - deltaLon).toFixed(6),
    filter: "true",
  });
  try {
    const response = await fetch(`https://api.netatmo.com/api/getpublicdata?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json() as { body?: NetatmoPublicStation[]; error?: { code?: number; message?: string } | string };
    if (!response.ok) {
      const errorCode = typeof body.error === "object" ? body.error.code : body.error;
      console.warn(`[Netatmo] getpublicdata indisponible (${response.status}${errorCode ? ` · ${errorCode}` : ""})`);
      return fetchPersistedNetatmoFallback(lat, lon, radiusKm, options.onStatus);
    }
    if (!Array.isArray(body.body)) {
      console.warn("[Netatmo] getpublicdata a renvoyé un format inattendu");
      return fetchPersistedNetatmoFallback(lat, lon, radiusKm, options.onStatus);
    }
    const stations = body.body.map((station) => mapNetatmoPublicStation(station, lat, lon)).filter((station): station is StationData => station !== null);
    console.info(`[Netatmo] ${stations.length} station(s) publique(s) authentifiée(s) trouvée(s) dans ${radiusKm} km`);
    options.onStatus?.(stations.length > 0 ? "live" : "connected_empty");
    return stations;
  } catch {
    console.warn("[Netatmo] getpublicdata est indisponible");
    return fetchPersistedNetatmoFallback(lat, lon, radiusKm, options.onStatus);
  }
}
