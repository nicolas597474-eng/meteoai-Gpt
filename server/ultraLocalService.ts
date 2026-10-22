import { getPreviousReadings, recordStationReadings } from "./stationReadingsCache";

/**
 * Ultra-Local Service — Advanced temperature calculation using concentric radius bands
 *
 * Three modes:
 *   - Standard: default weighting (50% distance, 30% quality, 20% freshness)
 *   - Local: enhanced proximity weighting with tighter freshness requirements
 *   - Ultra-local: extreme proximity bias with concentric radius bands
 *
 * Ultra-local radius bands:
 *   < 2 km  → 60% weight
 *   2-5 km  → 28% weight
 *   5-10 km → 10% weight
 *   Models (numerical) → 2% weight
 *
 * Quality verification before using a station:
 *   1. Freshness: last measurement must be recent (< 30 min for ultra-local)
 *   2. Coherence: temperature must not deviate > 5°C from neighbors
 *   3. Altitude: adjust for elevation differences only with an explicit target altitude
 *   4. Priorité technique source : le score fixe du réseau doit atteindre le seuil
 *   5. Stability: no erratic jumps in recent readings
 *
 * Microclimate detection:
 *   - Urban heat island (city centers)
 *   - Valley cold pools
 *   - Forest cooling
 *   - Water body effects (sea, rivers)
 *   - Altitude corrections (-0.65°C per 100m) only when the caller supplies a target altitude
 */

import { StationData, StationContribution, StationExclusion, haversineKm } from "./stationService";
import { buildNormalizedSpatialWeights, type SpatialQualityCheck } from "./spatialFusionCore";
import { evaluateStationFieldQuality, getStationMeasurementAgeState, getStationMeasurementAgeStates, getValidStationMeasurementTimestamp, hasFreshStationMeasurement, type StationFieldQualityResult, type StationMeasurementField } from "./stationMeasurementFreshness";

export type LocalMode = "standard" | "local" | "ultra-local";

type UltraLocalParameter = "temperature" | "humidity" | "pressure" | "windSpeed" | "windGust" | "precipitation";

export type RadiusBand = {
  minKm: number;
  maxKm: number;
  weight: number;
  label: string;
};

export type UltraLocalResult = {
  mode: LocalMode;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  precipitation: number | null;
  stationsUsed: UltraLocalContribution[];
  stationsIgnored: UltraLocalExclusion[];
  modelContribution: number | null; // numerical model temperature
  modelWeight: number;
  finalModelWeight?: number;
  bandBreakdown: BandBreakdown[];
  microclimateAdjustment: number; // °C adjustment applied
  microclimateFactors: MicroclimateFactor[];
  stationCount: number;
  confidenceScore: number | null;
  confidenceByParameter: Record<UltraLocalParameter, number | null>;
  altitudeCorrection: AltitudeCorrectionProvenance;
  explanation: string;
};

export type AltitudeCorrectionProvenance = {
  applied: boolean;
  reason:
    | "adjustment_applied"
    | "adjustment_applied_with_unverifiable_stations"
    | "reference_altitude_unavailable"
    | "station_altitude_unavailable"
    | "no_temperature_contributions"
    | "no_altitude_difference"
    | "mode_disabled";
};

export type UltraLocalContribution = StationContribution & {
  band: string; // "0-2km", "2-5km", etc.
  bandWeight: number; // weight from the band allocation
  qualityChecks: QualityCheck[];
  altitudeAdjustment: number; // °C correction for altitude
  adjustedTemperature: number | null; // temperature after altitude correction
  /** Field-specific station weights; the legacy weight remains the temperature weight. */
  fieldWeights?: Partial<Record<StationMeasurementField, number>>;
};

export type UltraLocalExclusion = StationExclusion & {
  temperature?: number | null;
  checks: QualityCheck[];
};

export type QualityCheck = {
  name: string;
  passed: boolean;
  status?: "passed" | "failed" | "non_verifiable";
  value: string;
  threshold: string;
};

export type BandBreakdown = {
  band: string;
  minKm: number;
  maxKm: number;
  allocatedWeight: number; // configured weight for this band
  effectiveWeight: number; // actual weight used (may differ if no stations in band)
  stationCount: number;
  avgTemperature: number | null;
};

export type MicroclimateFactor = {
  type: string;
  label: string;
  adjustment: number; // °C
  confidence: number; // 0-1
  description: string;
};

// ─── Configuration per mode ──────────────────────────────────────────────────

const MODE_CONFIG: Record<LocalMode, {
  radiusBands: RadiusBand[];
  modelWeight: number;
  maxFreshnessMin: number;
  maxTempDeviation: number;
  minReliability: number;
  altitudeCorrection: boolean;
  microclimateEnabled: boolean;
}> = {
  standard: {
    radiusBands: [
      { minKm: 0, maxKm: 20, weight: 1.0, label: "0-20 km" },
    ],
    modelWeight: 0.30,
    maxFreshnessMin: 120,
    maxTempDeviation: 8,
    minReliability: 30,
    altitudeCorrection: false,
    microclimateEnabled: false,
  },
  local: {
    radiusBands: [
      { minKm: 0, maxKm: 5, weight: 0.45, label: "0-5 km" },
      { minKm: 5, maxKm: 10, weight: 0.25, label: "5-10 km" },
      { minKm: 10, maxKm: 20, weight: 0.18, label: "10-20 km" },
      { minKm: 20, maxKm: 30, weight: 0.05, label: "20-30 km" },
    ],
    modelWeight: 0.07,
    maxFreshnessMin: 60,
    maxTempDeviation: 6,
    minReliability: 40,
    altitudeCorrection: true,
    microclimateEnabled: false,
  },
  "ultra-local": {
    radiusBands: [
      { minKm: 0, maxKm: 2, weight: 0.60, label: "< 2 km" },
      { minKm: 2, maxKm: 5, weight: 0.28, label: "2-5 km" },
      { minKm: 5, maxKm: 10, weight: 0.10, label: "5-10 km" },
    ],
    modelWeight: 0.02,
    maxFreshnessMin: 30,
    maxTempDeviation: 5,
    minReliability: 45,
    altitudeCorrection: true,
    // Les heuristiques géographiques (urbain, forêt, littoral, vallée) ne sont
    // pas des observations. Elles restent désactivées tant qu’elles ne sont pas
    // calibrées séparément par un historique physique qualifié au lieu concerné.
    microclimateEnabled: false,
  },
};

// ─── Quality Verification ────────────────────────────────────────────────────

const QUALITY_CHECK_LABELS: Record<SpatialQualityCheck["code"], string> = {
  distance: "Distance",
  freshness: "Fraîcheur",
  reliability: "Qualité historique",
  data: "Disponibilité",
  coherence: "Cohérence",
  altitude: "Altitude",
};

function mapSpatialChecks(checks: SpatialQualityCheck[]): QualityCheck[] {
  return checks.map((check) => {
    const status = check.code === "altitude" && check.value === "non vérifiable"
      ? "non_verifiable"
      : check.passed ? "passed" : "failed";
    return {
      name: QUALITY_CHECK_LABELS[check.code],
      passed: status === "passed",
      status,
      value: check.value,
      threshold: check.threshold,
    };
  });
}

// ─── Microclimate Detection ──────────────────────────────────────────────────

function detectMicroclimate(
  lat: number,
  lon: number,
  altitude: number | null,
  stations: StationData[]
): MicroclimateFactor[] {
  const factors: MicroclimateFactor[] = [];

  // Estimate reference altitude from nearby stations
  const stationAlts = stations
    .filter(s => s.altitude != null && s.isActive)
    .map(s => s.altitude!);
  const avgAlt = stationAlts.length > 0
    ? stationAlts.reduce((a, b) => a + b, 0) / stationAlts.length
    : altitude ?? 50;

  // Urban heat island detection (based on population density proxy)
  // Cities tend to have more stations in close proximity
  const veryClose = stations.filter(s => s.distanceKm < 3).length;
  if (veryClose >= 3) {
    factors.push({
      type: "urban",
      label: "Îlot de chaleur urbain",
      adjustment: 0.5,
      confidence: 0.6,
      description: "Zone urbaine détectée (densité élevée de stations). Température légèrement supérieure aux zones rurales environnantes.",
    });
  }

  // Valley cold pool (if location is significantly lower than surroundings)
  if (altitude != null && avgAlt > altitude + 50) {
    factors.push({
      type: "valley",
      label: "Fond de vallée",
      adjustment: -0.8,
      confidence: 0.5,
      description: "Position en fond de vallée. Accumulation d'air froid possible, surtout la nuit.",
    });
  }

  // Coastal effect (proximity to sea — rough heuristic based on lat/lon for northern France)
  // If near the coast (lat > 50.5 and lon < 2.0 for Côte d'Opale area)
  if (lat > 50.8 && lon < 2.5) {
    factors.push({
      type: "coastal",
      label: "Influence maritime",
      adjustment: -0.3,
      confidence: 0.4,
      description: "Proximité de la mer. Effet modérateur sur les températures (plus frais en été, plus doux en hiver).",
    });
  }

  // Altitude effect (if significantly above average)
  if (altitude != null && altitude > avgAlt + 100) {
    const altAdj = -((altitude - avgAlt) / 100) * 0.65;
    factors.push({
      type: "altitude",
      label: "Effet d'altitude",
      adjustment: altAdj,
      confidence: 0.8,
      description: `Position en altitude (${altitude}m). Correction de ${altAdj.toFixed(1)}°C appliquée.`,
    });
  }

  // Forest cooling (heuristic: if few stations nearby, likely rural/forested)
  if (veryClose === 0 && stations.filter(s => s.distanceKm < 5).length <= 1) {
    factors.push({
      type: "forest",
      label: "Zone rurale/boisée",
      adjustment: -0.3,
      confidence: 0.3,
      description: "Zone peu instrumentée, possiblement rurale ou boisée. Légère fraîcheur par rapport aux zones urbanisées.",
    });
  }

  return factors;
}

// ─── Main Ultra-Local Calculation ────────────────────────────────────────────

export function calculateUltraLocal(
  stations: StationData[],
  mode: LocalMode,
  refLat: number,
  refLon: number,
  refAltitude: number | null = null,
  modelTemperature: number | null = null,
  options: {
    recordStationReadings?: boolean;
    /** Retained for caller compatibility; station-derived reference altitudes are never inferred. */
    inferReferenceAltitude?: boolean;
    /** Multiplicateurs de performance par identifiant de station ; une station absente de la map demeure au neutre 1. */
    performanceMultiplierById?: ReadonlyMap<string, number>;
  } = {},
): UltraLocalResult {
  const config = MODE_CONFIG[mode];
  const effectiveAltitude = refAltitude;
  const now = Date.now();
  const prevReadings = getPreviousReadings();
  const fields = ["temperature", "humidity", "pressure", "windSpeed", "windGust", "precipitation"] as const;
  type Field = (typeof fields)[number];
  type SpatialSource = StationData & { id: string };
  type QualifiedFieldStation = { station: StationData; checks: QualityCheck[]; altAdj: number };
  type FieldWeight = {
    station: StationData;
    weight: number;
    coreWeight: { distanceWeight: number; qualityWeight: number; freshnessWeight: number; altitudeAdjustmentC: number; adjustedTemperature: number | null };
    band: string;
    bandWeight: number;
    checks: QualityCheck[];
  };
  const stationById = new Map(stations.map((station) => [station.stationId, station]));
  const activeSources: SpatialSource[] = stations
    .filter((station) => station.isActive)
    .map((station) => ({ ...station, id: station.stationId }));
  const qcOptions = {
    now,
    maxDistanceKm: Math.max(...config.radiusBands.map((band) => band.maxKm)),
    maxFreshnessMin: config.maxFreshnessMin,
    minReliabilityScore: config.minReliability,
    maxTempDeviationC: config.maxTempDeviation,
    refAltitude: config.altitudeCorrection ? effectiveAltitude : null,
  };
  const qcByField = new Map<Field, Map<string, StationFieldQualityResult<SpatialSource>>>();
  const qualifiedByField = new Map<Field, QualifiedFieldStation[]>();

  for (const field of fields) {
    const evaluations = evaluateStationFieldQuality(activeSources, field, qcOptions);
    qcByField.set(field, new Map(evaluations.map((result) => [result.source.stationId, result])));
    let qualified = evaluations.filter((result) => result.passed).map((result) => ({
      station: stationById.get(result.source.stationId)!,
      checks: mapSpatialChecks(result.checks),
      altAdj: result.altitudeAdjustmentC,
    }));

    // History checks continue to apply only to the temperature observation;
    // they cannot remove the same station's separately timestamped fields.
    if (field === "temperature" && prevReadings.size > 0) {
      qualified = qualified.filter((entry) => {
        const previous = prevReadings.get(entry.station.stationId);
        const observedAt = getValidStationMeasurementTimestamp(entry.station.measurementTimes, "temperature", now);
        if (!previous || entry.station.temperature == null || observedAt == null) return true;
        const observationTimestamp = Date.parse(observedAt);
        if (!Number.isFinite(observationTimestamp)
          || !Number.isFinite(previous.timestamp)
          || !Number.isFinite(previous.stableSince)
          || previous.stableSince > previous.timestamp
          || observationTimestamp <= previous.timestamp) return true;
        const observationGapMin = (observationTimestamp - previous.timestamp) / 60_000;
        const tempDelta = Math.abs(entry.station.temperature - previous.temperature);
        const unchangedValue = entry.station.temperature === previous.temperature;
        const stableAgeMin = unchangedValue
          ? (observationTimestamp - previous.stableSince) / 60_000
          : 0;
        if (stableAgeMin > 60 && tempDelta < 0.01) {
          entry.checks.push({
            name: "frozen_value",
            passed: false,
            value: `${entry.station.temperature.toFixed(1)}°C inchangé depuis ${Math.round(stableAgeMin)} min`,
            threshold: "ΔT > 0.01°C en 60 min",
          });
          return false;
        }
        if (observationGapMin < 10 && tempDelta > 5) {
          entry.checks.push({
            name: "sudden_jump",
            passed: false,
            value: `Δ${tempDelta.toFixed(1)}°C en ${Math.round(observationGapMin)} min`,
            threshold: "ΔT < 5°C en 10 min",
          });
          return false;
        }
        return true;
      });
    }
    qualifiedByField.set(field, qualified);
  }

  function makeBandBreakdown(qualified: QualifiedFieldStation[], field: Field): BandBreakdown[] {
    const breakdown = config.radiusBands.map((band) => {
      const bandStations = qualified.filter(({ station }) => station.distanceKm >= band.minKm && station.distanceKm < band.maxKm);
      const values = bandStations.flatMap(({ station, altAdj }) => {
        const value = station[field];
        if (typeof value !== "number" || !Number.isFinite(value)) return [];
        return [field === "temperature" ? value + altAdj : value];
      });
      return {
        band: band.label,
        minKm: band.minKm,
        maxKm: band.maxKm,
        allocatedWeight: band.weight,
        effectiveWeight: band.weight,
        stationCount: bandStations.length,
        avgTemperature: field === "temperature" && values.length > 0
          ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
          : null,
      };
    });
    const bandsWithData = breakdown.filter((band) => band.stationCount > 0);
    const emptyWeight = breakdown.filter((band) => band.stationCount === 0).reduce((sum, band) => sum + band.allocatedWeight, 0);
    if (bandsWithData.length > 0 && emptyWeight > 0) {
      const activeWeight = bandsWithData.reduce((sum, band) => sum + band.allocatedWeight, 0);
      bandsWithData.forEach((band) => {
        band.effectiveWeight = band.allocatedWeight + (emptyWeight * (band.allocatedWeight / activeWeight));
      });
    }
    breakdown.filter((band) => band.stationCount === 0).forEach((band) => { band.effectiveWeight = 0; });
    return breakdown;
  }

  const temperatureQualified = qualifiedByField.get("temperature") ?? [];
  const bandBreakdown = makeBandBreakdown(temperatureQualified, "temperature");

  function weightsForField(field: Field, qualified: QualifiedFieldStation[], breakdown: BandBreakdown[]): Map<string, FieldWeight> {
    const result = new Map<string, FieldWeight>();
    for (const band of config.radiusBands) {
      const bandInfo = breakdown.find((entry) => entry.band === band.label)!;
      if (bandInfo.stationCount === 0) continue;
      const bandStations = qualified.filter(({ station }) => station.distanceKm >= band.minKm && station.distanceKm < band.maxKm);
      const timedSources = bandStations.map(({ station }) => ({
        ...station,
        id: station.stationId,
        updatedAt: getValidStationMeasurementTimestamp(station.measurementTimes, field, now),
        temperature: field === "temperature" ? station.temperature : null,
      }));
      const coreWeights = buildNormalizedSpatialWeights(timedSources, {
        now,
        refAltitude: config.altitudeCorrection ? effectiveAltitude : null,
        performanceMultiplierById: options.performanceMultiplierById,
      });
      bandStations.forEach((entry, index) => {
        const core = coreWeights[index];
        // Un zéro du noyau signifie une exclusion explicite (p. ex. tous les
        // multiplicateurs de performance ou pénalités). Ne pas conserver une
        // pseudo-contribution à poids nul dans les fieldWeights ni la compter
        // comme station utilisée : aucune masse ne doit être redistribuée.
        if (core.finalWeight <= 0) return;
        result.set(entry.station.stationId, {
          station: entry.station,
          weight: core.finalWeight * bandInfo.effectiveWeight,
          coreWeight: {
            distanceWeight: core.distanceWeight,
            qualityWeight: core.qualityWeight,
            freshnessWeight: core.freshnessWeight,
            altitudeAdjustmentC: core.altitudeAdjustmentC,
            adjustedTemperature: core.adjustedTemperature,
          },
          band: band.label,
          bandWeight: bandInfo.effectiveWeight,
          checks: entry.checks,
        });
      });
    }
    return result;
  }

  const weightsByField = new Map<Field, Map<string, FieldWeight>>();
  for (const field of fields) {
    const qualified = qualifiedByField.get(field) ?? [];
    const breakdown = field === "temperature" ? bandBreakdown : makeBandBreakdown(qualified, field);
    weightsByField.set(field, weightsForField(field, qualified, breakdown));
  }

  const temperatureWeights = weightsByField.get("temperature") ?? new Map<string, FieldWeight>();
  const temperatureContributors = Array.from(temperatureWeights.values()).filter((entry) => entry.weight > 0);
  const altitudeKnownContributors = temperatureContributors.filter((entry) => entry.station.altitude != null);
  const hasUnverifiableStationAltitude = temperatureContributors.some((entry) => entry.station.altitude == null);
  const hasNonZeroAltitudeAdjustment = altitudeKnownContributors.some((entry) => entry.coreWeight.altitudeAdjustmentC !== 0);
  let altitudeCorrection: AltitudeCorrectionProvenance;
  if (!config.altitudeCorrection) {
    altitudeCorrection = { applied: false, reason: "mode_disabled" };
  } else if (effectiveAltitude == null) {
    altitudeCorrection = { applied: false, reason: "reference_altitude_unavailable" };
  } else if (temperatureContributors.length === 0) {
    altitudeCorrection = { applied: false, reason: "no_temperature_contributions" };
  } else if (hasNonZeroAltitudeAdjustment) {
    altitudeCorrection = {
      applied: true,
      reason: hasUnverifiableStationAltitude
        ? "adjustment_applied_with_unverifiable_stations"
        : "adjustment_applied",
    };
  } else if (hasUnverifiableStationAltitude || altitudeKnownContributors.length === 0) {
    altitudeCorrection = { applied: false, reason: "station_altitude_unavailable" };
  } else {
    altitudeCorrection = { applied: false, reason: "no_altitude_difference" };
  }
  let weightedTemp = 0;
  let totalWeight = 0;
  temperatureWeights.forEach((entry) => {
    if (entry.coreWeight.adjustedTemperature == null || entry.weight <= 0) return;
    weightedTemp += entry.coreWeight.adjustedTemperature * entry.weight;
    totalWeight += entry.weight;
  });

  // Add the existing model share only when a qualified station temperature exists.
  const effectiveModelWeight = config.modelWeight;
  if (modelTemperature != null && totalWeight > 0) {
    weightedTemp += modelTemperature * effectiveModelWeight;
    totalWeight += effectiveModelWeight;
  }

  // Microclimate adjustments
  const microFactors = config.microclimateEnabled
    ? detectMicroclimate(refLat, refLon, effectiveAltitude, stations)
    : [];
  const microAdjustment = microFactors.reduce((sum, f) => sum + f.adjustment * f.confidence, 0);

  let finalTemp: number | null = null;
  if (totalWeight > 0) {
    finalTemp = Math.round(((weightedTemp / totalWeight) + microAdjustment) * 10) / 10;
  }
  type WeightedValue = { value: number; weight: number };
  function weightedValues(field: Exclude<UltraLocalParameter, "temperature">): WeightedValue[] {
    return Array.from(weightsByField.get(field)?.values() ?? []).flatMap((entry) => {
      const value = entry.station[field];
      return typeof value === "number" && Number.isFinite(value) && entry.weight > 0 ? [{ value, weight: entry.weight }] : [];
    });
  }

  function weightedAverage(values: WeightedValue[]): number | null {
    const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) return null;
    return Math.round((values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight) * 10) / 10;
  }

  function confidenceForValues(values: WeightedValue[], spreadAtLowConfidence: number): number | null {
    // Une seule station renseigne un contexte, mais ne permet pas de mesurer
    // l'accord inter-stations. La confiance reste donc explicitement
    // indisponible au lieu d'afficher une valeur artificiellement favorable.
    if (values.length < 2) return null;
    const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) return null;
    const mean = values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
    const weightedVariance = values.reduce(
      (sum, entry) => sum + entry.weight * (entry.value - mean) ** 2,
      0
    ) / totalWeight;
    const weightedStdDev = Math.sqrt(weightedVariance);
    const agreementPenalty = Math.min(60, (weightedStdDev / spreadAtLowConfidence) * 60);
    const availabilityPenalty = Math.max(0, 4 - values.length) * 8;
    return Math.max(0, Math.min(100, Math.round(100 - agreementPenalty - availabilityPenalty)));
  }

  const temperatureValues: WeightedValue[] = Array.from(temperatureWeights.values()).flatMap((entry) => {
    const value = entry.coreWeight.adjustedTemperature;
    return value != null && entry.weight > 0 ? [{ value, weight: entry.weight }] : [];
  });
  const confidenceByParameter: Record<UltraLocalParameter, number | null> = {
    temperature: confidenceForValues(temperatureValues, 4),
    humidity: confidenceForValues(weightedValues("humidity"), 20),
    pressure: confidenceForValues(weightedValues("pressure"), 8),
    windSpeed: confidenceForValues(weightedValues("windSpeed"), 12),
    windGust: confidenceForValues(weightedValues("windGust"), 15),
    precipitation: confidenceForValues(weightedValues("precipitation"), 5),
  };
  const confidenceScore = confidenceByParameter.temperature;

  // Keep one observation row per station used by any field. The legacy weight
  // and its component scores remain temperature-specific; fieldWeights names
  // the independently qualified variables.
  const fieldWeightsByStation = new Map<string, Partial<Record<StationMeasurementField, number>>>();
  for (const field of fields) {
    weightsByField.get(field)?.forEach((entry, stationId) => {
      const map = fieldWeightsByStation.get(stationId) ?? {};
      map[field] = Math.round(entry.weight * 1000) / 1000;
      fieldWeightsByStation.set(stationId, map);
    });
  }
  const contributions: UltraLocalContribution[] = Array.from(fieldWeightsByStation.keys()).map((stationId) => {
    const station = stationById.get(stationId)!;
    const temperatureEntry = temperatureWeights.get(stationId);
    const anyEntry = fields.map((field) => weightsByField.get(field)?.get(stationId)).find(Boolean)!;
    return {
      stationId,
      name: station.name,
      source: station.source,
      observedAt: getValidStationMeasurementTimestamp(station.measurementTimes, "temperature", now),
      measurementTimes: station.measurementTimes ?? null,
      measurementAgeByField: getStationMeasurementAgeStates(station.measurementTimes, now),
      fieldWeights: fieldWeightsByStation.get(stationId),
      distanceKm: station.distanceKm,
      weight: Math.round((temperatureEntry?.weight ?? 0) * 1000) / 1000,
      distanceWeight: temperatureEntry ? Math.round(temperatureEntry.coreWeight.distanceWeight * 1000) / 1000 : 0,
      qualityWeight: temperatureEntry ? Math.round(temperatureEntry.coreWeight.qualityWeight * 1000) / 1000 : 0,
      freshnessWeight: temperatureEntry ? Math.round(temperatureEntry.coreWeight.freshnessWeight * 1000) / 1000 : 0,
      temperature: station.temperature,
      humidity: station.humidity,
      pressure: station.pressure,
      windSpeed: station.windSpeed,
      windGust: station.windGust,
      precipitation: station.precipitation,
      band: temperatureEntry?.band ?? anyEntry.band,
      bandWeight: temperatureEntry?.bandWeight ?? 0,
      qualityChecks: temperatureEntry?.checks ?? [],
      altitudeAdjustment: temperatureEntry ? Math.round(temperatureEntry.coreWeight.altitudeAdjustmentC * 100) / 100 : 0,
      adjustedTemperature: temperatureEntry?.coreWeight.adjustedTemperature != null
        ? Math.round(temperatureEntry.coreWeight.adjustedTemperature * 10) / 10
        : null,
    };
  });

  const usedIds = new Set(fieldWeightsByStation.keys());
  const stationsIgnored: UltraLocalExclusion[] = stations.flatMap((station) => {
    if (usedIds.has(station.stationId)) return [];
    const checks: QualityCheck[] = [];
    const reasons: string[] = [];
    for (const field of fields) {
      const value = station[field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (!hasFreshStationMeasurement(station.measurementTimes, field, config.maxFreshnessMin, now)) {
        const age = getStationMeasurementAgeState(station.measurementTimes, field, now);
        const detail = age.status === "unknown" ? "âge inconnu (horodatage propre absent ou invalide)" : `âge ${age.ageMinutes} min, au-delà du cutoff ${config.maxFreshnessMin} min`;
        reasons.push(`${field}: ${detail}`);
        checks.push({ name: `${field} — Fraîcheur`, passed: false, value: detail, threshold: `≤ ${config.maxFreshnessMin} min` });
        continue;
      }
      const failed = qcByField.get(field)?.get(station.stationId);
      if (failed && !failed.passed) {
        const fieldChecks = mapSpatialChecks(failed.checks).filter((check) => check.status !== "non_verifiable" && !check.passed);
        reasons.push(`${field}: ${fieldChecks.map((check) => `${check.name} (${check.value})`).join(", ")}`);
        checks.push(...fieldChecks.map((check) => ({ ...check, name: `${field} — ${check.name}` })));
      }
    }
    if (!station.isActive) reasons.unshift(station.exclusionReason ?? "Station inactive");
    if (reasons.length === 0) reasons.push("Aucune mesure exploitable dans les variables prises en charge.");
    return [{
      stationId: station.stationId,
      name: station.name,
      source: station.source,
      distanceKm: station.distanceKm,
      reason: reasons.join("; "),
      temperature: station.temperature,
      checks,
    }];
  });

  // Generate explanation
  const finalModelWeight=modelTemperature!=null&&temperatureWeights.size>0&&totalWeight>0?effectiveModelWeight/totalWeight:0;
  const explanation = generateExplanation(mode, contributions.filter((contribution) => contribution.weight > 0), bandBreakdown, microFactors, finalTemp, modelTemperature,finalModelWeight);

  // Record current readings for next cycle's frozen/jump detection
  const readingsToRecord = stations.flatMap((station) => {
    if (station.temperature == null || !Number.isFinite(station.temperature)) return [];
    const observedAt = getValidStationMeasurementTimestamp(station.measurementTimes, "temperature", now);
    return observedAt == null
      ? []
      : [{ stationId: station.stationId, temperature: station.temperature, observedAt }];
  });
  if (options.recordStationReadings !== false) recordStationReadings(readingsToRecord);

  return {
    mode,
    temperature: finalTemp,
    humidity: weightedAverage(weightedValues("humidity")),
    pressure: weightedAverage(weightedValues("pressure")),
    windSpeed: weightedAverage(weightedValues("windSpeed")),
    windGust: weightedAverage(weightedValues("windGust")),
    precipitation: weightedAverage(weightedValues("precipitation")),
    stationsUsed: contributions,
    stationsIgnored,
    modelContribution: modelTemperature,
    modelWeight: effectiveModelWeight,
    finalModelWeight,
    bandBreakdown,
    microclimateAdjustment: Math.round(microAdjustment * 10) / 10,
    microclimateFactors: microFactors,
    stationCount: temperatureWeights.size,
    confidenceScore,
    confidenceByParameter,
    altitudeCorrection,
    explanation,
  };
}

// ─── Explanation Generator ───────────────────────────────────────────────────

function generateExplanation(
  mode: LocalMode,
  contributions: UltraLocalContribution[],
  bands: BandBreakdown[],
  microFactors: MicroclimateFactor[],
  finalTemp: number | null,
  modelTemp: number | null,
  finalModelWeight: number
): string {
  if (contributions.length === 0) {
    return "Aucune station valide trouvée dans le rayon de recherche. La température affichée provient des modèles numériques.";
  }

  const modeLabels: Record<LocalMode, string> = {
    standard: "standard",
    local: "local",
    "ultra-local": "Ultra-local",
  };

  const closestStation = contributions.sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const activeBands = bands.filter(b => b.stationCount > 0);

  let text = `Le mode ${modeLabels[mode]} a utilisé ${contributions.length} station${contributions.length > 1 ? "s" : ""} `;

  if (mode === "ultra-local") {
    text += `répartie${contributions.length > 1 ? "s" : ""} sur ${activeBands.length} bande${activeBands.length > 1 ? "s" : ""} de distance`;
    if (closestStation) {
      text += `. La station la plus proche (${closestStation.name}) est à ${closestStation.distanceKm.toFixed(1)} km`;
    }
    text += `. Les stations situées à proximité immédiate ont été privilégiées afin de représenter le plus fidèlement possible les conditions réelles observées sur place.`;
  } else if (mode === "local") {
    text += `avec une pondération renforcée pour les stations les plus proches.`;
  } else {
    text += `avec une pondération équilibrée entre distance, qualité et fraîcheur des données.`;
  }

  if (microFactors.length > 0) {
    const adjustments = microFactors.map(f => f.label).join(", ");
    text += ` Ajustements microclimatiques appliqués : ${adjustments}.`;
  }

  if (modelTemp != null && mode === "ultra-local") {
    text += ` Part finale réellement appliquée du modèle numérique : ${(finalModelWeight*100).toFixed(1)} %.`;
  }

  return text;
}

// ─── Export mode config for UI ───────────────────────────────────────────────

export function getUltraLocalConfig(mode: LocalMode) {
  return {
    mode,
    config: MODE_CONFIG[mode],
    description: mode === "ultra-local"
      ? "Utilise uniquement les stations situées dans les 10 km, avec priorité aux moins de 2 km (60%). Vérification stricte de la qualité et fraîcheur des données."
      : mode === "local"
        ? "Utilise les stations situées dans les 30 km, avec priorité aux moins de 5 km (45%). L’altitude n’est corrigée qu’avec une référence explicite."
        : "Pondération équilibrée entre distance, qualité et fraîcheur. Rayon de 20 km.",
  };
}
