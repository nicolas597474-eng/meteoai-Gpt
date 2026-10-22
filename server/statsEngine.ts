/**
 * Statistical Engine for MeteoAI — Multi-Dimension Error Analysis
 *
 * Principle: NEVER compute a single raw score. First measure each error dimension
 * independently with its own specific metrics, then combine with contextual weights.
 *
 * ─── 4 Error Dimensions ──────────────────────────────────────────────────────
 *
 * 🌡️ Temperature
 *   - MAE (Mean Absolute Error)
 *   - Bias (tendency to over/under-estimate)
 *   - Max error (worst forecast spike)
 *
 * 🌧️ Precipitation
 *   - Rain detection: POD (Probability of Detection), FAR (False Alarm Rate), CSI (Critical Success Index)
 *   - Quantity error: MAE on rainy days only
 *   - False positives (predicted rain, no rain) / False negatives (missed rain)
 *
 * 💨 Wind
 *   - MAE mean wind speed
 *   - MAE wind gusts (when available)
 *
 * ☁️ Cloud cover / Conditions
 *   - Categorical concordance score (sunny / cloudy / overcast)
 *
 * ─── Contextual Weighting ────────────────────────────────────────────────────
 * 🌧️ Jour pluvieux   → Précip 50% | Temp 20% | Vent 15% | Cond 15%
 * 🌞 Été stable      → Temp 40%   | Précip 20% | Vent 10% | Cond 30%
 * 🌬️ Tempête         → Vent 40%   | Précip 30% | Temp 15% | Cond 15%
 * ❄️  Hiver froid     → Temp 45%   | Précip 25% | Vent 20% | Cond 10%
 * ⛅ Standard        → Temp 30%   | Précip 30% | Vent 20% | Cond 20%
 */

// ─── Regime definitions ───────────────────────────────────────────────────────

// ─── Unified regime system (20 régimes — aligned with fusionEngine display) ────
// Import the 20-regime system from fusionEngine to unify calculation and display
import {
  detectExtendedRegime,
  getRegimeWeights,
  EXTENDED_REGIME_INFO,
  type ExtendedRegime,
} from "./fusionEngine";
import { LABORATORY_SCORE_WEIGHTS } from "./weatherReliabilityConfig";

// Alias for backward compatibility throughout this file
export type WeatherRegime = ExtendedRegime;
export type RegimeWeights = {
  temp: number;
  precip: number;
  wind: number;
  condition: number;
  humidity?: number;
  pressure?: number;
};

export type RegimeInfo = {
  regime: WeatherRegime;
  label: string;
  emoji: string;
  description: string;
  weights: RegimeWeights;
};

/**
 * Le moteur de fiabilité mesure actuellement quatre dimensions : température,
 * précipitations, vent et conditions. Les poids humidité/pression du moteur de
 * fusion sont donc intégrés au score « conditions » afin de conserver une somme
 * de 100 %, sans perdre l'importance contextuelle de ces deux paramètres.
 */
function toScoredWeights(weights: {
  temp: number;
  precip: number;
  wind: number;
  condition: number;
  humidity?: number;
  pressure?: number;
}): RegimeWeights {
  return {
    temp: weights.temp,
    precip: weights.precip,
    wind: weights.wind,
    condition: weights.condition + (weights.humidity ?? 0) + (weights.pressure ?? 0),
  };
}

// REGIME_DEFINITIONS is now EXTENDED_REGIME_INFO in fusionEngine.ts
// Use EXTENDED_REGIME_INFO[regime] for label/emoji/description
export const REGIME_DEFINITIONS = EXTENDED_REGIME_INFO;

export function detectWeatherRegime(params: {
  precipitation: number | null;
  windSpeed: number | null;
  tempMax: number | null;
  tempMin: number | null;
  humidity?: number | null;
  cloudCover?: number | null;
  visibilityKm?: number | null;
}): RegimeInfo | null {
  // Delegate to the unified 20-regime system in fusionEngine
  const avgTemp = typeof params.tempMax === "number" && Number.isFinite(params.tempMax)
    && typeof params.tempMin === "number" && Number.isFinite(params.tempMin)
    ? (params.tempMax + params.tempMin) / 2
    : null;
  const regime = detectExtendedRegime({
    temperature: avgTemp,
    precipitation: params.precipitation,
    windSpeed: params.windSpeed,
    humidity: params.humidity,
    cloudCover: params.cloudCover,
    visibility: typeof params.visibilityKm === "number" && Number.isFinite(params.visibilityKm)
      ? params.visibilityKm * 1000
      : null,
  });
  if (!regime) return null;
  const info = EXTENDED_REGIME_INFO[regime];
  const weights = toScoredWeights(getRegimeWeights(regime));
  return {
    regime,
    label: info.label,
    emoji: info.emoji,
    description: info.description,
    weights,
  };
}

// ─── Row types ────────────────────────────────────────────────────────────────

export type ForecastRow = {
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  cloudCover?: number | null;
  visibilityKm?: number | null;
  condition?: string | null;
};

export type ObservationRow = {
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  cloudCover?: number | null;
  visibilityKm?: number | null;
  condition?: string | null;
};

// ─── Dimension result types ───────────────────────────────────────────────────

/** 🌡️ Temperature dimension */
export type TempDimension = {
  mae: number;          // Mean Absolute Error (°C)
  bias: number;         // Systematic bias (+ = overestimate, - = underestimate)
  maxError: number;     // Worst single-day error (°C)
  rmse: number;         // Root Mean Square Error
  score: number | null; // 0-100 (higher = better), null sans paire comparable
  sampleSize: number;
};

/** 🌧️ Precipitation dimension */
export type PrecipDimension = {
  // Detection skill (binary: rain vs no-rain, threshold 1mm)
  pod: number;          // Probability of Detection (hits / (hits + misses)) 0-1
  far: number;          // False Alarm Rate (false alarms / (hits + false alarms)) 0-1
  csi: number;          // Critical Success Index (hits / (hits + misses + false alarms)) 0-1
  falsePositives: number;  // Days predicted rain, no rain observed
  falseNegatives: number;  // Days missed rain (rain observed, none predicted)
  // Quantity error (only on days where both forecast and obs have rain)
  maeQuantity: number;  // MAE of precipitation amount (mm)
  biasQuantity: number; // Wet/dry bias on quantity
  score: number | null; // 0-100 composite, null sans paire comparable
  sampleSize: number;
};

/** 💨 Wind dimension */
export type WindDimension = {
  maeMean: number;      // MAE of mean wind speed (km/h)
  maeGusts: number;     // MAE of wind gusts (km/h), NaN if no gust data
  biasMean: number;     // Systematic bias on mean wind
  maxError: number;     // Worst single-day error
  score: number | null; // 0-100, null sans paire comparable
  sampleSize: number;
};

/** A scalar error dimension used by the laboratory's transparent normalized score. */
export type ScalarDimension = {
  mae: number;
  rmse: number;
  bias: number;
  score: number | null;
  sampleSize: number;
};

/** ☁️ Cloud cover / Conditions dimension */
export type ConditionDimension = {
  concordance: number;  // % of days where category matches (0-100)
  maeCloudCover: number; // MAE of cloud cover % (when available)
  score: number | null; // 0-100, null sans paire comparable
  sampleSize: number;
};

/** Full multi-dimension score result */
export type DimensionScores = {
  temperature: TempDimension;
  precipitation: PrecipDimension;
  wind: WindDimension;
  condition: ConditionDimension;
};

/** Final aggregated score result */
export type ScoreResult = {
  serviceName: string;
  // Legacy flat fields (kept for DB compatibility)
  maeTemp: number;
  maePrecip: number;
  maeWind: number;
  rmseTemp: number;
  rmsePrecip: number;
  rmseWind: number;
  biasTemp: number;
  biasPrecip: number;
  biasWind: number;
  conditionAccuracy: number;
  weightedScore: number | null;
  /** Null until all six laboratory dimensions have real aligned values. */
  normalizedScore: number | null;
  // New dimension-level detail
  dimensions: DimensionScores;
  regimeStatus: "available" | "unknown";
  regime: WeatherRegime | null;
  regimeLabel: string | null;
  regimeEmoji: string | null;
  weights: RegimeWeights | null;
  laboratory: {
    wind: ScalarDimension;
    gusts: ScalarDimension;
    humidity: ScalarDimension;
    pressure: ScalarDimension;
  };
};

// ─── Math primitives ──────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function mae(predicted: number[], actual: number[]): number {
  if (predicted.length === 0) return 0;
  return mean(predicted.map((v, i) => Math.abs(v - actual[i])));
}

function rmse(predicted: number[], actual: number[]): number {
  if (predicted.length === 0) return 0;
  return Math.sqrt(mean(predicted.map((v, i) => Math.pow(v - actual[i], 2))));
}

function bias(predicted: number[], actual: number[]): number {
  if (predicted.length === 0) return 0;
  return mean(predicted.map((v, i) => v - actual[i]));
}

function maxAbsError(predicted: number[], actual: number[]): number {
  if (predicted.length === 0) return 0;
  return Math.max(...predicted.map((v, i) => Math.abs(v - actual[i])));
}

/** Convert MAE to 0-100 score using exponential decay */
function maeToScore(maeValue: number, maxExpectedError: number): number {
  const k = 3 / maxExpectedError;
  return Math.max(0, Math.min(100, 100 * Math.exp(-k * maeValue)));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ─── Dimension calculators ────────────────────────────────────────────────────

/**
 * 🌡️ Temperature dimension
 * Uses both tempMax and tempMin for all metrics.
 */
function calcTempDimension(forecasts: ForecastRow[], observations: ObservationRow[]): TempDimension {
  const pred: number[] = [];
  const actual: number[] = [];

  for (let i = 0; i < forecasts.length; i++) {
    const f = forecasts[i], o = observations[i];
    if (!f || !o) continue;
    if (f.tempMax != null && o.tempMax != null) { pred.push(f.tempMax); actual.push(o.tempMax); }
    if (f.tempMin != null && o.tempMin != null) { pred.push(f.tempMin); actual.push(o.tempMin); }
  }

  if (pred.length === 0) {
    return { mae: 0, bias: 0, maxError: 0, rmse: 0, score: null, sampleSize: 0 };
  }
  const maeVal = mae(pred, actual);
  return {
    mae: round2(maeVal),
    bias: round2(bias(pred, actual)),
    maxError: round2(maxAbsError(pred, actual)),
    rmse: round2(rmse(pred, actual)),
    score: round2(maeToScore(maeVal, 10)),
    sampleSize: pred.length,
  };
}

/**
 * 🌧️ Precipitation dimension
 * Threshold for rain/no-rain detection: 1 mm/day
 */
const RAIN_THRESHOLD = 1.0; // mm

function calcPrecipDimension(forecasts: ForecastRow[], observations: ObservationRow[]): PrecipDimension {
  let hits = 0;        // Both predicted and observed rain
  let misses = 0;      // Observed rain, not predicted
  let falseAlarms = 0; // Predicted rain, not observed
  let correctNeg = 0;  // Both correctly predicted no rain

  const quantityPred: number[] = [];
  const quantityActual: number[] = [];

  for (let i = 0; i < forecasts.length; i++) {
    const f = forecasts[i], o = observations[i];
    if (!f || !o || f.precipitation == null || o.precipitation == null) continue;

    const fRain = f.precipitation >= RAIN_THRESHOLD;
    const oRain = o.precipitation >= RAIN_THRESHOLD;

    if (fRain && oRain) {
      hits++;
      quantityPred.push(f.precipitation);
      quantityActual.push(o.precipitation);
    } else if (!fRain && oRain) {
      misses++;
    } else if (fRain && !oRain) {
      falseAlarms++;
    } else {
      correctNeg++;
    }
  }

  const sampleSize = hits + misses + falseAlarms + correctNeg;
  if (sampleSize === 0) {
    return { pod: 0, far: 0, csi: 0, falsePositives: 0, falseNegatives: 0, maeQuantity: 0, biasQuantity: 0, score: null, sampleSize: 0 };
  }
  const pod = (hits + misses) > 0 ? hits / (hits + misses) : 0;
  const far = (hits + falseAlarms) > 0 ? falseAlarms / (hits + falseAlarms) : 0;
  const csi = (hits + misses + falseAlarms) > 0 ? hits / (hits + misses + falseAlarms) : 0;

  const maeQ = mae(quantityPred, quantityActual);
  const biasQ = bias(quantityPred, quantityActual);

  // Composite score: 50% detection skill (CSI) + 50% quantity accuracy
  const detectionScore = csi * 100;
  const compositeScore = quantityPred.length > 0
    ? (detectionScore * 0.5) + (maeToScore(maeQ, 15) * 0.5)
    : detectionScore;

  return {
    pod: round2(pod),
    far: round2(far),
    csi: round2(csi),
    falsePositives: falseAlarms,
    falseNegatives: misses,
    maeQuantity: round2(maeQ),
    biasQuantity: round2(biasQ),
    score: round2(compositeScore),
    sampleSize,
  };
}

/**
 * 💨 Wind dimension
 * Separate MAE for mean wind and gusts.
 */
function calcWindDimension(forecasts: ForecastRow[], observations: ObservationRow[]): WindDimension {
  const meanPred: number[] = [];
  const meanActual: number[] = [];
  const gustPred: number[] = [];
  const gustActual: number[] = [];

  for (let i = 0; i < forecasts.length; i++) {
    const f = forecasts[i], o = observations[i];
    if (!f || !o) continue;
    if (f.windSpeed != null && o.windSpeed != null) { meanPred.push(f.windSpeed); meanActual.push(o.windSpeed); }
    if (f.windGust != null && o.windGust != null) { gustPred.push(f.windGust); gustActual.push(o.windGust); }
  }

  if (meanPred.length === 0) {
    return { maeMean: 0, maeGusts: 0, biasMean: 0, maxError: 0, score: null, sampleSize: 0 };
  }
  const maeMean = mae(meanPred, meanActual);
  const maeGusts = gustPred.length > 0 ? mae(gustPred, gustActual) : 0;

  // Score: 70% mean wind accuracy + 30% gust accuracy (if available)
  const meanScore = maeToScore(maeMean, 25);
  const gustScore = gustPred.length > 0 ? maeToScore(maeGusts, 35) : meanScore;
  const score = gustPred.length > 0 ? (meanScore * 0.7 + gustScore * 0.3) : meanScore;

  return {
    maeMean: round2(maeMean),
    maeGusts: gustPred.length > 0 ? round2(maeGusts) : 0,
    biasMean: round2(bias(meanPred, meanActual)),
    maxError: round2(maxAbsError(meanPred, meanActual)),
    score: round2(score),
    sampleSize: meanPred.length,
  };
}

/**
 * Measure one directly comparable scalar variable. Missing archived values stay
 * unavailable instead of being converted into a neutral or favourable score.
 */
function calcScalarDimension(
  forecasts: ForecastRow[],
  observations: ObservationRow[],
  forecastValue: (row: ForecastRow) => number | null | undefined,
  observationValue: (row: ObservationRow) => number | null | undefined,
  expectedError: number,
): ScalarDimension {
  const predicted: number[] = [];
  const actual: number[] = [];
  for (let index = 0; index < forecasts.length; index++) {
    const forecast = forecasts[index];
    const observation = observations[index];
    if (!forecast || !observation) continue;
    const predictedValue = forecastValue(forecast);
    const actualValue = observationValue(observation);
    if (predictedValue == null || actualValue == null) continue;
    predicted.push(predictedValue);
    actual.push(actualValue);
  }

  if (predicted.length === 0) {
    return { mae: 0, rmse: 0, bias: 0, score: null, sampleSize: 0 };
  }

  const maeValue = mae(predicted, actual);
  return {
    mae: round2(maeValue),
    rmse: round2(rmse(predicted, actual)),
    bias: round2(bias(predicted, actual)),
    score: round2(maeToScore(maeValue, expectedError)),
    sampleSize: predicted.length,
  };
}

/**
 * ☁️ Cloud cover / Conditions dimension
 * Categorical concordance: maps conditions to 3 categories (clear/partly/overcast).
 */
type ConditionCategory = 0 | 1 | 2;
function conditionCategory(condition: string | null | undefined, cloudCover: number | null | undefined): ConditionCategory | null {
  // 0 = clear, 1 = partly cloudy, 2 = overcast/rain
  if (condition) {
    const c = condition.trim().toLowerCase();
    // The canonical condition sources emit French labels, not slug identifiers.
    // Do not infer a category from partial words inside unknown IDs such as
    // "freezing_rain" or "pluie_verglacante".
    if (!c.includes("_") && !c.includes("-")) {
      if (c.includes("pluie") || c.includes("orage") || c.includes("couvert")
        || c.includes("brouillard") || c.includes("bruine") || c.includes("neige")) return 2;
      if (c.includes("nuageux") || c.includes("averses") || c.includes("partiellement")) return 1;
      if (c.includes("ensoleillé") || c.includes("clair") || c.includes("dégagé")) return 0;
    }
  }
  if (cloudCover != null) {
    if (cloudCover > 75) return 2;
    if (cloudCover > 35) return 1;
    return 0;
  }
  return null;
}

function calcConditionDimension(forecasts: ForecastRow[], observations: ObservationRow[]): ConditionDimension {
  let matches = 0;
  let total = 0;
  const cloudPred: number[] = [];
  const cloudActual: number[] = [];

  for (let i = 0; i < forecasts.length; i++) {
    const f = forecasts[i], o = observations[i];
    if (!f || !o) continue;

    const forecastHasCondition = f.condition != null || f.cloudCover != null;
    const observationHasCondition = o.condition != null || o.cloudCover != null;
    if (!forecastHasCondition || !observationHasCondition) continue;
    if (f.cloudCover != null && o.cloudCover != null) {
      cloudPred.push(f.cloudCover);
      cloudActual.push(o.cloudCover);
    }
    const fCat = conditionCategory(f.condition, f.cloudCover);
    const oCat = conditionCategory(o.condition, o.cloudCover);
    if (fCat === null || oCat === null) continue;
    total++;
    if (fCat === oCat) matches++;
  }

  if (total === 0) {
    return { concordance: 0, maeCloudCover: 0, score: null, sampleSize: 0 };
  }
  const concordance = (matches / total) * 100;
  const maeCloud = cloudPred.length > 0 ? mae(cloudPred, cloudActual) : 0;

  // Score: concordance is primary, cloud MAE is secondary
  const score = cloudPred.length > 0
    ? (concordance * 0.6 + maeToScore(maeCloud, 40) * 0.4)
    : concordance;

  return {
    concordance: round2(concordance),
    maeCloudCover: round2(maeCloud),
    score: round2(score),
    sampleSize: total,
  };
}

// ─── RMSE helpers for legacy flat fields ─────────────────────────────────────

function rmsePrecipValue(forecasts: ForecastRow[], observations: ObservationRow[]): number {
  const pred: number[] = [];
  const actual: number[] = [];
  for (let i = 0; i < forecasts.length; i++) {
    const f = forecasts[i], o = observations[i];
    if (!f || !o || f.precipitation == null || o.precipitation == null) continue;
    pred.push(f.precipitation);
    actual.push(o.precipitation);
  }
  return rmse(pred, actual);
}

function rmseWindValue(forecasts: ForecastRow[], observations: ObservationRow[]): number {
  const pred: number[] = [];
  const actual: number[] = [];
  for (let i = 0; i < forecasts.length; i++) {
    const f = forecasts[i], o = observations[i];
    if (!f || !o || f.windSpeed == null || o.windSpeed == null) continue;
    pred.push(f.windSpeed);
    actual.push(o.windSpeed);
  }
  return rmse(pred, actual);
}

// ─── Main scoring function ────────────────────────────────────────────────────

/**
 * Calculate full multi-dimension reliability score.
 * Each dimension is measured independently before contextual combination.
 */
export function calculateReliabilityScore(
  forecasts: ForecastRow[],
  observations: ObservationRow[],
  forcedRegime?: WeatherRegime
): ScoreResult {
  // Calculate each dimension independently
  const tempDim = calcTempDimension(forecasts, observations);
  const precipDim = calcPrecipDimension(forecasts, observations);
  const windDim = calcWindDimension(forecasts, observations);
  const condDim = calcConditionDimension(forecasts, observations);
  const laboratoryWind = calcScalarDimension(forecasts, observations, row => row.windSpeed, row => row.windSpeed, 25);
  const laboratoryGusts = calcScalarDimension(forecasts, observations, row => row.windGust, row => row.windGust, 35);
  const laboratoryHumidity = calcScalarDimension(forecasts, observations, row => row.humidity, row => row.humidity, 30);
  const laboratoryPressure = calcScalarDimension(forecasts, observations, row => row.pressure, row => row.pressure, 20);

  const laboratoryComponents = {
    temperature: tempDim.score,
    precipitation: precipDim.score,
    wind: laboratoryWind.score,
    gusts: laboratoryGusts.score,
    humidity: laboratoryHumidity.score,
    pressure: laboratoryPressure.score,
  };
  const normalizedScore = laboratoryComponents.temperature !== null
    && laboratoryComponents.precipitation !== null
    && laboratoryComponents.wind !== null
    && laboratoryComponents.gusts !== null
    && laboratoryComponents.humidity !== null
    && laboratoryComponents.pressure !== null
    ? round2(
      laboratoryComponents.temperature * LABORATORY_SCORE_WEIGHTS.temperature
      + laboratoryComponents.precipitation * LABORATORY_SCORE_WEIGHTS.precipitation
      + laboratoryComponents.wind * LABORATORY_SCORE_WEIGHTS.wind
      + laboratoryComponents.gusts * LABORATORY_SCORE_WEIGHTS.gusts
      + laboratoryComponents.humidity * LABORATORY_SCORE_WEIGHTS.humidity
      + laboratoryComponents.pressure * LABORATORY_SCORE_WEIGHTS.pressure
    )
    : null;

  // Detect regime only from observed, complete and finite inputs.
  let regimeInfo: RegimeInfo | null;
  if (forcedRegime) {
    const definition = REGIME_DEFINITIONS[forcedRegime];
    regimeInfo = {
      regime: forcedRegime,
      label: definition.label,
      emoji: definition.emoji,
      description: definition.description,
      weights: toScoredWeights(definition.weights),
    };
  } else {
    // Average precipitation and wind across observations for regime detection
    const obsPrecips = observations.filter(o => o.precipitation != null).map(o => o.precipitation!);
    const obsWinds = observations.filter(o => o.windSpeed != null).map(o => o.windSpeed!);
    const obsTempMax = observations.filter(o => o.tempMax != null).map(o => o.tempMax!);
    const obsTempMin = observations.filter(o => o.tempMin != null).map(o => o.tempMin!);
    const obsHumidity = observations.filter(o => o.humidity != null).map(o => o.humidity!);
    const obsCloudCover = observations.filter(o => o.cloudCover != null).map(o => o.cloudCover!);
    const obsVisibility = observations.filter(o => o.visibilityKm != null).map(o => o.visibilityKm!);
    regimeInfo = detectWeatherRegime({
      precipitation: obsPrecips.length > 0 ? mean(obsPrecips) : null,
      windSpeed: obsWinds.length > 0 ? mean(obsWinds) : null,
      tempMax: obsTempMax.length > 0 ? mean(obsTempMax) : null,
      tempMin: obsTempMin.length > 0 ? mean(obsTempMin) : null,
      humidity: obsHumidity.length > 0 ? mean(obsHumidity) : null,
      cloudCover: obsCloudCover.length > 0 ? mean(obsCloudCover) : null,
      visibilityKm: obsVisibility.length > 0 ? mean(obsVisibility) : null,
    });
  }

  const weights = regimeInfo?.weights ?? null;

  // Contextually-weighted final score
  const measuredDimensions = weights ? [
    { score: tempDim.score, weight: weights.temp },
    { score: precipDim.score, weight: weights.precip },
    { score: windDim.score, weight: weights.wind },
    { score: condDim.score, weight: weights.condition },
  ].filter((dimension): dimension is { score: number; weight: number } => dimension.score !== null) : [];
  const measuredWeight = measuredDimensions.reduce((total, dimension) => total + dimension.weight, 0);
  const weightedScore = weights && measuredWeight > 0
    ? measuredDimensions.reduce((total, dimension) => total + dimension.score * (dimension.weight / measuredWeight), 0)
    : null;

  return {
    serviceName: "",
    // Legacy flat fields
    maeTemp: tempDim.mae,
    maePrecip: precipDim.maeQuantity,
    maeWind: windDim.maeMean,
    rmseTemp: tempDim.rmse,
    rmsePrecip: round2(rmsePrecipValue(forecasts, observations)),
    rmseWind: round2(rmseWindValue(forecasts, observations)),
    biasTemp: tempDim.bias,
    biasPrecip: precipDim.biasQuantity,
    biasWind: windDim.biasMean,
    conditionAccuracy: condDim.concordance / 100,
    weightedScore: weightedScore == null ? null : round2(weightedScore),
    normalizedScore,
    // Dimension detail
    dimensions: {
      temperature: tempDim,
      precipitation: precipDim,
      wind: windDim,
      condition: condDim,
    },
    regimeStatus: regimeInfo ? "available" : "unknown",
    regime: regimeInfo?.regime ?? null,
    regimeLabel: regimeInfo?.label ?? null,
    regimeEmoji: regimeInfo?.emoji ?? null,
    weights,
    laboratory: {
      wind: laboratoryWind,
      gusts: laboratoryGusts,
      humidity: laboratoryHumidity,
      pressure: laboratoryPressure,
    },
  };
}

// ─── MeteoAI Forecast Generator ──────────────────────────────────────────────

export function generateMeteoAIForecast(
  forecasts: ForecastRow[],
  serviceNames: string[],
  reliabilityScores: Record<string, number>
): {
  tempMax: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  weights: Record<string, number>;
} {
  const reliabilityByModel = serviceNames.map((name) => {
    const score = reliabilityScores[name];
    return typeof score === "number" && Number.isFinite(score) && score >= 0 ? score : 50;
  });
  const totalScore = reliabilityByModel.reduce((acc, score) => acc + score, 0);
  const weights: Record<string, number> = {};
  serviceNames.forEach((name, index) => {
    weights[name] = totalScore > 0 ? Math.round((reliabilityByModel[index] / totalScore) * 100) : 0;
  });

  let tempMaxSum = 0, tempMinSum = 0, precipSum = 0, windSum = 0;
  let tempMaxW = 0, tempMinW = 0, precipW = 0, windW = 0;

  forecasts.forEach((f, i) => {
    const w = totalScore > 0 && reliabilityByModel[i] != null ? reliabilityByModel[i] / totalScore : 0;
    if (w <= 0) return;
    if (typeof f.tempMax === "number" && Number.isFinite(f.tempMax)) { tempMaxSum += f.tempMax * w; tempMaxW += w; }
    if (typeof f.tempMin === "number" && Number.isFinite(f.tempMin)) { tempMinSum += f.tempMin * w; tempMinW += w; }
    if (typeof f.precipitation === "number" && Number.isFinite(f.precipitation)) { precipSum += f.precipitation * w; precipW += w; }
    if (typeof f.windSpeed === "number" && Number.isFinite(f.windSpeed)) { windSum += f.windSpeed * w; windW += w; }
  });

  return {
    tempMax: tempMaxW > 0 ? Math.round((tempMaxSum / tempMaxW) * 10) / 10 : null,
    tempMin: tempMinW > 0 ? Math.round((tempMinSum / tempMinW) * 10) / 10 : null,
    precipitation: precipW > 0 ? Math.round((precipSum / precipW) * 10) / 10 : null,
    windSpeed: windW > 0 ? Math.round((windSum / windW) * 10) / 10 : null,
    weights,
  };
}
