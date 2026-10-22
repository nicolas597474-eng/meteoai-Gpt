export type SpatialFusionSource = {
  id: string;
  distanceKm: number;
  reliabilityScore?: number | null;
  updatedAt?: Date | string | null;
  altitude?: number | null;
  temperature?: number | null;
  windSpeed?: number | null;
  precipitation?: number | null;
};

export type SpatialQualityCheckCode = "distance" | "freshness" | "reliability" | "data" | "coherence" | "altitude";
export type SpatialQualityCheck = {
  code: SpatialQualityCheckCode;
  passed: boolean;
  value: string;
  threshold: string;
  reason: string;
};

export type SpatialQcOptions = {
  now?: number;
  maxDistanceKm: number;
  maxFreshnessMin: number;
  minReliabilityScore: number;
  maxTempDeviationC: number;
  refAltitude?: number | null;
  maxAltitudeDifferenceM?: number;
  /** Permit precipitation to satisfy data presence only for its own field QC. */
  dataField?: "precipitation";
};

export type SpatialQcResult<T extends SpatialFusionSource> = {
  source: T;
  passed: boolean;
  checks: SpatialQualityCheck[];
  altitudeAdjustmentC: number;
};

export const SPATIAL_FUSION_COMPONENT_SHARES = {
  distance: 0.5,
  quality: 0.3,
  freshness: 0.2,
} as const;
export const SPATIAL_FUSION_IDW_EXPONENT = 2;
export const SPATIAL_FUSION_DISTANCE_EPSILON_KM = 0.5;
// Gradient standard approximatif, pas une mesure du profil atmosphérique réel.
// T_cible = T_station + 0,0065 × (z_station − z_cible).
// https://www.noaa.gov/jetstream/appendix/weather-glossary-l
export const SPATIAL_FUSION_LAPSE_RATE_C_PER_100M = 0.65;

function sourceTimestamp(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getSpatialFreshnessScore(updatedAt: Date | string | null | undefined, now = Date.now()): number {
  const observedAt = sourceTimestamp(updatedAt);
  // Un relevé daté dans le futur n'est pas une mesure fraîche : il est
  // temporellement indisponible. Ne jamais le ramener artificiellement à 0 min.
  if (observedAt != null && observedAt > now) return 0;
  const ageMin = observedAt == null ? 60 : Math.max(0, (now - observedAt) / 60_000);
  return Math.exp(-ageMin / 60);
}

export type SpatialZeroWeightPolicy = "uniform" | "zero";

/**
 * Normalise des poids positifs. Le repli uniforme conserve le comportement
 * historique pour une liste sans signal intrinsèque. Les appelants qui ont
 * explicitement annulé toutes les sources doivent demander `zero` : rétablir
 * une moyenne égale contournerait alors une pénalité ou un multiplicateur.
 */
export function normalizeSpatialWeights(
  values: readonly number[],
  zeroWeightPolicy: SpatialZeroWeightPolicy = "uniform",
): number[] {
  const safe = values.map((value) => Number.isFinite(value) && value > 0 ? value : 0);
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total > 0) return safe.map((value) => value / total);
  if (zeroWeightPolicy === "zero") return safe.map(() => 0);
  return safe.length === 0 ? [] : safe.map(() => 1 / safe.length);
}

/**
 * Variante interne qui conserve l'égalisation historique d'une composante
 * dépourvue de signal (p. ex. toutes les fiabilités à 0), mais seulement parmi
 * les sources déjà temporellement admissibles. Ainsi, une date future ne peut
 * jamais profiter du repli uniforme, tandis que les parts IDW 50/30/20 des
 * sources valides restent inchangées.
 */
function normalizeTemporalEligibleComponent(
  values: readonly number[],
  temporalEligibility: readonly boolean[],
): number[] {
  const safe = values.map((value, index) => temporalEligibility[index] && Number.isFinite(value) && value > 0 ? value : 0);
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total > 0) return safe.map((value) => value / total);
  const eligibleCount = temporalEligibility.filter(Boolean).length;
  return eligibleCount === 0 ? safe : temporalEligibility.map((eligible) => eligible ? 1 / eligibleCount : 0);
}

/**
 * Contrôle qualité spatial commun : distance, fraîcheur, priorité de source, donnée exploitable,
 * cohérence thermique et correction/limite d’altitude. Les consommateurs peuvent définir
 * leurs contraintes de mode, mais n’implémentent pas une seconde logique de QC.
 */
export function evaluateSpatialQuality<T extends SpatialFusionSource>(
  sources: readonly T[],
  options: SpatialQcOptions,
): SpatialQcResult<T>[] {
  const now = options.now ?? Date.now();
  const prelim = sources.map((source) => {
    const checks: SpatialQualityCheck[] = [];
    const normalizedSource = {
      ...source,
      temperature: source.temperature == null ? source.temperature : Number.isFinite(source.temperature) ? source.temperature : null,
      windSpeed: source.windSpeed == null ? source.windSpeed : Number.isFinite(source.windSpeed) ? source.windSpeed : null,
      precipitation: source.precipitation == null ? source.precipitation : Number.isFinite(source.precipitation) ? source.precipitation : null,
    } as T;
    const distance = Number.isFinite(source.distanceKm) ? Math.max(0, source.distanceKm) : Number.POSITIVE_INFINITY;
    const distanceOk = distance <= options.maxDistanceKm;
    checks.push({ code: "distance", passed: distanceOk, value: Number.isFinite(distance) ? `${distance.toFixed(1)} km` : "inconnue", threshold: `≤ ${options.maxDistanceKm} km`, reason: "Distance hors périmètre" });

    const timestamp = sourceTimestamp(source.updatedAt);
    const futureTimestamp = timestamp != null && timestamp > now;
    const ageMin = timestamp == null || futureTimestamp ? Number.POSITIVE_INFINITY : Math.max(0, (now - timestamp) / 60_000);
    const freshnessOk = ageMin <= options.maxFreshnessMin;
    checks.push({
      code: "freshness",
      passed: freshnessOk,
      value: futureTimestamp ? "horodatage futur" : Number.isFinite(ageMin) ? `${Math.round(ageMin)} min` : "inconnue",
      threshold: `≤ ${options.maxFreshnessMin} min`,
      reason: futureTimestamp ? "Horodatage futur" : "Donnée trop ancienne",
    });

    const reliability = Math.max(0, Math.min(100, source.reliabilityScore ?? 50));
    const reliabilityOk = reliability >= options.minReliabilityScore;
    checks.push({ code: "reliability", passed: reliabilityOk, value: `${Math.round(reliability)}/100`, threshold: `≥ ${options.minReliabilityScore}/100`, reason: "Priorité technique de source insuffisante" });

    const dataOk = Number.isFinite(normalizedSource.temperature)
      || Number.isFinite(normalizedSource.windSpeed)
      || (options.dataField === "precipitation" && Number.isFinite(normalizedSource.precipitation));
    const dataThreshold = options.dataField === "precipitation"
      ? "température, vent ou précipitation"
      : "température ou vent";
    checks.push({ code: "data", passed: dataOk, value: dataOk ? "mesure présente" : "aucune mesure", threshold: dataThreshold, reason: "Aucune mesure exploitable" });

    let altitudeAdjustmentC = 0;
    const hasReferenceAltitude = options.refAltitude != null && source.altitude != null;
    const altitudeDifference = hasReferenceAltitude ? source.altitude! - options.refAltitude! : null;
    const altitudeOk = altitudeDifference == null || Math.abs(altitudeDifference) <= (options.maxAltitudeDifferenceM ?? 200);
    if (altitudeDifference != null) altitudeAdjustmentC = (altitudeDifference / 100) * SPATIAL_FUSION_LAPSE_RATE_C_PER_100M;
    checks.push({
      code: "altitude",
      passed: altitudeOk,
      value: altitudeDifference == null ? "non vérifiable" : `Δ${Math.round(Math.abs(altitudeDifference))} m`,
      threshold: altitudeDifference == null ? "référence indisponible" : altitudeOk ? `correction ${altitudeAdjustmentC >= 0 ? "+" : ""}${altitudeAdjustmentC.toFixed(2)} °C` : `≤ ${options.maxAltitudeDifferenceM ?? 200} m`,
      reason: "Écart d’altitude excessif",
    });
    return { source: normalizedSource, checks, altitudeAdjustmentC };
  });

  const prelimPassed = prelim.filter(({ checks }) => checks.every((check) => check.passed));
  const temperatures = prelimPassed.map(({ source }) => source.temperature).filter((temperature): temperature is number => Number.isFinite(temperature)).sort((a, b) => a - b);
  const median = temperatures.length >= 3 ? temperatures[Math.floor(temperatures.length / 2)] : null;

  return prelim.map((entry) => {
    const temperature = Number.isFinite(entry.source.temperature) ? entry.source.temperature! : null;
    const deviation = median != null && temperature != null ? Math.abs(temperature - median) : null;
    const coherenceOk = deviation == null || deviation <= options.maxTempDeviationC;
    entry.checks.push({
      code: "coherence",
      passed: coherenceOk,
      value: deviation == null ? "non évaluée" : `±${deviation.toFixed(1)} °C`,
      threshold: median == null ? "au moins 3 températures" : `≤ ${options.maxTempDeviationC} °C de la médiane`,
      reason: "Mesure incohérente avec les stations voisines",
    });
    return { ...entry, passed: entry.checks.every((check) => check.passed) };
  });
}

export type SpatialWeightOptions = {
  now?: number;
  refAltitude?: number | null;
  idwExponent?: number;
  distanceEpsilonKm?: number;
  performanceMultiplierById?: ReadonlyMap<string, number>;
  anomalyPenaltyById?: ReadonlyMap<string, number>;
};

export type NormalizedSpatialWeight<T extends SpatialFusionSource> = {
  source: T;
  finalWeight: number;
  distanceWeight: number;
  qualityWeight: number;
  freshnessWeight: number;
  performanceWeight: number;
  anomalyPenalty: number;
  altitudeAdjustmentC: number;
  adjustedTemperature: number | null;
};

/**
 * Pondération spatiale de référence : IDW normalisée par composante, qualité et
 * fraîcheur normalisées, parts 50/30/20 appliquées puis renormalisation finale.
 * Les multiplicateurs de performance et d’anomalie modulent seulement le poids
 * spatial final, avant sa dernière normalisation.
 */
export function buildNormalizedSpatialWeights<T extends SpatialFusionSource>(
  sources: readonly T[],
  options: SpatialWeightOptions = {},
): NormalizedSpatialWeight<T>[] {
  const now = options.now ?? Date.now();
  const idwExponent = options.idwExponent ?? SPATIAL_FUSION_IDW_EXPONENT;
  const distanceEpsilonKm = options.distanceEpsilonKm ?? SPATIAL_FUSION_DISTANCE_EPSILON_KM;
  // Cette API est aussi appelée directement par quelques consommateurs. Une
  // source future doit donc être nulle ici, même si leur QC amont est contourné.
  const temporalEligibility = sources.map((source) => {
    const timestamp = sourceTimestamp(source.updatedAt);
    return timestamp == null || timestamp <= now;
  });
  const distanceRaw = sources.map((source, index) => temporalEligibility[index]
    ? 1 / Math.pow(Math.max(0, source.distanceKm) + distanceEpsilonKm, idwExponent)
    : 0);
  const qualityRaw = sources.map((source, index) => temporalEligibility[index]
    ? Math.max(0, Math.min(100, source.reliabilityScore ?? 50)) / 100
    : 0);
  const freshnessRaw = sources.map((source, index) => temporalEligibility[index]
    ? getSpatialFreshnessScore(source.updatedAt, now)
    : 0);
  const distanceWeights = normalizeTemporalEligibleComponent(distanceRaw, temporalEligibility);
  const qualityWeights = normalizeTemporalEligibleComponent(qualityRaw, temporalEligibility);
  const freshnessWeights = normalizeTemporalEligibleComponent(freshnessRaw, temporalEligibility);
  const preliminary = sources.map((source, index) => {
    const performanceWeight = Math.max(0, options.performanceMultiplierById?.get(source.id) ?? 1);
    const anomalyPenalty = Math.max(0, Math.min(1, options.anomalyPenaltyById?.get(source.id) ?? 1));
    return (distanceWeights[index] * SPATIAL_FUSION_COMPONENT_SHARES.distance
      + qualityWeights[index] * SPATIAL_FUSION_COMPONENT_SHARES.quality
      + freshnessWeights[index] * SPATIAL_FUSION_COMPONENT_SHARES.freshness) * performanceWeight * anomalyPenalty;
  });
  // Les poids nuls ci-dessus proviennent de modulateurs explicites (performance
  // ou anomalie). Une normalisation uniforme les réintroduirait à tort.
  const finalWeights = normalizeSpatialWeights(preliminary, "zero");

  return sources.map((source, index) => {
    const altitudeAdjustmentC = options.refAltitude != null && source.altitude != null
      ? ((source.altitude - options.refAltitude) / 100) * SPATIAL_FUSION_LAPSE_RATE_C_PER_100M
      : 0;
    const temperature = typeof source.temperature === "number" && Number.isFinite(source.temperature)
      ? source.temperature
      : null;
    return {
      source,
      finalWeight: finalWeights[index],
      distanceWeight: distanceWeights[index],
      qualityWeight: qualityWeights[index],
      freshnessWeight: freshnessWeights[index],
      performanceWeight: Math.max(0, options.performanceMultiplierById?.get(source.id) ?? 1),
      anomalyPenalty: Math.max(0, Math.min(1, options.anomalyPenaltyById?.get(source.id) ?? 1)),
      altitudeAdjustmentC,
      adjustedTemperature: temperature == null ? null : temperature + altitudeAdjustmentC,
    };
  });
}
