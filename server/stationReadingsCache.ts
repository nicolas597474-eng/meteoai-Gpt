/**
 * In-memory state for station-temperature anomaly detection.
 * Provider observation timestamps, never processing time, drive all comparisons.
 * Entries are still evicted after three hours to bound memory use.
 */
export type StationReadingSnapshot = {
  temperature: number;
  /** Timestamp of the latest accepted, distinct provider observation. */
  timestamp: number;
  /** Provider timestamp at which the current unchanged-value sequence began. */
  stableSince: number;
};

export type StationReadingObservation = {
  stationId: string;
  temperature: number;
  observedAt: string;
};

const MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3 hours
const cache = new Map<string, StationReadingSnapshot>();

/**
 * Record only a valid provider observation. Duplicate or out-of-order provider
 * timestamps are ignored; a processing-time clock is never used as a substitute.
 */
export function recordStationReading(
  stationId: string,
  temperature: number,
  observedAt: string,
): void {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp) || !Number.isFinite(temperature)) return;

  const previous = cache.get(stationId);
  if (previous && timestamp <= previous.timestamp) return;

  const stableSince = previous && temperature === previous.temperature
    ? previous.stableSince
    : timestamp;
  cache.set(stationId, { temperature, timestamp, stableSince });
}

/** Record multiple timestamped station observations at once. */
export function recordStationReadings(readings: StationReadingObservation[]): void {
  for (const reading of readings) {
    recordStationReading(reading.stationId, reading.temperature, reading.observedAt);
  }
}

/**
 * Get a snapshot of non-expired readings for detectAnomalies / computeFusion.
 * The snapshot is copied so later writes cannot change a caller's baseline.
 */
export function getPreviousReadings(): Map<string, StationReadingSnapshot> {
  evictStale();
  return new Map(cache);
}

/** Evict readings whose latest provider observation is older than three hours. */
function evictStale(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [key, value] of Array.from(cache.entries())) {
    if (value.timestamp < cutoff) cache.delete(key);
  }
}

/** Get cache size (for diagnostics). */
export function getCacheSize(): number {
  return cache.size;
}

/** Clear the entire cache (for tests). */
export function clearCache(): void {
  cache.clear();
}
