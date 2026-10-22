import { getStationSourceKind, PHYSICAL_STATION_SOURCES, type StationSource } from "./stationService";
import type { StationMeasurementTimes } from "./stationMeasurementFreshness";
import { PUBLIC_RANKING_EVIDENCE_THRESHOLDS } from "./weatherReliabilityConfig";

export const STATION_PERFORMANCE_VERSION = "station-cross-network-performance-v1" as const;

/**
 * Coverage gates for calculating exploratory per-variable agreement only.
 * 30/7 are inherited from the existing public model-evidence maturity policy;
 * they are not a station-quality significance test or permission to publish a
 * composite score. Two reference networks are structurally required for a
 * cross-network comparison; two peer sites are the minimum for sample variance.
 */
export const STATION_PERFORMANCE_CALCULATION_GATES = {
  minimumComparisons: PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons,
  minimumDistinctDays: PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays,
  minimumDistinctReferenceNetworksPerComparison: 2,
  minimumSourcePriorSites: 2,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const VARIABLE_DEFINITIONS = [
  { key: "temperature", label: "Température", unit: "°C" },
  { key: "humidity", label: "Humidité", unit: "points de %" },
  { key: "pressure", label: "Pression", unit: "hPa" },
  { key: "windSpeed", label: "Vent", unit: "km/h" },
  { key: "windGust", label: "Rafales", unit: "km/h" },
  { key: "windDirection", label: "Direction du vent", unit: "°" },
  { key: "precipitation", label: "Précipitations", unit: "mm" },
] as const;

export type StationPerformanceVariable = typeof VARIABLE_DEFINITIONS[number]["key"];
type StationPerformanceReason =
  | "station_not_eligible"
  | "outside_reference_radius"
  | "no_station_observations"
  | "distinct_reference_networks_insufficient"
  | "comparisons_insufficient"
  | "distinct_days_insufficient"
  | "precipitation_method_not_defined"
  | "source_prior_insufficient"
  | "source_prior_variance_unavailable";

export type StationPerformanceObservation = {
  observedAt: number | Date | string;
  /** Provider-reported timestamp for each measured field; never inferred from observedAt. */
  measurementTimes?: StationMeasurementTimes | null;
  temperature?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  windDirection?: number | null;
  precipitation?: number | null;
};

export type StationPerformanceStation = {
  stationId: string;
  source: string;
  qualificationStatus?: string | null;
  isActive?: boolean | number | null;
  lat: number;
  lon: number;
  distanceKm?: number | null;
  readings: readonly StationPerformanceObservation[];
};

export type StationPerformanceEstimate = {
  meanAbsoluteError: number;
  meanDailyAbsoluteError: number;
  rootMeanSquareError: number;
  meanBias: number;
  sourcePriorMeanAbsoluteError: number;
  shrunkMeanAbsoluteError: number;
  uncertainty95: { lower: number; upper: number; method: "hierarchical_day_block_approximation" };
  /** Fraction of the posterior estimate attributable to this station's evidence; not an accuracy score. */
  stationEvidenceWeight: number;
  meanReferenceDisagreement: number;
};

export type StationPerformanceVariableResult = {
  status: "mesuree" | "non_mesuree";
  reason: StationPerformanceReason | null;
  comparisons: number;
  distinctDays: number;
  distinctEventDays: number | null;
  referenceNetworks: string[];
  minimumDistinctReferenceNetworksPerComparison: number;
  sourcePriorSiteCount: number;
  unit: string;
  estimate: StationPerformanceEstimate | null;
};

export type StationPerformanceProfile = {
  version: typeof STATION_PERFORMANCE_VERSION;
  status: "mesuree" | "non_mesuree";
  variables: Record<StationPerformanceVariable, StationPerformanceVariableResult>;
};

export type StationPerformanceInput = {
  stations: readonly StationPerformanceStation[];
  maxDistanceKm?: number;
  /** Absolute request-time cutoff for field observations. */
  asOf?: number;
};

type NormalizedObservation = {
  stationId: string;
  source: string;
  siteKey: string;
  hour: number;
  observedAt: number;
  value: number;
};

type StationComparison = {
  error: number;
  referenceDisagreement: number;
  referenceNetworks: string[];
  isEventDay: boolean;
  utcDay: string;
};

type RawStationMetric = {
  stationId: string;
  source: string;
  lat: number;
  lon: number;
  comparisons: StationComparison[];
  candidateObservations: number;
  dailyMeanAbsoluteErrors: number[];
  meanAbsoluteError: number;
  distinctDays: number;
  referenceNetworks: string[];
  availableReferenceNetworks: string[];
  minimumDistinctReferenceNetworksPerComparison: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function toAbsoluteMeasurementEpoch(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):?(\d{2}))$/i.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6] ?? 0);
  const offsetHour = Number(parts[9] ?? 0);
  const offsetMinute = Number(parts[10] ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return null;
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values)!;
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function circularSignedError(value: number, reference: number): number {
  return ((value - reference + 540) % 360) - 180;
}

function circularAbsoluteError(value: number, reference: number): number {
  return Math.abs(circularSignedError(value, reference));
}

function circularMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const normalized = values.map((value) => ((value % 360) + 360) % 360);
  return normalized.reduce((best, candidate) => {
    const candidateLoss = normalized.reduce((sum, value) => sum + circularAbsoluteError(value, candidate), 0);
    const bestLoss = normalized.reduce((sum, value) => sum + circularAbsoluteError(value, best), 0);
    return candidateLoss < bestLoss ? candidate : best;
  }, normalized[0]);
}

function variableMedian(variable: StationPerformanceVariable, values: number[]): number | null {
  return variable === "windDirection" ? circularMedian(values) : median(values);
}

function siteKey(station: StationPerformanceStation): string {
  return `${station.lat}|${station.lon}`;
}

function isEligibleStation(station: StationPerformanceStation, maxDistanceKm?: number): boolean {
  if (!station.stationId || station.qualificationStatus !== "validated") return false;
  if (station.isActive === false || station.isActive === 0) return false;
  if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return false;
  if (maxDistanceKm !== undefined && (!isFiniteNumber(station.distanceKm) || station.distanceKm > maxDistanceKm)) return false;
  const source = station.source as StationSource;
  return PHYSICAL_STATION_SOURCES.has(source) && getStationSourceKind(source, station.stationId) === "physical";
}

function createEmptyVariableResult(
  unit: string,
  reason: StationPerformanceReason,
  counts: Partial<Pick<StationPerformanceVariableResult,
    "comparisons" | "distinctDays" | "distinctEventDays" | "referenceNetworks" | "minimumDistinctReferenceNetworksPerComparison" | "sourcePriorSiteCount"
  >> = {},
): StationPerformanceVariableResult {
  return {
    status: "non_mesuree",
    reason,
    comparisons: counts.comparisons ?? 0,
    distinctDays: counts.distinctDays ?? 0,
    distinctEventDays: counts.distinctEventDays ?? null,
    referenceNetworks: counts.referenceNetworks ?? [],
    minimumDistinctReferenceNetworksPerComparison: counts.minimumDistinctReferenceNetworksPerComparison ?? 0,
    sourcePriorSiteCount: counts.sourcePriorSiteCount ?? 0,
    unit,
    estimate: null,
  };
}

/** Two-sided nominal 95% Student-t quantile (alpha 0.05), with a normal limit above 30 df. */
export function studentT95Critical(degreesOfFreedom: number): number {
  const criticalValues = [
    Number.POSITIVE_INFINITY,
    12.706,
    4.303,
    3.182,
    2.776,
    2.571,
    2.447,
    2.365,
    2.306,
    2.262,
    2.228,
    2.201,
    2.179,
    2.160,
    2.145,
    2.131,
    2.120,
    2.110,
    2.101,
    2.093,
    2.086,
    2.080,
    2.074,
    2.069,
    2.064,
    2.060,
    2.056,
    2.052,
    2.048,
    2.045,
    2.042,
  ];
  const index = Math.max(1, Math.floor(degreesOfFreedom));
  return criticalValues[index] ?? 1.96;
}

function buildRawStationMetrics(
  stations: readonly StationPerformanceStation[],
  variable: StationPerformanceVariable,
  maxDistanceKm?: number,
  asOf = Date.now(),
): Map<string, RawStationMetric> {
  const eligibleStations = stations.filter((station) => isEligibleStation(station, maxDistanceKm));
  const byHour = new Map<number, Map<string, NormalizedObservation[]>>();

  for (const station of eligibleStations) {
    for (const reading of station.readings) {
      const observedAt = toAbsoluteMeasurementEpoch(reading.measurementTimes?.[variable]);
      const value = reading[variable];
      if (observedAt === null || observedAt > asOf || !isFiniteNumber(value)) continue;
      const hour = Math.floor(observedAt / HOUR_MS) * HOUR_MS;
      const stationValues = byHour.get(hour) ?? new Map<string, NormalizedObservation[]>();
      const readingsForStation = stationValues.get(station.stationId) ?? [];
      if (!readingsForStation.some((current) => current.observedAt === observedAt)) {
        readingsForStation.push({ stationId: station.stationId, source: station.source, siteKey: siteKey(station), hour, observedAt, value });
      }
      stationValues.set(station.stationId, readingsForStation);
      byHour.set(hour, stationValues);
    }
  }

  const result = new Map<string, RawStationMetric>();
  for (const station of eligibleStations) {
    const comparisons: StationComparison[] = [];
    let candidateObservations = 0;
    let minimumAvailableReferenceNetworks = Number.POSITIVE_INFINITY;
    let minimumMatchedReferenceNetworks = Number.POSITIVE_INFINITY;
    const availableReferenceNetworks = new Set<string>();
    Array.from(byHour.entries()).forEach(([hour, readingsByStation]) => {
      const candidateReadings = readingsByStation.get(station.stationId) ?? [];
      const candidate = candidateReadings.reduce<NormalizedObservation | null>(
        (latest, reading) => !latest || reading.observedAt > latest.observedAt ? reading : latest,
        null,
      );
      if (!candidate) return;
      candidateObservations++;

      const valuesBySite = new Map<string, NormalizedObservation[]>();
      Array.from(readingsByStation.values()).forEach((stationReadings) => {
        const value = stationReadings.reduce<NormalizedObservation | null>(
          (latest, reading) => reading.observedAt <= candidate.observedAt && (!latest || reading.observedAt > latest.observedAt)
            ? reading
            : latest,
          null,
        );
        if (!value) return;
        if (value.source === station.source || value.siteKey === candidate.siteKey) return;
        valuesBySite.set(value.siteKey, [...(valuesBySite.get(value.siteKey) ?? []), value]);
      });
      const valuesByNetwork = new Map<string, number[]>();
      valuesBySite.forEach((siteValues) => {
        const siteNetworks = Array.from(new Set(siteValues.map((value) => value.source)));
        // A same-coordinate feed from multiple networks is one physical site,
        // not multiple independent reference networks.
        if (siteNetworks.length !== 1) return;
        const network = siteNetworks[0];
        const siteValue = variableMedian(variable, siteValues.map((value) => value.value));
        if (siteValue === null) return;
        valuesByNetwork.set(network, [...(valuesByNetwork.get(network) ?? []), siteValue]);
      });
      const networkMedians = Array.from(valuesByNetwork.entries()).flatMap(([source, values]) => {
        const networkMedian = variableMedian(variable, values);
        return networkMedian === null ? [] : [{ source, value: networkMedian }];
      });
      minimumAvailableReferenceNetworks = Math.min(minimumAvailableReferenceNetworks, networkMedians.length);
      networkMedians.forEach((item) => availableReferenceNetworks.add(item.source));
      if (networkMedians.length < STATION_PERFORMANCE_CALCULATION_GATES.minimumDistinctReferenceNetworksPerComparison) return;
      minimumMatchedReferenceNetworks = Math.min(minimumMatchedReferenceNetworks, networkMedians.length);

      const referenceValue = variableMedian(variable, networkMedians.map((item) => item.value));
      if (referenceValue === null) return;
      const error = variable === "windDirection" ? circularSignedError(candidate.value, referenceValue) : candidate.value - referenceValue;
      const utcDay = new Date(hour).toISOString().slice(0, 10);
      comparisons.push({
        error,
        referenceDisagreement: mean(networkMedians.map((item) => variable === "windDirection"
          ? circularAbsoluteError(item.value, referenceValue)
          : Math.abs(item.value - referenceValue))) ?? 0,
        referenceNetworks: networkMedians.map((item) => item.source).sort(),
        isEventDay: variable === "precipitation" && (candidate.value > 0 || referenceValue > 0),
        utcDay,
      });
    });

    const byDay = new Map<string, number[]>();
    for (const comparison of comparisons) {
      byDay.set(comparison.utcDay, [...(byDay.get(comparison.utcDay) ?? []), Math.abs(comparison.error)]);
    }
    const dailyMeanAbsoluteErrors = Array.from(byDay.values()).map((errors) => mean(errors)!).filter(Number.isFinite);
    result.set(station.stationId, {
      stationId: station.stationId,
      source: station.source,
      lat: station.lat,
      lon: station.lon,
      comparisons,
      candidateObservations,
      dailyMeanAbsoluteErrors,
      meanAbsoluteError: mean(comparisons.map((comparison) => Math.abs(comparison.error))) ?? 0,
      distinctDays: byDay.size,
      referenceNetworks: Array.from(new Set(comparisons.flatMap((comparison) => comparison.referenceNetworks))).sort(),
      availableReferenceNetworks: Array.from(availableReferenceNetworks).sort(),
      minimumDistinctReferenceNetworksPerComparison: Number.isFinite(minimumMatchedReferenceNetworks)
        ? minimumMatchedReferenceNetworks
        : Number.isFinite(minimumAvailableReferenceNetworks)
          ? minimumAvailableReferenceNetworks
          : 0,
    });
  }

  return result;
}

function deriveVariableResult(
  candidate: StationPerformanceStation,
  stations: readonly StationPerformanceStation[],
  variable: StationPerformanceVariable,
  rawMetrics: Map<string, RawStationMetric>,
  maxDistanceKm?: number,
): StationPerformanceVariableResult {
  const unit = VARIABLE_DEFINITIONS.find((definition) => definition.key === variable)!.unit;
  if (!isEligibleStation(candidate, maxDistanceKm)) {
    return createEmptyVariableResult(unit, maxDistanceKm !== undefined && isFiniteNumber(candidate.distanceKm) && candidate.distanceKm > maxDistanceKm
      ? "outside_reference_radius"
      : "station_not_eligible");
  }

  const raw = rawMetrics.get(candidate.stationId);
  if (!raw || raw.candidateObservations === 0) {
    return createEmptyVariableResult(unit, "no_station_observations");
  }

  const comparisonCount = raw.comparisons.length;
  const distinctDays = raw.distinctDays;
  const distinctEventDays = variable === "precipitation"
    ? new Set(raw.comparisons.filter((comparison) => comparison.isEventDay).map((comparison) => comparison.utcDay)).size
    : null;
  const referenceNetworks = comparisonCount > 0 ? raw.referenceNetworks : raw.availableReferenceNetworks;
  const minimumDistinctReferenceNetworksPerComparison = raw.minimumDistinctReferenceNetworksPerComparison;
  const basicCounts = {
    comparisons: comparisonCount,
    distinctDays,
    distinctEventDays,
    referenceNetworks,
    minimumDistinctReferenceNetworksPerComparison,
  };

  if (variable === "precipitation") {
    return createEmptyVariableResult(unit, "precipitation_method_not_defined", basicCounts);
  }

  if (comparisonCount === 0) {
    return createEmptyVariableResult(unit, "distinct_reference_networks_insufficient", basicCounts);
  }

  if (comparisonCount < STATION_PERFORMANCE_CALCULATION_GATES.minimumComparisons) {
    return createEmptyVariableResult(unit, "comparisons_insufficient", basicCounts);
  }
  if (distinctDays < STATION_PERFORMANCE_CALCULATION_GATES.minimumDistinctDays) {
    return createEmptyVariableResult(unit, "distinct_days_insufficient", basicCounts);
  }
  if (minimumDistinctReferenceNetworksPerComparison < STATION_PERFORMANCE_CALCULATION_GATES.minimumDistinctReferenceNetworksPerComparison) {
    return createEmptyVariableResult(unit, "distinct_reference_networks_insufficient", basicCounts);
  }

  const candidateSite = siteKey(candidate);
  const peerMetricsBySite = new Map<string, RawStationMetric>();
  for (const station of stations) {
    if (station.stationId === candidate.stationId || station.source !== candidate.source || siteKey(station) === candidateSite) continue;
    const peer = rawMetrics.get(station.stationId);
    if (!peer || peer.comparisons.length < STATION_PERFORMANCE_CALCULATION_GATES.minimumComparisons
      || peer.distinctDays < STATION_PERFORMANCE_CALCULATION_GATES.minimumDistinctDays
      || peer.referenceNetworks.length < STATION_PERFORMANCE_CALCULATION_GATES.minimumDistinctReferenceNetworksPerComparison) continue;
    const key = siteKey(station);
    const current = peerMetricsBySite.get(key);
    if (!current || peer.comparisons.length > current.comparisons.length
      || (peer.comparisons.length === current.comparisons.length && peer.stationId.localeCompare(current.stationId) < 0)) {
      peerMetricsBySite.set(key, peer);
    }
  }
  const peerMetrics = Array.from(peerMetricsBySite.values());
  const sourcePriorSiteCount = peerMetrics.length;
  if (sourcePriorSiteCount < STATION_PERFORMANCE_CALCULATION_GATES.minimumSourcePriorSites) {
    return createEmptyVariableResult(unit, "source_prior_insufficient", { ...basicCounts, sourcePriorSiteCount });
  }

  const candidateDailyMae = raw.dailyMeanAbsoluteErrors;
  const candidateObservedMae = mean(candidateDailyMae);
  const sourcePriorValues = peerMetrics.map((peer) => mean(peer.dailyMeanAbsoluteErrors)!).filter(Number.isFinite);
  const sourcePriorMae = mean(sourcePriorValues);
  if (candidateObservedMae === null || sourcePriorMae === null) {
    return createEmptyVariableResult(unit, "source_prior_insufficient", { ...basicCounts, sourcePriorSiteCount });
  }

  const sourceBetweenStationVariance = sampleVariance(sourcePriorValues);
  if (sourceBetweenStationVariance <= 0) {
    return createEmptyVariableResult(unit, "source_prior_variance_unavailable", { ...basicCounts, sourcePriorSiteCount });
  }

  const candidateDayVariance = sampleVariance(candidateDailyMae);
  const referenceDisagreementByDay = new Map<string, number[]>();
  for (const comparison of raw.comparisons) {
    referenceDisagreementByDay.set(comparison.utcDay, [
      ...(referenceDisagreementByDay.get(comparison.utcDay) ?? []),
      comparison.referenceDisagreement,
    ]);
  }
  const dailyReferenceDisagreement = Array.from(referenceDisagreementByDay.values()).map((values) => mean(values)!).filter(Number.isFinite);
  const meanReferenceDisagreement = mean(raw.comparisons.map((comparison) => comparison.referenceDisagreement)) ?? 0;
  const candidateSamplingVariance = candidateDayVariance / candidateDailyMae.length
    + (sampleVariance(dailyReferenceDisagreement) / Math.max(dailyReferenceDisagreement.length, 1))
    + (meanReferenceDisagreement ** 2 / Math.max(dailyReferenceDisagreement.length, 1));
  const totalVariance = sourceBetweenStationVariance + candidateSamplingVariance;
  if (!Number.isFinite(totalVariance) || totalVariance <= 0) {
    return createEmptyVariableResult(unit, "source_prior_variance_unavailable", { ...basicCounts, sourcePriorSiteCount });
  }

  const stationEvidenceWeight = sourceBetweenStationVariance / totalVariance;
  const shrunkMeanAbsoluteError = stationEvidenceWeight * candidateObservedMae
    + (1 - stationEvidenceWeight) * sourcePriorMae;
  const posteriorVariance = stationEvidenceWeight ** 2 * candidateSamplingVariance
    + (1 - stationEvidenceWeight) ** 2 * sourceBetweenStationVariance / sourcePriorSiteCount;
  const degreesOfFreedom = Math.max(1, Math.min(candidateDailyMae.length - 1, sourcePriorSiteCount - 1));
  const margin = studentT95Critical(degreesOfFreedom) * Math.sqrt(Math.max(0, posteriorVariance));
  const errors = raw.comparisons.map((comparison) => comparison.error);
  const meanBias = mean(errors) ?? 0;
  const rootMeanSquareError = Math.sqrt(mean(errors.map((error) => error ** 2)) ?? 0);

  return {
    status: "mesuree",
    reason: null,
    ...basicCounts,
    sourcePriorSiteCount,
    unit,
    estimate: {
      meanAbsoluteError: round(raw.meanAbsoluteError),
      meanDailyAbsoluteError: round(candidateObservedMae),
      rootMeanSquareError: round(rootMeanSquareError),
      meanBias: round(meanBias),
      sourcePriorMeanAbsoluteError: round(sourcePriorMae),
      shrunkMeanAbsoluteError: round(shrunkMeanAbsoluteError),
      uncertainty95: {
        lower: round(Math.max(0, shrunkMeanAbsoluteError - margin)),
        upper: round(shrunkMeanAbsoluteError + margin),
        method: "hierarchical_day_block_approximation",
      },
      stationEvidenceWeight: round(stationEvidenceWeight),
      meanReferenceDisagreement: round(meanReferenceDisagreement),
    },
  };
}

export function deriveStationPerformanceProfiles(input: StationPerformanceInput): Map<string, StationPerformanceProfile> {
  const profiles = new Map<string, StationPerformanceProfile>();
  const asOf = Number.isFinite(input.asOf) ? input.asOf! : Date.now();

  for (const { key: variable } of VARIABLE_DEFINITIONS) {
    const rawMetrics = buildRawStationMetrics(input.stations, variable, input.maxDistanceKm, asOf);
    for (const station of input.stations) {
      const existing = profiles.get(station.stationId);
      const variableResult = deriveVariableResult(station, input.stations, variable, rawMetrics, input.maxDistanceKm);
      const variables = {
        ...(existing?.variables ?? {} as Record<StationPerformanceVariable, StationPerformanceVariableResult>),
        [variable]: variableResult,
      } as Record<StationPerformanceVariable, StationPerformanceVariableResult>;
      profiles.set(station.stationId, {
        version: STATION_PERFORMANCE_VERSION,
        status: Object.values(variables).some((result) => result?.estimate !== null && result?.estimate !== undefined)
          ? "mesuree"
          : "non_mesuree",
        variables,
      });
    }
  }

  return profiles;
}

export const STATION_PERFORMANCE_VARIABLES = VARIABLE_DEFINITIONS;
export const STATION_PERFORMANCE_HOUR_MS = HOUR_MS;
