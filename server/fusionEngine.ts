/**
 * FusionEngine — Moteur de fusion scientifique unifié pour MeteoAI
 *
 * Améliorations par rapport aux algorithmes précédents :
 *
 * 1. IDW adaptatif (p=2) — exposant quadratique pour mieux pondérer les stations proches,
 *    cohérent avec la composante spatiale normalisée de calculateGroundTruth
 *
 * 2. Pondération adaptative par performance historique — les stations/modèles ayant
 *    démontré une meilleure précision (MAE plus faible) reçoivent un poids plus élevé
 *
 * 3. Détection d'anomalies avancée — valeurs figées, sauts brutaux (Δ > 5°C en < 10min),
 *    outliers statistiques (Z-score > 2.5σ)
 *
 * 4. Fusion par paramètre — chaque variable (temp, vent, précip, humidité, pression)
 *    utilise ses propres pondérations basées sur les performances historiques de chaque source
 *
 * 5. Régimes météo étendus (12 régimes vs 5) — scoring contextuel plus précis
 *
 * 6. Scoring par échéance — MAE/RMSE calculés séparément pour 0-6h, 6-24h, 1-3j, 4-7j, 8-15j
 *
 * Règle de validation : une nouvelle méthode ne remplace l'ancienne QUE si elle réduit
 * le MAE de manière statistiquement significative (p < 0.05, n >= 10 observations)
 */

import { buildNormalizedSpatialWeights } from "./spatialFusionCore";
import { evaluateStationFieldQuality, getStationMeasurementAgeState, getValidStationMeasurementTimestamp, hasFreshStationMeasurement, type StationMeasurementField } from "./stationMeasurementFreshness";
import type { StationReadingSnapshot } from "./stationReadingsCache";
import {
  getEvidenceIneligibilityReason,
  regularizeModelPerformance,
  calculateRobustFallbackMultipliers,
  normalizeModelWeightsWithCap,
  MODEL_FUSION_WEIGHT_CAP,
  PERFORMANCE_PRIOR_DAYS,
  type ModelPerformanceContext,
  type ModelPerformanceEvidence,
  type RegularizedPerformance,
} from "./fusionPerformance";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FusionSource = {
  id: string;
  name: string;
  distanceKm: number;
  altitude?: number | null;
  temperature?: number | null;
  apparentTemp?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  windDirection?: number | null;
  precipitation?: number | null;
  cloudCover?: number | null;
  dewPoint?: number | null;
  uvIndex?: number | null;
  visibility?: number | null;
  updatedAt?: Date | string | null;
  /** Provider-reported time per station field; global updatedAt is never a field-time fallback. */
  measurementTimes?: Partial<Record<StationMeasurementField, string | null>>;
  reliabilityScore?: number; // Prior source/réseau 0-100; pas une performance individuelle mesurée
  // Per-parameter historical MAE (lower = better, used for adaptive weighting)
  maeTemp?: number | null;
  maePrecip?: number | null;
  maeWind?: number | null;
  modelId?: string | null;
  performanceEvidence?: ModelPerformanceEvidence | null;
  /** Exact model-specific slice; different models may legitimately have different lead buckets. */
  performanceContext?: ModelPerformanceContext;
  // Source type
  type: "station" | "model" | "service";
};

export type FusionConfig = {
  idwExponent: number;          // IDW exponent p (default 2.0, range 1-3)
  maxDistanceKm: number;        // Maximum search radius
  maxFreshnessMin: number;      // Max age of data in minutes
  maxTempDeviationC: number;    // Max deviation from neighbors (coherence check)
  minReliabilityScore: number;  // Seuil minimum de priorité technique source/réseau
  altitudeCorrectionEnabled: boolean;
  anomalyDetectionEnabled: boolean;
  adaptiveWeightingEnabled: boolean; // Use historical MAE for weighting
  modelWeightFraction: number;  // Fraction of weight given to numerical models (0-1)
  refAltitude?: number | null;
  /** When present, model sources require exact qualified production evidence for this slice. */
  performanceContext?: ModelPerformanceContext;
  /** Keep available model values when history is missing; use a bounded robust fallback. */
  allowRobustUncalibratedModels?: boolean;
  /** Evaluate source freshness at the forecast fusion reference time for reproducible runs. */
  referenceAt?: number;
};

export type FusionResult = {
  temperature: number | null;
  apparentTemp: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  precipitation: number | null;
  cloudCover: number | null;
  dewPoint: number | null;
  uvIndex: number | null;
  visibility: number | null;
  confidenceScore: number;       // 0-100
  stationCount: number;
  modelCount: number;
  usedSources: UsedSource[];
  excludedSources: ExcludedSource[];
  anomaliesDetected: AnomalyReport[];
  altitudeAdjustmentC: number;
  methodUsed: string;
  validationNote: string;
  performanceEvidenceStatus: "not_requested" | "qualified" | "partially_qualified" | "insufficient";
};

export type UsedSource = {
  id: string;
  name: string;
  type: "station" | "model" | "service";
  distanceKm: number;
  finalWeight: number;         // normalized 0-1
  distanceWeight: number;
  qualityWeight: number;
  freshnessWeight: number;
  performanceWeight: number;   // from historical MAE
  rawWeight?: number;
  robustFallbackWeight?: number;
  performanceEvidence?: ModelPerformanceEvidence | null;
  uncertaintyAdjustedMae?: number;
  regularizedMae?: number;
  sampleReliability?: number;
  altitudeAdjustmentC: number;
  temperature: number | null;
  adjustedTemperature: number | null;
  measurementTimes?: Partial<Record<StationMeasurementField, string | null>> | null;
  measurementObservations?: Partial<Record<StationMeasurementField, {
    value: number | null;
    observedAt: string | null;
    ageMinutes: number | null;
    ageStatus: "known" | "unknown";
    contributes: boolean;
  }>>;
  fieldWeights?: Partial<Record<StationMeasurementField, number>>;
  contributedParameters?: StationMeasurementField[];
};

export type ExcludedSource = {
  id: string;
  name: string;
  reason: string;
  temperature: number | null;
};

export type AnomalyReport = {
  sourceId: string;
  sourceName: string;
  type: "frozen_value" | "sudden_jump" | "statistical_outlier" | "coherence_failure";
  description: string;
  severity: "low" | "medium" | "high";
  penaltyApplied: number; // weight reduction factor 0-1
};

// ─── Extended Weather Regimes (12 vs 5) ──────────────────────────────────────

export type ExtendedRegime =
  | "overcast"          // Ciel couvert (nébulosité > 80%)
  | "partly_cloudy"     // Partiellement nuageux (50-80%)
  | "few_clouds"        // Peu nuageux (20-50%)
  | "sunny"             // Ensoleillé (nébulosité < 20%)
  | "fog"               // Brouillard (visibilité < 1km, humidité > 90%)
  | "showers"           // Averses (précip légères intermittentes)
  | "rainy"             // Pluie (précip modérées 2-10mm)
  | "thunderstorm"      // Orages (vent > 35km/h + précip > 5mm)
  | "windy"             // Vent fort (> 40km/h)
  | "snow"              // Neige explicitement typée par une source
  | "winter_precipitation_uncertain" // Précipitations froides sans phase typée
  | "frost"             // Verglas / Gel (T < 0°C sans précip)
  | "freezing_rain"     // Pluie verglaçante explicitement typée par une source
  | "deep_frost"        // Gel intense (T < -5°C)
  | "summer_heat"       // Canicule (> 33°C)
  | "storm"             // Tempête (vent > 60km/h)
  | "variable"          // Temps variable (conditions changeantes)
  | "spring_unstable"   // Printemps instable (alternance soleil/averses)
  | "stable"            // Été stable (chaud, sec, calme)
  | "autumn_disturbed"; // Automne perturbé (pluie + vent + frais)

export type RegimeWeights = {
  temp: number;
  precip: number;
  wind: number;
  condition: number;
  humidity: number;
  pressure: number;
};

const COLD_PRECIPITATION_REGIME_WEIGHTS: RegimeWeights = {
  temp: 0.40,
  precip: 0.30,
  wind: 0.15,
  condition: 0.10,
  humidity: 0.03,
  pressure: 0.02,
};

const EXTENDED_REGIME_WEIGHTS: Record<ExtendedRegime, RegimeWeights> = {
  overcast:        { temp: 0.25, precip: 0.15, wind: 0.10, condition: 0.30, humidity: 0.10, pressure: 0.10 },
  partly_cloudy:   { temp: 0.25, precip: 0.15, wind: 0.10, condition: 0.30, humidity: 0.10, pressure: 0.10 },
  few_clouds:      { temp: 0.30, precip: 0.10, wind: 0.10, condition: 0.30, humidity: 0.10, pressure: 0.10 },
  sunny:           { temp: 0.35, precip: 0.05, wind: 0.10, condition: 0.30, humidity: 0.10, pressure: 0.10 },
  fog:             { temp: 0.20, precip: 0.10, wind: 0.05, condition: 0.20, humidity: 0.35, pressure: 0.10 },
  showers:         { temp: 0.20, precip: 0.35, wind: 0.15, condition: 0.15, humidity: 0.10, pressure: 0.05 },
  rainy:           { temp: 0.20, precip: 0.40, wind: 0.15, condition: 0.15, humidity: 0.05, pressure: 0.05 },
  thunderstorm:    { temp: 0.10, precip: 0.35, wind: 0.35, condition: 0.10, humidity: 0.05, pressure: 0.05 },
  windy:           { temp: 0.15, precip: 0.15, wind: 0.45, condition: 0.15, humidity: 0.05, pressure: 0.05 },
  snow:            COLD_PRECIPITATION_REGIME_WEIGHTS,
  winter_precipitation_uncertain: COLD_PRECIPITATION_REGIME_WEIGHTS,
  frost:           { temp: 0.50, precip: 0.15, wind: 0.15, condition: 0.10, humidity: 0.05, pressure: 0.05 },
  freezing_rain:   { temp: 0.40, precip: 0.30, wind: 0.15, condition: 0.10, humidity: 0.03, pressure: 0.02 },
  deep_frost:      { temp: 0.55, precip: 0.10, wind: 0.15, condition: 0.10, humidity: 0.05, pressure: 0.05 },
  summer_heat:     { temp: 0.45, precip: 0.10, wind: 0.15, condition: 0.15, humidity: 0.10, pressure: 0.05 },
  storm:           { temp: 0.10, precip: 0.25, wind: 0.45, condition: 0.10, humidity: 0.05, pressure: 0.05 },
  variable:        { temp: 0.25, precip: 0.25, wind: 0.20, condition: 0.15, humidity: 0.10, pressure: 0.05 },
  spring_unstable: { temp: 0.25, precip: 0.30, wind: 0.15, condition: 0.15, humidity: 0.10, pressure: 0.05 },
  stable:          { temp: 0.35, precip: 0.10, wind: 0.10, condition: 0.25, humidity: 0.10, pressure: 0.10 },
  autumn_disturbed:{ temp: 0.20, precip: 0.30, wind: 0.25, condition: 0.15, humidity: 0.05, pressure: 0.05 },
};

export function detectExtendedRegime(params: {
  temperature?: number | null;
  precipitation?: number | null;
  precipitationType?: string | null;
  windSpeed?: number | null;
  humidity?: number | null;
  visibility?: number | null;
  cloudCover?: number | null;
}): ExtendedRegime | null {
  const precipitationType = params.precipitationType;
  if (!hasCompleteRegimeInputs(params)) return null;
  const t = params.temperature;
  const p = params.precipitation;
  const w = params.windSpeed;
  const h = params.humidity;
  const v = params.visibility;
  const c = params.cloudCover;

  // Extreme events first
  if (w > 60) return "storm";
  if (w > 35 && p > 5) return "thunderstorm";
  if (w > 40) return "windy";
  // Cold + precipitation
  if (p > 0 && precipitationType === "snow") return "snow";
  if (t <= 0 && p > 0.5 && precipitationType === "freezing_rain") return "freezing_rain";
  if (t >= -5 && t <= 2 && p > 0.5 && precipitationType === "rain") return p > 5 ? "rainy" : "showers";
  if (t <= 2 && p > 0 && precipitationType !== "rain") return "winter_precipitation_uncertain";
  if (t < -5) return "deep_frost";
  if (t < 0) return "frost";
  // Fog
  if (v < 1000 && h > 90) return "fog";
  // Precipitation regimes
  if (p > 5) return "rainy";
  if (p > 0.5 && p <= 5) return "showers";
  // Temperature extremes
  if (t > 33 && p < 0.5) return "summer_heat";
  // Seasonal patterns
  if (t > 20 && p < 0.5 && w < 20 && c < 30) return "stable";
  if (t >= 8 && t <= 18 && p > 0.2 && p <= 3 && c > 40) return "spring_unstable";
  if (t >= 5 && t <= 15 && p > 1 && w > 15) return "autumn_disturbed";
  if (p > 0.1 && c > 50 && w > 10) return "variable";
  // Cloud-based regimes
  if (c > 80) return "overcast";
  if (c > 50) return "partly_cloudy";
  if (c > 20) return "few_clouds";
  return "sunny";
}

export function getRegimeWeights(regime: ExtendedRegime): RegimeWeights {
  return EXTENDED_REGIME_WEIGHTS[regime];
}

// ─── Extended Regime Info (labels, emojis, descriptions) ─────────────────────

export type ExtendedRegimeInfo = {
  id: ExtendedRegime;
  label: string;
  emoji: string;
  description: string;
  weights: RegimeWeights;
};

export const EXTENDED_REGIME_INFO: Record<ExtendedRegime, Omit<ExtendedRegimeInfo, 'id'>> = {
  overcast:        { label: "Ciel couvert",         emoji: "☁️",  description: "Nébulosité > 80%, ciel entièrement couvert.",                              weights: EXTENDED_REGIME_WEIGHTS.overcast },
  partly_cloudy:   { label: "Partiellement nuageux",emoji: "⛅",  description: "Nébulosité 50-80%, alternance de nuages et d'éclaircies.",                  weights: EXTENDED_REGIME_WEIGHTS.partly_cloudy },
  few_clouds:      { label: "Peu nuageux",          emoji: "🌤️", description: "Nébulosité 20-50%, quelques nuages épars.",                                  weights: EXTENDED_REGIME_WEIGHTS.few_clouds },
  sunny:           { label: "Ensoleillé",           emoji: "☀️",  description: "Ciel dégagé, nébulosité < 20%.",                                           weights: EXTENDED_REGIME_WEIGHTS.sunny },
  fog:             { label: "Brouillard",           emoji: "🌫️", description: "Visibilité réduite (< 1 km), humidité > 90%.",                              weights: EXTENDED_REGIME_WEIGHTS.fog },
  showers:         { label: "Averses",              emoji: "🌦️", description: "Précipitations légères intermittentes (0.5-5 mm).",                          weights: EXTENDED_REGIME_WEIGHTS.showers },
  rainy:           { label: "Pluie",                emoji: "🌧️", description: "Précipitations modérées à fortes (> 5 mm).",                                weights: EXTENDED_REGIME_WEIGHTS.rainy },
  thunderstorm:    { label: "Orages",               emoji: "⛈️",  description: "Orages — vent fort et précipitations intenses combinés.",                   weights: EXTENDED_REGIME_WEIGHTS.thunderstorm },
  windy:           { label: "Vent fort",            emoji: "💨",  description: "Vents soutenus > 40 km/h.",                                                weights: EXTENDED_REGIME_WEIGHTS.windy },
  snow:            { label: "Neige",                emoji: "❄️",  description: "Phase neigeuse explicitement fournie par une source météo.",                  weights: EXTENDED_REGIME_WEIGHTS.snow },
  winter_precipitation_uncertain: { label: "Précipitations hivernales — phase incertaine", emoji: "🌧️", description: "Précipitations avec température ≤ 2°C ; la phase n’est pas fournie et reste incertaine.", weights: EXTENDED_REGIME_WEIGHTS.winter_precipitation_uncertain },
  frost:           { label: "Gel",        emoji: "🧊",  description: "Températures négatives sans précipitations — risque de gel.",               weights: EXTENDED_REGIME_WEIGHTS.frost },
  freezing_rain:   { label: "Pluie verglaçante",    emoji: "🌧",  description: "Phase de pluie verglaçante explicitement fournie par une source météo.",       weights: EXTENDED_REGIME_WEIGHTS.freezing_rain },
  deep_frost:      { label: "Gel intense",                  emoji: "❄",   description: "Gel intense (T < -5°C) — froid extrême.",                                   weights: EXTENDED_REGIME_WEIGHTS.deep_frost },
  summer_heat:     { label: "Canicule",             emoji: "🔥",  description: "Températures > 33°C, temps sec et calme.",                                  weights: EXTENDED_REGIME_WEIGHTS.summer_heat },
  storm:           { label: "Tempête",              emoji: "🌀",  description: "Vents violents > 60 km/h — paramètre critique.",                           weights: EXTENDED_REGIME_WEIGHTS.storm },
  variable:        { label: "Temps variable",       emoji: "🌦",  description: "Conditions changeantes, alternance de soleil et nuages.",                  weights: EXTENDED_REGIME_WEIGHTS.variable },
  spring_unstable: { label: "Printemps instable",   emoji: "🌸",  description: "Alternance soleil/averses typique du printemps.",                           weights: EXTENDED_REGIME_WEIGHTS.spring_unstable },
  stable:          { label: "Été stable",           emoji: "☀️",  description: "Temps chaud, sec et calme — conditions estivales.",                        weights: EXTENDED_REGIME_WEIGHTS.stable },
  autumn_disturbed:{ label: "Automne perturbé",     emoji: "🍂",  description: "Pluie + vent modéré + températures fraîches.",                              weights: EXTENDED_REGIME_WEIGHTS.autumn_disturbed },
};

// ─── Multi-Regime Detection ───────────────────────────────────────────────────

export type ActiveRegime = {
  id: ExtendedRegime;
  label: string;
  emoji: string;
  influence: number; // 0-100 percentage
};

export type MultiRegimeResult = {
  primaryRegime: ExtendedRegimeInfo;
  activeRegimes: ActiveRegime[];
  blendedWeights: RegimeWeights;
  confidenceScore: number; // 0-100: how clear-cut the dominant regime is
  description: string;
};

export type CompleteRegimeInputs = {
  temperature: number;
  precipitation: number;
  windSpeed: number;
  humidity: number;
  visibility: number;
  cloudCover: number;
};

export function hasCompleteRegimeInputs(params: {
  temperature?: number | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  humidity?: number | null;
  visibility?: number | null;
  cloudCover?: number | null;
}): params is CompleteRegimeInputs {
  return [params.temperature, params.precipitation, params.windSpeed, params.humidity, params.visibility, params.cloudCover]
    .every((value) => typeof value === "number" && Number.isFinite(value));
}

/**
 * Detect multiple simultaneous weather regimes with influence percentages.
 * Returns the primary regime, all active regimes with their influence,
 * blended weights, and a global confidence score.
 */
export function detectMultiRegime(params: {
  temperature?: number | null;
  precipitation?: number | null;
  precipitationType?: string | null;
  windSpeed?: number | null;
  humidity?: number | null;
  visibility?: number | null;
  cloudCover?: number | null;
}): MultiRegimeResult | null {
  const precipitationType = params.precipitationType;
  if (!hasCompleteRegimeInputs(params)) return null;
  const t = params.temperature;
  const p = params.precipitation;
  const w = params.windSpeed;
  const h = params.humidity;
  const v = params.visibility;
  const c = params.cloudCover;

  const snowScore = Math.max(0, Math.min(100, (p > 0 && precipitationType === "snow" ? 50 + Math.min(50, Math.max(0, (2 - t) * 10) + p * 5) : 0)));
  const freezingRainScore = Math.max(0, Math.min(100, (precipitationType === "freezing_rain" && t <= 0 ? t >= -3 && p > 0.5 ? 60 + Math.min(40, p * 10) : t > -5 && p > 0.3 ? 25 : 0 : 0)));
  const phaseConfirmsSnow = snowScore > 0;
  const phaseConfirmsFreezingRain = freezingRainScore > 0;

  // Compute raw scores for each regime (0-100)
  const scores: Record<ExtendedRegime, number> = {
    // Extreme events
    storm:           Math.max(0, Math.min(100, (w > 60 ? 80 + (w - 60) * 0.5 : w > 50 ? (w - 50) * 8 : 0))),
    thunderstorm:    Math.max(0, Math.min(100, (w > 35 && p > 5 ? 60 + Math.min(40, (w - 35) * 1.5 + (p - 5) * 2) : w > 25 && p > 3 ? 30 : 0))),
    windy:           Math.max(0, Math.min(100, (w > 40 && p < 2 ? 50 + (w - 40) * 2 : w > 25 ? (w - 25) * 3 : 0))),
    // Precipitation
    rainy:           Math.max(0, Math.min(100, (p > 5 ? 50 + Math.min(50, (p - 5) * 5) : p > 3 ? (p - 3) * 25 : 0))),
    showers:         Math.max(0, Math.min(100, (p > 0.5 && p <= 5 ? 40 + Math.min(40, p * 10) : p > 0.2 ? p * 30 : 0))),
    // Cold precipitation stays phase-uncertain unless a source provides an actual type.
    winter_precipitation_uncertain: Math.max(0, Math.min(100, (t <= 2 && p > 0 && precipitationType !== "rain" && !phaseConfirmsSnow && !phaseConfirmsFreezingRain ? 50 + Math.min(50, (2 - t) * 10 + p * 5) : 0))),
    snow:            snowScore,
    frost:           Math.max(0, Math.min(100, (t < 0 && p < 0.5 ? 50 + Math.min(50, (-t) * 10) : t < 2 ? (2 - t) * 20 : 0))),
    freezing_rain:   freezingRainScore,
    deep_frost:      Math.max(0, Math.min(100, (t < -5 ? 60 + Math.min(40, (-t - 5) * 5) : t < -2 ? (Math.abs(t) - 2) * 20 : 0))),
    // Heat
    summer_heat:     Math.max(0, Math.min(100, (t > 33 ? 60 + Math.min(40, (t - 33) * 5) : t > 28 ? (t - 28) * 12 : 0))),
    // Fog
    fog:             Math.max(0, Math.min(100, (v < 1000 && h > 90 ? 60 + Math.min(40, (1000 - v) / 20 + (h - 90) * 2) : v < 3000 && h > 85 ? 30 : 0))),
    // Cloud-based
    overcast:        Math.max(0, Math.min(100, (c > 80 ? 40 + Math.min(40, (c - 80) * 3) : c > 70 ? (c - 70) * 4 : 0))),
    partly_cloudy:   Math.max(0, Math.min(100, (c >= 50 && c <= 80 ? 40 + Math.min(30, (c - 50)) : c > 35 ? (c - 35) * 2.5 : 0))),
    few_clouds:      Math.max(0, Math.min(100, (c >= 20 && c < 50 ? 40 + Math.min(30, (50 - c)) : c < 60 && c > 10 ? 20 : 0))),
    sunny:           Math.max(0, Math.min(100, (c < 20 ? 50 + Math.min(50, (20 - c) * 3) : c < 30 ? (30 - c) * 5 : 0))),
    // Seasonal
    stable:          Math.max(0, Math.min(100, (t > 20 && p < 0.5 && w < 20 && c < 30 ? 50 + Math.min(40, (t - 20) * 3 + (30 - c)) : t > 18 && p < 1 && w < 15 ? 25 : 0))),
    spring_unstable: Math.max(0, Math.min(100, (t >= 8 && t <= 18 && p > 0.2 && p <= 3 && c > 40 ? 40 + Math.min(30, p * 10) : 0))),
    autumn_disturbed:Math.max(0, Math.min(100, (t >= 5 && t <= 15 && p > 1 && w > 15 ? 40 + Math.min(30, p * 5 + (w - 15) * 2) : 0))),
    variable:        Math.max(0, Math.min(100, (p > 0.1 && c > 50 && w > 10 ? 30 + Math.min(30, c * 0.3 + w * 0.5) : 0))),
  };

  // Normalize to sum to 100
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const normalized: Record<ExtendedRegime, number> = {} as any;
  for (const key of Object.keys(scores) as ExtendedRegime[]) {
    normalized[key] = Math.round((scores[key] / total) * 100);
  }

  // Active regimes: those with >= 5% influence
  const active: ActiveRegime[] = (Object.keys(normalized) as ExtendedRegime[])
    .filter(k => normalized[k] >= 5)
    .sort((a, b) => normalized[b] - normalized[a])
    .map(k => ({
      id: k,
      label: EXTENDED_REGIME_INFO[k].label,
      emoji: EXTENDED_REGIME_INFO[k].emoji,
      influence: normalized[k],
    }));

  const primaryKey = active[0]?.id ?? "variable";
  const primaryInfo = EXTENDED_REGIME_INFO[primaryKey];

  // Blend weights proportionally to influence
  const blended: RegimeWeights = { temp: 0, precip: 0, wind: 0, condition: 0, humidity: 0, pressure: 0 };
  for (const ar of active) {
    const w2 = EXTENDED_REGIME_WEIGHTS[ar.id];
    const frac = ar.influence / 100;
    blended.temp      += w2.temp      * frac;
    blended.precip    += w2.precip    * frac;
    blended.wind      += w2.wind      * frac;
    blended.condition += w2.condition * frac;
    blended.humidity  += w2.humidity  * frac;
    blended.pressure  += w2.pressure  * frac;
  }
  // Re-normalize blended weights to sum to 1
  const bSum = blended.temp + blended.precip + blended.wind + blended.condition + blended.humidity + blended.pressure || 1;
  blended.temp      = Math.round(blended.temp / bSum * 100) / 100;
  blended.precip    = Math.round(blended.precip / bSum * 100) / 100;
  blended.wind      = Math.round(blended.wind / bSum * 100) / 100;
  blended.condition = Math.round(blended.condition / bSum * 100) / 100;
  blended.humidity  = Math.round(blended.humidity / bSum * 100) / 100;
  blended.pressure  = Math.round(blended.pressure / bSum * 100) / 100;

  // Confidence: how dominant is the primary regime (0-100)
  const primaryInfluence = active[0]?.influence ?? 0;
  const secondInfluence  = active[1]?.influence ?? 0;
  const confidenceScore  = Math.round(Math.min(100, primaryInfluence + (primaryInfluence - secondInfluence) * 0.5));

  // Build description from active regimes
  const topLabels = active.slice(0, 3).map(r => `${r.emoji} ${r.label} (${r.influence}%)`).join(', ');
  const description = `Régimes actifs : ${topLabels}. ${primaryInfo.description}`;

  return {
    primaryRegime: { id: primaryKey, ...primaryInfo },
    activeRegimes: active,
    blendedWeights: blended,
    confidenceScore,
    description,
  };
}

// ─── Scoring by Lead Time ─────────────────────────────────────────────────────

export type LeadTimeBucket = "0-6h" | "6-24h" | "1-3d" | "4-7d" | "8-15d";

export function classifyLeadTime(forecastDateStr: string, issueDateStr: string): LeadTimeBucket {
  const forecastMs = new Date(forecastDateStr).getTime();
  const issueMs = new Date(issueDateStr).getTime();
  const hoursAhead = (forecastMs - issueMs) / 3600000;
  if (hoursAhead <= 6) return "0-6h";
  if (hoursAhead <= 24) return "6-24h";
  if (hoursAhead <= 72) return "1-3d";
  if (hoursAhead <= 168) return "4-7d";
  return "8-15d";
}

export type LeadTimeScores = Record<LeadTimeBucket, {
  maeTemp: number | null;
  rmseTemp: number | null;
  biasTemp: number | null;
  maePrecip: number | null;
  maeWind: number | null;
  sampleSize: number;
}>;

/**
 * Compute per-lead-time error metrics from paired forecast/observation arrays.
 * Each entry must have forecastDate and issueDate to classify the lead time.
 */
export function computeLeadTimeScores(
  pairs: Array<{
    forecastDate: string;
    issueDate: string;
    forecastTemp: number | null;
    observedTemp: number | null;
    forecastPrecip: number | null;
    observedPrecip: number | null;
    forecastWind: number | null;
    observedWind: number | null;
  }>
): LeadTimeScores {
  const buckets: LeadTimeBucket[] = ["0-6h", "6-24h", "1-3d", "4-7d", "8-15d"];
  const grouped: Record<LeadTimeBucket, typeof pairs> = {
    "0-6h": [], "6-24h": [], "1-3d": [], "4-7d": [], "8-15d": [],
  };
  for (const p of pairs) {
    const bucket = classifyLeadTime(p.forecastDate, p.issueDate);
    grouped[bucket].push(p);
  }

  const result = {} as LeadTimeScores;
  for (const bucket of buckets) {
    const group = grouped[bucket];
    const tempPairs = group.filter(p => p.forecastTemp != null && p.observedTemp != null);
    const precipPairs = group.filter(p => p.forecastPrecip != null && p.observedPrecip != null);
    const windPairs = group.filter(p => p.forecastWind != null && p.observedWind != null);

    const maeTemp = tempPairs.length > 0
      ? tempPairs.reduce((s, p) => s + Math.abs(p.forecastTemp! - p.observedTemp!), 0) / tempPairs.length
      : null;
    const rmseTemp = tempPairs.length > 0
      ? Math.sqrt(tempPairs.reduce((s, p) => s + Math.pow(p.forecastTemp! - p.observedTemp!, 2), 0) / tempPairs.length)
      : null;
    const biasTemp = tempPairs.length > 0
      ? tempPairs.reduce((s, p) => s + (p.forecastTemp! - p.observedTemp!), 0) / tempPairs.length
      : null;
    const maePrecip = precipPairs.length > 0
      ? precipPairs.reduce((s, p) => s + Math.abs(p.forecastPrecip! - p.observedPrecip!), 0) / precipPairs.length
      : null;
    const maeWind = windPairs.length > 0
      ? windPairs.reduce((s, p) => s + Math.abs(p.forecastWind! - p.observedWind!), 0) / windPairs.length
      : null;

    result[bucket] = {
      maeTemp: maeTemp != null ? Math.round(maeTemp * 100) / 100 : null,
      rmseTemp: rmseTemp != null ? Math.round(rmseTemp * 100) / 100 : null,
      biasTemp: biasTemp != null ? Math.round(biasTemp * 100) / 100 : null,
      maePrecip: maePrecip != null ? Math.round(maePrecip * 100) / 100 : null,
      maeWind: maeWind != null ? Math.round(maeWind * 100) / 100 : null,
      sampleSize: group.length,
    };
  }
  return result;
}

// ─── Statistical Validation ───────────────────────────────────────────────────

/**
 * Paired t-test for improvement validation.
 * Returns true if the new method is significantly better (p < 0.05, n >= 10).
 * Uses the Welch t-test approximation.
 */
export function isSignificantImprovement(
  oldErrors: number[],
  newErrors: number[],
  alpha = 0.05
): { significant: boolean; pValue: number; improvement: number; note: string } {
  const n = Math.min(oldErrors.length, newErrors.length);
  if (n < 10) {
    return {
      significant: false,
      pValue: 1,
      improvement: 0,
      note: `Données insuffisantes (n=${n} < 10). Validation reportée.`,
    };
  }

  const oldMean = oldErrors.reduce((s, v) => s + v, 0) / n;
  const newMean = newErrors.reduce((s, v) => s + v, 0) / n;
  const improvement = oldMean - newMean; // positive = new is better

  // Paired differences
  const diffs = oldErrors.slice(0, n).map((v, i) => v - newErrors[i]);
  const diffMean = diffs.reduce((s, v) => s + v, 0) / n;
  const diffVar = diffs.reduce((s, v) => s + Math.pow(v - diffMean, 2), 0) / (n - 1);
  const se = Math.sqrt(diffVar / n);

  if (se === 0) {
    return {
      significant: improvement > 0,
      pValue: improvement > 0 ? 0 : 1,
      improvement: Math.round(improvement * 100) / 100,
      note: "Erreur standard nulle — méthodes identiques.",
    };
  }

  const tStat = diffMean / se;
  // Approximate p-value using normal distribution (valid for n >= 10)
  const pValue = 2 * (1 - normalCDF(Math.abs(tStat)));

  return {
    significant: pValue < alpha && improvement > 0,
    pValue: Math.round(pValue * 1000) / 1000,
    improvement: Math.round(improvement * 100) / 100,
    note: pValue < alpha && improvement > 0
      ? `Amélioration significative: MAE réduit de ${Math.round(improvement * 100) / 100}°C (p=${Math.round(pValue * 1000) / 1000})`
      : `Pas d'amélioration significative (p=${Math.round(pValue * 1000) / 1000}, amélioration=${Math.round(improvement * 100) / 100}°C)`,
  };
}

function normalCDF(x: number): number {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

/**
 * Detect anomalies in a set of station readings.
 * Returns a map of sourceId → penalty factor (0-1, where 1 = no penalty).
 */
export function detectAnomalies(
  sources: FusionSource[],
  previousReadings?: Map<string, StationReadingSnapshot>,
  referenceAt?: number,
): { penalties: Map<string, number>; reports: AnomalyReport[] } {
  const penalties = new Map<string, number>();
  const reports: AnomalyReport[] = [];

  // Initialize all sources with no penalty
  sources.forEach(s => penalties.set(s.id, 1.0));

  const temps = sources
    .filter(s => s.temperature != null)
    .map(s => s.temperature!);

  if (temps.length < 2) return { penalties, reports };

  // Statistical outlier detection (Z-score)
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const std = Math.sqrt(temps.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / temps.length);

  sources.forEach(s => {
    if (s.temperature == null) return;

    // 1. Statistical outlier (Z-score > 2.5σ)
    if (std > 0) {
      const z = Math.abs(s.temperature - mean) / std;
      if (z > 2.5) {
        const penalty = Math.max(0.1, 1 - (z - 2.5) * 0.3);
        penalties.set(s.id, Math.min(penalties.get(s.id)!, penalty));
        reports.push({
          sourceId: s.id,
          sourceName: s.name,
          type: "statistical_outlier",
          description: `Température ${s.temperature.toFixed(1)}°C écart de ${z.toFixed(1)}σ (moy: ${mean.toFixed(1)}°C, σ: ${std.toFixed(1)}°C)`,
          severity: z > 3.5 ? "high" : "medium",
          penaltyApplied: penalty,
        });
      }
    }

    // 2. Sudden jump detection (requires previous readings)
    if (previousReadings && s.type === "station") {
      const prev = previousReadings.get(s.id);
      const observedAt = typeof referenceAt === "number" && Number.isFinite(referenceAt)
        ? getValidStationMeasurementTimestamp(s.measurementTimes, "temperature", referenceAt)
        : null;
      if (prev && observedAt != null) {
        const observationTimestamp = Date.parse(observedAt);
        if (!Number.isFinite(observationTimestamp)
          || !Number.isFinite(prev.timestamp)
          || !Number.isFinite(prev.stableSince)
          || prev.stableSince > prev.timestamp
          || observationTimestamp <= prev.timestamp) return;
        const observationGapMin = (observationTimestamp - prev.timestamp) / 60000;
        const tempDelta = Math.abs(s.temperature - prev.temperature);
        const unchangedValue = s.temperature === prev.temperature;
        const stableAgeMin = unchangedValue
          ? (observationTimestamp - prev.stableSince) / 60000
          : 0;
        // More than 5°C change in less than 10 minutes is suspicious
        if (observationGapMin < 10 && tempDelta > 5) {
          const penalty = Math.max(0.2, 1 - (tempDelta - 5) * 0.1);
          penalties.set(s.id, Math.min(penalties.get(s.id)!, penalty));
          reports.push({
            sourceId: s.id,
            sourceName: s.name,
            type: "sudden_jump",
            description: `Saut de ${tempDelta.toFixed(1)}°C en ${observationGapMin.toFixed(0)} min (${prev.temperature.toFixed(1)}→${s.temperature.toFixed(1)}°C)`,
            severity: tempDelta > 10 ? "high" : "medium",
            penaltyApplied: penalty,
          });
        }
        // Frozen value (no change at all for > 60 min)
        if (stableAgeMin > 60 && tempDelta < 0.01) {
          const penalty = 0.5;
          penalties.set(s.id, Math.min(penalties.get(s.id)!, penalty));
          reports.push({
            sourceId: s.id,
            sourceName: s.name,
            type: "frozen_value",
            description: `Valeur figée à ${s.temperature.toFixed(1)}°C depuis ${stableAgeMin.toFixed(0)} min`,
            severity: "low",
            penaltyApplied: penalty,
          });
        }
      }
    }
  });

  return { penalties, reports };
}

// ─── IDW p=2 Adaptive Fusion ──────────────────────────────────────────────────

const DEFAULT_CONFIG: FusionConfig = {
  idwExponent: 2.0,
  maxDistanceKm: 20,
  maxFreshnessMin: 90,
  maxTempDeviationC: 6,
  minReliabilityScore: 35,
  altitudeCorrectionEnabled: true,
  anomalyDetectionEnabled: true,
  adaptiveWeightingEnabled: true,
  modelWeightFraction: 0.15, // 15% for numerical models, 85% for stations
  refAltitude: null,
};

/**
 * Main fusion function — IDW p=2 with adaptive weighting.
 *
 * Algorithm:
 * 1. Filter sources by freshness, reliability, coherence
 * 2. Detect anomalies and compute penalties
 * 3. Compute IDW weights (p=2) for each source
 * 4. Apply quality multiplier (reliability score)
 * 5. Apply freshness decay (exponential half-life 60 min)
 * 6. Apply performance multiplier (1/MAE if available)
 * 7. Apply anomaly penalty
 * 8. Separate station vs model weights, apply modelWeightFraction
 * 9. Compute weighted average for each parameter
 * 10. Apply altitude correction
 * 11. Compute confidence score
 */
export function computeFusion(
  sources: FusionSource[],
  config: Partial<FusionConfig> = {},
  previousReadings?: Map<string, StationReadingSnapshot>
): FusionResult {
  const cfg: FusionConfig = { ...DEFAULT_CONFIG, ...config };
  const now = Number.isFinite(cfg.referenceAt) ? cfg.referenceAt! : Date.now();

  // ── Step 1: Filter sources ──────────────────────────────────────────────────
  const excluded: ExcludedSource[] = [];
  const candidates: FusionSource[] = [];
  const stationFields = ["temperature", "humidity", "pressure", "windSpeed", "windGust", "windDirection", "precipitation"] as const;
  const originalStationById = new Map(sources.filter((source) => source.type === "station").map((source) => [source.id, source]));

  for (const s of sources) {
    // Distance filter
    if (s.distanceKm > cfg.maxDistanceKm) {
      excluded.push({ id: s.id, name: s.name, reason: `Distance ${s.distanceKm.toFixed(1)}km > ${cfg.maxDistanceKm}km`, temperature: s.temperature ?? null });
      continue;
    }
    let candidateSource = s;
    if (s.type === "station") {
      const observedFields = stationFields.flatMap((field) => {
        const value = s[field];
        const observedAt = getValidStationMeasurementTimestamp(s.measurementTimes, field, now);
        return typeof value === "number" && Number.isFinite(value)
          && observedAt != null && hasFreshStationMeasurement(s.measurementTimes, field, cfg.maxFreshnessMin, now)
          ? [{ field, observedAt }]
          : [];
      });
      if (observedFields.length === 0) {
        excluded.push({ id: s.id, name: s.name, reason: "Aucune mesure station avec horodatage propre valide dans la fenêtre de fraîcheur du mode", temperature: s.temperature ?? null });
        continue;
      }
      const newestFieldTime = observedFields
        .map(({ observedAt }) => observedAt)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
      const temperatureTime = observedFields.find(({ field }) => field === "temperature")?.observedAt;
      const fieldValues = Object.fromEntries(stationFields.map((field) => {
        const value = s[field];
        const isFresh = typeof value === "number" && Number.isFinite(value)
          && hasFreshStationMeasurement(s.measurementTimes, field, cfg.maxFreshnessMin, now);
        return [field, isFresh ? value : null];
      })) as Pick<FusionSource, typeof stationFields[number]>;
      // This representative time is used only for the legacy source-level trace;
      // every field's QC and fusion weight below use its own measurement time.
      candidateSource = { ...s, ...fieldValues, updatedAt: temperatureTime ?? newestFieldTime };
    } else {
      // Existing model/service freshness behavior is deliberately unchanged.
      const ageMin = s.updatedAt
        ? (now - new Date(s.updatedAt).getTime()) / 60000
        : 999;
      if (ageMin > cfg.maxFreshnessMin) {
        excluded.push({ id: s.id, name: s.name, reason: `Données trop anciennes (${Math.round(ageMin)} min > ${cfg.maxFreshnessMin} min)`, temperature: s.temperature ?? null });
        continue;
      }
    }
    // Reliability filter
    const reliability = s.reliabilityScore ?? 50;
    if (reliability < cfg.minReliabilityScore) {
      excluded.push({ id: s.id, name: s.name, reason: `Score fiabilité trop bas (${reliability}/100 < ${cfg.minReliabilityScore})`, temperature: s.temperature ?? null });
      continue;
    }
    const performanceContext = s.performanceContext ?? cfg.performanceContext;
    if ((performanceContext || cfg.allowRobustUncalibratedModels) && s.type !== "station"
      && (s.temperature == null || !Number.isFinite(s.temperature))) {
      excluded.push({ id: s.id, name: s.name, reason: "prévision de cette variable indisponible", temperature: s.temperature ?? null });
      continue;
    }
    if (performanceContext && s.type !== "station") {
      const evidence = s.performanceEvidence;
      let evidenceReason = getEvidenceIneligibilityReason(evidence, performanceContext, new Date(now));
      if (!evidenceReason && evidence && (evidence.serviceName !== s.name || (s.modelId != null && evidence.modelId !== s.modelId))) {
        evidenceReason = "preuve rattachée à un autre modèle";
      }
      if (evidenceReason && !cfg.allowRobustUncalibratedModels) {
        excluded.push({ id: s.id, name: s.name, reason: `Preuve statistique non qualifiée : ${evidenceReason}`, temperature: s.temperature ?? null });
        continue;
      }
    }
    candidates.push(candidateSource);
  }

  // QC spatial indépendamment par variable; une mesure absente, inconnue ou
  // périmée ne retire pas les autres champs datés de la même station.
  const preliminaryStations = candidates.filter(source => source.type === "station");
  const fieldQualityByField = new Map<StationMeasurementField, ReturnType<typeof evaluateStationFieldQuality<FusionSource>>>();
  const qualifiedIdsByField = new Map<StationMeasurementField, Set<string>>();
  for (const field of stationFields) {
    const results = evaluateStationFieldQuality(preliminaryStations, field, {
      now,
      maxDistanceKm: cfg.maxDistanceKm,
      maxFreshnessMin: cfg.maxFreshnessMin,
      minReliabilityScore: cfg.minReliabilityScore,
      maxTempDeviationC: cfg.maxTempDeviationC,
      refAltitude: cfg.altitudeCorrectionEnabled ? cfg.refAltitude : null,
    });
    fieldQualityByField.set(field, results);
    qualifiedIdsByField.set(field, new Set(results.filter((result) => result.passed).map((result) => result.source.id)));
  }
  const anyQualifiedStationIds = new Set(Array.from(qualifiedIdsByField.values()).flatMap((ids) => Array.from(ids)));
  for (const source of preliminaryStations) {
    if (anyQualifiedStationIds.has(source.id)) continue;
    const failedReasons = Array.from(fieldQualityByField.values())
      .flatMap((results) => results.filter((result) => result.source.id === source.id && !result.passed))
      .flatMap((result) => result.checks.filter((check) => !check.passed).map((check) => check.reason));
    excluded.push({
      id: source.id,
      name: source.name,
      reason: failedReasons.join(" ; ") || "Aucune mesure station qualifiée par variable",
      temperature: source.temperature ?? null,
    });
  }
  for (let index = candidates.length - 1; index >= 0; index--) {
    if (candidates[index].type === "station" && !anyQualifiedStationIds.has(candidates[index].id)) candidates.splice(index, 1);
  }

  // Sanitize fields rejected by their own QC without affecting other fields.
  for (let index = 0; index < candidates.length; index++) {
    const source = candidates[index];
    if (source.type !== "station") continue;
    const qualifiedFields = Object.fromEntries(stationFields.map((field) => [
      field,
      qualifiedIdsByField.get(field)?.has(source.id) ? source[field] : null,
    ])) as Pick<FusionSource, typeof stationFields[number]>;
    candidates[index] = { ...source, ...qualifiedFields };
  }

  if (candidates.length === 0) {
    return {
      temperature: null, apparentTemp: null, humidity: null, pressure: null,
      windSpeed: null, windGust: null, windDirection: null, precipitation: null,
      cloudCover: null, dewPoint: null, uvIndex: null, visibility: null,
      confidenceScore: 0, stationCount: 0, modelCount: 0,
      usedSources: [], excludedSources: excluded, anomaliesDetected: [],
      altitudeAdjustmentC: 0, methodUsed: "IDW-p2-adaptive",
      validationNote: "Aucune source disponible après filtrage",
      performanceEvidenceStatus: cfg.performanceContext || cfg.allowRobustUncalibratedModels ? "insufficient" : "not_requested",
    };
  }

  // ── Step 2: Anomaly detection ───────────────────────────────────────────────
  const { penalties, reports: anomalyReports } = cfg.anomalyDetectionEnabled
    ? detectAnomalies(candidates, previousReadings, now)
    : { penalties: new Map<string, number>(), reports: [] };

  // ── Step 3-8: Poids spatiaux communs pour stations + fusion numérique ───────
  const stationsOnly = candidates.filter(s => s.type === "station");
  const modelsOnly = candidates.filter(s => s.type !== "station");
  type StationFieldWeight = ReturnType<typeof buildNormalizedSpatialWeights<FusionSource>>[number];
  const regularizedPerformanceById = new Map<string, RegularizedPerformance>();
  const performanceGroups = new Map<string, { context: ModelPerformanceContext; sources: FusionSource[] }>();
  const performanceContextFor = (source: FusionSource) => source.performanceContext ?? cfg.performanceContext;
  for (const source of modelsOnly) {
    const context = performanceContextFor(source);
    const evidence = source.performanceEvidence;
    if (!context || !evidence || getEvidenceIneligibilityReason(evidence, context, new Date(now)) != null
      || evidence.serviceName !== source.name || (source.modelId != null && evidence.modelId !== source.modelId)) continue;
    const key = [context.locationKey, context.variable, context.horizonBucket].join("\u001f");
    const group = performanceGroups.get(key) ?? { context, sources: [] };
    group.sources.push(source);
    performanceGroups.set(key, group);
  }
  Array.from(performanceGroups.values()).forEach(({ context, sources: groupSources }) => {
    const regularized = regularizeModelPerformance(
      groupSources.map((source) => source.performanceEvidence!).filter((evidence): evidence is ModelPerformanceEvidence => evidence != null),
      context,
      new Date(now),
    );
    for (const source of groupSources) {
      const performance = regularized.get(source.name);
      if (performance) regularizedPerformanceById.set(source.id, performance);
    }
  });
  const robustFallbackById = cfg.allowRobustUncalibratedModels
    ? calculateRobustFallbackMultipliers(modelsOnly.flatMap((source) => source.temperature != null && Number.isFinite(source.temperature)
      ? [{ modelId: source.id, value: source.temperature }]
      : []))
    : new Map<string, number>();
  const isModelPerformanceQualified = (source: FusionSource) => regularizedPerformanceById.has(source.id);

  function performanceMultiplier(source: FusionSource): number {
    if (performanceContextFor(source)) return regularizedPerformanceById.get(source.id)?.performanceMultiplier ?? (cfg.allowRobustUncalibratedModels ? 1 : 0);
    if (cfg.allowRobustUncalibratedModels) return 1;
    // A bare MAE has no sample size, location, variable, or horizon; never use it to alter a weight.
    return 1;
  }

  // Le noyau commun applique IDW p=2, qualité et fraîcheur normalisées (50/30/20),
  // puis les modulations de performance et d’anomalie avant renormalisation.
  const performanceMultiplierById = new Map(stationsOnly.map(source => [source.id, performanceMultiplier(source)]));
  const stationSpatialWeights = buildNormalizedSpatialWeights(stationsOnly, {
    now,
    refAltitude: cfg.altitudeCorrectionEnabled ? cfg.refAltitude : null,
    idwExponent: cfg.idwExponent,
    performanceMultiplierById,
    anomalyPenaltyById: penalties,
  });
  const stationSpatialWeightsByField = new Map<StationMeasurementField, Map<string, StationFieldWeight>>();
  for (const field of stationFields) {
    const qualified = (fieldQualityByField.get(field) ?? []).filter((result) => result.passed);
    const timedSources = qualified.map(({ source }) => ({
      ...source,
      updatedAt: getValidStationMeasurementTimestamp(source.measurementTimes, field, now),
      temperature: field === "temperature" ? source.temperature : null,
    }));
    const weights = buildNormalizedSpatialWeights(timedSources, {
      now,
      refAltitude: cfg.altitudeCorrectionEnabled ? cfg.refAltitude : null,
      idwExponent: cfg.idwExponent,
      performanceMultiplierById,
      anomalyPenaltyById: penalties,
    });
    stationSpatialWeightsByField.set(field, new Map(weights.map((weight) => [weight.source.id, weight])));
  }

  function computeModelRawWeight(source: FusionSource): number {
    const ageMin = source.updatedAt ? Math.max(0, (now - new Date(source.updatedAt).getTime()) / 60000) : 30;
    const distanceWeight = 1 / Math.pow(Math.max(0, source.distanceKm) + 0.1, cfg.idwExponent);
    // Exact production evidence already carries model performance; do not count a second, unrelated score.
    const qualityWeight = cfg.performanceContext || source.performanceContext || cfg.allowRobustUncalibratedModels
      ? 1
      : 0.5 + ((source.reliabilityScore ?? 50) / 100);
    const freshnessWeight = Math.exp(-ageMin / 60);
    const robustnessWeight = cfg.allowRobustUncalibratedModels && !isModelPerformanceQualified(source)
      ? robustFallbackById.get(source.id) ?? 1
      : 1;
    return distanceWeight * qualityWeight * freshnessWeight * performanceMultiplier(source)
      * robustnessWeight * (penalties.get(source.id) ?? 1);
  }

  const hasPerformanceContext = cfg.performanceContext != null || modelsOnly.some((source) => source.performanceContext != null);
  let performanceEvidenceStatus: FusionResult["performanceEvidenceStatus"] = hasPerformanceContext || cfg.allowRobustUncalibratedModels
    ? "insufficient"
    : "not_requested";
  let modelWeights: Array<{ source: FusionSource; raw: number; finalWeight?: number; robustnessWeight: number }> = modelsOnly.map(source => ({
    source,
    raw: computeModelRawWeight(source),
    robustnessWeight: cfg.allowRobustUncalibratedModels && !isModelPerformanceQualified(source)
      ? robustFallbackById.get(source.id) ?? 1
      : 1,
  }));
  if ((hasPerformanceContext || cfg.allowRobustUncalibratedModels) && modelWeights.length > 0) {
    const modelBudget = stationsOnly.length > 0 ? cfg.modelWeightFraction : 1;
    const cappedByModel = normalizeModelWeightsWithCap(modelWeights.map(({ source, raw }) => ({
      modelId: source.modelId ?? source.performanceEvidence?.modelId ?? source.id,
      rawWeight: raw,
    })), modelBudget, MODEL_FUSION_WEIGHT_CAP);
    if (cappedByModel) {
      const rawByModel = new Map<string, number>();
      for (const { source, raw } of modelWeights) {
        const modelId = source.modelId ?? source.performanceEvidence?.modelId ?? source.id;
        rawByModel.set(modelId, (rawByModel.get(modelId) ?? 0) + raw);
      }
      modelWeights = modelWeights.map(({ source, raw }) => {
        const modelId = source.modelId ?? source.performanceEvidence?.modelId ?? source.id;
        const groupRaw = rawByModel.get(modelId) ?? raw;
        const groupWeight = cappedByModel.get(modelId) ?? 0;
        const robustnessWeight = cfg.allowRobustUncalibratedModels && !isModelPerformanceQualified(source)
          ? robustFallbackById.get(source.id) ?? 1
          : 1;
        return { source, raw, robustnessWeight, finalWeight: groupRaw > 0 ? groupWeight * raw / groupRaw : 0 };
      });
      const qualifiedCount = modelWeights.filter(({ source }) => isModelPerformanceQualified(source)).length;
      performanceEvidenceStatus = qualifiedCount === modelWeights.length
        ? "qualified"
        : qualifiedCount > 0 ? "partially_qualified" : "insufficient";
    } else {
      for (const { source } of modelWeights) {
        excluded.push({ id: source.id, name: source.name, reason: `Preuve statistique insuffisante : il faut assez de modèles pour respecter le plafond individuel de ${Math.round(MODEL_FUSION_WEIGHT_CAP * 100)} %`, temperature: source.temperature ?? null });
      }
      modelWeights = [];
    }
  }
  const stationTotalRaw = stationSpatialWeights.reduce((sum, weight) => sum + weight.finalWeight, 0);
  const modelTotalRaw = modelWeights.reduce((sum, weight) => sum + weight.raw, 0);
  const hasStations = stationTotalRaw > 0;
  const hasModels = modelTotalRaw > 0;
  const stationFraction = hasStations ? (hasModels ? 1 - cfg.modelWeightFraction : 1.0) : 0;
  const modelFraction = hasModels ? (hasStations ? cfg.modelWeightFraction : 1.0) : 0;

  const allWeighted: { source: FusionSource; weight: number; rawWeight: number; robustnessWeight: number; distW: number; qualW: number; freshW: number; perfW: number; altAdj: number }[] = [];
  stationSpatialWeights.forEach((spatial) => {
    allWeighted.push({
      source: spatial.source,
      weight: spatial.finalWeight * stationFraction,
      rawWeight: spatial.finalWeight,
      robustnessWeight: 1,
      distW: spatial.distanceWeight,
      qualW: spatial.qualityWeight,
      freshW: spatial.freshnessWeight,
      perfW: spatial.performanceWeight,
      altAdj: spatial.altitudeAdjustmentC,
    });
  });
  modelWeights.forEach(({ source, raw, finalWeight, robustnessWeight }) => {
    const ageMin = source.updatedAt ? Math.max(0, (now - new Date(source.updatedAt).getTime()) / 60000) : 30;
    const qualityWeight = cfg.performanceContext || source.performanceContext || cfg.allowRobustUncalibratedModels
      ? 1
      : 0.5 + ((source.reliabilityScore ?? 50) / 100);
    allWeighted.push({
      source,
      weight: finalWeight ?? (modelTotalRaw > 0 ? (raw / modelTotalRaw) * modelFraction : 0),
      rawWeight: raw,
      robustnessWeight,
      distW: 1 / Math.pow(Math.max(0, source.distanceKm) + 0.1, cfg.idwExponent),
      qualW: qualityWeight,
      freshW: Math.exp(-ageMin / 60),
      perfW: performanceMultiplier(source),
      altAdj: 0,
    });
  });

  // ── Step 9: Weighted average per parameter ──────────────────────────────────
  function weightedAvg(field: keyof Pick<FusionSource,
    "temperature" | "apparentTemp" | "humidity" | "pressure" | "windSpeed" |
    "windGust" | "precipitation" | "cloudCover" | "dewPoint" | "uvIndex" | "visibility">
  ): number | null {
    let sum = 0, wSum = 0;
    for (const { source, weight: sourceWeight, altAdj: sourceAltAdj } of allWeighted) {
      let weight = sourceWeight;
      let altAdj = sourceAltAdj;
      if (source.type === "station") {
        const stationFieldWeight = stationSpatialWeightsByField.get(field as StationMeasurementField)?.get(source.id);
        if (!stationFieldWeight) continue;
        weight = stationFieldWeight.finalWeight * stationFraction;
        altAdj = field === "temperature" ? stationFieldWeight.altitudeAdjustmentC : 0;
      }
      const base = source[field];
      const v = field === "temperature" && source.type === "station" && base != null ? (base as number) + altAdj : base;
      if (typeof v === "number" && Number.isFinite(v) && weight > 0) {
        sum += (v as number) * weight;
        wSum += weight;
      }
    }
    return wSum > 0 ? Math.round((sum / wSum) * 10) / 10 : null;
  }

  // Wind direction: circular mean
  function circularMeanDeg(): number | null {
    let sinSum = 0, cosSum = 0, wSum = 0;
    for (const { source, weight: sourceWeight } of allWeighted) {
      const stationWeight = source.type === "station"
        ? stationSpatialWeightsByField.get("windDirection")?.get(source.id)?.finalWeight
        : undefined;
      const weight = source.type === "station" ? (stationWeight ?? 0) * stationFraction : sourceWeight;
      if (typeof source.windDirection === "number" && Number.isFinite(source.windDirection) && weight > 0) {
        const rad = (source.windDirection * Math.PI) / 180;
        sinSum += Math.sin(rad) * weight;
        cosSum += Math.cos(rad) * weight;
        wSum += weight;
      }
    }
    if (wSum === 0) return null;
    const angle = (Math.atan2(sinSum / wSum, cosSum / wSum) * 180) / Math.PI;
    return Math.round((angle + 360) % 360);
  }

  let temperature = weightedAvg("temperature");
  const humidity = weightedAvg("humidity");
  const pressure = weightedAvg("pressure");
  const windSpeed = weightedAvg("windSpeed");
  const windGust = weightedAvg("windGust");
  const windDirection = circularMeanDeg();
  const precipitation = weightedAvg("precipitation");
  const cloudCover = weightedAvg("cloudCover");
  const dewPoint = weightedAvg("dewPoint");
  const uvIndex = weightedAvg("uvIndex");
  const visibility = weightedAvg("visibility");
  const apparentTemp = weightedAvg("apparentTemp");

  // ── Step 10: Correction d’altitude déjà appliquée dans le noyau spatial ─────
  const temperatureStationWeights = stationSpatialWeightsByField.get("temperature") ?? new Map<string, StationFieldWeight>();
  const altitudeContributors = Array.from(temperatureStationWeights.values());
  const altitudeTotal = altitudeContributors.reduce((sum, spatial) => sum + spatial.finalWeight * stationFraction, 0);
  const altitudeAdjustmentC = altitudeTotal > 0
    ? altitudeContributors.reduce((sum, spatial) => sum + spatial.altitudeAdjustmentC * spatial.finalWeight * stationFraction, 0) / altitudeTotal
    : 0;

  // ── Step 11: Confidence score ────────────────────────────────────────────────
  const stationCount = temperatureStationWeights.size;
  const modelCount = modelWeights.length;
  const temps = [
    ...Array.from(temperatureStationWeights.values()).flatMap((spatial) =>
      spatial.adjustedTemperature == null ? [] : [spatial.adjustedTemperature]),
    ...allWeighted.flatMap((entry) => entry.source.type !== "station" && typeof entry.source.temperature === "number" && Number.isFinite(entry.source.temperature)
      ? [entry.source.temperature]
      : []),
  ];
  const tempMean = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  const tempStd = temps.length > 1
    ? Math.sqrt(temps.reduce((s, v) => s + Math.pow(v - tempMean, 2), 0) / temps.length)
    : 0;
  const avgReliability = candidates.reduce((s, c) => s + (c.reliabilityScore ?? 50), 0) / candidates.length;

  const confidenceScore = Math.max(0, Math.min(100, Math.round(
    // Base: agreement between sources (low std dev → high confidence)
    (Math.max(0, 100 - tempStd * 15)) * 0.4 +
    // Station count bonus
    (Math.min(100, stationCount * 10)) * 0.3 +
    // Average reliability
    avgReliability * 0.3
  )));
  const guardedConfidenceScore = (cfg.performanceContext || cfg.allowRobustUncalibratedModels || modelsOnly.some((source) => source.performanceContext))
    && performanceEvidenceStatus !== "qualified"
    ? 0
    : confidenceScore;

  // ── Build used sources list ──────────────────────────────────────────────────
  const usedSources: UsedSource[] = allWeighted.map(({ source: s, weight, rawWeight, robustnessWeight, distW, qualW, freshW, perfW, altAdj }) => {
    const performance = regularizedPerformanceById.get(s.id);
    const rawStation = s.type === "station" ? originalStationById.get(s.id) : undefined;
    const fieldWeights = s.type === "station"
      ? Object.fromEntries(stationFields.flatMap((field) => {
        const fieldWeight = stationSpatialWeightsByField.get(field)?.get(s.id)?.finalWeight;
        return fieldWeight == null || fieldWeight <= 0 ? [] : [[field, Math.round(fieldWeight * stationFraction * 1_000_000_000) / 1_000_000_000]];
      })) as Partial<Record<StationMeasurementField, number>>
      : undefined;
    const measurementObservations = s.type === "station"
      ? Object.fromEntries(stationFields.map((field) => {
        const age = getStationMeasurementAgeState(rawStation?.measurementTimes, field, now);
        const rawValue = rawStation?.[field];
        return [field, {
          value: typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null,
          observedAt: age.observedAt,
          ageMinutes: age.ageMinutes,
          ageStatus: age.status,
          contributes: stationSpatialWeightsByField.get(field)?.has(s.id) ?? false,
        }];
      })) as UsedSource["measurementObservations"]
      : undefined;
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      distanceKm: s.distanceKm,
      finalWeight: Math.round(weight * 1_000_000_000) / 1_000_000_000,
      rawWeight: Math.round(rawWeight * 1_000_000_000) / 1_000_000_000,
      robustFallbackWeight: Math.round(robustnessWeight * 1_000_000) / 1_000_000,
      distanceWeight: Math.round(distW * 1000) / 1000,
      qualityWeight: Math.round(qualW * 1000) / 1000,
      freshnessWeight: Math.round(freshW * 1000) / 1000,
      performanceWeight: Math.round(perfW * 1000) / 1000,
      performanceEvidence: performance?.evidence ?? null,
      uncertaintyAdjustedMae: performance?.uncertaintyAdjustedMae,
      regularizedMae: performance?.regularizedMae,
      sampleReliability: performance?.sampleReliability,
      altitudeAdjustmentC: Math.round(altAdj * 100) / 100,
      temperature: s.temperature ?? null,
      adjustedTemperature: s.temperature != null
        ? Math.round((s.temperature + altAdj) * 10) / 10
        : null,
      measurementTimes: s.type === "station" ? s.measurementTimes ?? null : undefined,
      measurementObservations,
      fieldWeights,
      contributedParameters: fieldWeights ? Object.keys(fieldWeights) as StationMeasurementField[] : undefined,
    };
  });

  const methodParts = [
    `spatial-core+IDW-p${cfg.idwExponent}`,
    cfg.adaptiveWeightingEnabled ? "adaptive" : "fixed",
    performanceEvidenceStatus === "qualified" ? "statistically-qualified" : performanceEvidenceStatus === "partially_qualified" ? "partially-calibrated" : "",
    cfg.anomalyDetectionEnabled ? "anomaly-checked" : "",
    cfg.altitudeCorrectionEnabled ? "alt-corrected" : "",
  ].filter(Boolean).join("+");

  return {
    temperature,
    apparentTemp,
    humidity,
    pressure,
    windSpeed,
    windGust,
    windDirection,
    precipitation,
    cloudCover,
    dewPoint,
    uvIndex,
    visibility,
    confidenceScore: guardedConfidenceScore,
    stationCount,
    modelCount,
    usedSources,
    excludedSources: excluded,
    anomaliesDetected: anomalyReports,
    altitudeAdjustmentC: Math.round(altitudeAdjustmentC * 100) / 100,
    methodUsed: methodParts,
    validationNote: `${stationCount} station(s) + ${modelCount} modèle(s) utilisés. IDW p=${cfg.idwExponent}.`,
    performanceEvidenceStatus,
  };
}

// ─── Adaptive Model Fusion (per-parameter) ────────────────────────────────────

/**
 * Generate MeteoAI forecast using per-parameter adaptive weighting.
 * Each parameter (tempMax, tempMin, precip, wind) uses its own set of weights
 * based on the qualified historical MAE of each service for that parameter.
 *
 * Qualified evidence only: a service carries a performance weight solely when
 * its MAE comes from a qualified historical proof (calibration exacte avec
 * comparaisons et jours indépendants valides). Une MAE isolée sans masse de
 * preuve ni un score global hors maille exacte ne modifient jamais un poids,
 * comme dans computeFusion ; la MAE de chaque service prouvé est rétractée vers
 * la médiane des MAE prouvées, plus fortement quand sa masse de preuve est
 * mince, et chaque poids respecte le plafond individuel commun.
 *
 * This replaces the single-score weighting in generateMeteoAIForecast.
 */
export function generateAdaptiveForecast(
  forecasts: Array<{
    serviceName: string;
    tempMax: number | null;
    tempMin: number | null;
    precipitation: number | null;
    windSpeed: number | null;
    windGust?: number | null;
    cloudCover?: number | null;
  }>,
  performanceByService: Record<string, {
    maeTemp?: number;
    maePrecip?: number;
    maeWind?: number;
    /** Conservé pour compatibilité d'appel ; jamais utilisé comme poids. */
    weightedScore?: number;
    /** True uniquement quand la MAE provient d'une preuve historique qualifiée. */
    qualified?: boolean;
    comparisonCount?: number;
    evaluatedDays?: number;
  }>
): {
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust: number | null;
  cloudCover: number | null;
  weights: Record<string, { tempWeight: number; precipWeight: number; windWeight: number }>;
  methodNote: string;
} {
  if (forecasts.length === 0) {
    return {
      tempMax: null, tempMin: null, precipitation: null,
      windSpeed: null, windGust: null, cloudCover: null,
      weights: {}, methodNote: "Aucune prévision disponible",
    };
  }

  function qualifiedProof(
    perf: { qualified?: boolean; comparisonCount?: number; evaluatedDays?: number } | undefined
  ): { comparisonCount: number; evaluatedDays: number } | null {
    const comparisonCount = perf?.comparisonCount;
    const evaluatedDays = perf?.evaluatedDays;
    return perf?.qualified === true
      && typeof comparisonCount === "number" && Number.isInteger(comparisonCount) && comparisonCount > 0
      && typeof evaluatedDays === "number" && Number.isInteger(evaluatedDays) && evaluatedDays > 0
      ? { comparisonCount, evaluatedDays }
      : null;
  }

  // Poids par paramètre depuis les seules preuves qualifiées : la MAE de chaque
  // service prouvé est rétractée vers la médiane des MAE prouvées selon sa
  // masse de preuve, bornée comme dans le moteur de fusion officiel.
  function computeParamWeights(
    field: "maeTemp" | "maePrecip" | "maeWind"
  ): Record<string, number> {
    const proven = new Map<string, { mae: number; reliability: number }>();
    for (const f of forecasts) {
      const perf = performanceByService[f.serviceName];
      const proof = qualifiedProof(perf);
      const mae = perf?.[field];
      if (!proof || typeof mae !== "number" || !Number.isFinite(mae) || mae <= 0) continue;
      proven.set(f.serviceName, {
        mae,
        reliability: proof.evaluatedDays / (proof.evaluatedDays + PERFORMANCE_PRIOR_DAYS),
      });
    }
    const sortedProvenMaes = Array.from(proven.values()).map((item) => item.mae).sort((a, b) => a - b);
    const baseline = sortedProvenMaes.length > 0
      ? sortedProvenMaes.length % 2 === 0
        ? (sortedProvenMaes[sortedProvenMaes.length / 2 - 1]! + sortedProvenMaes[sortedProvenMaes.length / 2]!) / 2
        : sortedProvenMaes[Math.floor(sortedProvenMaes.length / 2)]!
      : null;

    const raw: Record<string, number> = {};
    for (const f of forecasts) {
      const item = proven.get(f.serviceName);
      // Sans preuve historique qualifiée, ni une MAE isolée ni un score global
      // hors maille exacte ne modifient le poids : il reste neutre.
      raw[f.serviceName] = item && baseline != null
        ? Math.min(2, Math.max(0.3, 1 / Math.max(baseline + item.reliability * (item.mae - baseline), 0.5)))
        : 1;
    }
    const capped = normalizeModelWeightsWithCap(
      forecasts.map((f) => ({ modelId: f.serviceName, rawWeight: raw[f.serviceName] ?? 1 })),
      1,
      MODEL_FUSION_WEIGHT_CAP,
    );
    const normalized: Record<string, number> = {};
    if (capped) {
      for (const f of forecasts) normalized[f.serviceName] = capped.get(f.serviceName) ?? 0;
      return normalized;
    }
    for (const f of forecasts) normalized[f.serviceName] = 1 / forecasts.length;
    return normalized;
  }

  const tempWeights = computeParamWeights("maeTemp");
  const precipWeights = computeParamWeights("maePrecip");
  const windWeights = computeParamWeights("maeWind");

  function wavg(
    field: "tempMax" | "tempMin" | "precipitation" | "windSpeed" | "windGust" | "cloudCover",
    weights: Record<string, number>
  ): number | null {
    let sum = 0, wSum = 0;
    for (const f of forecasts) {
      const v = f[field];
      const w = weights[f.serviceName] ?? (1 / forecasts.length);
      if (v != null) {
        sum += v * w;
        wSum += w;
      }
    }
    return wSum > 0 ? Math.round((sum / wSum) * 10) / 10 : null;
  }

  const weights: Record<string, { tempWeight: number; precipWeight: number; windWeight: number }> = {};
  for (const f of forecasts) {
    weights[f.serviceName] = {
      tempWeight: Math.round((tempWeights[f.serviceName] ?? 0) * 1000) / 1000,
      precipWeight: Math.round((precipWeights[f.serviceName] ?? 0) * 1000) / 1000,
      windWeight: Math.round((windWeights[f.serviceName] ?? 0) * 1000) / 1000,
    };
  }

  return {
    tempMax: wavg("tempMax", tempWeights),
    tempMin: wavg("tempMin", tempWeights),
    precipitation: wavg("precipitation", precipWeights),
    windSpeed: wavg("windSpeed", windWeights),
    windGust: wavg("windGust", windWeights),
    cloudCover: wavg("cloudCover", tempWeights), // use temp weights for cloud cover
    weights,
    methodNote: `Fusion adaptative par paramètre : ${forecasts.length} services ; seuls les modèles avec preuve historique qualifiée portent un poids de performance régularisé par leur masse de preuve, plafonné à ${Math.round(MODEL_FUSION_WEIGHT_CAP * 100)} %`,
  };
}

// ─── Bias Correction ──────────────────────────────────────────────────────────
/**
 * Historical bias per service per parameter.
 * biasTemp > 0 means the model OVERESTIMATES temperature → subtract bias.
 * biasTemp < 0 means the model UNDERESTIMATES temperature → add |bias|.
 */
export type ServiceBias = {
  serviceName: string;
  biasTemp: number | null;   // °C — average (forecast - observed)
  biasPrecip: number | null; // mm
  biasWind: number | null;   // km/h
};

/**
 * Apply historical bias correction to a set of forecasts before fusion.
 * Each forecast value is shifted by -bias so the corrected value is closer
 * to the expected observation.
 *
 * Example: if AROME has biasTemp = +0.8°C (overestimates by 0.8°C),
 * we subtract 0.8°C from every AROME temperature forecast.
 *
 * A dampening factor (0.7) is applied to avoid over-correction when the
 * bias estimate is based on few samples.
 */
export function applyBiasCorrection<T extends {
  serviceName: string;
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust?: number | null;
}>(
  forecasts: T[],
  biases: ServiceBias[],
  dampening = 0.7
): T[] {
  const biasMap = new Map<string, ServiceBias>();
  for (const b of biases) biasMap.set(b.serviceName, b);

  return forecasts.map(f => {
    const bias = biasMap.get(f.serviceName);
    if (!bias) return f;

    const corrected = { ...f };

    if (bias.biasTemp != null && Math.abs(bias.biasTemp) > 0.1) {
      const correction = bias.biasTemp * dampening;
      if (corrected.tempMax != null) corrected.tempMax = Math.round((corrected.tempMax - correction) * 10) / 10;
      if (corrected.tempMin != null) corrected.tempMin = Math.round((corrected.tempMin - correction) * 10) / 10;
    }

    if (bias.biasPrecip != null && Math.abs(bias.biasPrecip) > 0.2) {
      const correction = bias.biasPrecip * dampening;
      if (corrected.precipitation != null) {
        corrected.precipitation = Math.max(0, Math.round((corrected.precipitation - correction) * 10) / 10);
      }
    }

    if (bias.biasWind != null && Math.abs(bias.biasWind) > 1.0) {
      const correction = bias.biasWind * dampening;
      if (corrected.windSpeed != null) {
        corrected.windSpeed = Math.max(0, Math.round((corrected.windSpeed - correction) * 10) / 10);
      }
      if (corrected.windGust != null) {
        corrected.windGust = Math.max(0, Math.round((corrected.windGust - correction) * 10) / 10);
      }
    }

    return corrected;
  });
}

// ─── Lead-Time Weighted Fusion ────────────────────────────────────────────────
/**
 * Scores per service per lead-time bucket (from DB).
 */
export type LeadTimePerf = {
  serviceName: string;
  bucket: LeadTimeBucket;
  avgMaeTemp: number | null;
  avgMaePrecip: number | null;
  avgMaeWind: number | null;
  sampleSize?: number | null;
  latestScoreDate?: string | null;
};

export const MIN_LEAD_TIME_SAMPLES = 7;
export const MAX_LEAD_TIME_SCORE_AGE_DAYS = 7;
export const MIN_GLOBAL_RELIABILITY_SAMPLES = 7;
export const MAX_GLOBAL_RELIABILITY_SCORE_AGE_DAYS = 7;

function isEligibleLeadTimePerf(perf: LeadTimePerf, now: Date): boolean {
  if ((perf.sampleSize ?? 0) < MIN_LEAD_TIME_SAMPLES) return false;
  if (!perf.latestScoreDate) return false;
  const parsed = new Date(`${perf.latestScoreDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const ageMs = now.getTime() - parsed.getTime();
  return ageMs >= 0 && ageMs <= MAX_LEAD_TIME_SCORE_AGE_DAYS * 24 * 60 * 60 * 1000;
}

export function isEligibleGlobalReliabilityScore(
  sampleSize: number | null | undefined,
  latestScoreDate: string | null | undefined,
  now = new Date(),
): boolean {
  if ((sampleSize ?? 0) < MIN_GLOBAL_RELIABILITY_SAMPLES || !latestScoreDate) return false;
  const parsed = new Date(`${latestScoreDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const ageMs = now.getTime() - parsed.getTime();
  return ageMs >= 0 && ageMs <= MAX_GLOBAL_RELIABILITY_SCORE_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Select the best performance metrics for a given lead-time bucket.
 * Falls back to adjacent buckets if the exact bucket has no data.
 * Returns a map of serviceName → { maeTemp, maePrecip, maeWind }.
 */
export function getLeadTimeWeights(
  leadTimePerfs: LeadTimePerf[],
  targetBucket: LeadTimeBucket,
  now = new Date(),
): Record<string, { maeTemp?: number; maePrecip?: number; maeWind?: number }> {
  const orderedBuckets: LeadTimeBucket[] = ["0-6h", "6-24h", "1-3d", "4-7d", "8-15d"];
  const targetIndex = orderedBuckets.indexOf(targetBucket);
  const bucketPriority = [...orderedBuckets].sort((left, right) => {
    const distanceDifference = Math.abs(orderedBuckets.indexOf(left) - targetIndex) - Math.abs(orderedBuckets.indexOf(right) - targetIndex);
    return distanceDifference || orderedBuckets.indexOf(left) - orderedBuckets.indexOf(right);
  });

  const result: Record<string, { maeTemp?: number; maePrecip?: number; maeWind?: number }> = {};

  const eligiblePerfs = leadTimePerfs.filter((perf) => isEligibleLeadTimePerf(perf, now));
  const uniqueServices = Array.from(new Set(eligiblePerfs.map(p => p.serviceName)));
  for (const svc of uniqueServices) {
    let found: LeadTimePerf | undefined;
    for (const bucket of bucketPriority) {
      found = eligiblePerfs.find(p => p.serviceName === svc && p.bucket === bucket);
      if (found) break;
    }
    if (found) {
      result[svc] = {
        maeTemp: found.avgMaeTemp ?? undefined,
        maePrecip: found.avgMaePrecip ?? undefined,
        maeWind: found.avgMaeWind ?? undefined,
      };
    }
  }

  return result;
}
