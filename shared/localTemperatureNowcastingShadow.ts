export const LOCAL_TEMPERATURE_NOWCASTING_SHADOW_VERSION = "local-temperature-nowcasting-shadow-v1" as const;

/**
 * All corrections are temporary. The physical residual is fully applied at the
 * observation hour, fades monotonically, and is exactly zero at +6 hours.
 */
export const LOCAL_TEMPERATURE_NOWCAST_DECAY = Object.freeze([
  1,
  0.75,
  0.55,
  0.35,
  0.15,
  0.05,
  0,
] as const);

export const LOCAL_TEMPERATURE_NOWCAST_MAX_OBSERVATION_AGE_MINUTES = 90;
export const LOCAL_TEMPERATURE_NOWCAST_MAX_CORRECTION_C = 3;

export type LocalTemperatureNowcastStatus =
  | "READY"
  | "BASELINE_ONLY"
  | "STALE_OBSERVATION"
  | "UNAVAILABLE"
  | "LEAKAGE_BLOCKED";

export type LocalTemperatureNowcastInput = {
  baselineTemperature: number | null;
  observedTemperature: number | null;
  observationReferenceAt: number | null;
  forecastAvailableAt: number | null;
  validTime: number;
  evaluatedAt: number;
  stationCount: number;
  confidenceScore: number | null;
};

export type LocalTemperatureNowcastResult = {
  status: LocalTemperatureNowcastStatus;
  horizonMinutes: number | null;
  correctionFactor: number;
  baselineTemperature: number | null;
  observedTemperature: number | null;
  rawResidual: number | null;
  boundedResidual: number | null;
  appliedCorrection: number | null;
  correctedTemperature: number | null;
  correctionClamped: boolean;
  reasons: string[];
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function rounded(value: number) {
  const result = Math.round(value * 100) / 100;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Produces a temperature-only nowcast candidate from an already archived
 * official baseline and one qualified physical snapshot. This function has no
 * I/O and never substitutes a missing forecast with an equal-weight mean.
 */
export function calculateLocalTemperatureNowcast(input: LocalTemperatureNowcastInput): LocalTemperatureNowcastResult {
  const reasons: string[] = [];
  if (!finite(input.observationReferenceAt) || !finite(input.validTime) || !finite(input.evaluatedAt)) {
    return {
      status: "UNAVAILABLE", horizonMinutes: null, correctionFactor: 0,
      baselineTemperature: finite(input.baselineTemperature) ? input.baselineTemperature : null,
      observedTemperature: finite(input.observedTemperature) ? input.observedTemperature : null,
      rawResidual: null, boundedResidual: null, appliedCorrection: null, correctedTemperature: null,
      correctionClamped: false, reasons: ["HORODATAGE_OBSERVATION_INEXPLOITABLE"],
    };
  }
  const horizonMinutes = Math.round((input.validTime - input.observationReferenceAt) / 60_000);
  if (horizonMinutes < 0 || horizonMinutes > 6 * 60) {
    return {
      status: "UNAVAILABLE", horizonMinutes, correctionFactor: 0,
      baselineTemperature: finite(input.baselineTemperature) ? input.baselineTemperature : null,
      observedTemperature: finite(input.observedTemperature) ? input.observedTemperature : null,
      rawResidual: null, boundedResidual: null, appliedCorrection: null, correctedTemperature: null,
      correctionClamped: false, reasons: ["HORIZON_HORS_FENETRE_0_6H"],
    };
  }
  if (!finite(input.observedTemperature) || input.stationCount < 1) reasons.push("OBSERVATION_PHYSIQUE_NON_QUALIFIEE");
  if (!finite(input.baselineTemperature)) reasons.push("PREVISION_HORAIRE_OFFICIELLE_INDISPONIBLE");
  if (!finite(input.forecastAvailableAt)) reasons.push("HEURE_DISPONIBILITE_PREVISION_INDISPONIBLE");
  if (reasons.length > 0) {
    return {
      status: "UNAVAILABLE", horizonMinutes, correctionFactor: 0,
      baselineTemperature: finite(input.baselineTemperature) ? input.baselineTemperature : null,
      observedTemperature: finite(input.observedTemperature) ? input.observedTemperature : null,
      rawResidual: null, boundedResidual: null, appliedCorrection: null, correctedTemperature: null,
      correctionClamped: false, reasons,
    };
  }

  const baselineTemperature = input.baselineTemperature as number;
  const observedTemperature = input.observedTemperature as number;
  const forecastAvailableAt = input.forecastAvailableAt as number;
  if (forecastAvailableAt > input.observationReferenceAt) {
    return {
      status: "LEAKAGE_BLOCKED", horizonMinutes, correctionFactor: 0,
      baselineTemperature, observedTemperature,
      rawResidual: null, boundedResidual: null, appliedCorrection: null, correctedTemperature: null,
      correctionClamped: false, reasons: ["PREVISION_DISPONIBLE_APRES_OBSERVATION"],
    };
  }
  const observationAgeMinutes = Math.max(0, (input.evaluatedAt - input.observationReferenceAt) / 60_000);
  if (observationAgeMinutes > LOCAL_TEMPERATURE_NOWCAST_MAX_OBSERVATION_AGE_MINUTES) {
    return {
      status: "STALE_OBSERVATION", horizonMinutes, correctionFactor: 0,
      baselineTemperature, observedTemperature,
      rawResidual: null, boundedResidual: null, appliedCorrection: null, correctedTemperature: null,
      correctionClamped: false, reasons: ["OBSERVATION_PLUS_DE_90_MINUTES"],
    };
  }

  const horizonHour = Math.round(horizonMinutes / 60);
  const correctionFactor = LOCAL_TEMPERATURE_NOWCAST_DECAY[horizonHour] ?? 0;
  const rawResidual = observedTemperature - baselineTemperature;
  const boundedResidual = Math.max(-LOCAL_TEMPERATURE_NOWCAST_MAX_CORRECTION_C, Math.min(LOCAL_TEMPERATURE_NOWCAST_MAX_CORRECTION_C, rawResidual));
  const appliedCorrection = boundedResidual * correctionFactor;
  const correctionClamped = Math.abs(rawResidual - boundedResidual) > 1e-9;
  const status: LocalTemperatureNowcastStatus = correctionFactor === 0 ? "BASELINE_ONLY" : "READY";
  const statusReasons = [
    ...(correctionClamped ? ["CORRECTION_BORNEE_A_3C"] : []),
    ...(input.confidenceScore == null ? ["CONFIANCE_STATION_NON_QUANTIFIEE"] : []),
  ];
  return {
    status,
    horizonMinutes,
    correctionFactor,
    baselineTemperature: rounded(baselineTemperature),
    observedTemperature: rounded(observedTemperature),
    rawResidual: rounded(rawResidual),
    boundedResidual: rounded(boundedResidual),
    appliedCorrection: rounded(appliedCorrection),
    correctedTemperature: rounded(baselineTemperature + appliedCorrection),
    correctionClamped,
    reasons: statusReasons,
  };
}
