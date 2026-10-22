/**
 * Weather Services Configuration & Open-Meteo Collector
 * Location: Hondeghem (lat: 50.7567, lon: 2.5204)
 */

import { randomUUID } from "node:crypto";
import { conditionFromWmoWeatherCode } from "./weatherConditionLabels";
import { fetchWeather, getWeatherResponseAttemptCount } from "./weatherFetch";
import { getParisDateAndHour } from "./parisHourlyTime";
import { getParisHourlyTimestamps, shiftParisCivilDate } from "./weatherTime";
import { getDailyForecastValidTime } from "./dailyForecastVerification";
import { isCompleteHourlyForecastBatch } from "./hourlyForecastCompleteness";
import { normalizeHourlySourceValue, parseHourlyTimestampSeconds } from "./hourlyValueNormalization";
import { OFFICIAL_HOURLY_MODELS } from "./officialModels";
export { OFFICIAL_HOURLY_MODELS } from "./officialModels";
import type {
  HourlyHistoricalEvidence,
  HourlyMultiModelMetrics,
  HourlySelectionEvidenceBasis,
  HourlyVariableSelectionReason,
  HourlyVariableSelectionStrategy,
} from "../shared/hourlyModelMetrics";
import type { ModelCountCoverageLevel } from "../shared/modelCoverageConfidence";
import { summarizeDailyModelAgreement, type DailyAgreementInput, type DailyModelAgreement } from "../shared/modelAgreement";
import type { PrecipitationModelConsensus } from "../shared/precipitationConsensus";
import type { BestMatchDailyReference, DailyForecastMetric, DailyOfficialFusionDisplay } from "../shared/dailyForecast";
import { isValidDailyWmoWeatherCode, summarizeDailyWeatherCodes, type DailyWeatherCodeCandidate, type DailyWeatherCodeSummary } from "../shared/dailyWeatherCode";
import type { HourlyFallbackProvenance } from "../shared/hourlyFallbackProvenance";
import type { computeOfficialDailyForecastWithDiagnostics, ForecastTraceSource } from "./officialForecast";
import {
  buildDailyModelCollectionCoverage,
  buildHourlyModelCollectionCoverage,
  DAILY_FORECAST_REQUEST_KEYS,
  finiteCoverageValue,
  HOURLY_FORECAST_VARIABLES,
  MODEL_FORECAST_HORIZONS,
  type DailyModelCollectionCoverage,
  type HourlySourceValueStatus,
  type HourlyVariableSourceDiagnostic,
} from "./forecastVariableCoverage";

// Hondeghem coordinates
export const HONDEGHEM = { lat: 50.7567, lon: 2.5204 };

// All weather services/models tracked
export const WEATHER_SERVICES = {
  expert: [
    { name: "AROME", modelId: "meteofrance_arome_france_hd", category: "expert" as const },
    { name: "ARPEGE", modelId: "meteofrance_arpege_europe", category: "expert" as const },
    { name: "ICON", modelId: "dwd_icon_eu", category: "expert" as const },
    { name: "ECMWF", modelId: "ecmwf_ifs025", category: "expert" as const },
    { name: "GFS", modelId: "gfs_seamless", category: "expert" as const },
    { name: "GEM", modelId: "gem_seamless", category: "expert" as const },
    { name: "UKMET", modelId: "ukmo_seamless", category: "expert" as const },
    { name: "Open-Meteo", modelId: "best_match", category: "expert" as const },
  ],
  /** Aucun service public de prévision n'est actif ni écrit en production. */
  public: [] as const,
  /** Marques documentaires uniquement : aucune donnée ne doit être affichée ou scorée sans intégration réelle. */
  inactivePublicCatalogue: ["Meteoblue", "AccuWeather", "Apple Weather", "Weather.com", "Ventusky", "Weatherbit", "World Weather Online", "La Chaîne Météo"] as const,
};

/**
 * IDs applicatifs archivés → IDs effectivement demandés à Open-Meteo.
 * Le probe public borné du 2026-10-12 accepte aussi les aliases documentés
 * ncep_/cmc_, mais ne fournit aucune métadonnée qui justifierait de changer
 * des archives actives. Les IDs actifs sont donc explicitement conservés.
 */
export const OPEN_METEO_PROVIDER_MODEL_ID_BY_APPLICATION_MODEL_ID: Readonly<Record<string, string>> = {
  gfs_seamless: "gfs_seamless",
  gem_seamless: "gem_seamless",
};

export function getOpenMeteoProviderModelId(applicationModelId: string): string {
  return OPEN_METEO_PROVIDER_MODEL_ID_BY_APPLICATION_MODEL_ID[applicationModelId] ?? applicationModelId;
}

/** Limit only the request horizon; every requested variable remains requested. */
export function getModelRequestedForecastDays(modelName: string, productMaximumDays = 16): number {
  const documentedMaximum = MODEL_FORECAST_HORIZONS[modelName]?.maximumDocumentedDays;
  return Math.max(1, Math.min(productMaximumDays, documentedMaximum ?? productMaximumDays));
}

/** Modèles observés séparément avant toute éventuelle qualification. */
export const VALIDATION_WEATHER_MODELS = [
  { name: "DMI HARMONIE-DINI", modelId: "dmi_seamless", family: "harmonie" as const },
  { name: "ICON-D2", modelId: "dwd_icon_d2", family: "icon" as const },
  { name: "ECMWF AIFS", modelId: "ecmwf_aifs025", family: "aifs" as const },
  { name: "ECMWF ENS", modelId: "ecmwf_ifs025_ensemble", family: "ensemble" as const },
  { name: "AIFS ENS", modelId: "ecmwf_aifs025_ensemble", family: "ensemble" as const },
] as const;

export type ForecastData = {
  serviceName: string;
  serviceCategory: "public" | "expert";
  modelId?: string | null;
  sourceName?: string | null;
  runId?: string | null;
  runIdKind?: "capture" | "provider" | "unknown";
  requestStartedAt?: number | null;
  availableAt?: number | null;
  validTime?: number | null;
  qualityStatus?: "qualified" | "rejected" | "unknown";
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust: number | null;
  humidity: number | null;
  cloudCover: number | null;
  condition: string | null;
  rawData?: unknown;
};

export type DailyFusionResolver = (
  targetDate: string,
  forecasts: ForecastData[],
  referenceAt: number,
  availabilityReasonByModel?: Readonly<Record<string, string>>,
) => Promise<ReturnType<typeof computeOfficialDailyForecastWithDiagnostics>>;

export type Collect15DayForecastOptions = {
  issuedAt: number;
  resolveOfficialFusion: DailyFusionResolver;
  quotaStore?: import('./openMeteoQuota').WeatherQuotaStore;
};

export function hasUsableForecastValue(forecast: Pick<ForecastData, "tempMax" | "tempMin" | "precipitation" | "windSpeed" | "windGust" | "humidity" | "cloudCover">): boolean {
  return [
    forecast.tempMax,
    forecast.tempMin,
    forecast.precipitation,
    forecast.windSpeed,
    forecast.windGust,
    forecast.humidity,
    forecast.cloudCover,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
}

export type ValidationForecastData = ForecastData & {
  modelId: string;
  validationStatus: "candidate";
};

/** Collect each expert source and retain a safe per-model daily coverage summary. */
export async function collectExpertForecastsWithDiagnostics(
  targetDate: string,
  coords?: { lat: number; lon: number },
): Promise<{ forecasts: ForecastData[]; diagnostics: DailyModelCollectionCoverage[]; availabilityReasonByModel: Record<string, string> }> {
  const location = coords ?? HONDEGHEM;
  const outcomes = await Promise.all(WEATHER_SERVICES.expert.map(async (service) => {
    const base = {
      modelName: service.name,
      modelId: service.modelId,
      isOfficialModel: service.modelId !== "best_match",
      requestedDays: getModelRequestedForecastDays(service.name),
      targetDate,
    };
    try {
      const requestStartedAt = Date.now();
      const runId = randomUUID();
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", location.lat.toString());
      url.searchParams.set("longitude", location.lon.toString());
      url.searchParams.set("daily", DAILY_FORECAST_REQUEST_KEYS.join(","));
      url.searchParams.set("timezone", "Europe/Paris");
      url.searchParams.set("forecast_days", String(base.requestedDays));
      if (service.modelId !== "best_match") url.searchParams.set("models", getOpenMeteoProviderModelId(service.modelId));

      const response = await fetchWeather(url.toString(), {}, { timeoutMs: 12_000, attempts: 2 });
      const requestAttempts = getWeatherResponseAttemptCount(response);
      if (!response.ok) {
        const errorCode = response.status >= 500 ? "provider_http_5xx" : response.status >= 400 ? "provider_http_4xx" : "provider_http_error";
        return {
          forecast: null,
          diagnostic: buildDailyModelCollectionCoverage({ ...base, status: "failed", requestAttempts, errorCode }),
        };
      }

      const data = await response.json();
      const availableAt = Date.now();
      const daily = data && typeof data === "object" && "daily" in data && data.daily && typeof data.daily === "object"
        ? data.daily as Record<string, unknown>
        : null;
      const preliminary = buildDailyModelCollectionCoverage({
        ...base,
        status: "succeeded",
        requestAttempts,
        errorCode: null,
        daily,
      });
      const hasReturnedValues = preliminary.variables.some((variable) => variable.requested && variable.receivedCount > 0);
      const allRequestedVariablesHaveValues = preliminary.variables
        .filter((variable) => variable.requested)
        .every((variable) => variable.receivedCount === base.requestedDays);
      const dateIndex = Array.isArray(daily?.time) ? daily.time.indexOf(targetDate) : -1;
      const rawAtDate = (key: string): unknown => dateIndex >= 0 && Array.isArray(daily?.[key])
        ? (daily![key] as unknown[])[dateIndex]
        : null;
      const forecast: ForecastData | null = dateIndex < 0 ? null : {
        serviceName: service.name,
        serviceCategory: service.category,
        modelId: service.modelId,
        sourceName: "open-meteo",
        runId,
        runIdKind: "capture",
        requestStartedAt,
        availableAt,
        validTime: getDailyForecastValidTime(targetDate),
        qualityStatus: "unknown",
        tempMax: finiteCoverageValue(rawAtDate("temperature_2m_max")),
        tempMin: finiteCoverageValue(rawAtDate("temperature_2m_min")),
        precipitation: finiteCoverageValue(rawAtDate("precipitation_sum")),
        windSpeed: finiteCoverageValue(rawAtDate("wind_speed_10m_max")),
        windGust: finiteCoverageValue(rawAtDate("wind_gusts_10m_max")),
        // Keep requesting these undocumented means; expose only values actually returned by this model.
        humidity: finiteCoverageValue(rawAtDate("relative_humidity_2m_mean")),
        cloudCover: finiteCoverageValue(rawAtDate("cloud_cover_mean")),
        condition: null,
        rawData: data,
      };
      const usableForecast = forecast && hasUsableForecastValue(forecast) ? forecast : null;
      const status = preliminary.returnedDays === 0
        ? "failed"
        : hasReturnedValues && allRequestedVariablesHaveValues && preliminary.returnedDays === base.requestedDays && preliminary.targetDateInResponse
          ? "succeeded"
          : "partial";
      const errorCode = !hasReturnedValues
        ? "no_usable_data"
        : !preliminary.targetDateInResponse
          ? "target_date_out_of_horizon"
          : !usableForecast
            ? "target_date_no_usable_data"
            : null;
      const diagnostic = buildDailyModelCollectionCoverage({
        ...base,
        status,
        requestAttempts,
        errorCode,
        daily,
      });
      return { forecast: usableForecast, diagnostic };
    } catch (error) {
      const errorCode = classifyHourlyProviderError(error);
      return {
        forecast: null,
        diagnostic: buildDailyModelCollectionCoverage({
          ...base,
          status: errorCode === "invalid_response" ? "failed" : "safe_error",
          requestAttempts: 2,
          errorCode,
        }),
      };
    }
  }));

  return {
    forecasts: outcomes.flatMap((outcome) => outcome.forecast ? [outcome.forecast] : []),
    diagnostics: outcomes.map((outcome) => outcome.diagnostic),
    availabilityReasonByModel: outcomes.reduce<Record<string, string>>((reasons, outcome) => {
      const diagnostic = outcome.diagnostic;
      if (outcome.forecast) return reasons;
      const reason = diagnostic.errorCode === "target_date_out_of_horizon"
        ? "Échéance absente de la portée normale du modèle; absence physique non scorable et non pénalisante."
        : diagnostic.errorCode === "target_date_no_usable_data"
          ? "Le run existe, mais aucune valeur utilisable n’est renvoyée pour cette variable à cette échéance."
          : diagnostic.errorCode === "no_usable_data"
            ? "Le provider n’a renvoyé aucune valeur exploitable pour ce run."
            : `Run indisponible à la collecte (${diagnostic.errorCode ?? diagnostic.status}).`;
      reasons[diagnostic.modelName] = reason;
      return reasons;
    }, {}),
  };
}

/** Compatibility wrapper for consumers that only need the current daily values. */
export async function collectExpertForecasts(
  targetDate: string,
  coords?: { lat: number; lon: number },
): Promise<ForecastData[]> {
  return (await collectExpertForecastsWithDiagnostics(targetDate, coords)).forecasts;
}

/**
 * Collect validation models separately from the active expert catalogue.
 * Empty provider responses remain unavailable; no other model substitutes them.
 */
export async function collectValidationForecasts(
  targetDate: string,
  coords?: { lat: number; lon: number }
): Promise<ValidationForecastData[]> {
  const location = coords ?? HONDEGHEM;
  const responses = await Promise.all(
    VALIDATION_WEATHER_MODELS.map(async (model): Promise<ValidationForecastData | null> => {
      try {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", location.lat.toString());
        url.searchParams.set("longitude", location.lon.toString());
        url.searchParams.set("daily", DAILY_FORECAST_REQUEST_KEYS.join(","));
        url.searchParams.set("timezone", "Europe/Paris");
        url.searchParams.set("forecast_days", "16");
        url.searchParams.set("models", model.modelId);

        const response = await fetchWeather(url.toString(), {}, { timeoutMs: 12_000, attempts: 2 });
        if (!response.ok) return null;
        const data = await response.json();
        const daily = data.daily;
        const dateIndex = daily?.time?.indexOf(targetDate) ?? -1;
        if (dateIndex < 0 || daily.temperature_2m_max?.[dateIndex] == null) return null;
        return {
          serviceName: model.name,
          serviceCategory: "expert",
          modelId: model.modelId,
          validationStatus: "candidate",
          tempMax: daily.temperature_2m_max?.[dateIndex] ?? null,
          tempMin: daily.temperature_2m_min?.[dateIndex] ?? null,
          precipitation: daily.precipitation_sum?.[dateIndex] ?? null,
          windSpeed: daily.wind_speed_10m_max?.[dateIndex] ?? null,
          windGust: daily.wind_gusts_10m_max?.[dateIndex] ?? null,
          humidity: null,
          cloudCover: null,
          condition: null,
          rawData: data,
        };
      } catch (err) {
        console.warn(`[Validation] Error fetching ${model.name}:`, err);
        return null;
      }
    })
  );
  return responses.filter((forecast): forecast is ValidationForecastData => forecast !== null);
}

/**
 * Collect a retrospective model reference from Open-Meteo's forecast endpoint.
 * This is deliberately not represented as a physical observation.
 */
export async function collectObservations(
  targetDate: string,
  coords?: { lat: number; lon: number; name?: string }
) {
  const lat = coords?.lat ?? HONDEGHEM.lat;
  const lon = coords?.lon ?? HONDEGHEM.lon;
  const locationName = coords?.name ?? "Steenvoorde/Hazebrouck";
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat.toString());
    url.searchParams.set("longitude", lon.toString());
    url.searchParams.set("daily", DAILY_FORECAST_REQUEST_KEYS.join(","));
    url.searchParams.set("timezone", "Europe/Paris");
    url.searchParams.set("past_days", "7");
    url.searchParams.set("forecast_days", "0");

    const response = await fetchWeather(url.toString(), {}, { timeoutMs: 10_000, attempts: 2 });
    if (!response.ok) return null;

    const data = await response.json();
    const daily = data.daily;
    if (!daily || !daily.time) return null;

    const dateIndex = daily.time.indexOf(targetDate);
    if (dateIndex === -1) return null;

    return {
      date: targetDate,
      tempMax: daily.temperature_2m_max?.[dateIndex] ?? null,
      tempMin: daily.temperature_2m_min?.[dateIndex] ?? null,
      precipitation: daily.precipitation_sum?.[dateIndex] ?? null,
      windSpeed: daily.wind_speed_10m_max?.[dateIndex] ?? null,
      windGust: daily.wind_gusts_10m_max?.[dateIndex] ?? null,
      humidity: null,
      cloudCover: null,
      condition: null,
      source: `Open-Meteo forecast reference (${locationName})`,
      provenanceType: "model_reference" as const,
      isQualified: 0 as const,
      rawData: data,
    };
  } catch (err) {
    console.error("[Collector] Error fetching observations:", err);
    return null;
  }
}

export type DayForecast = {
  date: string;
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  precipitationConsensus?: PrecipitationModelConsensus | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection?: number | null;
  humidity: number | null;
  cloudCover: number | null;
  condition: string | null;
  weatherCode?: number | null;
  weatherCodeSummary?: DailyWeatherCodeSummary | null;
  modelAgreement: DailyModelAgreement;
  officialFusion: DailyOfficialFusionDisplay;
  bestMatchReference: BestMatchDailyReference | null;
  uvIndex?: number | null;
  feelsLikeMax?: number | null;
  feelsLikeMin?: number | null;
  sunrise?: string | null;
  sunset?: string | null;
};

export type HourlyWeightingUnavailableReason =
  | "insufficient_historical_evidence"
  | "history_unavailable"
  | "horizon_not_scored"
  | "incomparable_horizons"
  | "no_wet_models"
  | "no_model_data";

export type HourlyCalibrationStatus = "CALIBRATED" | "PARTIALLY_CALIBRATED" | "UNCALIBRATED_ROBUST" | "UNAVAILABLE";
export type HourlyAvailabilityStatus = "FUSED" | "SINGLE_MODEL" | "UNAVAILABLE";

export type HourlyModelWeightDiagnostic = {
  modelName: string;
  modelId: string;
  sourceName: string;
  runId: string | null;
  runIdKind: "capture" | "provider" | "unknown";
  requestStartedAt: number | null;
  availableAt: number;
  validTime: number;
  horizonMinutes: number | null;
  horizonBucket: string | null;
  value: number;
  reliability: number;
  historicalScore: HourlyHistoricalEvidence["metrics"];
  calibrationLevel: "EXACT_LOCAL_MODEL_VARIABLE_HORIZON" | "EXACT_LOCAL_MODEL_VARIABLE_BUCKET" | "UNCALIBRATED_ROBUST";
  calibrationStatus: HourlyCalibrationStatus;
  rawWeight: number;
  robustFallbackWeight: number | null;
  weight: number;
  contributedToValue: boolean;
  historicalEvidence?: HourlyHistoricalEvidence;
  exactHorizonEvidence?: HourlyHistoricalEvidence;
};

export type HourlyVariableWeighting = {
  variable: string;
  method: "historical_skill" | "mixed" | "robust_fallback" | "single_model" | "unavailable";
  selectionStrategy: HourlyVariableSelectionStrategy;
  selectedModelName: string | null;
  selectionEvidenceBasis: HourlySelectionEvidenceBasis;
  selectionReason: HourlyVariableSelectionReason;
  /** Null when available model runs fall into different history buckets. */
  horizonBucket: string | null;
  availabilityStatus: HourlyAvailabilityStatus;
  calibrationStatus: HourlyCalibrationStatus;
  unavailableReason: HourlyWeightingUnavailableReason | null;
  expectedModelCount: number;
  availableModelCount: number;
  evidenceEligibleModelCount: number;
  contributingModelCount: number;
  coverageLevel: ModelCountCoverageLevel;
  availableModels: string[];
  evidenceEligibleModels: string[];
  modelReasons: Array<{ modelName: string; reason: string; sourceName: string | null; modelId: string | null; runId: string | null; availableAt: number | null; validTime: number | null; horizonMinutes: number | null; horizonBucket: string | null }>;
  calibrationReasons: Array<{ modelName: string; reason: string; horizonBucket: string | null }>;
  modelsWithData: string[];
  modelWeights: HourlyModelWeightDiagnostic[];
  minimumComparisons: number | null;
  minimumComparableDays: number | null;
  historicalEvidence?: HourlyHistoricalEvidence[];
};

export type HourlyPointWeighting = {
  method: "historical_skill" | "mixed" | "robust_fallback" | "single_model" | "unavailable";
  availabilityStatus: HourlyAvailabilityStatus;
  calibrationStatus: HourlyCalibrationStatus;
  expectedModelCount: number;
  availableModelCount: number;
  evidenceEligibleModelCount: number;
  contributingModelCount: number;
  horizonBucket: string | null;
  unavailableReason: HourlyWeightingUnavailableReason | null;
  scoredVariables: string[];
  robustVariables: string[];
  unavailableVariables: string[];
  minimumComparisons: number | null;
  minimumComparableDays: number | null;
  variableWeightings: HourlyVariableWeighting[];
  modelsWithData: string[];
};

export type HourlyPoint = {
  date?: string;              // YYYY-MM-DD, nécessaire lorsque la couverture dépasse la journée courante
  hour: string;      // "HH:00"
  validAt?: number; // Absolute UTC instant; preserves repeated local hours at DST fall-back.
  forecastWeighting?: HourlyPointWeighting;
  temp: number | null;
  apparentTemp: number | null;
  precipitation: number | null;
  /** Raw rain/showers/snowfall values from the already selected precipitation contributors; never averaged here. */
  precipitationComponents?: Array<{ modelName: string; rain: number | null; showers: number | null; snowfall: number | null }>;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;  // degrees 0-360
  cloudCover: number | null;
  humidity: number | null;
  uvIndex: number | null;
  condition: string | null;
  weatherCode?: number | null;     // code WMO de la source, lorsqu’il est disponible
  // Extended fields for details page
  pressure?: number | null;        // hPa
  dewPoint?: number | null;        // °C
  visibility?: number | null;      // km
  solarRadiation?: number | null;  // W/m²
  cloudLow?: number | null;        // %
  cloudMid?: number | null;        // %
  cloudHigh?: number | null;       // %
  precipType?: string | null;      // rain, snow, freezing_rain, etc.
  precipIntensity?: string | null; // light, moderate, heavy
  /** Per-cell supplemental source, populated only by the detail-page gap fallback. */
  fallbackProvenance?: HourlyFallbackProvenance;
  /** Only the official seven-model engine populates these source-tagged metrics. */
  multiModelMetrics?: HourlyMultiModelMetrics | null;
};

export type CurrentWeatherSnapshot = {
  sourceKind: "model_current_snapshot";
  source: "open-meteo";
  capturedAt: string;
  /** Elevation reported for the requested point; used only for station altitude QA. */
  elevationM?: number | null;
  temp: number | null;
  apparentTemp: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  cloudCover: number | null;
  humidity: number | null;
  weatherCode: number | null;
  condition: string | null;
};

/** Une direction est circulaire : 350° et 10° sont proches du nord, pas du sud. */
export function circularMeanDegrees(values: readonly number[]): number | null {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  const radians = valid.map((value) => (value * Math.PI) / 180);
  const sin = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  const cos = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  return Math.round((((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360) * 10) / 10;
}

/** Écart angulaire minimal, en tenant compte du passage 359° → 0°. */
export function circularDifferenceDegrees(left: number | null, right: number | null): number | null {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  const rawDifference = Math.abs(left - right) % 360;
  return Math.min(rawDifference, 360 - rawDifference);
}

/** Fetch actual daily coverage from the official models and fuse only qualified evidence. */
export async function collect15DayForecast(
  coords: { lat: number; lon: number } | undefined,
  options: Collect15DayForecastOptions,
): Promise<{ days: DayForecast[]; modelsUsed: string[] }> {
  const location = coords ?? HONDEGHEM;
  const models = [
    ...OFFICIAL_HOURLY_MODELS.map((model) => ({ name: model.name, modelId: model.modelId })),
    { name: "Open-Meteo", modelId: null },
  ];
  const officialModelNames = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
  const dates = new Set<string>();
  const forecastsByDate = new Map<string, ForecastData[]>();
  const agreementInputsByDate = new Map<string, DailyAgreementInput[]>();
  const bestMatchByDate = new Map<string, BestMatchDailyReference>();
  const sunDataByDate = new Map<string, { sunrise: string | null; sunset: string | null }>();
  const usedModels = new Set<string>();
  const requestDate = getParisDateAndHour(options.issuedAt)?.date ?? null;
  const dailyFields = Array.from(new Set([
    ...DAILY_FORECAST_REQUEST_KEYS,
    "wind_direction_10m_dominant",
    "uv_index_max",
    "apparent_temperature_max",
    "apparent_temperature_min",
    "sunrise",
    "sunset",
  ])).join(",");
  const officialDailyFields = Array.from(new Set([...dailyFields.split(","), "weather_code"])).join(",");

  const modelResults = await Promise.all(models.map(async (model) => {
    const requestStartedAt = Date.now();
    const runId = randomUUID();
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", location.lat.toString());
      url.searchParams.set("longitude", location.lon.toString());
      // Daily WMO codes are requested only for the seven official model runs; Best Match stays excluded.
      url.searchParams.set("daily", model.modelId ? officialDailyFields : dailyFields);
      url.searchParams.set("timezone", "Europe/Paris");
      url.searchParams.set("forecast_days", String(getModelRequestedForecastDays(model.name)));
      if (model.modelId) url.searchParams.set("models", model.modelId);

      const response = await fetchWeather(url.toString(), {}, { timeoutMs: 6_000, attempts: 1,quotaStore:options.quotaStore });
      const networkAttemptCount = getWeatherResponseAttemptCount(response);
      if (!response.ok) return { name: model.name, modelId: model.modelId, daily: null, requestStartedAt, availableAt: null, networkAttemptCount, runId, errorReason: `HTTP ${response.status}` };
      const data = await response.json();
      const availableAt = Date.now();
      const daily = data.daily;
      if (!Array.isArray(daily?.time)) return { name: model.name, modelId: model.modelId, daily: null, requestStartedAt, availableAt, networkAttemptCount, runId, errorReason: "Réponse provider sans série daily.time." };
      return { name: model.name, modelId: model.modelId, daily, requestStartedAt, availableAt, networkAttemptCount, runId, errorReason: null };
    } catch (error) {
      console.error(`[15Day] Error fetching ${model.name}:`, error);
      return { name: model.name, modelId: model.modelId, daily: null, requestStartedAt, availableAt: null, networkAttemptCount: null, runId, errorReason: error instanceof Error ? error.message : "Source indisponible." };
    }
  }));
  const collectionReferenceAt = Date.now();
  const resultByModelName = new Map(modelResults.map((result) => [result.name, result]));
  const availabilityReasonForDate = (date: string): Record<string, string> => officialModelNames.reduce<Record<string, string>>((reasons, modelName) => {
    const result = resultByModelName.get(modelName);
    if (!result) {
      reasons[modelName] = "Aucun résultat de collecte pour ce modèle.";
      return reasons;
    }
    if (!result.daily) {
      reasons[modelName] = `Run indisponible: ${result.errorReason ?? "aucune série daily reçue"}.`;
      return reasons;
    }
    if (!Array.isArray(result.daily.time) || !result.daily.time.includes(date)) {
      reasons[modelName] = "Échéance absente de la portée normale du modèle; absence physique non scorable et non pénalisante.";
    }
    return reasons;
  }, {});

  const at = (values: unknown, index: number): number | null =>
    Array.isArray(values) ? finiteCoverageValue(values[index]) : null;
  const dateIsValid = (value: unknown): value is string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const weatherCodeCandidatesForDate = (date: string): DailyWeatherCodeCandidate[] => OFFICIAL_HOURLY_MODELS.map((model) => {
    const result = resultByModelName.get(model.name);
    const base = {
      modelName: model.name,
      modelId: model.modelId,
      sourceName: result ? "open-meteo" : null,
      runId: result?.runId ?? null,
      runIdKind: result ? "capture" as const : null,
      networkAttemptCount: result?.networkAttemptCount ?? null,
      deliveryMode: result?.networkAttemptCount === 0 ? "cache" as const : result?.networkAttemptCount == null ? "unknown" as const : "network" as const,
      requestStartedAt: result?.requestStartedAt ?? null,
      availableAt: result?.availableAt ?? null,
      validTime: null as number | null,
      weatherCode: null as number | null,
    };
    if (!result?.daily || !Array.isArray(result.daily.time)) return { ...base, valueStatus: "request_failed" as const };
    const dateIndexes = result.daily.time.flatMap((value: unknown, index: number) => value === date ? [index] : []);
    if (dateIndexes.length === 0) return { ...base, valueStatus: "date_missing" as const };
    if (dateIndexes.length !== 1) return { ...base, valueStatus: "duplicate_date" as const };
    const index = dateIndexes[0]!;
    const validTime = getDailyForecastValidTime(date);
    const timeMatchedBase = { ...base, validTime };
    const codes = result.daily.weather_code;
    if (!Array.isArray(codes) || index >= codes.length || !Object.prototype.hasOwnProperty.call(codes, index)) {
      return { ...timeMatchedBase, valueStatus: "field_missing" as const };
    }
    const rawCode = codes[index];
    if (rawCode == null) return { ...timeMatchedBase, valueStatus: "provider_null" as const };
    if (!isValidDailyWmoWeatherCode(rawCode)) return { ...timeMatchedBase, valueStatus: "invalid_value" as const };
    return { ...timeMatchedBase, weatherCode: rawCode, valueStatus: "valid" as const };
  });

  for (const result of modelResults) {
    if (!result?.daily) continue;
    const { name, modelId, daily, availableAt, requestStartedAt, runId } = result;
    const bestMatch = modelId == null;
    const requestedDates = daily.time.slice(0, 16);
    for (let index = 0; index < requestedDates.length; index++) {
      const date = requestedDates[index];
      if (!dateIsValid(date)) continue;
      dates.add(date);
      const values = {
        tempMax: at(daily.temperature_2m_max, index),
        tempMin: at(daily.temperature_2m_min, index),
        precipitation: at(daily.precipitation_sum, index),
        windSpeed: at(daily.wind_speed_10m_max, index),
        windGust: at(daily.wind_gusts_10m_max, index),
        humidity: at(daily.relative_humidity_2m_mean, index),
        cloudCover: at(daily.cloud_cover_mean, index),
      };
      const supplementalBestMatchValues = {
        windDirection: at(daily.wind_direction_10m_dominant, index),
        uvIndex: at(daily.uv_index_max, index),
        feelsLikeMax: at(daily.apparent_temperature_max, index),
        feelsLikeMin: at(daily.apparent_temperature_min, index),
      };
      const hasMetric = Object.values(values).some((value) => value != null);
      if (hasMetric) usedModels.add(name);

      if (bestMatch) {
        if (hasMetric || Object.values(supplementalBestMatchValues).some((value) => value != null)) {
          bestMatchByDate.set(date, {
            source: "Open-Meteo Best Match",
            role: "derived_reference",
            officialContributor: false,
            ...values,
            ...supplementalBestMatchValues,
          });
        }
      } else {
        const forecast: ForecastData = {
          serviceName: name,
          serviceCategory: "expert",
          modelId,
          sourceName: "open-meteo",
          runId,
          runIdKind: "capture",
          requestStartedAt,
          availableAt,
          validTime: getDailyForecastValidTime(date),
          qualityStatus: "unknown",
          tempMax: values.tempMax,
          tempMin: values.tempMin,
          precipitation: values.precipitation,
          windSpeed: values.windSpeed,
          windGust: values.windGust,
          humidity: values.humidity,
          cloudCover: values.cloudCover,
          condition: null,
        };
        const forecasts = forecastsByDate.get(date) ?? [];
        forecasts.push(forecast);
        forecastsByDate.set(date, forecasts);
        const agreementInputs = agreementInputsByDate.get(date) ?? [];
        agreementInputs.push({
          modelName: name,
          tempMax: values.tempMax,
          tempMin: values.tempMin,
          precipitation: values.precipitation,
          windSpeed: values.windSpeed,
          windGust: values.windGust,
          humidity: values.humidity,
          cloudCover: values.cloudCover,
        });
        agreementInputsByDate.set(date, agreementInputs);
      }

      if (!sunDataByDate.has(date) && Array.isArray(daily.sunrise) && Array.isArray(daily.sunset)
        && typeof daily.sunrise[index] === "string" && typeof daily.sunset[index] === "string") {
        sunDataByDate.set(date, {
          sunrise: daily.sunrise[index].slice(11, 16),
          sunset: daily.sunset[index].slice(11, 16),
        });
      }
    }
  }

  const toDiagnostics = (
    sources: readonly ForecastTraceSource[],
    variable: DailyForecastMetric | "humidity" | "cloud_cover",
    horizonBucket: DailyOfficialFusionDisplay["horizonBucket"],
  ) => sources.map((source) => ({
      modelName: source.name,
      variable: source.variable ?? variable,
      horizonBucket: source.horizonBucket ?? horizonBucket,
      sourceName: source.sourceName,
      modelId: source.modelId,
      runId: source.runId,
      availableAt: source.availableAt,
      validTime: source.validTime,
      horizonMinutes: source.horizonMinutes,
      calibrationStatus: source.calibrationStatus,
      finalWeight: source.finalWeight,
      rawWeight: source.rawWeight,
      robustFallbackWeight: source.robustFallbackWeight,
      signedBias: source.signedBias ?? null,
      sampleSize: source.sampleSize ?? null,
      comparisonCount: source.comparisonCount ?? null,
      evaluatedDays: source.evaluatedDays ?? null,
      latestScoreDate: source.latestScoreDate ?? null,
    }));

  const requestDay = requestDate ? Date.parse(`${requestDate}T12:00:00.000Z`) : NaN;
  const days: DayForecast[] = await Promise.all(Array.from(dates).sort().slice(0, 16).map(async (date) => {
    const officialForecasts = forecastsByDate.get(date) ?? [];
    const fusion = await options.resolveOfficialFusion(date, officialForecasts, collectionReferenceAt, availabilityReasonForDate(date));
    const horizonBucket = fusion.trace.horizonBucket;
    const agreementInputs = agreementInputsByDate.get(date) ?? [];
    const physicallyAvailableAgreementModels = agreementInputs.filter((item) =>
      [item.tempMax, item.tempMin, item.precipitation, item.windSpeed, item.windGust, item.humidity, item.cloudCover]
        .some((value) => typeof value === "number" && Number.isFinite(value))
    ).map((item) => item.modelName);
    const modelAgreement = summarizeDailyModelAgreement(
      agreementInputs,
      physicallyAvailableAgreementModels,
      Number.isFinite(requestDay)
        ? Math.round((Date.parse(`${date}T12:00:00.000Z`) - requestDay) / 86_400_000)
        : null,
    );
    const officialFusion: DailyOfficialFusionDisplay = {
      issuedAt: fusion.trace.issuedAt,
      referenceAt: fusion.trace.referenceAt,
      horizonBucket,
      availabilityStatus: {
        tempMax: fusion.availabilityStatus.tempMax,
        tempMin: fusion.availabilityStatus.tempMin,
        precipitation: fusion.availabilityStatus.precipitation,
        windSpeed: fusion.availabilityStatus.windSpeed,
        windGust: fusion.availabilityStatus.windGust,
        humidity: fusion.availabilityStatus.humidity,
        cloudCover: fusion.availabilityStatus.cloudCover,
      },
      calibrationStatus: {
        tempMax: fusion.calibrationStatus.tempMax,
        tempMin: fusion.calibrationStatus.tempMin,
        precipitation: fusion.calibrationStatus.precipitation,
        windSpeed: fusion.calibrationStatus.windSpeed,
        windGust: fusion.calibrationStatus.windGust,
        humidity: fusion.calibrationStatus.humidity,
        cloudCover: fusion.calibrationStatus.cloudCover,
      },
      sourcesByVariable: {
      tempMax: toDiagnostics(fusion.trace.parameterSources.tempMax, "temperature_max", horizonBucket),
      tempMin: toDiagnostics(fusion.trace.parameterSources.tempMin, "temperature_min", horizonBucket),
        precipitation: toDiagnostics(fusion.trace.parameterSources.precipitation, "precipitation_sum", horizonBucket),
      windSpeed: toDiagnostics(fusion.trace.parameterSources.windSpeed, "wind_speed_max", horizonBucket),
        windGust: toDiagnostics(fusion.trace.parameterSources.windGust, "wind_gust_max", horizonBucket),
        humidity: toDiagnostics(fusion.trace.parameterSources.humidity, "humidity", horizonBucket),
        cloudCover: toDiagnostics(fusion.trace.parameterSources.cloudCover, "cloud_cover", horizonBucket),
      },
      diagnosticsByVariable: {
        tempMax: fusion.parameterDiagnostics.temperature_max,
        tempMin: fusion.parameterDiagnostics.temperature_min,
        precipitation: fusion.parameterDiagnostics.precipitation_sum,
        windSpeed: fusion.parameterDiagnostics.wind_speed_max,
        windGust: fusion.parameterDiagnostics.wind_gust_max,
        humidity: fusion.parameterDiagnostics.humidity,
        cloudCover: fusion.parameterDiagnostics.cloud_cover,
      },
    };
    const dailyWeatherCodeSummary = summarizeDailyWeatherCodes({
      validDate: date,
      expectedValidTime: getDailyForecastValidTime(date) ?? Number.NaN,
      computedAt: collectionReferenceAt,
      expectedModels: OFFICIAL_HOURLY_MODELS.map(({ name, modelId }) => ({ modelName: name, modelId })),
      candidates: weatherCodeCandidatesForDate(date),
    });
    const bestMatchReference = bestMatchByDate.get(date) ?? null;
    return {
      date,
      tempMax: fusion.tempMax,
      tempMin: fusion.tempMin,
      precipitation: fusion.precipitation,
      precipitationConsensus: fusion.trace.precipitationConsensus,
      windSpeed: fusion.windSpeed,
      windGust: fusion.windGust,
      // Supplemental values are raw Best Match references, not official fusion inputs.
      windDirection: bestMatchReference?.windDirection ?? null,
      humidity: fusion.humidity,
      cloudCover: fusion.cloudCover,
      condition: dailyWeatherCodeSummary.condition,
      weatherCode: dailyWeatherCodeSummary.weatherCode,
      weatherCodeSummary: dailyWeatherCodeSummary,
      modelAgreement,
      officialFusion,
      bestMatchReference,
      uvIndex: bestMatchReference?.uvIndex ?? null,
      feelsLikeMax: bestMatchReference?.feelsLikeMax ?? null,
      feelsLikeMin: bestMatchReference?.feelsLikeMin ?? null,
      sunrise: sunDataByDate.get(date)?.sunrise ?? null,
      sunset: sunDataByDate.get(date)?.sunset ?? null,
    };
  }));

  return { days, modelsUsed: models.filter((model) => usedModels.has(model.name)).map((model) => model.name) };
}

/**
 * Fetch hourly forecast for today from Open-Meteo best_match model.
 */
export async function collectHourlyForecast(
  targetDate: string,
  coords?: { lat: number; lon: number },
  forecastDays = 2,
  options: { now?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HourlyPoint[]> {
  const location = coords ?? HONDEGHEM;
  const now = options.now ?? Date.now();
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", location.lat.toString());
    url.searchParams.set("longitude", location.lon.toString());
    url.searchParams.set("hourly", "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,relative_humidity_2m,uv_index,surface_pressure,dew_point_2m,visibility,shortwave_radiation,cloud_cover_low,cloud_cover_mid,cloud_cover_high,snowfall,weather_code");
    url.searchParams.set("timezone", "Europe/Paris");
    url.searchParams.set("timeformat", "unixtime");
    url.searchParams.set("forecast_days", String(Math.min(16, Math.max(1, forecastDays))));

    const response = await fetchWeather(url.toString(), { signal: options.signal }, { timeoutMs: options.timeoutMs ?? 8_000, attempts: 1 });
    if (!response.ok) return [];

    const data = await response.json();
    const hourly = data.hourly;
    if (!hourly?.time) return [];

    const points: HourlyPoint[] = [];
    for (let i = 0; i < hourly.time.length; i++) {
      const validAt = Number(hourly.time[i]) * 1000;
      const parisTime = getParisDateAndHour(validAt);
      if (!Number.isFinite(validAt) || !parisTime || parisTime.date < targetDate || validAt + 60 * 60_000 <= now) continue;
      const date = parisTime.date;
      const hour = `${String(parisTime.hour).padStart(2, "0")}:00`;
      const precip = hourly.precipitation?.[i] ?? null;
      const cloud = hourly.cloud_cover?.[i] ?? null;
      const weatherCode = hourly.weather_code?.[i] ?? null;
      const bestTemp = hourly.temperature_2m?.[i] ?? null;
      const windSpeed = hourly.wind_speed_10m?.[i] ?? null;
      const windGust = hourly.wind_gusts_10m?.[i] ?? null;
      const windDirection = hourly.wind_direction_10m?.[i] ?? null;
      const humidity = hourly.relative_humidity_2m?.[i] ?? null;

      // Derive precipitation type and intensity
      const snowfall = hourly.snowfall?.[i] ?? null;
      let precipType: string | null = null;
      let precipIntensity: string | null = null;
      const hasPrecipitation = typeof precip === "number" && Number.isFinite(precip);
      const hasSnowfall = typeof snowfall === "number" && Number.isFinite(snowfall);
      const typedWeatherCode = typeof weatherCode === "number" && Number.isFinite(weatherCode) ? weatherCode : null;
      const phaseFromWeatherCode = typedWeatherCode === 66 || typedWeatherCode === 67
        ? "freezing_rain"
        : typedWeatherCode != null && ((typedWeatherCode >= 71 && typedWeatherCode <= 77) || typedWeatherCode === 85 || typedWeatherCode === 86)
          ? "snow"
          : typedWeatherCode != null && ((typedWeatherCode >= 51 && typedWeatherCode <= 55) || (typedWeatherCode >= 61 && typedWeatherCode <= 65) || (typedWeatherCode >= 80 && typedWeatherCode <= 82))
            ? "rain"
            : null;
      if ((hasPrecipitation && precip > 0) || (hasSnowfall && snowfall > 0)) {
        precipType = phaseFromWeatherCode ?? (hasSnowfall && snowfall > 0 ? "snow" : null);
        const total = hasPrecipitation && hasSnowfall ? precip + snowfall : null;
        precipIntensity = total == null ? null : total > 5 ? "heavy" : total > 1 ? "moderate" : "light";
      }

      points.push({
        date,
        hour,
        validAt,
        temp: bestTemp,
        apparentTemp: hourly.apparent_temperature?.[i] ?? null,
        precipitation: precip,
        windSpeed,
        windGust,
        windDirection,
        cloudCover: cloud,
        humidity,
        uvIndex: hourly.uv_index?.[i] ?? null,
        condition: conditionFromWmoWeatherCode(weatherCode, precip, cloud),
        weatherCode,
        // Extended fields
        pressure: hourly.surface_pressure?.[i] ?? null,
        dewPoint: hourly.dew_point_2m?.[i] ?? null,
        visibility: hourly.visibility?.[i] != null ? Math.round((hourly.visibility[i] as number) / 1000 * 10) / 10 : null,
        solarRadiation: hourly.shortwave_radiation?.[i] ?? null,
        cloudLow: hourly.cloud_cover_low?.[i] ?? null,
        cloudMid: hourly.cloud_cover_mid?.[i] ?? null,
        cloudHigh: hourly.cloud_cover_high?.[i] ?? null,
        precipType,
        precipIntensity,
      });
    }
    return points;
  } catch (err) {
    console.error("[Hourly] Error fetching hourly forecast:", err);
    return [];
  }
}

type CurrentSnapshotCacheEntry = {
  expiresAt: number;
  value: Promise<CurrentWeatherSnapshot | null>;
};

export const CURRENT_WEATHER_SNAPSHOT_TTL_MS = 20_000;
export const CURRENT_WEATHER_SNAPSHOT_CACHE_MAX_ENTRIES = 64;
const currentWeatherSnapshotCache = new Map<string, CurrentSnapshotCacheEntry>();

function currentSnapshotCacheKey(coords: { lat: number; lon: number }): string {
  // Coordinates received from UI calls can vary below the useful model-grid
  // precision. Canonicalise only the in-memory key; DB/archive keys are untouched.
  return `${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`;
}

function trimCurrentSnapshotCache(now = Date.now()): void {
  for (const [key, entry] of Array.from(currentWeatherSnapshotCache.entries())) {
    if (entry.expiresAt <= now) currentWeatherSnapshotCache.delete(key);
  }
  while (currentWeatherSnapshotCache.size > CURRENT_WEATHER_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldest = currentWeatherSnapshotCache.keys().next().value as string | undefined;
    if (!oldest) break;
    currentWeatherSnapshotCache.delete(oldest);
  }
}

export function getCurrentWeatherSnapshotCacheMetrics() {
  trimCurrentSnapshotCache();
  return { entries: currentWeatherSnapshotCache.size };
}

export function resetCurrentWeatherSnapshotCache(): void {
  currentWeatherSnapshotCache.clear();
}

/** Fetches Open-Meteo's model-provided current snapshot separately from hourly forecast values. */
export async function collectCurrentWeatherSnapshot(
  coords?: { lat: number; lon: number },
  options: { signal?: AbortSignal; timeoutMs?: number;quotaStore?: import('./openMeteoQuota').WeatherQuotaStore } = {},
): Promise<CurrentWeatherSnapshot | null> {
  const location = coords ?? HONDEGHEM;
  const key = currentSnapshotCacheKey(location);
  const now = Date.now();
  trimCurrentSnapshotCache(now);
  const cached = currentWeatherSnapshotCache.get(key);
  if (cached && cached.expiresAt > now) {
    // Map insertion order is the LRU order.
    currentWeatherSnapshotCache.delete(key);
    currentWeatherSnapshotCache.set(key, cached);
    return cached.value;
  }

  // A caller-owned signal must remain cancellable and cannot be allowed to
  // cancel another reader's shared work. Unsigned calls are true single-flight.
  if (options.signal) return collectCurrentWeatherSnapshotUncached(location, options);
  const value = collectCurrentWeatherSnapshotUncached(location, options);
  currentWeatherSnapshotCache.set(key, { expiresAt: now + CURRENT_WEATHER_SNAPSHOT_TTL_MS, value });
  trimCurrentSnapshotCache();
  void value.catch(() => {
    if (currentWeatherSnapshotCache.get(key)?.value === value) currentWeatherSnapshotCache.delete(key);
  });
  return value;
}

async function collectCurrentWeatherSnapshotUncached(
  location: { lat: number; lon: number },
  options: { signal?: AbortSignal; timeoutMs?: number;quotaStore?: import('./openMeteoQuota').WeatherQuotaStore },
): Promise<CurrentWeatherSnapshot | null> {
  const value = (async (): Promise<CurrentWeatherSnapshot | null> => {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", location.lat.toString());
    url.searchParams.set("longitude", location.lon.toString());
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,relative_humidity_2m,weather_code");
    url.searchParams.set("timezone", "Europe/Paris");
    url.searchParams.set("timeformat", "unixtime");

    const response = await fetchWeather(url.toString(), { signal: options.signal }, {
      timeoutMs: options.timeoutMs ?? 6_000,
      attempts: 1,
      quotaStore:options.quotaStore,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const current = payload.current;
    if (!current || typeof current.time !== "number" || !Number.isFinite(current.time)) return null;
    const capturedAt = Number(current?.time) * 1000;
    if (!Number.isFinite(capturedAt)) return null;
    const weatherCode = current.weather_code ?? null;
    const precipitation = current.precipitation ?? null;
    const cloudCover = current.cloud_cover ?? null;
    return {
      sourceKind: "model_current_snapshot",
      source: "open-meteo",
      capturedAt: new Date(capturedAt).toISOString(),
      elevationM: typeof payload.elevation === "number" && Number.isFinite(payload.elevation) ? payload.elevation : null,
      temp: current.temperature_2m ?? null,
      apparentTemp: current.apparent_temperature ?? null,
      precipitation,
      windSpeed: current.wind_speed_10m ?? null,
      windGust: current.wind_gusts_10m ?? null,
      windDirection: current.wind_direction_10m ?? null,
      cloudCover,
      humidity: current.relative_humidity_2m ?? null,
      weatherCode,
      condition: conditionFromWmoWeatherCode(weatherCode, precipitation, cloudCover),
    };
  } catch (error) {
    console.error("[CurrentSnapshot] Error fetching Open-Meteo current model snapshot:", error);
    return null;
  }
  })();
  return value;
}

/**
 * Collect hourly forecasts for ALL expert models for a given date and location.
 * Returns an array of { modelName, hours } for storage in hourly_forecasts table.
 * Called at each active favorite-forecast schedule slot; deployment Heartbeat is configured separately.
 */
export type HourlyModelForecast = {
  modelName: string;
  modelId?: string | null;
  sourceName?: string;
  captureRunId?: string;
  requestStartedAt?: number;
  availableAt?: number;
  /** Exact provider model initialization timestamp, null when the response does not attest it. */
  providerRunAt?: number | null;
  hours: Array<{
    validAt: number;
    hour: number;
    temperature: number | null;
    apparentTemperature: number | null;
    precipitation: number | null;
    rain: number | null;
    showers: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    windDirection: number | null;
    humidity: number | null;
    pressure: number | null;
    cloudCover: number | null;
    weatherCode: number | null;
    uvIndex?: number | null;
    dewPoint?: number | null;
    visibility?: number | null; // km
    solarRadiation?: number | null;
    cloudLow?: number | null;
    cloudMid?: number | null;
    cloudHigh?: number | null;
    snowfall?: number | null;
  }>;
  sourceMetadata?: {
    timezone: string | null;
    utcOffsetSeconds: number | null;
    units: {
      temperature: string | null;
      apparentTemperature: string | null;
      precipitation: string | null;
      rain: string | null;
      showers: string | null;
      windSpeed: string | null;
      windGusts: string | null;
      windDirection: string | null;
      humidity: string | null;
      pressure: string | null;
      cloudCover: string | null;
      weatherCode: string | null;
      uvIndex?: string | null;
      dewPoint?: string | null;
      visibility?: string | null;
      solarRadiation?: string | null;
      cloudLow?: string | null;
      cloudMid?: string | null;
      cloudHigh?: string | null;
      snowfall?: string | null;
    };
  };
};

export type HourlyModelCollectionStatus = "attempting" | "succeeded" | "partial" | "failed" | "safe_error";
export type HourlyModelCollectionDiagnostic = {
  modelName: string;
  modelId: string | null;
  status: Exclude<HourlyModelCollectionStatus, "attempting">;
  attemptCount: number;
  hoursReceived: number;
  valuesReceived: number;
  expectedValueCount: number;
  expectedHoursCount: number;
  projectionReady: boolean;
  errorCode: string | null;
  variableDiagnostics?: HourlyVariableSourceDiagnostic[];
};

export type CollectedHourlyForecastModels = {
  forecasts: HourlyModelForecast[];
  diagnostics: HourlyModelCollectionDiagnostic[];
};

const HOURLY_ARCHIVE_VARIABLES = HOURLY_FORECAST_VARIABLES.map((definition) => definition.valueField);
const HOURLY_PROJECTION_VARIABLES: readonly string[] = HOURLY_FORECAST_VARIABLES
  .filter((definition) => definition.consumerProjected)
  .map((definition) => definition.valueField);
// Champs d'archive secondaires (non consommés par la projection) : archivés tels
// quels, null admis (UV/rayonnement la nuit, averses/neige sans phénomène,
// visibilité selon le produit). Ils ne doivent plus bloquer la complétude du lot.
export const HOURLY_OPTIONAL_ARCHIVE_VARIABLES = HOURLY_ARCHIVE_VARIABLES.filter(
  (field) => !HOURLY_PROJECTION_VARIABLES.includes(field),
);

function finiteHourlyValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getHourlyVariableInputDiagnostics(
  hourly: Record<string, unknown>,
  rawTimes: readonly unknown[],
  expectedValidTimes: readonly number[],
  hourlyUnits: Record<string, unknown>,
): HourlyVariableSourceDiagnostic[] {
  const indicesByValidAt = new Map<number, number[]>();
  const instantsByLocalHour = new Map<string, Set<number>>();
  const expected = new Set(expectedValidTimes);
  let malformedTimeCount = 0;
  for (let index = 0; index < rawTimes.length; index++) {
    const unixSeconds = parseHourlyTimestampSeconds(rawTimes[index]);
    if (unixSeconds == null) {
      malformedTimeCount++;
      continue;
    }
    const validAt = unixSeconds * 1000;
    const local = getParisDateAndHour(validAt);
    if (local) {
      const key = `${local.date}:${String(local.hour).padStart(2, "0")}`;
      const instants = instantsByLocalHour.get(key) ?? new Set<number>();
      instants.add(validAt);
      instantsByLocalHour.set(key, instants);
    }
    if (!expected.has(validAt)) continue;
    const indexes = indicesByValidAt.get(validAt) ?? [];
    indexes.push(index);
    indicesByValidAt.set(validAt, indexes);
  }

  return HOURLY_FORECAST_VARIABLES.map((definition) => ({
    key: definition.key,
    slots: expectedValidTimes.map((validAt) => {
      const index = indicesByValidAt.get(validAt)?.[0];
      if (index == null) {
        const local = getParisDateAndHour(validAt);
        const key = local ? `${local.date}:${String(local.hour).padStart(2, "0")}` : "";
        const status: HourlySourceValueStatus = (local && (instantsByLocalHour.get(key)?.size ?? 0) > 0) || malformedTimeCount > 0
          ? "time_mismatch"
          : "no_model_data";
        return { validAt, status, rawType: null, rawValue: null, rawUnit: typeof hourlyUnits[definition.apiKey] === "string" ? hourlyUnits[definition.apiKey] as string : null };
      }
      const series = hourly[definition.apiKey];
      const rawValue = Array.isArray(series) && index < series.length ? series[index] : undefined;
      const normalized = normalizeHourlySourceValue({ variable: definition.key, value: rawValue, unit: hourlyUnits[definition.apiKey] });
      return {
        validAt,
        status: normalized.status,
        rawType: normalized.rawType,
        rawValue: normalized.rawValue,
        rawUnit: normalized.rawUnit,
      };
    }),
  }));
}

function classifyHourlyProviderError(error: unknown): string {
  if (error instanceof Error && error.name === "SyntaxError") return "invalid_response";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|timed out|aborted/i.test(error.message))) {
    return "timeout";
  }
  return "source_unavailable";
}

/** Collects each model independently and preserves safe per-model outcome metadata. */
export async function collectHourlyForecastAllModelsWithDiagnostics(
  targetDate: string,
  coords?: { lat: number; lon: number },
  options: {
    includeBestMatch?: boolean;
    includeNextDay?: boolean;
    forecastDays?: number;
    /** Délai par tentative fournisseur ; 12 s par défaut (collecte planifiée). */
    timeoutMs?: number;
    /**
     * Au-delà de ce délai écoulé depuis le début de la collecte, la seconde
     * passe n'est pas lancée : les modèles incomplets gardent leur diagnostic.
     */
    retryBudgetMs?: number;
    quotaStore?: import('./openMeteoQuota').WeatherQuotaStore;
    /** Propagé au transport fournisseur pour les lectures interactives annulables. */
    signal?: AbortSignal;
  } = {},
): Promise<CollectedHourlyForecastModels> {
  const collectionStartedAt = Date.now();
  const location = coords ?? HONDEGHEM;
  const nextDate = options.includeNextDay ? shiftParisCivilDate(targetDate, 1) : null;
  const hasExplicitForecastDays = Number.isFinite(options.forecastDays);
  const requestedForecastDays = hasExplicitForecastDays ? Math.floor(options.forecastDays!) : 2;
  const forecastDays = Math.min(16, Math.max(options.includeNextDay ? 2 : 1, requestedForecastDays));
  const lastDate = (hasExplicitForecastDays ? shiftParisCivilDate(targetDate, forecastDays - 1) : nextDate ?? targetDate) ?? targetDate;
  const expectedDates = nextDate ? [targetDate, nextDate] : [targetDate];
  const expectedValidTimes = expectedDates.flatMap((date) => getParisHourlyTimestamps(date));
  const expectedValidTimeSet = new Set(expectedValidTimes);
  const expectedHoursCount = expectedValidTimes.length;
  const expectedValueCount = expectedHoursCount * HOURLY_FORECAST_VARIABLES.length;
  const modelsToCollect = [
    ...OFFICIAL_HOURLY_MODELS,
    ...(options.includeBestMatch === false ? [] : [{ name: "best_match", modelId: null }]), // Open-Meteo best match
  ];

  type ModelAttempt = { forecast: HourlyModelForecast | null; diagnostic: HourlyModelCollectionDiagnostic };
  const collectModel = async (model: typeof modelsToCollect[number], attempts: number): Promise<ModelAttempt> => {
    const requestStartedAt = Date.now();
    let attemptCount = 0;
    const modelForecastDays = model.modelId
      ? getModelRequestedForecastDays(model.name, forecastDays)
      : forecastDays;
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", location.lat.toString());
      url.searchParams.set("longitude", location.lon.toString());
      url.searchParams.set("hourly", HOURLY_FORECAST_VARIABLES.map((definition) => definition.apiKey).join(","));
      url.searchParams.set("timezone", "Europe/Paris");
      url.searchParams.set("timeformat", "unixtime");
      url.searchParams.set("forecast_days", String(modelForecastDays));
      if (model.modelId) {
        url.searchParams.set("models", getOpenMeteoProviderModelId(model.modelId));
      }

      const response = await fetchWeather(url.toString(), { signal: options.signal }, {
        timeoutMs: options.timeoutMs ?? 12_000,
        attempts,
        cacheTtlMs: 0,
        quotaStore:options.quotaStore,
      });
      attemptCount = getWeatherResponseAttemptCount(response);
      if (!response.ok) {
        const errorCode = response.headers?.get('X-MeteoAI-Quota-Suspended')==='1'?'rate_limit_suspended':response.status===429?'provider_rate_limited':response.status >= 500 ? "provider_http_5xx" : response.status >= 400 ? "provider_http_4xx" : "provider_http_error";
        console.warn(`[HourlyAll] ${model.name} request failed (${errorCode}).`);
        return { forecast: null, diagnostic: {
          modelName: model.name, modelId: model.modelId, status: "failed", attemptCount,
          hoursReceived: 0, valuesReceived: 0, expectedValueCount, expectedHoursCount, projectionReady: false, errorCode,
        } };
      }

      const data = await response.json();
      const availableAt = Date.now();
      if (!data || typeof data !== "object" || !("hourly" in data)) {
        return { forecast: null, diagnostic: {
          modelName: model.name, modelId: model.modelId, status: "failed", attemptCount,
          hoursReceived: 0, valuesReceived: 0, expectedValueCount, expectedHoursCount, projectionReady: false, errorCode: "invalid_response",
        } };
      }
      const hourly = (data as { hourly?: Record<string, unknown> }).hourly;
      const rawTimes = hourly?.time;
      if (!hourly || !Array.isArray(rawTimes) || rawTimes.length === 0) {
        return { forecast: null, diagnostic: {
          modelName: model.name, modelId: model.modelId, status: "failed", attemptCount,
          hoursReceived: 0, valuesReceived: 0, expectedValueCount, expectedHoursCount, projectionReady: false, errorCode: "no_usable_data",
        } };
      }

      const hourlyUnits = (data as { hourly_units?: unknown }).hourly_units && typeof (data as { hourly_units?: unknown }).hourly_units === "object"
        ? (data as { hourly_units: Record<string, unknown> }).hourly_units
        : {};
      const variableDiagnostics = getHourlyVariableInputDiagnostics(hourly, rawTimes, expectedValidTimes, hourlyUnits);
      const canonicalUnits = Object.fromEntries(HOURLY_FORECAST_VARIABLES.map((definition) => [definition.unitField, definition.defaultUnit || ""])) as NonNullable<HourlyModelForecast["sourceMetadata"]>["units"];
      const hours: HourlyModelForecast["hours"] = [];
      let valuesReceived = 0;
      let diagnosticValuesReceived = 0;
      let diagnosticHoursReceived = 0;

      for (let i = 0; i < rawTimes.length; i++) {
        const unixSeconds = parseHourlyTimestampSeconds(rawTimes[i]);
        if (unixSeconds == null) continue;
        const validAt = unixSeconds * 1000;
        const parisTime = getParisDateAndHour(validAt);
        if (!parisTime || parisTime.date < targetDate || parisTime.date > lastDate) continue;
        const parsedValues = Object.fromEntries(HOURLY_FORECAST_VARIABLES.map((definition) => {
          const series = hourly[definition.apiKey];
          const rawValue = Array.isArray(series) && i < series.length ? series[i] : undefined;
          const normalized = normalizeHourlySourceValue({ variable: definition.key, value: rawValue, unit: hourlyUnits[definition.apiKey] });
          return [definition.valueField, normalized.value];
        }));
        const parsedHour = { validAt, hour: parisTime.hour, ...parsedValues } as HourlyModelForecast["hours"][number];
        const hourValuesReceived = HOURLY_ARCHIVE_VARIABLES.filter((key) => parsedHour[key as keyof typeof parsedHour] != null).length;
        valuesReceived += hourValuesReceived;
        if (expectedValidTimeSet.has(validAt)) {
          diagnosticHoursReceived += 1;
          diagnosticValuesReceived += hourValuesReceived;
        }
        hours.push(parsedHour);
      }

      if (hours.length > 0) {
        const getUnit = (key: string) => typeof hourlyUnits[key] === "string" ? hourlyUnits[key] as string : null;
        const forecast: HourlyModelForecast = {
          modelName: model.name,
          modelId: model.modelId,
          sourceName: "open-meteo",
          captureRunId: randomUUID(),
          requestStartedAt,
          availableAt,
          providerRunAt: null,
          hours,
          sourceMetadata: {
            timezone: typeof (data as { timezone?: unknown }).timezone === "string" ? (data as { timezone: string }).timezone : null,
            utcOffsetSeconds: Number.isFinite(Number((data as { utc_offset_seconds?: unknown }).utc_offset_seconds)) ? Number((data as { utc_offset_seconds?: unknown }).utc_offset_seconds) : null,
            units: canonicalUnits,
          },
        };
        const diagnosticHours = hours.filter((hour) => expectedValidTimeSet.has(hour.validAt));
        const projectionReady = isCompleteHourlyForecastBatch({
          rows: diagnosticHours,
          expectedValidTimes,
          requiredValueFields: HOURLY_PROJECTION_VARIABLES,
        });
        // La complétude du lot exige les créneaux attendus complets et les champs
        // projetés finis. Les champs secondaires (HOURLY_OPTIONAL_ARCHIVE_VARIABLES)
        // restent archivés en l'état (null compris) mais un null physiquement
        // attendu ne déclasse plus le lot en « partial ».
        const archiveBatchComplete = isCompleteHourlyForecastBatch({
          rows: diagnosticHours,
          expectedValidTimes,
          requiredValueFields: HOURLY_PROJECTION_VARIABLES,
        });
        if (valuesReceived === 0) {
          return { forecast, diagnostic: {
            modelName: model.name, modelId: model.modelId, status: "failed", attemptCount,
            hoursReceived: diagnosticHoursReceived, valuesReceived: diagnosticValuesReceived, expectedValueCount, expectedHoursCount, projectionReady: false, errorCode: "no_usable_data", variableDiagnostics,
          } };
        }
        return { forecast, diagnostic: {
          modelName: model.name,
          modelId: model.modelId,
          status: archiveBatchComplete ? "succeeded" : "partial",
          attemptCount,
          hoursReceived: diagnosticHoursReceived,
          valuesReceived: diagnosticValuesReceived,
          expectedValueCount,
          expectedHoursCount,
          projectionReady,
          errorCode: valuesReceived > 0 ? null : "no_usable_data",
          variableDiagnostics,
        } };
      }
      return { forecast: null, diagnostic: {
        modelName: model.name, modelId: model.modelId, status: "failed", attemptCount,
        hoursReceived: 0, valuesReceived: 0, expectedValueCount, expectedHoursCount, projectionReady: false, errorCode: "no_usable_data", variableDiagnostics,
      } };
    } catch (err) {
      const errorCode = classifyHourlyProviderError(err);
      console.warn(`[HourlyAll] ${model.name} request failed (${errorCode}).`);
      return { forecast: null, diagnostic: {
        modelName: model.name, modelId: model.modelId,
        status: errorCode === "invalid_response" ? "failed" : "safe_error",
        attemptCount: attemptCount || attempts,
        hoursReceived: 0, valuesReceived: 0, expectedValueCount, expectedHoursCount, projectionReady: false, errorCode,
      } };
    }
  };

  const firstPass = await Promise.all(modelsToCollect.map((model) => collectModel(model, 2)));
  const retryIndexes = firstPass.map((result, index) => result.diagnostic.projectionReady||['rate_limit_suspended','provider_rate_limited'].includes(result.diagnostic.errorCode??'') ? -1 : index).filter((index) => index >= 0);
  const retryPass = new Map<number, ModelAttempt>();
  const retryBudgetExhausted = Date.now() - collectionStartedAt >= (options.retryBudgetMs ?? Number.POSITIVE_INFINITY);
  if (retryIndexes.length > 0 && retryBudgetExhausted) {
    console.warn(`[HourlyAll] Retry skipped for ${retryIndexes.length} incomplete model source(s): latency budget exhausted.`);
  }
  if (retryIndexes.length > 0 && !retryBudgetExhausted && !options.signal?.aborted) {
    console.warn(`[HourlyAll] Retry targeted for ${retryIndexes.length} incomplete model source(s).`);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const retryResults = await Promise.all(retryIndexes.map((index) => collectModel(modelsToCollect[index], 1)));
    retryIndexes.forEach((index, resultIndex) => retryPass.set(index, retryResults[resultIndex]));
  }

  const outcomes = firstPass.map((first, index) => {
    const retry = retryPass.get(index);
    if (!retry) return first;
    const firstProjectionReady = first.diagnostic.projectionReady;
    const retryProjectionReady = retry.diagnostic.projectionReady;
    const selected = retryProjectionReady !== firstProjectionReady
      ? retryProjectionReady ? retry : first
      : retry.diagnostic.valuesReceived > first.diagnostic.valuesReceived
        || retry.diagnostic.valuesReceived === first.diagnostic.valuesReceived && retry.diagnostic.hoursReceived > first.diagnostic.hoursReceived
        ? retry
        : first;
    const status = selected.diagnostic.status;
    return {
      forecast: selected.forecast,
      diagnostic: {
        ...selected.diagnostic,
        attemptCount: first.diagnostic.attemptCount + retry.diagnostic.attemptCount,
        errorCode: status === "succeeded" ? null : retry.diagnostic.errorCode ?? selected.diagnostic.errorCode,
      },
    };
  });

  return {
    forecasts: outcomes.flatMap((outcome) => outcome.forecast ? [outcome.forecast] : []),
    diagnostics: outcomes.map(({ diagnostic }) => diagnostic),
  };
}

export async function collectHourlyForecastAllModels(
  targetDate: string,
  coords?: { lat: number; lon: number },
  options: { includeBestMatch?: boolean; includeNextDay?: boolean; forecastDays?: number } = {},
): Promise<HourlyModelForecast[]> {
  return (await collectHourlyForecastAllModelsWithDiagnostics(targetDate, coords, options)).forecasts;
}

/** Collect hourly candidate series without affecting active model coverage. */
export async function collectValidationHourlyForecasts(
  targetDate: string,
  coords?: { lat: number; lon: number }
): Promise<Array<{
  modelName: string;
  modelId: string;
  sourceName: string;
  captureRunId: string;
  requestStartedAt: number;
  availableAt: number;
  hours: Array<{
    validAt: number;
    hour: number;
    temperature: number | null;
    apparentTemperature: number | null;
    precipitation: number | null;
    windSpeed: number | null;
    windGusts: number | null;
    windDirection: number | null;
    humidity: number | null;
    cloudCover: number | null;
    weatherCode: number | null;
  }>;
}>> {
  const location = coords ?? HONDEGHEM;
  const results = await Promise.all(VALIDATION_WEATHER_MODELS.map(async (model) => {
    const requestStartedAt = Date.now();
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", location.lat.toString());
      url.searchParams.set("longitude", location.lon.toString());
      url.searchParams.set("hourly", "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,cloud_cover,weather_code");
      url.searchParams.set("timezone", "Europe/Paris");
      url.searchParams.set("timeformat", "unixtime");
      url.searchParams.set("forecast_days", "2");
      url.searchParams.set("models", model.modelId);
      const response = await fetchWeather(url.toString(), {}, { timeoutMs: 12_000, attempts: 2 });
      if (!response.ok) return null;
      const data = await response.json();
      const availableAt = Date.now();
      const hourly = data.hourly;
      if (!hourly?.time) return null;
      const units = data.hourly_units && typeof data.hourly_units === "object" ? data.hourly_units as Record<string, unknown> : {};
      const normalize = (variable: string, apiKey: string, index: number) => normalizeHourlySourceValue({
        variable,
        value: hourly[apiKey]?.[index],
        unit: units[apiKey],
      }).value;
      const hours = hourly.time.flatMap((unixTime: number | string, index: number) => {
        const unixSeconds = parseHourlyTimestampSeconds(unixTime);
        if (unixSeconds == null) return [];
        const validAt = unixSeconds * 1000;
        const parisTime = getParisDateAndHour(validAt);
        if (!parisTime || parisTime.date !== targetDate) return [];
        const values = {
          temperature: normalize("temperature", "temperature_2m", index),
          apparentTemperature: normalize("apparent_temperature", "apparent_temperature", index),
          precipitation: normalize("precipitation", "precipitation", index),
          windSpeed: normalize("wind_speed", "wind_speed_10m", index),
          windGusts: normalize("wind_gust", "wind_gusts_10m", index),
          windDirection: normalize("wind_direction", "wind_direction_10m", index),
          humidity: normalize("humidity", "relative_humidity_2m", index),
          cloudCover: normalize("cloud_cover", "cloud_cover", index),
          weatherCode: normalize("weather_code", "weather_code", index),
        };
        if (!Object.values(values).some((value) => value != null)) return [];
        return [{
          validAt,
          hour: parisTime.hour,
          ...values,
        }];
      });
      return hours.length > 0 ? {
        modelName: model.name,
        modelId: model.modelId,
        sourceName: "open-meteo",
        captureRunId: randomUUID(),
        requestStartedAt,
        availableAt,
        hours,
      } : null;
    } catch (err) {
      console.warn(`[ValidationHourly] Error fetching ${model.name}:`, err);
      return null;
    }
  }));
  return results.filter((forecast): forecast is NonNullable<typeof forecast> => forecast !== null);
}
