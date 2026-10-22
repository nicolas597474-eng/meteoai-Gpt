import { LOCAL_PRECIPITATION_NOWCAST_WET_THRESHOLD_MM } from "./localPrecipitationNowcastingShadow";

export const LOCAL_PRECIPITATION_VERIFICATION_HORIZONS_MINUTES = [60, 120] as const;
export type LocalPrecipitationVerificationHorizon = (typeof LOCAL_PRECIPITATION_VERIFICATION_HORIZONS_MINUTES)[number];

export type AccumulationWindowEvidence = {
  startAt: number;
  endAt: number;
  durationMinutes: number;
} | null;

export type LocalPrecipitationEmissionEvidence = {
  id: number;
  locationKey: string;
  observationReferenceAt: number;
  emittedAt: number;
  availableAt: number;
  validTime: number;
  horizonMinutes: number;
  baselineWet: boolean | null;
  candidateWet: boolean | null;
  forecastAccumulationWindow: AccumulationWindowEvidence;
  productionReadsEnabled: number;
  shadowMode: number;
  appliedToProduction: number;
};

export type LocalPrecipitationStationContribution = {
  stationId: string;
  precipitation: number | null;
};

export type LocalPrecipitationSourceObservation = {
  id: number;
  stationId: string;
  observedAt: number;
  collectedAt: number;
  precipitation: number | null;
  accumulationWindow?: AccumulationWindowEvidence;
};

export type LocalPrecipitationFutureSnapshotEvidence = {
  id: number;
  locationKey: string;
  referenceAt: number;
  collectedAt: number;
  stationCount: number;
  precipitation: number | null;
  stationsUsed: unknown;
};

export type LocalPrecipitationOutcomeStatus =
  | "PENDING_FUTURE"
  | "MATCHED"
  | "UNAVAILABLE_NO_QUALIFIED_FUTURE_SNAPSHOT"
  | "UNAVAILABLE_FUTURE_SNAPSHOT_UNQUALIFIED"
  | "UNAVAILABLE_FUTURE_HOUR_AMBIGUOUS"
  | "UNAVAILABLE_FUTURE_HOUR_MISMATCH"
  | "UNAVAILABLE_EMISSION_AFTER_VALID_TIME"
  | "UNAVAILABLE_OBSERVATION_TIME_NOT_PROVEN"
  | "UNAVAILABLE_ACCUMULATION_WINDOW_UNKNOWN"
  | "UNAVAILABLE_SHADOW_ISOLATION_VIOLATION";

/** Terminal outcomes are never rewritten by a repeated normal snapshot pass. */
export function canTransitionLocalPrecipitationOutcome(
  currentStatus: LocalPrecipitationOutcomeStatus,
  nextStatus: LocalPrecipitationOutcomeStatus,
): boolean {
  return currentStatus === "PENDING_FUTURE" && nextStatus !== "PENDING_FUTURE";
}

export type LocalPrecipitationOutcomeEvidence = {
  emissionId: number;
  locationKey: string;
  validTime: number;
  horizonMinutes: number;
  outcomeStatus: LocalPrecipitationOutcomeStatus;
  futureSnapshotId: number | null;
  futureReferenceAt: number | null;
  futureCollectedAt: number | null;
  futureObservedAt: number | null;
  sourceObservationIds: number[];
  sourceObservations: LocalPrecipitationSourceObservation[];
  observedPrecipitation: number | null;
  observedWet: boolean | null;
  accumulationWindow: AccumulationWindowEvidence;
  unavailabilityReason: string | null;
  productionReadsEnabled: 0;
  shadowMode: 1;
  appliedToProduction: 0;
  evaluatedAt: number;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value: unknown): number | null {
  return finite(value) ? value : null;
}

function parseStationsUsed(value: unknown): LocalPrecipitationStationContribution[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((station): LocalPrecipitationStationContribution[] => {
    if (!station || typeof station !== "object") return [];
    const record = station as Record<string, unknown>;
    if (typeof record.stationId !== "string" || record.stationId.length === 0) return [];
    return [{ stationId: record.stationId, precipitation: numberOrNull(record.precipitation) }];
  });
}

export function makeLocalPrecipitationEmissionNaturalKey(input: {
  locationKey: string;
  observationReferenceAt: number;
  validTime: number;
}): string {
  return `${input.locationKey}|${input.observationReferenceAt}|${input.validTime}`;
}

function outcomeBase(
  emission: LocalPrecipitationEmissionEvidence,
  evaluatedAt: number,
  outcomeStatus: LocalPrecipitationOutcomeStatus,
  snapshot: LocalPrecipitationFutureSnapshotEvidence | null = null,
  sources: LocalPrecipitationSourceObservation[] = [],
  unavailabilityReason: string | null = null,
): LocalPrecipitationOutcomeEvidence {
  const sourceObservationIds = sources.map((source) => source.id);
  return {
    emissionId: emission.id,
    locationKey: emission.locationKey,
    validTime: emission.validTime,
    horizonMinutes: emission.horizonMinutes,
    outcomeStatus,
    futureSnapshotId: snapshot?.id ?? null,
    futureReferenceAt: snapshot?.referenceAt ?? null,
    futureCollectedAt: snapshot?.collectedAt ?? null,
    futureObservedAt: sources.length > 0 ? Math.max(...sources.map((source) => source.observedAt)) : null,
    sourceObservationIds,
    sourceObservations: sources,
    observedPrecipitation: snapshot ? numberOrNull(snapshot.precipitation) : null,
    observedWet: null,
    accumulationWindow: null,
    unavailabilityReason,
    productionReadsEnabled: 0,
    shadowMode: 1,
    appliedToProduction: 0,
    evaluatedAt,
  };
}

/**
 * Evaluates only a distinct future qualified snapshot. The reference snapshot's
 * precipitation is deliberately not an input to this function and can never be
 * reused as the future label.
 */
export function evaluateLocalPrecipitationNowcastOutcome(input: {
  emission: LocalPrecipitationEmissionEvidence;
  evaluationReferenceAt: number;
  futureSnapshot: LocalPrecipitationFutureSnapshotEvidence | null;
  sourceObservations: LocalPrecipitationSourceObservation[];
  evaluatedAt: number;
}): LocalPrecipitationOutcomeEvidence | null {
  const { emission, futureSnapshot, evaluatedAt } = input;
  if (!(LOCAL_PRECIPITATION_VERIFICATION_HORIZONS_MINUTES as readonly number[]).includes(emission.horizonMinutes)) return null;
  if (input.evaluationReferenceAt < emission.validTime) {
    return outcomeBase(emission, evaluatedAt, "PENDING_FUTURE");
  }
  if (emission.productionReadsEnabled !== 0 || emission.shadowMode !== 1 || emission.appliedToProduction !== 0) {
    return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_SHADOW_ISOLATION_VIOLATION", null, [], "SHADOW_WRITE_GUARDS_INVALID");
  }
  if (!futureSnapshot) {
    if (emission.availableAt >= emission.validTime || emission.emittedAt >= emission.validTime) {
      return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_EMISSION_AFTER_VALID_TIME", null, [], "CANDIDATE_NOT_AVAILABLE_BEFORE_VALID_TIME");
    }
    return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_NO_QUALIFIED_FUTURE_SNAPSHOT", null, [], "AUCUN_SNAPSHOT_FUTUR_QUALIFIE_A_L_ECHEANCE");
  }
  if (futureSnapshot.locationKey !== emission.locationKey || futureSnapshot.referenceAt !== emission.validTime) {
    return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_FUTURE_HOUR_MISMATCH", futureSnapshot, [], "LIEU_OU_ECHEANCE_FUTURE_NON_ALIGNE");
  }
  if (!finite(futureSnapshot.collectedAt) || futureSnapshot.stationCount < 1 || !finite(futureSnapshot.precipitation) || futureSnapshot.precipitation < 0) {
    return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_FUTURE_SNAPSHOT_UNQUALIFIED", futureSnapshot, [], "PRECIPITATION_FUTURE_NON_QUALIFIEE");
  }
  if (emission.availableAt >= emission.validTime || emission.emittedAt >= emission.validTime) {
    return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_EMISSION_AFTER_VALID_TIME", futureSnapshot, input.sourceObservations, "CANDIDATE_NOT_AVAILABLE_BEFORE_VALID_TIME");
  }

  const contributions = parseStationsUsed(futureSnapshot.stationsUsed)
    .filter((station) => finite(station.precipitation) && station.precipitation >= 0);
  const latestSourceByStation = new Map<string, LocalPrecipitationSourceObservation>();
  for (const source of input.sourceObservations) {
    if (!contributions.some((station) => station.stationId === source.stationId)) continue;
    const previous = latestSourceByStation.get(source.stationId);
    if (!previous || source.observedAt > previous.observedAt) latestSourceByStation.set(source.stationId, source);
  }
  const sourceEvidence = Array.from(latestSourceByStation.values());
  const timesProven = contributions.length > 0 && contributions.every((contribution) => {
    const source = latestSourceByStation.get(contribution.stationId);
    return !!source
      && source.precipitation === contribution.precipitation
      && finite(source.observedAt)
      && source.observedAt > emission.emittedAt
      && source.observedAt >= emission.validTime
      && finite(source.collectedAt)
      && source.collectedAt > emission.availableAt
      && source.collectedAt <= futureSnapshot.collectedAt;
  });
  if (!timesProven) {
    return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_OBSERVATION_TIME_NOT_PROVEN", futureSnapshot, sourceEvidence, "HORODATAGES_SOURCE_POST_EMISSION_ET_A_ECHEANCE_NON_PROUVES");
  }

  const forecastWindow = emission.forecastAccumulationWindow;
  const observationsHaveComparableWindow = contributions.every((contribution) => {
    const source = latestSourceByStation.get(contribution.stationId);
    const observedWindow = source?.accumulationWindow;
    return !!forecastWindow && !!observedWindow
      && forecastWindow.startAt === observedWindow.startAt
      && forecastWindow.endAt === observedWindow.endAt
      && forecastWindow.durationMinutes === observedWindow.durationMinutes;
  });
  if (!observationsHaveComparableWindow) {
    return outcomeBase(emission, evaluatedAt, "UNAVAILABLE_ACCUMULATION_WINDOW_UNKNOWN", futureSnapshot, sourceEvidence, "INTERVAL_D_ACCUMULATION_NON_ETABLI_OU_NON_COMPARABLE");
  }

  const matched = outcomeBase(emission, evaluatedAt, "MATCHED", futureSnapshot, sourceEvidence);
  matched.observedWet = futureSnapshot.precipitation >= LOCAL_PRECIPITATION_NOWCAST_WET_THRESHOLD_MM;
  matched.accumulationWindow = forecastWindow;
  return matched;
}

export type ConfusionMatrix = {
  pairCount: number;
  hit: number;
  miss: number;
  falseAlarm: number;
  correctRejection: number;
};

export type EmpiricalFrequency = {
  numerator: number;
  denominator: number;
  value: number | null;
};

export type LocalPrecipitationVerificationForecastSummary = {
  usedPairCount: number;
  matrix: ConfusionMatrix;
  pod: EmpiricalFrequency;
  far: EmpiricalFrequency;
  csi: EmpiricalFrequency;
};

export type LocalPrecipitationVerificationHorizonSummary = {
  horizonMinutes: LocalPrecipitationVerificationHorizon;
  label: "+1 h" | "+2 h";
  samplingUnit: "paires horaires";
  independentEpisodesDeduplicated: false;
  emissionCount: number;
  forecastComparableCount: number;
  futureSnapshotPairCount: number;
  usablePairCount: number;
  coverage: { numerator: number; denominator: number };
  pendingCount: number;
  unavailableOutcomeCount: number;
  outcomeStatusCounts: Record<string, number>;
  identicalForecastCount: number;
  differentForecastCount: number;
  noLocalAdditionExpected: boolean;
  baseline: LocalPrecipitationVerificationForecastSummary;
  candidate: LocalPrecipitationVerificationForecastSummary;
};

export type LocalPrecipitationVerificationReport = {
  schemaAvailable: boolean;
  unavailableReason: string | null;
  horizons: LocalPrecipitationVerificationHorizonSummary[];
  productionReadsEnabled: 0;
  appliedToProduction: 0;
  shadowModeViolations: number;
  valid: boolean;
};

function ratio(numerator: number, denominator: number): EmpiricalFrequency {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null };
}

function emptyMatrix(): ConfusionMatrix {
  return { pairCount: 0, hit: 0, miss: 0, falseAlarm: 0, correctRejection: 0 };
}

function summarizeForecast(
  pairs: Array<{ prediction: boolean; observed: boolean }>,
): LocalPrecipitationVerificationForecastSummary {
  const matrix = emptyMatrix();
  for (const pair of pairs) {
    matrix.pairCount++;
    if (pair.prediction && pair.observed) matrix.hit++;
    else if (!pair.prediction && pair.observed) matrix.miss++;
    else if (pair.prediction && !pair.observed) matrix.falseAlarm++;
    else matrix.correctRejection++;
  }
  return {
    usedPairCount: pairs.length,
    matrix,
    pod: ratio(matrix.hit, matrix.hit + matrix.miss),
    far: ratio(matrix.falseAlarm, matrix.hit + matrix.falseAlarm),
    csi: ratio(matrix.hit, matrix.hit + matrix.miss + matrix.falseAlarm),
  };
}

export function buildLocalPrecipitationVerificationReport(input: {
  emissions: LocalPrecipitationEmissionEvidence[];
  outcomes: LocalPrecipitationOutcomeEvidence[];
  nowAt?: number;
  schemaAvailable?: boolean;
  unavailableReason?: string | null;
}): LocalPrecipitationVerificationReport {
  const nowAt = input.nowAt ?? Date.now();
  const byEmission = new Map(input.outcomes.map((outcome) => [outcome.emissionId, outcome]));
  let shadowModeViolations = 0;
  for (const emission of input.emissions) {
    shadowModeViolations += Number(emission.productionReadsEnabled !== 0 || emission.shadowMode !== 1 || emission.appliedToProduction !== 0);
  }
  for (const outcome of input.outcomes) {
    shadowModeViolations += Number(outcome.productionReadsEnabled !== 0 || outcome.shadowMode !== 1 || outcome.appliedToProduction !== 0);
  }

  const horizons = LOCAL_PRECIPITATION_VERIFICATION_HORIZONS_MINUTES.map((horizonMinutes) => {
    const emissions = input.emissions.filter((emission) => emission.horizonMinutes === horizonMinutes);
    const outcomes = emissions.flatMap((emission) => {
      const outcome = byEmission.get(emission.id);
      return outcome ? [outcome] : [];
    });
    const statusCounts: Record<string, number> = {};
    for (const outcome of outcomes) statusCounts[outcome.outcomeStatus] = (statusCounts[outcome.outcomeStatus] ?? 0) + 1;
    const forecastComparableEmissions = emissions.filter((emission) => emission.validTime <= nowAt
      && emission.baselineWet != null && emission.candidateWet != null);
    const matchedPairs = forecastComparableEmissions.flatMap((emission) => {
      const outcome = byEmission.get(emission.id);
      if (!outcome || outcome.outcomeStatus !== "MATCHED" || outcome.observedWet == null
        || outcome.futureSnapshotId == null
        || outcome.futureReferenceAt !== emission.validTime
        || outcome.futureCollectedAt == null || outcome.futureCollectedAt <= emission.availableAt
        || outcome.futureObservedAt == null || outcome.futureObservedAt <= emission.emittedAt
        || outcome.futureObservedAt < emission.validTime
        || !emission.forecastAccumulationWindow || !outcome.accumulationWindow
        || emission.forecastAccumulationWindow.startAt !== outcome.accumulationWindow.startAt
        || emission.forecastAccumulationWindow.endAt !== outcome.accumulationWindow.endAt
        || emission.forecastAccumulationWindow.durationMinutes !== outcome.accumulationWindow.durationMinutes
        || emission.productionReadsEnabled !== 0 || emission.shadowMode !== 1 || emission.appliedToProduction !== 0
        || outcome.productionReadsEnabled !== 0 || outcome.shadowMode !== 1 || outcome.appliedToProduction !== 0) return [];
      return [{ emission, observed: outcome.observedWet }];
    });
    const baselinePairs = matchedPairs.flatMap(({ emission, observed }) => emission.baselineWet == null ? [] : [{ prediction: emission.baselineWet, observed }]);
    const candidatePairs = matchedPairs.flatMap(({ emission, observed }) => emission.candidateWet == null ? [] : [{ prediction: emission.candidateWet, observed }]);
    const identicalForecastCount = emissions.filter((emission) => emission.baselineWet != null && emission.candidateWet != null && emission.baselineWet === emission.candidateWet).length;
    const differentForecastCount = emissions.filter((emission) => emission.baselineWet != null && emission.candidateWet != null && emission.baselineWet !== emission.candidateWet).length;
    return {
      horizonMinutes,
      label: horizonMinutes === 60 ? "+1 h" as const : "+2 h" as const,
      samplingUnit: "paires horaires" as const,
      independentEpisodesDeduplicated: false as const,
      emissionCount: emissions.length,
      forecastComparableCount: forecastComparableEmissions.length,
      futureSnapshotPairCount: outcomes.filter((outcome) => outcome.futureSnapshotId != null && emissions.some((emission) =>
        emission.id === outcome.emissionId && outcome.futureReferenceAt === emission.validTime)).length,
      usablePairCount: matchedPairs.length,
      coverage: { numerator: matchedPairs.length, denominator: forecastComparableEmissions.length },
      pendingCount: statusCounts.PENDING_FUTURE ?? 0,
      unavailableOutcomeCount: outcomes.filter((outcome) => outcome.outcomeStatus.startsWith("UNAVAILABLE_")).length,
      outcomeStatusCounts: statusCounts,
      identicalForecastCount,
      differentForecastCount,
      noLocalAdditionExpected: horizonMinutes === 120,
      baseline: summarizeForecast(baselinePairs),
      candidate: summarizeForecast(candidatePairs),
    };
  });
  const schemaAvailable = input.schemaAvailable ?? true;
  return {
    schemaAvailable,
    unavailableReason: input.unavailableReason ?? null,
    horizons,
    productionReadsEnabled: 0,
    appliedToProduction: 0,
    shadowModeViolations,
    valid: schemaAvailable && shadowModeViolations === 0,
  };
}
