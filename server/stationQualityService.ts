export type QualityObservation = {
  observedAt: number;
  temperature: number | null;
  humidity?: number | null;
  pressure?: number | null;
  windSpeed?: number | null;
  precipitation?: number | null;
};

export type StationQualityProfileInput = {
  stationId: string;
  observations: QualityObservation[];
  nowMs: number;
};

export type DerivedStationQualityProfile = {
  stationId: string;
  status: "en_observation" | "qualifiee" | "fiable" | "degradee";
  observationCount: number;
  temperatureObservationCount: number;
  continuityScore: number | null;
  completenessScore: number | null;
  stabilityScore: number | null;
  windowHours: number;
  firstObservedAt: number | null;
  lastObservedAt: number | null;
};

const HOUR_MS = 60 * 60 * 1000;

function round(value: number | null) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

/**
 * Derives auditable station metadata from archived observations only. The
 * output intentionally does not alter reliabilityScore or fusion weights.
 */
export function deriveStationQualityProfile(input: StationQualityProfileInput): DerivedStationQualityProfile {
  const observations = [...input.observations]
    .filter((item) => Number.isFinite(item.observedAt))
    .sort((a, b) => a.observedAt - b.observedAt);
  const observationCount = observations.length;
  const temperatureObservationCount = observations.filter((item) => item.temperature != null).length;
  const firstObservedAt = observations[0]?.observedAt ?? null;
  const lastObservedAt = observations.at(-1)?.observedAt ?? null;
  const windowHours = firstObservedAt == null || lastObservedAt == null
    ? 0
    : Math.max(0, Math.round((lastObservedAt - firstObservedAt) / HOUR_MS));
  const completenessScore = observationCount ? temperatureObservationCount / observationCount : null;

  const gaps = observations.slice(1).map((reading, index) => reading.observedAt - observations[index].observedAt);
  // Hourly snapshots are the authoritative archive cadence. A gap of up to
  // 90 minutes is continuous while giving the platform retry window room.
  const continuityScore = gaps.length ? gaps.filter((gap) => gap <= 90 * 60 * 1000).length / gaps.length : null;

  const temperaturePairs = observations.slice(1).flatMap((reading, index) => {
    const previous = observations[index];
    if (reading.temperature == null || previous.temperature == null) return [];
    const hours = Math.max((reading.observedAt - previous.observedAt) / HOUR_MS, 1 / 60);
    return [{ changePerHour: Math.abs(reading.temperature - previous.temperature) / hours }];
  });
  // A score here means absence of implausible discontinuities, not a judgement
  // that meteorological temperature must be flat.
  const stabilityScore = temperaturePairs.length
    ? temperaturePairs.filter((pair) => pair.changePerHour <= 8).length / temperaturePairs.length
    : null;

  let status: DerivedStationQualityProfile["status"] = "en_observation";
  if (observationCount >= 6 && (completenessScore ?? 0) < 0.7) status = "degradee";
  else if (observationCount >= 6 && (continuityScore ?? 0) < 0.5) status = "degradee";
  else if (observationCount >= 6 && (stabilityScore ?? 1) < 0.75) status = "degradee";
  else if (observationCount >= 72 && (continuityScore ?? 0) >= 0.8 && (completenessScore ?? 0) >= 0.9 && (stabilityScore ?? 0) >= 0.9) status = "fiable";
  else if (observationCount >= 6) status = "qualifiee";

  return {
    stationId: input.stationId,
    status,
    observationCount,
    temperatureObservationCount,
    continuityScore: round(continuityScore),
    completenessScore: round(completenessScore),
    stabilityScore: round(stabilityScore),
    windowHours,
    firstObservedAt,
    lastObservedAt,
  };
}
