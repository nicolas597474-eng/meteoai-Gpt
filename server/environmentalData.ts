import {terrainSamples,terrainHorizon,TERRAIN_AZIMUTH_STEP_DEG,TERRAIN_OBSERVER_HEIGHT_M} from '../shared/terrainHorizon';
import { fetchWeather, getWeatherResponseReceivedAt } from "./weatherFetch";
import {observeOpenMeteo} from './openMeteoTraffic';
import { buildAstronomyOutlook, type AstronomyOutlook } from "./astronomyEvents";
import type { Body as AstronomyBody, Observer as AstronomyObserver } from "astronomy-engine";
import * as Astronomy from "astronomy-engine";



export type AqiDescriptor = {
  label: string;
  tone: "emerald" | "lime" | "amber" | "orange" | "rose" | "slate";
};

export function getEuropeanAqiDescriptor(value: number | null): AqiDescriptor {
  if (value == null || !Number.isFinite(value)) return { label: "Indisponible", tone: "slate" };
  if (value <= 20) return { label: "Bon", tone: "emerald" };
  if (value <= 40) return { label: "Acceptable", tone: "lime" };
  if (value <= 60) return { label: "Moyen", tone: "amber" };
  if (value <= 80) return { label: "Mauvais", tone: "orange" };
  if (value <= 100) return { label: "Très mauvais", tone: "rose" };
  return { label: "Extrêmement mauvais", tone: "rose" };
}

export function getMoonPhaseDescriptor(value: number | null) {
  if (value == null || !Number.isFinite(value)) return { label: "Phase indisponible", symbol: "○" };
  const phase = ((value % 1) + 1) % 1;
  if (phase < 0.03 || phase >= 0.97) return { label: "Nouvelle lune", symbol: "●" };
  if (phase < 0.22) return { label: "Premier croissant", symbol: "◔" };
  if (phase < 0.28) return { label: "Premier quartier", symbol: "◐" };
  if (phase < 0.47) return { label: "Gibbeuse croissante", symbol: "◕" };
  if (phase < 0.53) return { label: "Pleine lune", symbol: "●" };
  if (phase < 0.72) return { label: "Gibbeuse décroissante", symbol: "◕" };
  if (phase < 0.78) return { label: "Dernier quartier", symbol: "◐" };
  return { label: "Dernier croissant", symbol: "◔" };
}

export function getMoonIllumination(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(50 * (1 - Math.cos(Math.PI * 2 * value)));
}

export type AstronomicalMoonPhase = {
  angleDeg: number;
  label: string;
  symbol: string;
  waxing: boolean;
  illuminationPct: number;
  illuminationFraction: number;
  brightLimbAngleDeg: number;
  librationLongitudeDeg: number;
  librationLatitudeDeg: number;
  lunarNorthPoleAngleDeg: number;
};

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function roundNormalizedDegrees(value: number) {
  const rounded = Math.round(normalizeDegrees(value) * 10) / 10;
  return rounded >= 360 ? 0 : rounded;
}

export function getAstronomicalMoonPhase(instant: Date, observer: AstronomyObserver): AstronomicalMoonPhase {
  const angleDeg = normalizeDegrees(Astronomy.MoonPhase(instant));
  const roundedAngleDeg = roundNormalizedDegrees(angleDeg);
  const illuminationFraction = Astronomy.Illumination(Astronomy.Body.Moon, instant).phase_fraction;
  const illuminationPct = Math.round(illuminationFraction * 100);
  const waxing = roundedAngleDeg > 0 && roundedAngleDeg < 180;
  const label = angleDeg < 5 || angleDeg >= 355 ? "Nouvelle lune"
    : angleDeg < 85 ? "Premier croissant"
      : angleDeg <= 95 ? "Premier quartier"
        : angleDeg < 175 ? "Gibbeuse croissante"
          : angleDeg <= 185 ? "Pleine lune"
            : angleDeg < 265 ? "Gibbeuse décroissante"
              : angleDeg <= 275 ? "Dernier quartier"
                : "Dernier croissant";
  const symbol = label === "Pleine lune" ? "●" : label.includes("quartier") ? "◐" : label.includes("Gibbeuse") ? "◕" : label === "Nouvelle lune" ? "●" : "◔";
  const moon = Astronomy.Equator(Astronomy.Body.Moon, instant, observer, true, true);
  const sun = Astronomy.Equator(Astronomy.Body.Sun, instant, observer, true, true);
  const raDelta = (sun.ra - moon.ra) * 15 * Math.PI / 180;
  const moonDec = moon.dec * Math.PI / 180;
  const sunDec = sun.dec * Math.PI / 180;
  const brightLimbPositionAngle = Math.atan2(Math.cos(sunDec) * Math.sin(raDelta), Math.sin(sunDec) * Math.cos(moonDec) - Math.cos(sunDec) * Math.sin(moonDec) * Math.cos(raDelta));
  const hourAngle = Astronomy.HourAngle(Astronomy.Body.Moon, instant, observer) * 15 * Math.PI / 180;
  const latitude = observer.latitude * Math.PI / 180;
  const parallacticAngle = Math.atan2(Math.sin(hourAngle), Math.tan(latitude) * Math.cos(moonDec) - Math.sin(moonDec) * Math.cos(hourAngle));
  const lunarPoleJ2000 = Astronomy.VectorFromSphere(new Astronomy.Spherical(66.5392, 269.9949, 1), instant);
  const lunarPoleOfDate = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(instant), lunarPoleJ2000);
  const lunarPole = Astronomy.EquatorFromVector(lunarPoleOfDate);
  const poleRaDelta = (lunarPole.ra * 15 - moon.ra * 15) * Math.PI / 180;
  const poleDec = lunarPole.dec * Math.PI / 180;
  const lunarPolePositionAngle = Math.atan2(Math.cos(poleDec) * Math.sin(poleRaDelta), Math.sin(poleDec) * Math.cos(moonDec) - Math.cos(poleDec) * Math.sin(moonDec) * Math.cos(poleRaDelta));
  const libration = Astronomy.Libration(instant);
  return {
    angleDeg: roundedAngleDeg,
    label,
    symbol,
    waxing,
    illuminationPct,
    illuminationFraction,
    brightLimbAngleDeg: roundNormalizedDegrees((brightLimbPositionAngle - parallacticAngle) * 180 / Math.PI),
    librationLongitudeDeg: libration.elon,
    librationLatitudeDeg: libration.elat,
    lunarNorthPoleAngleDeg: roundNormalizedDegrees((lunarPolePositionAngle - parallacticAngle) * 180 / Math.PI),
  };
}

export function roundAltitudeDegrees(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

export type ApparentBodyPosition = {
  altitudeDeg: number | null;
  azimuthDeg: number | null;
  distanceKm: number | null;
  aboveHorizon: boolean;
};

export type ApparentTrajectoryPoint = ApparentBodyPosition & {
  at: string;
};

export type ApparentAstronomyPosition = {
  sun: ApparentBodyPosition;
  moon: ApparentBodyPosition;
  lunar: AstronomicalMoonPhase;
  events: {
    sun: { rise: string | null; culmination: string | null; set: string | null };
    moon: { rise: string | null; culmination: string | null; set: string | null };
  };
  trajectory: {
    sun: ApparentTrajectoryPoint[];
    moon: ApparentTrajectoryPoint[];
  };
  calculatedAt: string;
};

function getApparentBodyPosition(body: AstronomyBody, instant: Date, observer: AstronomyObserver): ApparentBodyPosition {
  const equator = Astronomy.Equator(body, instant, observer, true, true);
  const horizon = Astronomy.Horizon(instant, observer, equator.ra, equator.dec, "normal");
  const altitudeDeg = roundAltitudeDegrees(horizon.altitude);
  const azimuthDeg = roundAltitudeDegrees(horizon.azimuth);
  const distanceKm = Number.isFinite(equator.dist) ? Math.round(equator.dist * 149_597_870.7) : null;
  return {
    altitudeDeg,
    azimuthDeg,
    distanceKm,
    aboveHorizon: Number.isFinite(horizon.altitude) && horizon.altitude > 0,
  };
}

/** Bornes du jour civil demandé, y compris les journées de 23/25 h. */
export function getAstronomyDayBounds(instant:Date,timeZone='Europe/Paris'){
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const parts=(date:Date)=>Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
 const local=parts(instant),midnight=Date.UTC(Number(local.year),Number(local.month)-1,Number(local.day));
 const resolve=(target:number)=>{let guess=target;for(let i=0;i<3;i++){const p=parts(new Date(guess));const wall=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));guess+=target-wall;}return new Date(guess);};
 return {start:resolve(midnight),end:resolve(midnight+86400000)};
}

function getApparentTrajectory(body: AstronomyBody, observer: AstronomyObserver, instant: Date): ApparentTrajectoryPoint[] {
  const {start,end}=getAstronomyDayBounds(instant);
  return Array.from({ length: Math.round((end.getTime()-start.getTime())/1800000)+1 }, (_, index) => {
    const sampledAt = new Date(start.getTime() + index * 30 * 60_000);
    return { ...getApparentBodyPosition(body, sampledAt, observer), at: sampledAt.toISOString() };
  });
}

function getAstronomicalEvents(body: AstronomyBody, observer: AstronomyObserver, instant: Date) {
  const {start,end}=getAstronomyDayBounds(instant);
  const duration=(end.getTime()-start.getTime())/86400000;
  const rise = Astronomy.SearchRiseSet(body, observer, 1, start, duration);
  const set = Astronomy.SearchRiseSet(body, observer, -1, start, duration);
  const culmination = Astronomy.SearchHourAngle(body, observer, 0, start, 1);
  return { rise: rise?.date.toISOString() ?? null, culmination: culmination&&culmination.time.date<end?culmination.time.date.toISOString():null, set: set?.date.toISOString() ?? null };
}

type AstronomyDayData={events:ApparentAstronomyPosition['events'];trajectory:ApparentAstronomyPosition['trajectory']};
const astronomyDays=new Map<string,AstronomyDayData>();
function getAstronomyDayData(coords:{lat:number;lon:number},observer:AstronomyObserver,instant:Date):AstronomyDayData{
 const {start,end}=getAstronomyDayBounds(instant),key=`${coords.lat},${coords.lon}/${start.toISOString()}/${end.toISOString()}`;
 const existing=astronomyDays.get(key);
 if(existing){astronomyDays.delete(key);astronomyDays.set(key,existing);return structuredClone(existing);}
 const value={events:{sun:getAstronomicalEvents(Astronomy.Body.Sun,observer,instant),moon:getAstronomicalEvents(Astronomy.Body.Moon,observer,instant)},trajectory:{sun:getApparentTrajectory(Astronomy.Body.Sun,observer,instant),moon:getApparentTrajectory(Astronomy.Body.Moon,observer,instant)}};
 astronomyDays.set(key,value);while(astronomyDays.size>32)astronomyDays.delete(astronomyDays.keys().next().value!);
 return structuredClone(value);
}

/** Daily paths/events are shared; instantaneous positions and lunar appearance stay current. */
export function getApparentAstronomyPosition(coords: { lat: number; lon: number }, instant = new Date()): ApparentAstronomyPosition {
  const observer = new Astronomy.Observer(coords.lat, coords.lon, 0);
  const day=getAstronomyDayData(coords,observer,instant);
  return {
    sun: getApparentBodyPosition(Astronomy.Body.Sun, instant, observer),
    moon: getApparentBodyPosition(Astronomy.Body.Moon, instant, observer),
    lunar: getAstronomicalMoonPhase(instant, observer),
    events: day.events,
    trajectory: day.trajectory,
    calculatedAt: instant.toISOString(),
  };
}

/* ─── Profil de relief local ─── */

export type TerrainHorizonPoint = {
  azimuthDeg: number;
  elevationDeg: number;
};

export type TerrainHorizonProfile = {
  points: TerrainHorizonPoint[];
  observerElevationM: number;
  resolutionM: number;
  source: string;
  maxDistanceKm:number;
  azimuthStepDeg:number;
  observerHeightM:number;
};

const terrainCache = new Map<string, { expiresAt: number; value: TerrainHorizonProfile }>();
const terrainPending = new Map<string,Promise<TerrainHorizonProfile>>();

/** DEM Copernicus GLO-90 : 36 directions, 10 distances entre 100 m et 50 km.
 * Maximum des angles le long de chaque rayon ; courbure terrestre incluse.
 * Le profil reste estimé : pas de bâtiments, végétation ou réfraction. */
export async function getTerrainHorizonProfile(coords: { lat: number; lon: number }): Promise<TerrainHorizonProfile> {
 const samples=terrainSamples(coords),key=`${coords.lat},${coords.lon}`;
 const cached=terrainCache.get(key);
 if(cached&&cached.expiresAt>Date.now())return cached.value;
 const pending=terrainPending.get(key);if(pending)return pending;
 const task=(async()=>{
  const locations=[coords,...samples],elevations:number[]=[];
  // Limite documentée : 100 coordonnées par appel. Requêtes séquentielles bornées.
  for(let offset=0;offset<locations.length;offset+=100){
   const batch=locations.slice(offset,offset+100),url=new URL('https://api.open-meteo.com/v1/elevation');
   url.searchParams.set('latitude',batch.map(p=>p.lat.toFixed(6)).join(','));
   url.searchParams.set('longitude',batch.map(p=>p.lon.toFixed(6)).join(','));
   const response=await fetchWeather(url,{}, {timeoutMs:4500,attempts:1,cacheTtlMs:86400000});
   if(!response.ok)throw new Error('Profil de relief indisponible.');
   const json=await response.json() as {elevation?:unknown[]};
   if(!Array.isArray(json.elevation)||json.elevation.length!==batch.length||!json.elevation.every(value=>typeof value==='number'&&Number.isFinite(value)))throw new Error('Profil de relief incomplet : aucune altitude n’est remplacée par zéro.');
   elevations.push(...json.elevation as number[]);
  }
  const observerElevationM=elevations[0];
  const profile:TerrainHorizonProfile={points:terrainHorizon(samples,elevations.slice(1),observerElevationM),observerElevationM:Math.round(observerElevationM),resolutionM:90,source:'Copernicus GLO-90 via Open-Meteo',maxDistanceKm:50,azimuthStepDeg:TERRAIN_AZIMUTH_STEP_DEG,observerHeightM:TERRAIN_OBSERVER_HEIGHT_M};
  if(terrainCache.size>=32)terrainCache.delete(terrainCache.keys().next().value!);
  terrainCache.set(key,{value:profile,expiresAt:Date.now()+86400000});return profile;
 })();
 terrainPending.set(key,task);
 try{return await task;}finally{terrainPending.delete(key);}
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toMinutes(time: string | null | undefined) {
  const match = time?.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function getMinutesInTimeZone(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function resolveTimeZone(value: unknown) {
  if (typeof value !== "string") return "UTC";
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function calculateDayProgress(sunrise: string | null, sunset: string | null, timeZone: string) {
  const zonedMinutes=(value:string|null)=>value&&/(Z|[+-]\d{2}:\d{2})$/.test(value)?getMinutesInTimeZone(timeZone,new Date(value)):toMinutes(value);
  const start = zonedMinutes(sunrise);
  const end = zonedMinutes(sunset);
  if (start == null || end == null || end <= start) return null;
  return Math.max(0, Math.min(1, (getMinutesInTimeZone(timeZone) - start) / (end - start)));
}

export type EnvironmentalJsonCache = {
 get(url:URL):Promise<Record<string,any>|null>;
 put(url:URL,value:Record<string,any>,receivedAt:number):Promise<void>;
};
type EnvironmentalOptions={online?:boolean;jsonCache?:EnvironmentalJsonCache};
async function fetchJson(url: URL,cacheTtlMs=20_000,jsonCache?:EnvironmentalJsonCache) {
  try{const stored=await jsonCache?.get(url);if(stored){observeOpenMeteo(url,'cache');return stored;}}catch{/* Device storage is optional. */}
  const remainingDay=getAstronomyDayBounds(new Date()).end.getTime()-Date.now();
  const response = await fetchWeather(url, {}, { timeoutMs: 5_000, attempts: 2,cacheTtlMs:Math.min(cacheTtlMs,Math.max(0,remainingDay)) });
  if (!response.ok) throw new Error(`Source environnementale indisponible (HTTP ${response.status}).`);
  const data=await response.json() as Record<string,any>;
  if(data?.error)throw new Error("Source environnementale inexploitable.");
  const receivedAt=getWeatherResponseReceivedAt(response);
  if(receivedAt!==null)try{await jsonCache?.put(url,data,receivedAt);}catch{/* Keep valid network data if device storage is unavailable. */}
  return data;
}

export type EnvironmentalSnapshot = {
  air: {
    aqi: number | null;
    descriptor: AqiDescriptor;
    pm25: number | null;
    pm10: number | null;
    nitrogenDioxide: number | null;
    ozone: number | null;
    observedAt: string | null;
    hourly: Array<{ time: string; value: number }>;
  } | null;
  astronomy: {
    sunrise: string | null;
    sunset: string | null;
    daylightDurationSeconds: number | null;
    moonrise: string | null;
    moonset: string | null;
    sunCulmination: string | null;
    moonCulmination: string | null;
    moonPhase: number | null;
    moon: ReturnType<typeof getMoonPhaseDescriptor>;
    moonIllumination: number | null;
    lunar: AstronomicalMoonPhase;
    dayProgress: number | null;
    sunAltitudeDeg: number | null;
    moonAltitudeDeg: number | null;
    sunAzimuthDeg: number | null;
    moonAzimuthDeg: number | null;
    sunAboveHorizon: boolean;
    moonAboveHorizon: boolean;
    altitudeCalculatedAt: string;
    timezone: string;
    cloudCover: number | null;
    outlook: AstronomyOutlook;
    coordinates: { lat: number; lon: number };
  } | null;
  source: "Open-Meteo / CAMS";
  timezone: string;
};

const snapshotCache = new Map<string, { expiresAt: number; value: EnvironmentalSnapshot }>();
const snapshotFlights=new Map<string,Promise<EnvironmentalSnapshot>>();

async function collectEnvironmentalSnapshot(coords: { lat: number; lon: number }, options:EnvironmentalOptions={}): Promise<EnvironmentalSnapshot> {
  if(!Number.isFinite(coords.lat)||!Number.isFinite(coords.lon)||Math.abs(coords.lat)>90||Math.abs(coords.lon)>180)throw new Error("Coordonnées environnementales invalides.");
  const key = `${coords.lat},${coords.lon}/${getAstronomyDayBounds(new Date()).start.toISOString()}`;
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.search = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    daily: "sunrise,sunset,daylight_duration,cloud_cover_mean",
    current: "cloud_cover",
    forecast_days: "16",
    timezone: "Europe/Paris",
  }).toString();

  const airUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  airUrl.search = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    current: "european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone",
    hourly: "european_aqi",
    forecast_hours: "24",
    timezone: "Europe/Paris",
  }).toString();

  const [weatherResult, airResult] = await Promise.allSettled(options.online===false?[Promise.reject(new Error("Hors ligne")),Promise.reject(new Error("Hors ligne"))]:[fetchJson(weatherUrl,10*60_000,options.jsonCache), fetchJson(airUrl,20*60_000,options.jsonCache)]);
  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
  const airResponse = airResult.status === "fulfilled" ? airResult.value : null;
  const timezone = resolveTimeZone(weather?.timezone ?? airResponse?.timezone ?? "Europe/Paris");

  const daily = weather?.daily ?? null;
  const dailyDates = Array.isArray(daily?.time) ? daily.time.filter((value: unknown): value is string => typeof value === "string") : [];
  const dailyMoonPhases = dailyDates.map((date:string)=>Astronomy.MoonPhase(new Date(date+"T12:00:00Z"))/360);
  const dailyDaylightDurations = Array.isArray(daily?.daylight_duration) ? daily.daylight_duration.map(asNumber) : [];
  const dailyCloudCoverMeans = Array.isArray(daily?.cloud_cover_mean) ? daily.cloud_cover_mean.map(asNumber) : [];
  const sunrise = typeof daily?.sunrise?.[0] === "string" ? daily.sunrise[0] : null;
  const sunset = typeof daily?.sunset?.[0] === "string" ? daily.sunset[0] : null;
  const moonPhase = asNumber(daily?.moon_phase?.[0]);
  const currentAir = airResponse?.current ?? null;
  const hourlyTimes = Array.isArray(airResponse?.hourly?.time) ? airResponse.hourly.time : [];
  const hourlyValues = Array.isArray(airResponse?.hourly?.european_aqi) ? airResponse.hourly.european_aqi : [];
  const hourly = hourlyTimes
    .map((time: unknown, index: number) => ({ time: typeof time === "string" ? time : "", value: asNumber(hourlyValues[index]) }))
    .filter((point: { time: string; value: number | null }): point is { time: string; value: number } => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(point.time) && point.value != null && point.value >= 0)
    .slice(0, 24);
  const nonNegative=(value:unknown)=>{const number=asNumber(value);return number!=null&&number>=0?number:null;};
  const aqi = nonNegative(currentAir?.european_aqi);
  const altitudeCalculatedAt = new Date();
  const apparentPosition = getApparentAstronomyPosition(coords, altitudeCalculatedAt);

  const value: EnvironmentalSnapshot = {
    air: airResponse ? {
      aqi,
      descriptor: getEuropeanAqiDescriptor(aqi),
      pm25: nonNegative(currentAir?.pm2_5),
      pm10: nonNegative(currentAir?.pm10),
      nitrogenDioxide: nonNegative(currentAir?.nitrogen_dioxide),
      ozone: nonNegative(currentAir?.ozone),
      observedAt: typeof currentAir?.time === "string" ? currentAir.time : null,
      hourly,
    } : null,
    astronomy: {
      sunrise: apparentPosition.events.sun.rise ?? sunrise,
      sunset: apparentPosition.events.sun.set ?? sunset,
      daylightDurationSeconds: asNumber(daily?.daylight_duration?.[0]) ?? (apparentPosition.events.sun.rise&&apparentPosition.events.sun.set ? Math.max(0,(Date.parse(apparentPosition.events.sun.set)-Date.parse(apparentPosition.events.sun.rise))/1000):null),
      moonrise: apparentPosition.events.moon.rise ?? (typeof daily?.moonrise?.[0] === "string" ? daily.moonrise[0] : null),
      moonset: apparentPosition.events.moon.set ?? (typeof daily?.moonset?.[0] === "string" ? daily.moonset[0] : null),
      sunCulmination: apparentPosition.events.sun.culmination,
      moonCulmination: apparentPosition.events.moon.culmination,
      moonPhase: apparentPosition.lunar.angleDeg,
      moon: { label: apparentPosition.lunar.label, symbol: apparentPosition.lunar.symbol },
      moonIllumination: apparentPosition.lunar.illuminationPct,
      lunar: apparentPosition.lunar,
      dayProgress: calculateDayProgress(apparentPosition.events.sun.rise??sunrise, apparentPosition.events.sun.set??sunset, timezone),
      sunAltitudeDeg: apparentPosition.sun.altitudeDeg,
      moonAltitudeDeg: apparentPosition.moon.altitudeDeg,
      sunAzimuthDeg: apparentPosition.sun.azimuthDeg,
      moonAzimuthDeg: apparentPosition.moon.azimuthDeg,
      sunAboveHorizon: apparentPosition.sun.aboveHorizon,
      moonAboveHorizon: apparentPosition.moon.aboveHorizon,
      altitudeCalculatedAt: altitudeCalculatedAt.toISOString(),
      timezone,
      cloudCover: asNumber(weather?.current?.cloud_cover),
      outlook: buildAstronomyOutlook({
        dates: dailyDates,
        moonPhases: dailyMoonPhases,
        daylightDurations: dailyDaylightDurations,
        cloudCoverMeans: dailyCloudCoverMeans,
        today: dailyDates[0] ?? new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(altitudeCalculatedAt),
        referenceInstant: altitudeCalculatedAt,
        timeZone: timezone,
      }),
      coordinates: { lat: coords.lat, lon: coords.lon },
    },
    source: "Open-Meteo / CAMS",
    timezone,
  };

  if(snapshotCache.size>=8&&!snapshotCache.has(key))snapshotCache.delete(snapshotCache.keys().next().value!);
  if(options.online!==false&&(weather||airResponse))snapshotCache.set(key, { value, expiresAt: Date.now() + (weather&&airResponse?10*60:30)*1_000 });
  return value;
}

/** Une seule collecte publique par lieu lors de montages simultanés. */
export async function getEnvironmentalSnapshot(coords:{lat:number;lon:number},options:EnvironmentalOptions={}){
 const key=coords.lat+','+coords.lon+'|'+(options.online!==false);
 const prior=snapshotFlights.get(key);if(prior)return prior;
 const pending=collectEnvironmentalSnapshot(coords,options).finally(()=>snapshotFlights.delete(key));
 snapshotFlights.set(key,pending);return pending;
}
