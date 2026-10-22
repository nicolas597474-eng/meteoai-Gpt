import { describe, expect, it } from "vitest";
import {
  buildLocalPrecipitationVerificationReport,
  canTransitionLocalPrecipitationOutcome,
  evaluateLocalPrecipitationNowcastOutcome,
  makeLocalPrecipitationEmissionNaturalKey,
  type LocalPrecipitationEmissionEvidence,
  type LocalPrecipitationFutureSnapshotEvidence,
  type LocalPrecipitationOutcomeEvidence,
  type LocalPrecipitationSourceObservation,
} from "../shared/localPrecipitationNowcastVerification";

const referenceAt = Date.UTC(2026, 9, 1, 10);
const emittedAt = referenceAt + 5 * 60_000;
const validTime = referenceAt + 60 * 60_000;

function emission(overrides: Partial<LocalPrecipitationEmissionEvidence> = {}): LocalPrecipitationEmissionEvidence {
  return {
    id: 101,
    locationKey: "50.756_2.521",
    observationReferenceAt: referenceAt,
    emittedAt,
    availableAt: emittedAt,
    validTime,
    horizonMinutes: 60,
    baselineWet: false,
    candidateWet: true,
    forecastAccumulationWindow: null,
    productionReadsEnabled: 0,
    shadowMode: 1,
    appliedToProduction: 0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<LocalPrecipitationFutureSnapshotEvidence> = {}): LocalPrecipitationFutureSnapshotEvidence {
  return {
    id: 202,
    locationKey: "50.756_2.521",
    referenceAt: validTime,
    collectedAt: validTime + 8 * 60_000,
    stationCount: 1,
    precipitation: 0.4,
    stationsUsed: [{ stationId: "station-a", precipitation: 0.4 }],
    ...overrides,
  };
}

function source(overrides: Partial<LocalPrecipitationSourceObservation> = {}): LocalPrecipitationSourceObservation {
  return {
    id: 303,
    stationId: "station-a",
    observedAt: validTime + 1_000,
    collectedAt: validTime + 5 * 60_000,
    precipitation: 0.4,
    ...overrides,
  };
}

describe("évaluation shadow future du nowcasting pluie", () => {
  it("ne confond jamais la pluie du snapshot de référence avec un label futur", () => {
    const result = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission(),
      evaluationReferenceAt: validTime,
      futureSnapshot: snapshot(),
      sourceObservations: [source({ observedAt: referenceAt, collectedAt: emittedAt - 1 })],
      evaluatedAt: validTime + 10 * 60_000,
    });

    expect(result?.outcomeStatus).toBe("UNAVAILABLE_OBSERVATION_TIME_NOT_PROVEN");
    expect(result?.observedWet).toBeNull();
    expect(result?.futureSnapshotId).toBe(202);
  });

  it("exige une mesure source postérieure à l’émission et à l’échéance", () => {
    const beforeEmission = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission(), evaluationReferenceAt: validTime, futureSnapshot: snapshot(),
      sourceObservations: [source({ observedAt: emittedAt, collectedAt: validTime + 1 })], evaluatedAt: validTime + 10,
    });
    const beforeHorizon = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission(), evaluationReferenceAt: validTime, futureSnapshot: snapshot(),
      sourceObservations: [source({ observedAt: validTime - 1, collectedAt: validTime + 1 })], evaluatedAt: validTime + 10,
    });

    expect(beforeEmission?.outcomeStatus).toBe("UNAVAILABLE_OBSERVATION_TIME_NOT_PROVEN");
    expect(beforeHorizon?.outcomeStatus).toBe("UNAVAILABLE_OBSERVATION_TIME_NOT_PROVEN");
  });

  it("garde le snapshot futur apparié mais rend le label indisponible sans fenêtre d’accumulation comparable", () => {
    const result = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission(), evaluationReferenceAt: validTime, futureSnapshot: snapshot(),
      sourceObservations: [source()], evaluatedAt: validTime + 10 * 60_000,
    });

    expect(result?.outcomeStatus).toBe("UNAVAILABLE_ACCUMULATION_WINDOW_UNKNOWN");
    expect(result?.futureSnapshotId).toBe(202);
    expect(result?.sourceObservationIds).toEqual([303]);
    expect(result?.observedPrecipitation).toBe(0.4);
    expect(result?.observedWet).toBeNull();
  });

  it("ne score une paire que si les fenêtres de prévision et de toutes les stations sont exactement identiques", () => {
    const window = { startAt: validTime - 60 * 60_000, endAt: validTime, durationMinutes: 60 };
    const comparable = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission({ forecastAccumulationWindow: window }),
      evaluationReferenceAt: validTime,
      futureSnapshot: snapshot(),
      sourceObservations: [source({ observedAt: validTime, accumulationWindow: window })],
      evaluatedAt: validTime + 10 * 60_000,
    });
    const mismatched = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission({ forecastAccumulationWindow: window }),
      evaluationReferenceAt: validTime,
      futureSnapshot: snapshot(),
      sourceObservations: [source({
        observedAt: validTime,
        accumulationWindow: { ...window, startAt: window.startAt + 1, durationMinutes: 59 },
      })],
      evaluatedAt: validTime + 10 * 60_000,
    });

    expect(comparable?.outcomeStatus).toBe("MATCHED");
    expect(comparable?.observedWet).toBe(true);
    expect(comparable?.accumulationWindow).toEqual(window);
    expect(mismatched?.outcomeStatus).toBe("UNAVAILABLE_ACCUMULATION_WINDOW_UNKNOWN");
    expect(mismatched?.observedWet).toBeNull();
  });

  it("n’évalue pas avant l’échéance, puis marque indisponible l’absence de snapshot futur qualifié", () => {
    const pending = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission(), evaluationReferenceAt: validTime - 1, futureSnapshot: null,
      sourceObservations: [], evaluatedAt: validTime - 1,
    });
    const missing = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission(), evaluationReferenceAt: validTime + 60_000, futureSnapshot: null,
      sourceObservations: [], evaluatedAt: validTime + 60_000,
    });

    expect(pending?.outcomeStatus).toBe("PENDING_FUTURE");
    expect(missing?.outcomeStatus).toBe("UNAVAILABLE_NO_QUALIFIED_FUTURE_SNAPSHOT");
  });

  it("exclut une émission tardive, un horizon 0 h et toute violation du mode shadow", () => {
    const late = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission({ emittedAt: validTime, availableAt: validTime }),
      evaluationReferenceAt: validTime, futureSnapshot: snapshot(), sourceObservations: [source()], evaluatedAt: validTime,
    });
    const horizonZero = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission({ horizonMinutes: 0 }), evaluationReferenceAt: validTime,
      futureSnapshot: snapshot(), sourceObservations: [source()], evaluatedAt: validTime,
    });
    const unsafe = evaluateLocalPrecipitationNowcastOutcome({
      emission: emission({ appliedToProduction: 1 }), evaluationReferenceAt: validTime,
      futureSnapshot: snapshot(), sourceObservations: [source()], evaluatedAt: validTime,
    });

    expect(late?.outcomeStatus).toBe("UNAVAILABLE_EMISSION_AFTER_VALID_TIME");
    expect(late?.futureSnapshotId).toBe(202);
    expect(late?.sourceObservationIds).toEqual([303]);
    expect(horizonZero).toBeNull();
    expect(unsafe?.outcomeStatus).toBe("UNAVAILABLE_SHADOW_ISOLATION_VIOLATION");
  });

  it("génère une clé naturelle stable pour rendre l’archivage des émissions idempotent", () => {
    const key = { locationKey: "50.756_2.521", observationReferenceAt: referenceAt, validTime };
    expect(makeLocalPrecipitationEmissionNaturalKey(key)).toBe(makeLocalPrecipitationEmissionNaturalKey({ ...key }));
  });

  it("finalise une issue pending une fois, sans réécrire un résultat terminal lors d’un passage répété", () => {
    expect(canTransitionLocalPrecipitationOutcome("PENDING_FUTURE", "UNAVAILABLE_ACCUMULATION_WINDOW_UNKNOWN")).toBe(true);
    expect(canTransitionLocalPrecipitationOutcome("UNAVAILABLE_ACCUMULATION_WINDOW_UNKNOWN", "MATCHED")).toBe(false);
    expect(canTransitionLocalPrecipitationOutcome("PENDING_FUTURE", "PENDING_FUTURE")).toBe(false);
  });
});

describe("matrices descriptives par horizon", () => {
  it("compte les hits, misses, fausses alertes et rejets corrects avec un dénominateur visible", () => {
    const emissions = [
      emission({ id: 1, horizonMinutes: 60, baselineWet: true, candidateWet: true, forecastAccumulationWindow: { startAt: validTime, endAt: validTime + 60 * 60_000, durationMinutes: 60 } }),
      emission({ id: 2, horizonMinutes: 60, baselineWet: false, candidateWet: true, forecastAccumulationWindow: { startAt: validTime, endAt: validTime + 60 * 60_000, durationMinutes: 60 } }),
      emission({ id: 3, horizonMinutes: 60, baselineWet: false, candidateWet: false, forecastAccumulationWindow: { startAt: validTime, endAt: validTime + 60 * 60_000, durationMinutes: 60 } }),
      emission({ id: 4, horizonMinutes: 60, baselineWet: true, candidateWet: false, forecastAccumulationWindow: { startAt: validTime, endAt: validTime + 60 * 60_000, durationMinutes: 60 } }),
    ];
    const outcomes: LocalPrecipitationOutcomeEvidence[] = [true, false, false, true].map((observedWet, index) => ({
      emissionId: index + 1,
      locationKey: "50.756_2.521",
      validTime,
      horizonMinutes: 60,
      outcomeStatus: "MATCHED",
      futureSnapshotId: 200 + index,
      futureReferenceAt: validTime,
      futureCollectedAt: validTime + 1,
      futureObservedAt: validTime + 1,
      sourceObservationIds: [300 + index],
      sourceObservations: [],
      observedPrecipitation: observedWet ? 0.4 : 0,
      observedWet,
      accumulationWindow: { startAt: validTime, endAt: validTime + 60 * 60_000, durationMinutes: 60 },
      unavailabilityReason: null,
      productionReadsEnabled: 0,
      shadowMode: 1,
      appliedToProduction: 0,
      evaluatedAt: validTime + 2,
    }));

    const report = buildLocalPrecipitationVerificationReport({ emissions, outcomes });
    const horizon = report.horizons[0];

    expect(horizon.emissionCount).toBe(4);
    expect(horizon.futureSnapshotPairCount).toBe(4);
    expect(horizon.usablePairCount).toBe(4);
    expect(horizon.coverage).toEqual({ numerator: 4, denominator: 4 });
    expect(horizon.baseline.matrix).toEqual({ pairCount: 4, hit: 2, miss: 0, falseAlarm: 0, correctRejection: 2 });
    expect(horizon.candidate.matrix).toEqual({ pairCount: 4, hit: 1, miss: 1, falseAlarm: 1, correctRejection: 1 });
    expect(horizon.candidate.pod).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(horizon.candidate.far).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(horizon.candidate.csi).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(horizon.samplingUnit).toBe("paires horaires");
    expect(horizon.independentEpisodesDeduplicated).toBe(false);
  });

  it("n’agrège pas les horizons et signale +2 h identique au baseline quand il n’y a aucun ajout local", () => {
    const emissions = [
      emission({ id: 11, horizonMinutes: 60, baselineWet: false, candidateWet: true }),
      emission({ id: 12, horizonMinutes: 120, validTime: referenceAt + 120 * 60_000, baselineWet: false, candidateWet: false }),
    ];
    const report = buildLocalPrecipitationVerificationReport({ emissions, outcomes: [] });

    expect(report.horizons.map((horizon) => horizon.label)).toEqual(["+1 h", "+2 h"]);
    expect(report.horizons[0].emissionCount).toBe(1);
    expect(report.horizons[1].emissionCount).toBe(1);
    expect(report.horizons[1].noLocalAdditionExpected).toBe(true);
    expect(report.horizons[1].identicalForecastCount).toBe(1);
    expect(report.horizons[1].candidate.pod.value).toBeNull();
  });
});
