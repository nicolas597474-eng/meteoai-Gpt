import { PRECIPITATION_RAIN_THRESHOLD_MM } from "./precipitationConsensus";

export const DailyAgreementVariableKeys = [
  "tempMax",
  "tempMin",
  "precipitation",
  "windSpeed",
  "windGust",
  "humidity",
  "cloudCover",
] as const;

export type DailyAgreementVariable = (typeof DailyAgreementVariableKeys)[number];

export type DailyAgreementInput = {
  modelName: string;
} & Partial<Record<DailyAgreementVariable, unknown>>;

export type DailyAgreementMeasure = {
  min: number | null;
  max: number | null;
  mean: number | null;
  /** max - min, unavailable unless at least two independent models returned a value. */
  range: number | null;
  /** Population standard deviation; unavailable unless at least two models returned a value. */
  standardDeviation: number | null;
  availableModelCount: number;
  modelsWithData: readonly string[];
};

export type DailyPrecipitationOccurrence = {
  thresholdMm: typeof PRECIPITATION_RAIN_THRESHOLD_MM;
  rainModelCount: number;
  availableModelCount: number;
  expectedModelCount: number;
  modelsPredictingRain: readonly string[];
};

export type DailyModelAgreement = {
  source: "independent_named_models";
  bestMatchIncluded: false;
  expectedModelCount: number;
  modelsExpected: readonly string[];
  /** Calendar-day offset in the requested forecast payload, not the upstream model issue time. */
  requestDayOffset: number | null;
  /** The provider payload does not archive an independent issue timestamp per daily model. */
  modelIssueTimeAvailable: false;
  horizonUnavailableReason: "run_issue_time_missing";
  statisticsBasis: "received_values_for_target_day";
  commonRunVerified: false;
  tempMax: DailyAgreementMeasure;
  tempMin: DailyAgreementMeasure;
  /** Amount range over every available named model, including genuine 0 mm values. */
  precipitation: DailyAgreementMeasure;
  /** Conditional amount dispersion using only models at or above the existing rain threshold. */
  precipitationWetAmounts: DailyAgreementMeasure;
  precipitationOccurrence: DailyPrecipitationOccurrence;
  windSpeed: DailyAgreementMeasure;
  windGust: DailyAgreementMeasure;
  humidity: DailyAgreementMeasure;
  cloudCover: DailyAgreementMeasure;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function summarizeValues(values: Array<{ modelName: string; value: number }>): DailyAgreementMeasure {
  const sorted = [...values].sort((left, right) => left.value - right.value || left.modelName.localeCompare(right.modelName));
  const numericValues = sorted.map(({ value }) => value);
  const availableModelCount = numericValues.length;
  const min = numericValues[0] ?? null;
  const max = numericValues.at(-1) ?? null;
  const mean = availableModelCount > 0
    ? numericValues.reduce((sum, value) => sum + value, 0) / availableModelCount
    : null;

  return {
    min,
    max,
    mean,
    range: availableModelCount >= 2 && min != null && max != null ? max - min : null,
    standardDeviation: availableModelCount >= 2 && mean != null
      ? Math.sqrt(numericValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / availableModelCount)
      : null,
    availableModelCount,
    modelsWithData: sorted.map(({ modelName }) => modelName),
  };
}

/**
 * Summarize physical-unit ranges without normalizing them into a score.
 * Aggregators (including Open-Meteo Best Match) are excluded by the caller's
 * explicit named-model allowlist; missing values never become zero-width ranges.
 */
export function summarizeDailyModelAgreement(
  input: readonly DailyAgreementInput[],
  expectedModelNames: readonly string[],
  requestDayOffset: number | null,
): DailyModelAgreement {
  const modelsExpected = Array.from(new Set(expectedModelNames));
  const expected = new Set(modelsExpected);
  const byModel = new Map<string, DailyAgreementInput>();
  for (const forecast of input) {
    if (!expected.has(forecast.modelName) || byModel.has(forecast.modelName)) continue;
    byModel.set(forecast.modelName, forecast);
  }

  const valuesFor = (variable: DailyAgreementVariable) => Array.from(byModel.entries())
    .flatMap(([modelName, forecast]) => finite(forecast[variable])
      ? [{ modelName, value: forecast[variable] }]
      : []);
  // Description des valeurs reçues pour le même jour cible. Aucun cycle commun,
  // horizon d'émission ni niveau de fiabilité historique n'est déduit de ces nombres.
  const summarize = (variable: DailyAgreementVariable): DailyAgreementMeasure => summarizeValues(valuesFor(variable));
  const precipitationValues = valuesFor("precipitation").filter(({ value }) => value >= PRECIPITATION_RAIN_THRESHOLD_MM);
  const precipitationAvailableModelCount = valuesFor("precipitation").length;

  return {
    source: "independent_named_models",
    bestMatchIncluded: false,
    expectedModelCount: modelsExpected.length,
    modelsExpected,
    requestDayOffset: Number.isInteger(requestDayOffset) && requestDayOffset! >= 0 ? requestDayOffset : null,
    modelIssueTimeAvailable: false,
    horizonUnavailableReason: "run_issue_time_missing",
    statisticsBasis: "received_values_for_target_day",
    commonRunVerified: false,
    tempMax: summarize("tempMax"),
    tempMin: summarize("tempMin"),
    precipitation: summarize("precipitation"),
    precipitationWetAmounts: summarizeValues(precipitationValues),
    precipitationOccurrence: {
      thresholdMm: PRECIPITATION_RAIN_THRESHOLD_MM,
      rainModelCount: precipitationValues.length,
      availableModelCount: precipitationAvailableModelCount,
      expectedModelCount: modelsExpected.length,
      modelsPredictingRain: precipitationValues.map(({ modelName }) => modelName),
    },
    windSpeed: summarize("windSpeed"),
    windGust: summarize("windGust"),
    humidity: summarize("humidity"),
    cloudCover: summarize("cloudCover"),
  };
}
