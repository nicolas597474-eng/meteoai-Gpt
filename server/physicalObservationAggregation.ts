export type PhysicalSnapshot = {
  id?: number;
  date?: string;
  hour: number;
  stationCount: number;
  temperature: number | null;
  windSpeed: number | null;
  windGust: number | null;
  precipitation: number | null;
  /** Immutable per-station source measurements; absent on legacy snapshots. */
  stationsUsed?: unknown;
};

export type QualifiedDailyObservation = {
  isQualified: boolean;
  coverageHours: number;
  windSpeedCoverageHours: number;
  windGustCoverageHours: number;
  precipitationCoverageHours: number;
  tempMax: number | null;
  tempMin: number | null;
  windSpeed: number | null;
  windGust: number | null;
  precipitation: number | null;
  precipitationSum: number | null;
  reason: string;
};

export const MINIMUM_COVERAGE_HOURS = 18;
const MINIMUM_STATIONS_PER_SNAPSHOT = 1;

/** Daily values are admissible only with enough independent physical evidence. */
export function buildQualifiedDailyObservation(snapshots: PhysicalSnapshot[]): QualifiedDailyObservation {
  const usable = snapshots.filter((snapshot) => snapshot.stationCount >= MINIMUM_STATIONS_PER_SNAPSHOT && snapshot.temperature != null);
  const temperatures = usable.map((snapshot) => snapshot.temperature!).filter(Number.isFinite);
  if (usable.length < MINIMUM_COVERAGE_HOURS || temperatures.length < MINIMUM_COVERAGE_HOURS) {
    return { isQualified: false, coverageHours: usable.length, windSpeedCoverageHours: 0, windGustCoverageHours: 0, precipitationCoverageHours: 0, tempMax: null, tempMin: null, windSpeed: null, windGust: null, precipitation: null, precipitationSum: null, reason: `Couverture insuffisante : ${usable.length}/${MINIMUM_COVERAGE_HOURS} heures physiques qualifiées` };
  }
  const finite = (values: Array<number | null>) => values.filter((value): value is number => value != null && Number.isFinite(value));
  const wind = finite(usable.map((snapshot) => snapshot.windSpeed));
  const gusts = finite(usable.map((snapshot) => snapshot.windGust));
  const precipitation = finite(usable.map((snapshot) => snapshot.precipitation));
  const windSpeedCoverageHours = new Set(usable.filter((snapshot) => snapshot.hour >= 0 && snapshot.hour < 24 && snapshot.windSpeed != null && Number.isFinite(snapshot.windSpeed)).map((snapshot) => snapshot.hour)).size;
  const windGustCoverageHours = new Set(usable.filter((snapshot) => snapshot.hour >= 0 && snapshot.hour < 24 && snapshot.windGust != null && Number.isFinite(snapshot.windGust)).map((snapshot) => snapshot.hour)).size;
  const precipitationByHour = new Map<number, number>();
  for (const snapshot of snapshots) {
    if (snapshot.stationCount < MINIMUM_STATIONS_PER_SNAPSHOT || !Number.isInteger(snapshot.hour) || snapshot.hour < 0 || snapshot.hour > 23) continue;
    if (snapshot.precipitation == null || !Number.isFinite(snapshot.precipitation) || snapshot.precipitation < 0) continue;
    precipitationByHour.set(snapshot.hour, snapshot.precipitation);
  }
  const precipitationCoverageHours = precipitationByHour.size;
  const precipitationSum = precipitationCoverageHours === 24
    ? Array.from(precipitationByHour.values()).reduce((sum, value) => sum + value, 0)
    : null;
  return {
    isQualified: true,
    coverageHours: usable.length,
    windSpeedCoverageHours,
    windGustCoverageHours,
    precipitationCoverageHours,
    tempMax: Math.max(...temperatures),
    tempMin: Math.min(...temperatures),
    windSpeed: wind.length ? Math.max(...wind) : null,
    windGust: gusts.length ? Math.max(...gusts) : null,
    precipitation: precipitation.length ? Math.max(...precipitation) : null,
    precipitationSum,
    reason: "Observation journalière issue exclusivement de snapshots physiques qualifiés",
  };
}
