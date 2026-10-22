/**
 * Comparaison shadow AROME à Hondeghem — mode shadow uniquement : aucun résultat
 * n’écrit en base, ne modifie les prévisions affichées, Best Match, les fusions
 * journalières, la Vigilance, l’agrégation Netatmo ni le score de fiabilité.
 *
 * Chemin par défaut (depuis le retrait du WCS) : AROME est récupéré uniquement
 * via Open-Meteo, sans clé Météo-France — série Forecast
 * `models=meteofrance_arome_france_hd` comparée, pour le run prouvé par les
 * métadonnées du modèle Open-Meteo, à la série Single Runs du même run.
 * Aucune lecture de `METEOFRANCE_API_KEY`, aucun appel OAuth2/WCS/GeoTIFF et
 * donc aucune erreur 401/404 issue de l’API authentifiée dans ce chemin.
 *
 * Chemin hérité WCS/GeoTIFF : conservé mais désactivé par défaut derrière
 * `AROME_WCS_ENABLED=true` (voir `isAromeWcsEnabled`), pour rester réversible.
 * Lui seul lit l’identifiant Météo-France et peut produire les statuts
 * `missing-key` / `invalid-key` / `authentication-error`.
 */
import { fromArrayBuffer } from "geotiff";
import { ENV } from "./_core/env";
import { inspectMeteoFranceCredential } from "./meteoFranceCredentials";
import { singleRunMetadataUrl } from "./providerRunHorizon";
import { HONDEGHEM } from "./weatherServices";

export const AROME_WCS_PROFILE = "MF-NWP-HIGHRES-AROME-001-FRANCE-WCS";
const AROME_WCS_BASE = `https://public-api.meteofrance.fr/public/arome/1.0/wcs/${AROME_WCS_PROFILE}`;
const METEOFRANCE_TOKEN_URL = "https://portail-api.meteofrance.fr/token";
const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_SINGLE_RUNS = "https://single-runs-api.open-meteo.com/v1/forecast";
const OPEN_METEO_MODEL = "meteofrance_arome_france_hd";
const MAX_HOURS = 24;
/** Fenêtre Single Runs : le run + le lendemain suffisent pour couvrir MAX_HOURS échéances. */
export const SINGLE_RUN_FORECAST_DAYS = Math.max(1, Math.ceil(MAX_HOURS / 24) + 1);
/** Runs candidats essayés au maximum pour l’alignement : un par cycle récent, jamais davantage. */
export const MAX_ALIGNED_RUN_ATTEMPTS = 3;
/** Lecture des métadonnées de run Open-Meteo : une panne ne doit jamais bloquer la comparaison. */
const OPEN_METEO_RUN_METADATA_TIMEOUT_MS = 10_000;
const METRICS = ["temperature", "precipitation", "windSpeed", "windDirection"] as const;
export type AromeShadowMetric = typeof METRICS[number];
/** Variables que le chemin hérité WCS savait récupérer; la direction DD(10 m) n’y a jamais été confirmée. */
const WCS_METRICS = ["temperature", "precipitation", "windSpeed"] as const;
type AromeWcsMetric = typeof WCS_METRICS[number];
export type AromeShadowStatus = "ok" | "partial" | "missing-key" | "invalid-key" | "authentication-error" | "request-impossible";

/**
 * Le WCS Météo-France authentifié est-il explicitement réactivé ?
 * Désactivé par défaut : seule la valeur `true` (insensible à la casse) de la
 * variable d’environnement `AROME_WCS_ENABLED` — ou l’option explicite des
 * appels/tests — réactive le chemin hérité, de façon réversible.
 */
export function isAromeWcsEnabled(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  return (process.env.AROME_WCS_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * Écart angulaire minimal entre deux directions, en degrés dans [0, 180].
 * Une direction est circulaire : 350° et 10° sont à 20° l’un de l’autre
 * (passage par le nord), pas à 340°. Renvoie `null` si une valeur manque :
 * aucun écart n’est inventé.
 */
export function angularDifferenceDegrees(left: number | null | undefined, right: number | null | undefined): number | null {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  const raw = Math.abs(((left - right) % 360 + 360) % 360);
  return Math.round(Math.min(raw, 360 - raw) * 100) / 100;
}

function normalizeDirectionDegrees(value: number): number {
  return Math.round((((value % 360) + 360) % 360) * 100) / 100;
}

/** Moyenne circulaire de directions (350° et 10° donnent 0°, pas 180°); `null` sans valeur exploitable. */
function circularMeanDegrees(values: number[]): number | null {
  if (!values.length) return null;
  const radians = values.map((value) => (value * Math.PI) / 180);
  const sin = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  const cos = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  if (Math.hypot(sin, cos) < 1e-12) return null;
  return normalizeDirectionDegrees((Math.atan2(sin, cos) * 180) / Math.PI);
}

const COVERAGE_PATTERNS: Record<AromeWcsMetric, RegExp> = {
  temperature: /^TEMPERATURE__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___/i,
  precipitation: /^TOTAL_WATER_PRECIPITATION__GROUND_OR_WATER_SURFACE___/i,
  windSpeed: /^WIND_SPEED__SPECIFIC_HEIGHT_LEVEL_ABOVE_GROUND___/i,
};
const METRIC_UNITS: Record<AromeShadowMetric, string> = {
  temperature: "°C",
  precipitation: "mm / heure",
  windSpeed: "km/h",
  windDirection: "°",
};

export interface AromeShadowMetricValue {
  arome: number | null;
  openMeteoArome: number | null;
  difference: number | null;
  unit: string;
  issue?: string;
}
export interface AromeShadowHour {
  validAt: string;
  metrics: Record<AromeShadowMetric, AromeShadowMetricValue>;
}
export interface AromeShadowDailyMetric {
  arome: number | null;
  openMeteoArome: number | null;
  difference: number | null;
  unit: string;
  hours: number;
}
export interface AromeShadowDaily {
  date: string;
  metrics: Record<AromeShadowMetric, AromeShadowDailyMetric>;
}
export interface AromeHondeghemShadowResult {
  status: AromeShadowStatus;
  message: string;
  location: { name: "Hondeghem"; lat: number; lon: number };
  profile: string;
  openMeteoModel: string;
  /** Run AROME prouvé par les métadonnées du modèle Open-Meteo; `null` = « run non prouvé », jamais inventé. */
  run: string | null;
  openMeteoRun: string | null;
  /** `true` uniquement si le run vient des métadonnées du modèle Open-Meteo (et, en mode WCS hérité, du catalogue commun). */
  runProven: boolean;
  comparedAt: string;
  hourly: AromeShadowHour[];
  daily: AromeShadowDaily[];
  missing: string[];
}

interface CoverageChoice {
  metric: AromeWcsMetric;
  id: string;
  run: string;
  period: string | null;
}
interface CoverageMetadata {
  validAt: string[];
  heights: number[];
  unit: string | null;
  axisLabels: string[];
  axisUnits: Record<string, string>;
}
interface ForecastSeries {
  time: string[];
  temperature: Array<number | null>;
  precipitation: Array<number | null>;
  windSpeed: Array<number | null>;
  windDirection: Array<number | null>;
}
type FetchLike = typeof fetch;

function emptyMetric(metric: AromeShadowMetric, issue?: string): AromeShadowMetricValue {
  return { arome: null, openMeteoArome: null, difference: null, unit: METRIC_UNITS[metric], ...(issue ? { issue } : {}) };
}
function baseResult(status: AromeShadowStatus, message: string, comparedAt: string, profile: string = AROME_WCS_PROFILE): AromeHondeghemShadowResult {
  return {
    status,
    message,
    location: { name: "Hondeghem", lat: HONDEGHEM.lat, lon: HONDEGHEM.lon },
    profile,
    openMeteoModel: OPEN_METEO_MODEL,
    run: null,
    openMeteoRun: null,
    runProven: false,
    comparedAt,
    hourly: [],
    daily: [],
    missing: [],
  };
}
function localTagText(xml: string, localName: string): string[] {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) values.push(match[1].replace(/<[^>]*>/g, "").trim());
  return values;
}
function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function localTagBlocks(xml: string, localName: string): string[] {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) values.push(match[1]);
  return values;
}
function parseRunFromCoverageId(id: string): { run: string; period: string | null } | null {
  const match = id.match(/___(\d{4}-\d{2}-\d{2}T\d{2}\.\d{2}\.\d{2}Z)(?:_(P[T\dHMS]+))?$/i);
  if (!match) return null;
  const run = match[1].replace(/(\d{2})\.(\d{2})\.(\d{2})Z$/, "$1:$2:$3Z");
  return Number.isFinite(Date.parse(run)) ? { run, period: match[2] ?? null } : null;
}
interface CatalogueRun {
  run: string;
  choices: Partial<Record<AromeWcsMetric, CoverageChoice>>;
}

function chooseLatestRun(coverageIds: string[]): CatalogueRun | null {
  return rankCatalogueRuns(coverageIds)[0] ?? null;
}
/** Tous les runs du catalogue, du plus récent au plus ancien, avec leurs couvertures reconnues. */
function rankCatalogueRuns(coverageIds: string[]): CatalogueRun[] {
  const byRun = new Map<string, Partial<Record<AromeWcsMetric, CoverageChoice>>>();
  for (const id of coverageIds) {
    const parsedRun = parseRunFromCoverageId(id);
    if (!parsedRun) continue;
    const metric = WCS_METRICS.find((candidate) => COVERAGE_PATTERNS[candidate].test(id));
    if (!metric) continue;
    if (metric === "precipitation" && parsedRun.period !== "PT1H") continue;
    const choices = byRun.get(parsedRun.run) ?? {};
    if (!choices[metric]) choices[metric] = { metric, id: decodeXml(id), run: parsedRun.run, period: parsedRun.period };
    byRun.set(parsedRun.run, choices);
  }
  return Array.from(byRun.entries())
    .filter(([, choices]) => choices.temperature || choices.windSpeed || choices.precipitation)
    .sort(([a], [b]) => Date.parse(b) - Date.parse(a))
    .map(([run, choices]) => ({ run, choices }));
}
function advertisedGeoTiffFormat(xml: string): string | null {
  const supported: string[] = [...localTagText(xml, "formatSupported")];
  const parameterPattern = /<(?:[\w.-]+:)?Parameter\b[^>]*\bname=["']format["'][^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?Parameter\s*>/gi;
  let parameterMatch: RegExpExecArray | null;
  while ((parameterMatch = parameterPattern.exec(xml)) !== null) supported.push(...localTagText(parameterMatch[1], "Value"));
  const normalized = supported.map(decodeXml).map((value) => value.trim()).filter((value) => /(?:geo)?tiff|tif/i.test(value));
  const preferred = ["image/tiff", "image/geotiff", "application/geotiff"];
  return preferred.find((format) => normalized.some((candidate) => candidate.toLowerCase() === format))
    ?? normalized.find((candidate) => /tiff|geotiff/i.test(candidate))
    ?? null;
}
function axisValues(xml: string, axisName: string): number[] {
  const axes = localTagBlocks(xml, "GeneralGridAxis");
  for (const axis of axes) {
    if (localTagText(axis, "gridAxesSpanned").some((name) => name.trim().toLowerCase() === axisName.toLowerCase())) {
      const coefficientText = localTagText(axis, "coefficients")[0] ?? "";
      return coefficientText.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    }
  }
  return [];
}
function parseCoverageMetadata(xml: string, run: string): CoverageMetadata {
  const axisLabelAttributes = /\baxisLabels=["']([^"']+)["']/gi;
  let axisLabelMatch: RegExpExecArray | null;
  let axisLabels: string[] = [];
  while ((axisLabelMatch = axisLabelAttributes.exec(xml)) !== null) {
    const labels = decodeXml(axisLabelMatch[1]).split(/\s+/).filter(Boolean).map((label) => label.toLowerCase());
    if (labels.length > axisLabels.length) axisLabels = labels;
  }
  const unitCandidates: string[][] = [];
  const unitAttributes = /\buomLabels=["']([^"']+)["']/gi;
  let unitMatch: RegExpExecArray | null;
  while ((unitMatch = unitAttributes.exec(xml)) !== null) unitCandidates.push(decodeXml(unitMatch[1]).split(/\s+/).filter(Boolean).map((unit) => unit.toLowerCase()));
  const secondsUnit = (unit: string | undefined) => ["s", "sec", "second", "seconds"].includes((unit ?? "").toLowerCase());
  const timeIndex = axisLabels.indexOf("time");
  const axisUnitCandidate = unitCandidates
    .filter((units) => units.length === axisLabels.length)
    .sort((a, b) => Number(secondsUnit(b[timeIndex])) - Number(secondsUnit(a[timeIndex])))[0] ?? [];
  const axisUnits: Record<string, string> = {};
  axisLabels.forEach((label, index) => { axisUnits[label] = axisUnitCandidate[index] ?? ""; });
  const timeAxis = axisValues(xml, "time");
  const unitNode = xml.match(/<(?:[\w.-]+:)?uom\b[^>]*\b(?:code|href)=["']([^"']+)["'][^>]*\/?\s*>/i);
  const unit = unitNode?.[1] ?? null;
  const heights = axisValues(xml, "height");
  const validAt = timeAxis.map((seconds) => new Date(Date.parse(run) + seconds * 1000).toISOString());
  return { validAt, heights, unit, axisLabels, axisUnits };
}
function convertOfficialValue(metric: AromeShadowMetric, value: number, unit: string): number | null {
  const normalized = unit.toLowerCase().replace(/[\s_]/g, "").replace(/−/g, "-");
  if (!Number.isFinite(value)) return null;
  if (metric === "temperature") {
    if (["k", "kelvin"].includes(normalized)) return value - 273.15;
    if (["°c", "c", "degc", "celsius", "cel"].includes(normalized)) return value;
    return null;
  }
  if (metric === "windSpeed") {
    if (["m/s", "ms-1", "m.s-1", "ms^-1"].includes(normalized)) return value * 3.6;
    if (["km/h", "kmh-1", "km.h-1", "kmh", "km/hours"].includes(normalized)) return value;
    return null;
  }
  if (["mm", "kg/m2", "kgm-2", "kgm^-2", "kgm−2", "kgm−2"].includes(normalized)) return value;
  if (["m", "meter", "metre"].includes(normalized)) return value * 1000;
  return null;
}
function toSingleRunTime(run: string): string {
  return run.slice(0, 16);
}
function resultStatus(result: AromeHondeghemShadowResult, comparedMetrics: readonly AromeShadowMetric[] = METRICS): AromeShadowStatus {
  if (!result.hourly.length) return "request-impossible";
  return result.missing.length > 0 || result.hourly.some((hour) => comparedMetrics.some((metric) => hour.metrics[metric].arome == null || hour.metrics[metric].openMeteoArome == null))
    ? "partial"
    : "ok";
}
function dailyAggregate(hours: AromeShadowHour[]): AromeShadowDaily[] {
  const grouped = new Map<string, AromeShadowHour[]>();
  for (const hour of hours) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(hour.validAt));
    grouped.set(day, [...(grouped.get(day) ?? []), hour]);
  }
  const aggregate = (values: number[], metric: AromeShadowMetric): number | null => {
    if (!values.length) return null;
    // La direction est circulaire : sa moyenne journalière est une moyenne circulaire, jamais arithmétique.
    if (metric === "windDirection") return circularMeanDegrees(values);
    if (metric === "precipitation") return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
  };
  return Array.from(grouped.entries()).map(([date, entries]) => {
    const metrics = {} as Record<AromeShadowMetric, AromeShadowDailyMetric>;
    for (const metric of METRICS) {
      const aromeValues = entries.map((entry) => entry.metrics[metric].arome).filter((value): value is number => value != null);
      const openValues = entries.map((entry) => entry.metrics[metric].openMeteoArome).filter((value): value is number => value != null);
      const arome = aggregate(aromeValues, metric);
      const openMeteoArome = aggregate(openValues, metric);
      metrics[metric] = {
        arome,
        openMeteoArome,
        // Écart journalier de direction : écart circulaire, pas une soustraction des moyennes.
        difference: metric === "windDirection"
          ? angularDifferenceDegrees(arome, openMeteoArome)
          : arome != null && openMeteoArome != null ? Math.round((arome - openMeteoArome) * 100) / 100 : null,
        unit: metric === "precipitation" ? "mm cumulés sur les heures comparées" : metric === "temperature" ? "°C · moyenne horaire" : metric === "windDirection" ? "° · moyenne circulaire horaire" : "km/h · moyenne horaire",
        hours: Math.min(aromeValues.length, openValues.length),
      };
    }
    return { date, metrics };
  });
}
export function getPointFromGeoTiffBytes(
  buffer: ArrayBuffer,
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
  openTiff: typeof fromArrayBuffer = fromArrayBuffer,
): Promise<number | null> {
  return (async () => {
    const tiff = await openTiff(buffer);
    const image = await tiff.getImage();
    const keys = image.getGeoKeys();
    const geographicCrs = keys?.GeographicTypeGeoKey;
    if (geographicCrs !== 4326) throw new Error("crs-not-wgs84");
    const [originX, originY] = image.getOrigin();
    const [resolutionX, resolutionY] = image.getResolution();
    const width = image.getWidth();
    const height = image.getHeight();
    if (![originX, originY, resolutionX, resolutionY].every(Number.isFinite) || resolutionX === 0 || resolutionY === 0) {
      throw new Error("invalid-georeferencing");
    }
    const pixelOffset = image.pixelIsArea() ? 0.5 : 0;
    const column = Math.round((longitude - originX) / resolutionX - pixelOffset);
    const row = Math.round((latitude - originY) / resolutionY - pixelOffset);
    if (column < 0 || row < 0 || column >= width || row >= height) throw new Error("point-outside-coverage");
    const raster = await image.readRasters({ window: [column, row, column + 1, row + 1], samples: [0], signal });
    const value = Number(raster[0]?.[0]);
    const noData = image.getGDALNoData();
    if (!Number.isFinite(value) || (noData != null && Object.is(value, noData))) return null;
    return value;
  })();
}
function buildSingleRunsUrl(run: string): string {
  const url = new URL(OPEN_METEO_SINGLE_RUNS);
  url.searchParams.set("latitude", String(HONDEGHEM.lat));
  url.searchParams.set("longitude", String(HONDEGHEM.lon));
  url.searchParams.set("run", toSingleRunTime(run));
  url.searchParams.set("models", OPEN_METEO_MODEL);
  url.searchParams.set("hourly", "temperature_2m,precipitation,wind_speed_10m,wind_direction_10m");
  // L’endpoint Single Runs n’expose pas start_hour/end_hour : la fenêtre est demandée en jours
  // (comme dans providerRunHorizon.ts) puis les échéances sont filtrées sur [run, run + MAX_HOURS[.
  url.searchParams.set("forecast_days", String(SINGLE_RUN_FORECAST_DAYS));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  return url.toString();
}
/**
 * Série AROME principale du chemin par défaut : API Forecast Open-Meteo, sans clé,
 * modèle imposé `meteofrance_arome_france_hd` et les quatre variables comparées —
 * dont `wind_direction_10m` (DD à 10 m), que le WCS n’avait jamais confirmée.
 */
function buildOpenMeteoForecastUrl(): string {
  const url = new URL(OPEN_METEO_FORECAST);
  url.searchParams.set("latitude", String(HONDEGHEM.lat));
  url.searchParams.set("longitude", String(HONDEGHEM.lon));
  url.searchParams.set("models", OPEN_METEO_MODEL);
  url.searchParams.set("hourly", "temperature_2m,precipitation,wind_speed_10m,wind_direction_10m");
  url.searchParams.set("forecast_days", String(SINGLE_RUN_FORECAST_DAYS));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("precipitation_unit", "mm");
  return url.toString();
}
/** Motif d’erreur Open-Meteo (`reason`), nettoyé et tronqué ; null si le corps n’est pas exploitable. */
async function readOpenMeteoReason(response: Response): Promise<string | null> {
  try {
    const payload = await response.json() as { reason?: unknown } | null;
    const reason = typeof payload?.reason === "string" ? payload.reason : null;
    return reason ? reason.replace(/\s+/g, " ").trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}
/**
 * Dernier run publié par Open-Meteo pour AROME France HD, lu dans `static/meta.json` du modèle.
 * C’est la seule preuve de run du chemin par défaut : `null` quand les métadonnées sont
 * indisponibles ou illisibles, et la comparaison affiche alors « run non prouvé » sans
 * inventer de run (en mode WCS hérité, le catalogue borne alors les candidats comme avant).
 */
async function readOpenMeteoLastRunAt(fetchImpl: FetchLike): Promise<number | null> {
  try {
    const response = await fetchImpl(singleRunMetadataUrl(OPEN_METEO_MODEL), {
      signal: AbortSignal.timeout(OPEN_METEO_RUN_METADATA_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { last_run_initialisation_time?: unknown } | null;
    const seconds = typeof payload?.last_run_initialisation_time === "number"
      ? payload.last_run_initialisation_time
      : Number(payload?.last_run_initialisation_time);
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(seconds)) return null;
    return seconds * 1000;
  } catch {
    return null;
  }
}
interface RunCandidates {
  /** Runs du catalogue candidats à la comparaison, du plus récent au plus ancien. */
  candidates: CatalogueRun[];
  /** Runs du catalogue écartés d’emblée parce qu’Open-Meteo ne les a pas encore publiés. */
  skipped: string[];
}
/**
 * L’alignement du run : seule une échéance de run publiée par les deux sources est comparable.
 * Le dernier run connu d’Open-Meteo borne donc le choix dans le catalogue WCS ; s’il est inconnu,
 * tous les runs récents restent candidats et la sonde Single Runs tranche, run par run.
 */
function selectRunCandidates(rankedRuns: CatalogueRun[], openMeteoLastRunAt: number | null): RunCandidates {
  const fallback: RunCandidates = { candidates: rankedRuns.slice(0, MAX_ALIGNED_RUN_ATTEMPTS), skipped: [] };
  if (openMeteoLastRunAt == null) return fallback;
  const published = rankedRuns.filter(({ run }) => Date.parse(run) <= openMeteoLastRunAt);
  if (!published.length) return fallback;
  return {
    candidates: published.slice(0, MAX_ALIGNED_RUN_ATTEMPTS),
    skipped: rankedRuns.filter(({ run }) => Date.parse(run) > openMeteoLastRunAt).map(({ run }) => run),
  };
}
/** Explique le décalage quand le run comparé n’est pas le plus récent annoncé par le WCS. */
function describeRunAlignment(input: { advertisedRun: string; comparedRun: string; openMeteoLastRunAt: number | null; skipped: string[] }): string {
  if (input.advertisedRun === input.comparedRun) return "";
  const openMeteoLastRun = input.openMeteoLastRunAt == null
    ? ""
    : ` (dernier run publié par Open-Meteo : ${toSingleRunTime(new Date(input.openMeteoLastRunAt).toISOString())} UTC)`;
  const skipped = input.skipped.length ? input.skipped : [input.advertisedRun];
  const skippedText = skipped.map(toSingleRunTime).join(", ");
  return ` Run comparé ${toSingleRunTime(input.comparedRun)} UTC : c’est le plus récent publié à la fois par le catalogue WCS et par Open-Meteo Single Runs${openMeteoLastRun}; le catalogue annonçait déjà ${skippedText} UTC, qu’Open-Meteo n’avait pas encore publié.`;
}
function parseOpenMeteoSeries(payload: any): ForecastSeries | null {
  const hourly = payload?.hourly;
  if (!Array.isArray(hourly?.time)) return null;
  const toNumbers = (values: unknown): Array<number | null> => Array.isArray(values)
    ? values.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null)
    : hourly.time.map(() => null);
  return {
    time: hourly.time.map(String).map((time: string) => time.length === 16 ? `${time}:00Z` : time),
    temperature: toNumbers(hourly.temperature_2m),
    precipitation: toNumbers(hourly.precipitation),
    windSpeed: toNumbers(hourly.wind_speed_10m),
    // Direction normalisée dans [0, 360) ; un `null` Open-Meteo reste `null`, jamais remplacé.
    windDirection: toNumbers(hourly.wind_direction_10m).map((value) => value == null ? null : normalizeDirectionDegrees(value)),
  };
}
function forecastValue(series: ForecastSeries | null, metric: AromeShadowMetric, validAt: string): number | null {
  if (!series) return null;
  const target = Date.parse(validAt);
  const index = series.time.findIndex((time) => Date.parse(time) === target);
  if (index < 0) return null;
  return series[metric][index] ?? null;
}

export interface AromeShadowOptions {
  /** Chemin hérité uniquement : identifiant OAuth2 Météo-France. Jamais lu dans le chemin Open-Meteo par défaut. */
  oauthApplicationId?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  decodePoint?: typeof getPointFromGeoTiffBytes;
  /** `true` = chemin hérité WCS/GeoTIFF authentifié. Défaut : `AROME_WCS_ENABLED`, désactivé. */
  wcsEnabled?: boolean;
}

export type AromeWindDirectionVerificationStatus =
  | "verified"
  | "not-confirmed"
  | "not-advertised"
  | "missing-key"
  | "invalid-key"
  | "authentication-error"
  | "request-impossible"
  /** WCS désactivé (défaut) : la direction DD(10 m) est comparée via `wind_direction_10m` Open-Meteo. */
  | "wcs-disabled";

export interface AromeWindDirectionCoverageCandidate {
  coverageId: string;
  run: string;
  unit: string | null;
  heights: number[];
  heightAxisUnit: string | null;
  validTimeCount: number;
  metadataConfirmed: boolean;
  issues: string[];
}

export interface AromeWindDirectionVerificationResult {
  status: AromeWindDirectionVerificationStatus;
  message: string;
  checkedAt: string;
  run: string | null;
  candidates: AromeWindDirectionCoverageCandidate[];
}

function looksLikeWindDirectionCoverageId(id: string): boolean {
  return !/(?:gust|rafale|dd_raf)/i.test(id)
    && (/(?:wind[_-]?direction|direction)/i.test(id) || /(?:^|[^a-z0-9])dd(?:[^a-z0-9]|$)/i.test(id));
}

/**
 * Sanitized technical cause for the generic failure paths: it names the real network or parsing error
 * without ever echoing credentials (the OAuth2 identifier only travels in request headers).
 */
function describeAromeShadowError(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "délai de 20 s dépassé (timeout)";
  }
  const parts: string[] = [];
  if (error instanceof Error) {
    if (error.message) parts.push(error.message);
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message && !error.message.includes(cause.message)) parts.push(cause.message);
    if (!parts.length) parts.push(error.name);
  } else if (error != null) {
    parts.push(String(error));
  }
  const text = (parts.join(" — ") || "erreur inconnue").replace(/\s+/g, " ").trim().slice(0, 200);
  return `erreur réseau ou parsing : ${text}`;
}

/**
 * Explicit admin-only metadata check. It discovers candidate identifiers from the live catalogue
 * when the admin clicks; it never assumes a WCS identifier and never downloads forecast values.
 * Chemin hérité uniquement : sans `AROME_WCS_ENABLED=true`, aucune clé n’est lue et aucune
 * requête n’est envoyée — la direction DD(10 m) est désormais comparée via Open-Meteo.
 */
export async function verifyHondeghemAromeWindDirectionAvailability(
  options: Pick<AromeShadowOptions, "oauthApplicationId" | "fetchImpl" | "now" | "wcsEnabled"> = {},
): Promise<AromeWindDirectionVerificationResult> {
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const base = (status: AromeWindDirectionVerificationStatus, message: string, run: string | null = null, candidates: AromeWindDirectionCoverageCandidate[] = []) => ({ status, message, checkedAt, run, candidates });
  if (!isAromeWcsEnabled(options.wcsEnabled)) {
    return base("wcs-disabled", "Vérification WCS DD(10 m) désactivée (AROME_WCS_ENABLED absent ou différent de true) : AROME passe uniquement par Open-Meteo et la direction DD(10 m) est comparée via wind_direction_10m dans la comparaison shadow. Aucune clé Météo-France n’a été lue et aucune requête WCS n’a été envoyée.");
  }
  const credential = inspectMeteoFranceCredential(options.oauthApplicationId ?? ENV.meteoFranceOAuthApplicationId);
  if (credential.kind === "missing") return base("missing-key", credential.message);
  if (!credential.basic) return base("invalid-key", credential.message);
  const oauthApplicationId = credential.basic;

  const fetchImpl = options.fetchImpl ?? fetch;
  let step = "l’échange OAuth2 Météo-France";
  try {
    const tokenResponse = await fetchImpl(METEOFRANCE_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${oauthApplicationId.trim()}`,
        "Content-Type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
    });
    if (!tokenResponse.ok) {
      return tokenResponse.status === 401 || tokenResponse.status === 403
        ? base("authentication-error", `Échange OAuth2 Météo-France refusé (HTTP ${tokenResponse.status}); vérifiez l’accès à l’API AROME.`)
        : base("request-impossible", `Service de jeton OAuth2 Météo-France indisponible (HTTP ${tokenResponse.status}).`);
    }
    const tokenPayload = await tokenResponse.json() as { access_token?: unknown } | null;
    const accessToken = typeof tokenPayload?.access_token === "string" ? tokenPayload.access_token.trim() : "";
    if (!accessToken) return base("request-impossible", "Échange OAuth2 réussi mais aucun jeton d’accès n’a été retourné.");

    const headers = { Authorization: `Bearer ${accessToken}`, accept: "application/xml" };
    step = "la lecture du catalogue WCS AROME";
    const capabilitiesUrl = new URL(`${AROME_WCS_BASE}/GetCapabilities`);
    capabilitiesUrl.searchParams.set("service", "WCS");
    capabilitiesUrl.searchParams.set("version", "2.0.1");
    capabilitiesUrl.searchParams.set("language", "fre");
    const capabilitiesResponse = await fetchImpl(capabilitiesUrl.toString(), { headers, signal: AbortSignal.timeout(20_000) });
    if (!capabilitiesResponse.ok) {
      return capabilitiesResponse.status === 401 || capabilitiesResponse.status === 403
        ? base("authentication-error", `Catalogue WCS AROME refusé (HTTP ${capabilitiesResponse.status}).`)
        : base("request-impossible", `Catalogue WCS AROME indisponible (HTTP ${capabilitiesResponse.status}).`);
    }

    const coverageIds = localTagText(await capabilitiesResponse.text(), "CoverageId").map(decodeXml);
    const selection = chooseLatestRun(coverageIds);
    if (!selection) return base("request-impossible", "Aucun run de référence AROME reconnu pour associer les métadonnées de direction.");
    const candidateIds = Array.from(new Set(coverageIds.filter((id) => looksLikeWindDirectionCoverageId(id)
      && parseRunFromCoverageId(id)?.run === selection.run))).slice(0, 5);
    if (!candidateIds.length) {
      return base("not-advertised", `Aucun identifiant du run ${selection.run} ne mentionne explicitement direction/DD dans le catalogue. Cela ne prouve pas l’absence du champ sous un autre nom; aucun identifiant n’est supposé.`, selection.run);
    }

    step = "les métadonnées WCS DescribeCoverage";
    const candidates: AromeWindDirectionCoverageCandidate[] = [];
    for (const coverageId of candidateIds) {
      const issues: string[] = [];
      const describeUrl = new URL(`${AROME_WCS_BASE}/DescribeCoverage`);
      describeUrl.searchParams.set("service", "WCS");
      describeUrl.searchParams.set("version", "2.0.1");
      describeUrl.searchParams.set("coverageID", coverageId);
      const described = await fetchImpl(describeUrl.toString(), { headers, signal: AbortSignal.timeout(20_000) });
      if (described.status === 401 || described.status === 403) {
        return base("authentication-error", `Métadonnées WCS refusées pour ${coverageId} (HTTP ${described.status}).`, selection.run, candidates);
      }
      if (!described.ok) {
        candidates.push({ coverageId, run: selection.run, unit: null, heights: [], heightAxisUnit: null, validTimeCount: 0, metadataConfirmed: false, issues: [`DescribeCoverage indisponible (HTTP ${described.status}).`] });
        continue;
      }

      const metadata = parseCoverageMetadata(await described.text(), selection.run);
      const unit = metadata.unit;
      const normalizedUnit = (unit ?? "").trim().toLowerCase().replace(/\s+/g, "");
      const angularUnit = ["°", "deg", "degree", "degrees"].includes(normalizedUnit);
      const heightAxisUnit = metadata.axisUnits.height ?? null;
      const normalizedHeightUnit = (heightAxisUnit ?? "").trim().toLowerCase();
      const metreHeightAxis = ["m", "meter", "metre", "meters", "metres"].includes(normalizedHeightUnit);
      const hasTenMetreLevel = metadata.heights.some((height) => Math.abs(height - 10) < 0.001);
      const exactAxes = ["long", "lat", "height", "time"].every((axis) => metadata.axisLabels.includes(axis));
      const secondsTimeAxis = ["s", "sec", "second", "seconds"].includes((metadata.axisUnits.time ?? "").toLowerCase());
      const validTimeCount = metadata.validAt.filter((time) => Date.parse(time) >= Date.parse(selection.run)
        && Date.parse(time) < Date.parse(selection.run) + MAX_HOURS * 60 * 60 * 1000).length;
      if (!angularUnit) issues.push(`Unité des valeurs absente ou non confirmée en degrés (${unit ?? "non fournie"}).`);
      if (!metadata.axisLabels.includes("height") || !metreHeightAxis || !hasTenMetreLevel) issues.push("Axe vertical en mètres avec niveau exact 10 m non confirmé.");
      if (!exactAxes || !secondsTimeAxis || validTimeCount === 0) issues.push("Axes géographiques et échéances UTC du run non confirmés.");
      candidates.push({ coverageId, run: selection.run, unit, heights: metadata.heights, heightAxisUnit, validTimeCount, metadataConfirmed: issues.length === 0, issues });
    }

    const verified = candidates.some((candidate) => candidate.metadataConfirmed);
    return base(
      verified ? "verified" : "not-confirmed",
      verified
        ? `Le catalogue annonce au moins une couverture candidate dont DescribeCoverage confirme les degrés, le niveau 10 m et des échéances du run ${selection.run}. Aucune valeur raster ni réponse Single Runs n’a été demandée; l’intégration reste à activer explicitement.`
        : `Le catalogue annonce des identifiants candidats pour le run ${selection.run}, mais leurs métadonnées ne confirment pas toutes les conditions 10 m/degrés/temps. Aucune valeur n’est comparée.`,
      selection.run,
      candidates,
    );
  } catch (error) {
    console.error(`[arome-shadow] vérification de la direction du vent échouée pendant ${step}`, error);
    return base("request-impossible", `Vérification du catalogue WCS impossible pendant ${step} (${describeAromeShadowError(error)}); aucune donnée de prévision n’a été téléchargée.`);
  }
}

/**
 * Comparaison shadow par défaut : AROME uniquement via Open-Meteo, sans clé.
 *
 * 1. Le run de référence est celui des métadonnées du modèle Open-Meteo
 *    (`static/meta.json`, `last_run_initialisation_time`). S’il ne peut pas être
 *    prouvé, `run` reste `null`, `runProven` vaut `false` et le résultat affiche
 *    « run non prouvé » : aucun run n’est inventé et Single Runs n’est pas
 *    demandé pour un run supposé.
 * 2. La série AROME comparée vient de l’API Forecast Open-Meteo
 *    (`models=meteofrance_arome_france_hd`, `temperature_2m`, `precipitation`,
 *    `wind_speed_10m`, `wind_direction_10m`). Quand le run est prouvé, la série
 *    Single Runs du même run sert de référence horaire; si Single Runs la
 *    refuse, aucun autre run n’est substitué et seules les valeurs Forecast
 *    sont présentées, en partiel.
 * 3. L’écart de direction DD(10 m) est un écart circulaire (modulo 360°) :
 *    350° contre 10° donne 20°. Une valeur `null` renvoyée par Open-Meteo pour
 *    une heure reste `null` : écart `null`, échéance signalée, statut partiel.
 *
 * Mode shadow strict : aucune écriture, aucune modification des prévisions
 * affichées, de Best Match, des fusions journalières, de la Vigilance, de
 * l’agrégation Netatmo ou du score de fiabilité.
 */
async function runHondeghemAromeOpenMeteoShadowComparison(options: AromeShadowOptions = {}): Promise<AromeHondeghemShadowResult> {
  const comparedAt = (options.now?.() ?? new Date()).toISOString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const result = baseResult("request-impossible", "La comparaison n’a pas pu être exécutée.", comparedAt, `Open-Meteo Forecast · ${OPEN_METEO_MODEL}`);
  const round2 = (value: number | null): number | null => value == null ? null : Math.round(value * 100) / 100;
  let step = "les métadonnées de run Open-Meteo (dernier run publié)";
  try {
    const openMeteoLastRunAt = await readOpenMeteoLastRunAt(fetchImpl);
    const provenRun = openMeteoLastRunAt == null ? null : new Date(openMeteoLastRunAt).toISOString().replace(/\.000Z$/, "Z");
    if (provenRun) {
      result.run = provenRun;
      result.openMeteoRun = toSingleRunTime(provenRun);
      result.runProven = true;
    } else {
      result.missing.push("Run non prouvé : les métadonnées du modèle Open-Meteo sont indisponibles ou illisibles; aucun run n’a été inventé et Single Runs n’a pas été demandé pour un run supposé.");
    }

    step = "la série AROME Open-Meteo (Forecast, sans clé)";
    const forecastResponse = await fetchImpl(buildOpenMeteoForecastUrl(), { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    if (!forecastResponse.ok) {
      return { ...result, message: `Open-Meteo AROME indisponible (HTTP ${forecastResponse.status}); aucune valeur n’a été inventée et le WCS Météo-France authentifié n’a pas été sollicité.` };
    }
    const forecastSeries = parseOpenMeteoSeries(await forecastResponse.json());
    if (!forecastSeries || !forecastSeries.time.length) {
      return { ...result, message: "La réponse Open-Meteo AROME ne contient pas de série horaire exploitable; aucune valeur n’a été inventée." };
    }

    let singleRunsSeries: ForecastSeries | null = null;
    if (provenRun) {
      step = "la série Open-Meteo Single Runs du run prouvé";
      const singleRunsResponse = await fetchImpl(buildSingleRunsUrl(provenRun), { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
      if (singleRunsResponse.ok) {
        singleRunsSeries = parseOpenMeteoSeries(await singleRunsResponse.json());
        if (!singleRunsSeries) result.missing.push("Single Runs a répondu sans série horaire exploitable pour le run prouvé; aucun autre run n’a été substitué.");
      } else {
        const reason = await readOpenMeteoReason(singleRunsResponse);
        result.missing.push(`Single Runs n’a pas fourni le run prouvé ${toSingleRunTime(provenRun)} UTC (HTTP ${singleRunsResponse.status}${reason ? ` : ${reason}` : ""}); aucun autre run n’a été substitué. Seules les valeurs AROME Open-Meteo Forecast sont présentées.`);
      }
    }

    step = "l’appariement horaire des séries Open-Meteo";
    // Fenêtre comparée : [run, run + MAX_HOURS) si le run est prouvé, sinon les
    // prochaines heures à partir de l’heure de comparaison — jamais un run supposé.
    const windowStart = provenRun ? Date.parse(provenRun) : Math.floor(Date.parse(comparedAt) / 3_600_000) * 3_600_000;
    const validTimes = forecastSeries.time
      .filter((time) => Date.parse(time) >= windowStart && Date.parse(time) < windowStart + MAX_HOURS * 60 * 60 * 1000)
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .slice(0, MAX_HOURS);
    if (!validTimes.length) return { ...result, message: "Aucune échéance AROME Open-Meteo n’est exploitable dans la fenêtre comparée; aucune valeur n’a été inventée et aucun autre run n’a été mélangé." };

    for (const validAt of validTimes) {
      const metrics = {} as Record<AromeShadowMetric, AromeShadowMetricValue>;
      for (const metric of METRICS) {
        const arome = round2(forecastValue(forecastSeries, metric, validAt));
        const openMeteoArome = round2(forecastValue(singleRunsSeries, metric, validAt));
        let issue: string | undefined;
        if (arome == null) {
          issue = "Valeur AROME Open-Meteo absente ou nulle pour cette échéance; elle n’est pas remplacée.";
          result.missing.push(`${metric} ${validAt}: valeur Open-Meteo Forecast absente ou nulle; aucun écart n’est calculé pour cette heure.`);
        } else if (provenRun && singleRunsSeries && openMeteoArome == null) {
          issue = "Valeur Single Runs absente ou nulle pour cette échéance du run prouvé; aucun écart n’est calculé pour cette heure.";
          result.missing.push(`${metric} ${validAt}: valeur Single Runs absente ou nulle pour le run prouvé; aucun écart n’est calculé pour cette heure.`);
        } else if (!provenRun) {
          issue = "Run non prouvé : pas de référence Single Runs attribuée à cette échéance.";
        } else if (!singleRunsSeries) {
          issue = "Référence Single Runs indisponible pour le run prouvé; aucun autre run n’a été substitué.";
        }
        metrics[metric] = {
          arome,
          openMeteoArome,
          // Direction : écart circulaire modulo 360° (350° vs 10° = 20°), jamais une soustraction simple.
          difference: metric === "windDirection"
            ? angularDifferenceDegrees(arome, openMeteoArome)
            : arome != null && openMeteoArome != null ? round2(arome - openMeteoArome) : null,
          unit: METRIC_UNITS[metric],
          ...(issue ? { issue } : {}),
        };
      }
      result.hourly.push({ validAt, metrics });
    }
    result.daily = dailyAggregate(result.hourly);
    result.status = resultStatus(result);
    result.message = (result.status === "ok"
      ? "Comparaison shadow terminée : AROME est récupéré uniquement via Open-Meteo (Forecast comparé à Single Runs pour le run prouvé par les métadonnées du modèle), direction DD(10 m) incluse en écart circulaire. Les prévisions affichées et le score de fiabilité restent inchangés."
      : "Comparaison shadow partielle : AROME est récupéré uniquement via Open-Meteo; seules les valeurs présentes sont comparées et les valeurs nulles ou manquantes ne sont pas remplacées. Les prévisions affichées et le score de fiabilité restent inchangés.")
      + (result.runProven ? "" : " Run non prouvé : aucun run n’est attribué à la série AROME tant que les métadonnées du modèle Open-Meteo ne le prouvent pas.");
    return result;
  } catch (error) {
    console.error(`[arome-shadow] comparaison shadow Open-Meteo échouée pendant ${step}`, error);
    return { ...result, message: `Requête Open-Meteo impossible ou métadonnées inattendues pendant ${step} (${describeAromeShadowError(error)}); aucune prévision de production n’a été modifiée et le WCS Météo-France authentifié n’a pas été sollicité.` };
  }
}

/**
 * Manual, read-only comparison at Hondeghem; it never writes to forecasts or lets
 * the AROME result replace the displayed Best Match values.
 * Chemin par défaut : Open-Meteo uniquement (voir ci-dessus), sans clé Météo-France.
 * Le chemin WCS/GeoTIFF hérité ne part que si `AROME_WCS_ENABLED=true`, de façon réversible.
 */
export async function runHondeghemAromeShadowComparison(options: AromeShadowOptions = {}): Promise<AromeHondeghemShadowResult> {
  if (!isAromeWcsEnabled(options.wcsEnabled)) return runHondeghemAromeOpenMeteoShadowComparison(options);
  return runHondeghemAromeShadowComparisonViaWcs(options);
}

/**
 * Chemin hérité désactivé par défaut (`AROME_WCS_ENABLED=true` pour le réactiver).
 * Manual, read-only comparison. It uses only the default AROME France HD product at Hondeghem;
 * it never writes to forecasts or lets the AROME result replace the displayed Best Match values.
 * Le cycle comparé est le plus récent publié à la fois par le catalogue WCS et par Open-Meteo
 * Single Runs : l’alignement du run évite de demander un cycle que Single Runs n’a pas encore.
 */
async function runHondeghemAromeShadowComparisonViaWcs(options: AromeShadowOptions = {}): Promise<AromeHondeghemShadowResult> {
  const comparedAt = (options.now?.() ?? new Date()).toISOString();
  const credential = inspectMeteoFranceCredential(options.oauthApplicationId ?? ENV.meteoFranceOAuthApplicationId);
  if (credential.kind === "missing") return baseResult("missing-key", credential.message, comparedAt);
  if (!credential.basic) return baseResult("invalid-key", credential.message, comparedAt);
  const oauthApplicationId = credential.basic;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const decodePoint = options.decodePoint ?? getPointFromGeoTiffBytes;
  const result = baseResult("request-impossible", "La comparaison n’a pas pu être exécutée.", comparedAt);
  let headers: Record<string, string> = {};
  let step = "l’échange OAuth2 Météo-France";
  const getText = async (url: string): Promise<{ ok: boolean; status: number; text: string }> => {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
    return { ok: response.ok, status: response.status, text: response.ok ? await response.text() : "" };
  };
  try {
    const tokenResponse = await fetchImpl(METEOFRANCE_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${oauthApplicationId.trim()}`,
        "Content-Type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000),
    });
    if (!tokenResponse.ok) {
      if (tokenResponse.status === 401 || tokenResponse.status === 403) {
        return { ...result, status: "authentication-error", message: `Échange OAuth2 Météo-France refusé (HTTP ${tokenResponse.status}). Vérifiez que METEOFRANCE_API_KEY contient bien l’APPLICATION_ID base64 du portail et que le compte est abonné à l’API AROME : un APPLICATION_ID généré pour une autre API du portail est refusé.` };
      }
      return { ...result, message: `Service de jeton OAuth2 Météo-France indisponible (HTTP ${tokenResponse.status}).` };
    }
    const tokenPayload = await tokenResponse.json() as { access_token?: unknown } | null;
    const accessToken = typeof tokenPayload?.access_token === "string" ? tokenPayload.access_token.trim() : "";
    if (!accessToken) return { ...result, message: "Échange OAuth2 Météo-France réussi mais aucun jeton d’accès n’a été retourné." };
    headers = { Authorization: `Bearer ${accessToken}`, accept: "application/xml, application/octet-stream" };
    step = "la lecture du catalogue WCS AROME";

    const capabilitiesUrl = new URL(`${AROME_WCS_BASE}/GetCapabilities`);
    capabilitiesUrl.searchParams.set("service", "WCS");
    capabilitiesUrl.searchParams.set("version", "2.0.1");
    capabilitiesUrl.searchParams.set("language", "fre");
    const capabilities = await getText(capabilitiesUrl.toString());
    if (!capabilities.ok) {
      if (capabilities.status === 401) {
        return { ...result, status: "authentication-error", message: "Authentification AROME refusée (HTTP 401); vérifiez l’identifiant OAuth2 et l’abonnement à l’API AROME." };
      }
      return { ...result, message: `Catalogue WCS AROME indisponible (HTTP ${capabilities.status}).` };
    }
    const coverageIds = localTagText(capabilities.text, "CoverageId").map(decodeXml);
    const rankedRuns = rankCatalogueRuns(coverageIds);
    if (!rankedRuns.length) return { ...result, message: "Le catalogue AROME ne contient aucun run récent avec une couverture de température, vent ou précipitation reconnue." };
    const advertisedRun = rankedRuns[0].run;
    const geotiffFormat = advertisedGeoTiffFormat(capabilities.text);
    if (!geotiffFormat) return { ...result, message: "Le catalogue WCS n’annonce aucun format GeoTIFF reconnu; aucun fichier raster n’a été demandé." };

    // Alignement du run : le catalogue WCS publie parfois un cycle (03/09/15/21 UTC) qu’Open-Meteo
    // n’a pas encore ingéré ; comparer ce cycle-là ferait échouer la requête. On borne donc le choix
    // au dernier run publié par Open-Meteo, puis la sonde Single Runs confirme, run par run.
    step = "les métadonnées de run Open-Meteo (dernier run publié)";
    const openMeteoLastRunAt = await readOpenMeteoLastRunAt(fetchImpl);
    const { candidates, skipped } = selectRunCandidates(rankedRuns, openMeteoLastRunAt);

    step = "la série Open-Meteo Single Runs du run aligné";
    let selection: CatalogueRun | null = null;
    let openMeteoSeries: ForecastSeries | null = null;
    const attemptedRuns: string[] = [];
    let lastRefusal: { run: string; status: number; reason: string | null } | null = null;
    let unreadableSeries = false;
    for (const candidate of candidates) {
      attemptedRuns.push(candidate.run);
      const openMeteoResponse = await fetchImpl(buildSingleRunsUrl(candidate.run), { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
      if (openMeteoResponse.ok) {
        const series = parseOpenMeteoSeries(await openMeteoResponse.json());
        if (!series) { unreadableSeries = true; break; }
        selection = candidate;
        openMeteoSeries = series;
        break;
      }
      // Le corps d’erreur d’Open-Meteo (`{"error":true,"reason":"…"}`) distingue un run inexistant,
      // un cycle non publié et un paramètre refusé : on le remonte et il décide de la suite.
      const reason = await readOpenMeteoReason(openMeteoResponse);
      lastRefusal = { run: candidate.run, status: openMeteoResponse.status, reason };
      // Seul un 400 « run indisponible » autorise à essayer un cycle plus ancien ; toute autre
      // réponse (authentification, quota, panne) arrête la comparaison au lieu de la contourner.
      if (openMeteoResponse.status !== 400) break;
    }
    if (unreadableSeries) return { ...result, message: "La réponse Open-Meteo Single Runs ne contient pas de série horaire exploitable." };
    if (!selection || !openMeteoSeries) {
      const refusedRun = lastRefusal?.run ?? advertisedRun;
      result.run = refusedRun;
      result.openMeteoRun = toSingleRunTime(refusedRun);
      const refusal = lastRefusal ? ` (HTTP ${lastRefusal.status}${lastRefusal.reason ? ` : ${lastRefusal.reason}` : ""})` : "";
      const attempts = attemptedRuns.length > 1 ? ` Runs essayés sans succès : ${attemptedRuns.map(toSingleRunTime).join(", ")} UTC.` : "";
      const skippedRuns = skipped.length ? ` Runs du catalogue écartés d’emblée (non publiés par Open-Meteo) : ${skipped.map(toSingleRunTime).join(", ")} UTC.` : "";
      return { ...result, message: `Open-Meteo Single Runs n’a pas fourni le run AROME ${toSingleRunTime(refusedRun)}${refusal}; aucun autre run n’a été substitué.${attempts}${skippedRuns}` };
    }
    const run = selection.run;
    result.run = run;
    result.openMeteoRun = toSingleRunTime(run);
    result.runProven = true;
    const alignmentNote = describeRunAlignment({ advertisedRun, comparedRun: run, openMeteoLastRunAt, skipped });

    step = "les métadonnées WCS DescribeCoverage";
    const metadata: Partial<Record<AromeShadowMetric, CoverageMetadata>> = {};
    for (const metric of WCS_METRICS) {
      const choice = selection.choices[metric];
      if (!choice) {
        result.missing.push(metric === "precipitation" ? "Précipitations : aucune couverture PT1H dans le run AROME sélectionné." : `${metric}: couverture absente du run AROME sélectionné.`);
        continue;
      }
      const describeUrl = new URL(`${AROME_WCS_BASE}/DescribeCoverage`);
      describeUrl.searchParams.set("service", "WCS");
      describeUrl.searchParams.set("version", "2.0.1");
      describeUrl.searchParams.set("coverageID", choice.id);
      const described = await getText(describeUrl.toString());
      if (!described.ok) {
        if (described.status === 401) return { ...result, status: "authentication-error", message: "Authentification AROME refusée pendant DescribeCoverage (HTTP 401)." };
        result.missing.push(`${metric}: métadonnées WCS indisponibles (HTTP ${described.status}).`);
        continue;
      }
      const parsed = parseCoverageMetadata(described.text, run);
      if (!parsed.validAt.length || !parsed.axisLabels.includes("long") || !parsed.axisLabels.includes("lat")) {
        result.missing.push(`${metric}: axes géographiques/temps absents ou non identifiables dans DescribeCoverage.`);
        continue;
      }
      const normalizedAxisUnit = (axis: string) => (parsed.axisUnits[axis] ?? "").toLowerCase().replace(/\s/g, "");
      if (!["deg", "degree", "degrees"].includes(normalizedAxisUnit("long"))
        || !["deg", "degree", "degrees"].includes(normalizedAxisUnit("lat"))) {
        result.missing.push(`${metric}: unités longitude/latitude absentes ou non angulaires dans DescribeCoverage.`);
        continue;
      }
      if (!["s", "sec", "second", "seconds"].includes(normalizedAxisUnit("time"))) {
        result.missing.push(`${metric}: coefficients temporels non confirmés en secondes dans DescribeCoverage.`);
        continue;
      }
      if (parsed.axisLabels.includes("height") && !["m", "meter", "metre", "meters", "metres"].includes(normalizedAxisUnit("height"))) {
        result.missing.push(`${metric}: unité de l’axe height absente ou différente du mètre.`);
        continue;
      }
      if (!parsed.unit || convertOfficialValue(metric, 1, parsed.unit) == null) {
        result.missing.push(`${metric}: unité WCS absente ou non prise en charge (${parsed.unit ?? "non fournie"}).`);
        continue;
      }
      const requiredHeight = metric === "temperature" ? 2 : metric === "windSpeed" ? 10 : null;
      if (requiredHeight != null && !parsed.heights.some((height) => Math.abs(height - requiredHeight) < 0.001)) {
        result.missing.push(`${metric}: l’altitude standard ${requiredHeight} m n’est pas présente dans les métadonnées WCS.`);
        continue;
      }
      if (metric === "precipitation" && choice.period !== "PT1H") {
        result.missing.push("Précipitations : période de cumul WCS différente de PT1H; variable non comparée à la valeur horaire Open-Meteo.");
        continue;
      }
      metadata[metric] = parsed;
    }

    const validTimes = Array.from(new Set(Object.values(metadata).flatMap((item) => item?.validAt ?? [])))
      .filter((time) => Date.parse(time) >= Date.parse(run) && Date.parse(time) < Date.parse(run) + MAX_HOURS * 60 * 60 * 1000)
      .filter((time) => openMeteoSeries.time.some((candidate) => Date.parse(candidate) === Date.parse(time)))
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .slice(0, MAX_HOURS);
    if (!validTimes.length) return { ...result, message: "Aucune échéance valide n’est commune au run AROME WCS et au même run Open-Meteo; aucun autre run n’a été mélangé." };

    step = "le téléchargement des GeoTIFF AROME";
    const spacingMs = 650;
    let lastCoverageStartedAt = 0;
    for (const validAt of validTimes) {
      const metrics = {} as Record<AromeShadowMetric, AromeShadowMetricValue>;
      for (const metric of METRICS) {
        // En mode WCS hérité, la direction n’a pas de couverture confirmée : valeur laissée vide, référence Single Runs conservée.
        const choice = (selection.choices as Partial<Record<AromeShadowMetric, CoverageChoice>>)[metric];
        const info = metadata[metric];
        const openMeteoArome = forecastValue(openMeteoSeries, metric, validAt);
        if (!choice || !info || !info.validAt.some((time) => Date.parse(time) === Date.parse(validAt))) {
          metrics[metric] = emptyMetric(metric, result.missing.find((message) => message.toLowerCase().includes(metric.toLowerCase())) ?? "Échéance absente des métadonnées AROME WCS.");
          metrics[metric].openMeteoArome = openMeteoArome;
          continue;
        }
        if (openMeteoArome == null) {
          metrics[metric] = emptyMetric(metric, "Échéance absente de la série Open-Meteo de ce run.");
          continue;
        }
        const elapsed = Date.now() - lastCoverageStartedAt;
        if (lastCoverageStartedAt && elapsed < spacingMs) await sleep(spacingMs - elapsed);
        lastCoverageStartedAt = Date.now();
        const coverageUrl = new URL(`${AROME_WCS_BASE}/GetCoverage`);
        coverageUrl.searchParams.set("service", "WCS");
        coverageUrl.searchParams.set("version", "2.0.1");
        coverageUrl.searchParams.set("coverageid", choice.id);
        coverageUrl.searchParams.append("subset", `time(${validAt})`);
        if (metric === "temperature") coverageUrl.searchParams.append("subset", "height(2)");
        if (metric === "windSpeed") coverageUrl.searchParams.append("subset", "height(10)");
        if (metric === "precipitation" && info.axisLabels.includes("height") && info.heights.length > 0) {
          const surfaceHeight = info.heights.includes(0) ? 0 : info.heights[0];
          coverageUrl.searchParams.append("subset", `height(${surfaceHeight})`);
        }
        coverageUrl.searchParams.append("subset", `lat(${(HONDEGHEM.lat - 0.04).toFixed(4)},${(HONDEGHEM.lat + 0.04).toFixed(4)})`);
        coverageUrl.searchParams.append("subset", `long(${(HONDEGHEM.lon - 0.04).toFixed(4)},${(HONDEGHEM.lon + 0.04).toFixed(4)})`);
        coverageUrl.searchParams.set("format", geotiffFormat);
        let value: number | null = null;
        let issue: string | undefined;
        try {
          const response = await fetchImpl(coverageUrl.toString(), { headers: { ...headers, accept: "application/octet-stream" }, signal: AbortSignal.timeout(20_000) });
          if (!response.ok) {
            if (response.status === 401) return { ...result, status: "authentication-error", message: "Authentification AROME refusée pendant GetCoverage (HTTP 401)." };
            issue = response.status === 403
              ? "Échéance AROME non encore disponible au backend (HTTP 403)."
              : `GeoTIFF AROME indisponible (HTTP ${response.status}).`;
          } else {
            const rawValue = await decodePoint(await response.arrayBuffer(), HONDEGHEM.lat, HONDEGHEM.lon);
            value = rawValue == null ? null : convertOfficialValue(metric, rawValue, info.unit!);
            if (value == null) issue = rawValue == null ? "Pixel GeoTIFF manquant à Hondeghem." : `Unité GeoTIFF non interprétable : ${info.unit}.`;
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "decode-error";
          issue = reason === "crs-not-wgs84" ? "GeoTIFF ignoré : CRS différent de WGS84 (EPSG:4326)." : reason === "point-outside-coverage" ? "Hondeghem est hors de l’emprise raster renvoyée." : "Réponse WCS/GeoTIFF illisible ou erreur réseau.";
        }
        const rounded = value == null ? null : Math.round(value * 100) / 100;
        metrics[metric] = {
          arome: rounded,
          openMeteoArome,
          difference: rounded == null ? null : Math.round((rounded - openMeteoArome) * 100) / 100,
          unit: METRIC_UNITS[metric],
          ...(issue ? { issue } : {}),
        };
        if (issue) result.missing.push(`${metric} ${validAt}: ${issue}`);
      }
      result.hourly.push({ validAt, metrics });
    }
    result.daily = dailyAggregate(result.hourly);
    result.status = resultStatus(result, WCS_METRICS);
    result.message = (result.status === "ok"
      ? "Comparaison shadow terminée : AROME WCS et Open-Meteo portent le même run. Les prévisions affichées restent inchangées."
      : "Comparaison partielle : seules les valeurs présentes dans les deux sources et conformes aux métadonnées sont comparées; les prévisions affichées restent inchangées.") + alignmentNote;
    return result;
  } catch (error) {
    console.error(`[arome-shadow] comparaison shadow échouée pendant ${step}`, error);
    const status = error instanceof Error && /401|403/.test(error.message) ? "authentication-error" : "request-impossible";
    return { ...result, status, message: status === "authentication-error"
      ? "Authentification AROME refusée; vérifiez l’identifiant OAuth2 et l’abonnement AROME."
      : `Requête fournisseur impossible ou métadonnées inattendues pendant ${step} (${describeAromeShadowError(error)}); aucune prévision de production n’a été modifiée.` };
  }
}
