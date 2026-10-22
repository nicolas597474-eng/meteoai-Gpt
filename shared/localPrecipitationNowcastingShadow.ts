export const LOCAL_PRECIPITATION_NOWCASTING_SHADOW_VERSION = "local-precipitation-nowcasting-shadow-v1" as const;

/**
 * Precipitation readings from the available physical stations do not preserve a
 * universally comparable accumulation interval. The module therefore emits a
 * short-lived occurrence signal, never an adjusted millimetre amount.
 */
export const LOCAL_PRECIPITATION_NOWCAST_WET_THRESHOLD_MM = 0.1;
export const LOCAL_PRECIPITATION_NOWCAST_MAX_OBSERVATION_AGE_MINUTES = 90;
export const LOCAL_PRECIPITATION_NOWCAST_CONTINUATION = Object.freeze([
  1,
  0.5,
  0,
] as const);

export type LocalPrecipitationNowcastStatus =
  | "WET_SIGNAL"
  | "BASELINE_WET"
  | "BASELINE_DRY"
  | "STALE_OBSERVATION"
  | "UNAVAILABLE"
  | "LEAKAGE_BLOCKED";

export type LocalPrecipitationNowcastInput = {
  baselinePrecipitation: number | null;
  observedPrecipitation: number | null;
  observationReferenceAt: number | null;
  forecastAvailableAt: number | null;
  validTime: number;
  evaluatedAt: number;
  stationCount: number;
  confidenceScore: number | null;
};

export type LocalPrecipitationNowcastResult = {
  status: LocalPrecipitationNowcastStatus;
  horizonMinutes: number | null;
  continuationFactor: number;
  baselinePrecipitation: number | null;
  observedPrecipitation: number | null;
  baselineWet: boolean | null;
  observedWet: boolean | null;
  localWetSignal: boolean;
  reasons: string[];
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function rounded(value: number): number {
  const result = Math.round(value * 100) / 100;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Builds a categorical, leakage-safe local precipitation nowcast. It never
 * changes the baseline amount in millimetres: a wet physical observation can
 * only add a short-lived occurrence signal when the archived model baseline is dry.
 */
export function calculateLocalPrecipitationNowcast(input: LocalPrecipitationNowcastInput): LocalPrecipitationNowcastResult {
  const reasons: string[] = [];
  if (!finite(input.observationReferenceAt) || !finite(input.validTime) || !finite(input.evaluatedAt)) {
    return {
      status: "UNAVAILABLE", horizonMinutes: null, continuationFactor: 0,
      baselinePrecipitation: finite(input.baselinePrecipitation) ? rounded(input.baselinePrecipitation) : null,
      observedPrecipitation: finite(input.observedPrecipitation) ? rounded(input.observedPrecipitation) : null,
      baselineWet: null, observedWet: null, localWetSignal: false,
      reasons: ["HORODATAGE_OBSERVATION_INEXPLOITABLE"],
    };
  }

  const horizonMinutes = Math.round((input.validTime - input.observationReferenceAt) / 60_000);
  if (horizonMinutes < 0 || horizonMinutes > 2 * 60) {
    return {
      status: "UNAVAILABLE", horizonMinutes, continuationFactor: 0,
      baselinePrecipitation: finite(input.baselinePrecipitation) ? rounded(input.baselinePrecipitation) : null,
      observedPrecipitation: finite(input.observedPrecipitation) ? rounded(input.observedPrecipitation) : null,
      baselineWet: null, observedWet: null, localWetSignal: false,
      reasons: ["HORIZON_HORS_FENETRE_0_2H"],
    };
  }

  if (!finite(input.observedPrecipitation) || input.stationCount < 1) reasons.push("OBSERVATION_PHYSIQUE_PRECIPITATION_NON_QUALIFIEE");
  if (!finite(input.baselinePrecipitation)) reasons.push("PREVISION_HORAIRE_PRECIPITATION_INDISPONIBLE");
  if (!finite(input.forecastAvailableAt)) reasons.push("HEURE_DISPONIBILITE_PREVISION_INDISPONIBLE");
  if (reasons.length > 0) {
    return {
      status: "UNAVAILABLE", horizonMinutes, continuationFactor: 0,
      baselinePrecipitation: finite(input.baselinePrecipitation) ? rounded(input.baselinePrecipitation) : null,
      observedPrecipitation: finite(input.observedPrecipitation) ? rounded(input.observedPrecipitation) : null,
      baselineWet: null, observedWet: null, localWetSignal: false,
      reasons,
    };
  }

  const baselinePrecipitation = input.baselinePrecipitation as number;
  const observedPrecipitation = input.observedPrecipitation as number;
  const forecastAvailableAt = input.forecastAvailableAt as number;
  const baselineWet = baselinePrecipitation >= LOCAL_PRECIPITATION_NOWCAST_WET_THRESHOLD_MM;
  const observedWet = observedPrecipitation >= LOCAL_PRECIPITATION_NOWCAST_WET_THRESHOLD_MM;

  if (forecastAvailableAt > input.observationReferenceAt) {
    return {
      status: "LEAKAGE_BLOCKED", horizonMinutes, continuationFactor: 0,
      baselinePrecipitation: rounded(baselinePrecipitation), observedPrecipitation: rounded(observedPrecipitation),
      baselineWet, observedWet, localWetSignal: false,
      reasons: ["PREVISION_DISPONIBLE_APRES_OBSERVATION"],
    };
  }

  const observationAgeMinutes = Math.max(0, (input.evaluatedAt - input.observationReferenceAt) / 60_000);
  if (observationAgeMinutes > LOCAL_PRECIPITATION_NOWCAST_MAX_OBSERVATION_AGE_MINUTES) {
    return {
      status: "STALE_OBSERVATION", horizonMinutes, continuationFactor: 0,
      baselinePrecipitation: rounded(baselinePrecipitation), observedPrecipitation: rounded(observedPrecipitation),
      baselineWet, observedWet, localWetSignal: false,
      reasons: ["OBSERVATION_PLUS_DE_90_MINUTES"],
    };
  }

  const horizonHour = Math.round(horizonMinutes / 60);
  const continuationFactor = LOCAL_PRECIPITATION_NOWCAST_CONTINUATION[horizonHour] ?? 0;
  // A dry station reading never cancels model precipitation: point observations
  // are spatially sparse and are not sufficient to infer an absence of rain.
  const localWetSignal = observedWet && !baselineWet && continuationFactor > 0;
  const status: LocalPrecipitationNowcastStatus = localWetSignal
    ? "WET_SIGNAL"
    : baselineWet
      ? "BASELINE_WET"
      : "BASELINE_DRY";

  return {
    status,
    horizonMinutes,
    continuationFactor,
    baselinePrecipitation: rounded(baselinePrecipitation),
    observedPrecipitation: rounded(observedPrecipitation),
    baselineWet,
    observedWet,
    localWetSignal,
    reasons: [
      "MONTANT_MM_NON_CORRIGE",
      ...(observedWet && !baselineWet ? [continuationFactor > 0 ? "SIGNAL_LOCAL_HUMIDE_TEMPORAIRE" : "SIGNAL_LOCAL_EXPIRE_A_2H"] : []),
      ...(!observedWet && baselineWet ? ["OBSERVATION_SECHE_NE_SUPPRIME_PAS_LA_PLUIE_MODELISEE"] : []),
      ...(input.confidenceScore == null ? ["CONFIANCE_STATION_NON_QUANTIFIEE"] : []),
    ],
  };
}
