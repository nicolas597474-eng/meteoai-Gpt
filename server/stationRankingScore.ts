export const STATION_RANKING_DISTANCE_CUTOFF_KM = 20;
export const STATION_RANKING_FRESHNESS_CUTOFF_MINUTES = 180;

export const STATION_RANKING_COMPONENT_WEIGHTS = {
  distance: 0.4,
  quality: 0.3,
  availability: 0.2,
  freshness: 0.1,
} as const;

export type StationRankingInput = {
  distanceKm: unknown;
  reliabilityScore: unknown;
  dataAvailability: unknown;
  updatedAt: unknown;
};

export type StationRankingComponents = {
  distanceScore: number;
  distanceKnown: boolean;
  qualityScore: number;
  availabilityScore: number;
  freshnessScore: number;
  freshnessKnown: boolean;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function numericScore(value: unknown, scale: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return clamp01(value / scale);
}

export function getStationRankingComponents(
  station: StationRankingInput,
  nowMs = Date.now(),
): StationRankingComponents {
  const distanceKm = station.distanceKm;
  const distanceKnown = typeof distanceKm === "number"
    && Number.isFinite(distanceKm)
    && distanceKm >= 0;
  const distanceScore = typeof distanceKm === "number"
    && Number.isFinite(distanceKm)
    && distanceKm >= 0
    ? clamp01(1 - distanceKm / STATION_RANKING_DISTANCE_CUTOFF_KM)
    : 0;

  const parsedUpdatedAt = typeof station.updatedAt === "string" && station.updatedAt.trim().length > 0
    ? Date.parse(station.updatedAt)
    : Number.NaN;
  const freshnessKnown = Number.isFinite(parsedUpdatedAt) && Number.isFinite(nowMs);
  const freshnessScore = freshnessKnown
    ? clamp01(1 - Math.max(0, nowMs - parsedUpdatedAt) / (STATION_RANKING_FRESHNESS_CUTOFF_MINUTES * 60_000))
    : 0;

  return {
    distanceScore,
    distanceKnown,
    qualityScore: numericScore(station.reliabilityScore, 100),
    availabilityScore: numericScore(station.dataAvailability, 1),
    freshnessScore,
    freshnessKnown,
  };
}

/**
 * Returns a dimensionless ranking point in [0, 1], not a probability or a
 * measurement of an individual station's historical meteorological accuracy.
 */
export function getStationRankingScore(station: StationRankingInput, nowMs = Date.now()): number {
  const components = getStationRankingComponents(station, nowMs);
  return STATION_RANKING_COMPONENT_WEIGHTS.distance * components.distanceScore
    + STATION_RANKING_COMPONENT_WEIGHTS.quality * components.qualityScore
    + STATION_RANKING_COMPONENT_WEIGHTS.availability * components.availabilityScore
    + STATION_RANKING_COMPONENT_WEIGHTS.freshness * components.freshnessScore;
}
