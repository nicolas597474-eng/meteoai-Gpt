import { buildQualifiedDailyObservation } from "./physicalObservationAggregation";

type SnapshotStation = {
  stationId?: string;
  name?: string;
  source?: string;
  distanceKm?: number;
};

type HistoricalStation = {
  stationId: string;
  name: string;
  source: string;
  distanceKm: number | null;
};

export type HistoricalPhysicalSnapshot = {
  date: string;
  hour: number;
  stationCount: number;
  temperature: number | null;
  windSpeed: number | null;
  windGust: number | null;
  precipitation: number | null;
  stationsUsed: unknown;
};

export type HistoricalCollectionSnapshot = {
  date: string;
  status: "completed" | "partial" | "failed";
};

export type HistoricalPhysicalCollectionTrace = {
  date: string;
  hour: number;
  locationKey: string;
  locationName?: string | null;
  status: "stored" | "no_station" | "failed";
  attempts: number;
  stationCount: number;
  reason?: string | null;
  collectedAt?: Date | string | null;
};

function toStation(value: unknown): HistoricalStation | null {
  if (!value || typeof value !== "object") return null;
  const station = value as SnapshotStation;
  if (!station.stationId || !station.name) return null;
  return {
    stationId: station.stationId,
    name: station.name,
    source: station.source ?? "inconnue",
    distanceKm: typeof station.distanceKm === "number" && Number.isFinite(station.distanceKm) ? station.distanceKm : null,
  };
}

function stationList(snapshots: HistoricalPhysicalSnapshot[]) {
  const unique = new Map<string, HistoricalStation>();
  for (const snapshot of snapshots) {
    const items = Array.isArray(snapshot.stationsUsed) ? snapshot.stationsUsed : [];
    for (const item of items) {
      const station = toStation(item);
      if (!station?.stationId) continue;
      const current = unique.get(station.stationId);
      if (!current || (station.distanceKm != null && (current.distanceKm == null || station.distanceKm < current.distanceKm))) {
        unique.set(station.stationId, station);
      }
    }
  }
  return Array.from(unique.values()).sort((left, right) => (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY) || left.name.localeCompare(right.name));
}

/**
 * Produces a read-only daily proof trail. A day is never treated as qualified
 * when its snapshots do not pass the same aggregation rule as operational scoring.
 */
export function buildEveningEvidence(
  snapshots: HistoricalPhysicalSnapshot[],
  collectionSnapshots: HistoricalCollectionSnapshot[],
  collectionTraces: HistoricalPhysicalCollectionTrace[] = [],
) {
  const snapshotsByDate = new Map<string, HistoricalPhysicalSnapshot[]>();
  for (const snapshot of snapshots) {
    const current = snapshotsByDate.get(snapshot.date) ?? [];
    current.push(snapshot);
    snapshotsByDate.set(snapshot.date, current);
  }
  const collectionByDate = new Map(collectionSnapshots.map((snapshot) => [snapshot.date, snapshot]));
  const tracesByDate = new Map<string, HistoricalPhysicalCollectionTrace[]>();
  for (const trace of collectionTraces) {
    const current = tracesByDate.get(trace.date) ?? [];
    current.push(trace);
    tracesByDate.set(trace.date, current);
  }
  const dates = new Set([...Array.from(snapshotsByDate.keys()), ...Array.from(collectionByDate.keys()), ...Array.from(tracesByDate.keys())]);

  return Array.from(dates).sort((left, right) => right.localeCompare(left)).map((date) => {
    const daySnapshots = snapshotsByDate.get(date) ?? [];
    const daily = buildQualifiedDailyObservation(daySnapshots);
    const collection = collectionByDate.get(date) ?? null;
    const traces = (tracesByDate.get(date) ?? []).sort((left, right) => right.hour - left.hour);
    const hasSnapshots = daySnapshots.length > 0;
    return {
      date,
      snapshotHours: daySnapshots.length,
      coverageHours: daily.coverageHours,
      requiredCoverageHours: 18,
      isQualified: hasSnapshots && daily.isQualified,
      exclusionReason: hasSnapshots
        ? daily.reason
        : "Aucun snapshot physique qualifié n’a été archivé pour cette journée.",
      stations: stationList(daySnapshots),
      collectionStatus: collection?.status ?? null,
      collectionTraces: traces,
    };
  });
}
