/** Seuil explicite de pluie utilisé pour compter un modèle comme pluvieux. */
export const PRECIPITATION_RAIN_THRESHOLD_MM = 0.1 as const;

export type PrecipitationConditionalMethod =
  | "arithmetic_mean"
  | "historical_skill"
  | "robust_fallback"
  | "unavailable";

export type PrecipitationModelValue = {
  modelName: string;
  amountMm: number;
  predictsRain: boolean;
};

/**
 * Fréquence brute et estimation de consensus calculées uniquement sur les
 * modèles nommés qui ont effectivement retourné une quantité finie et positive
 * ou nulle. Ce résultat n'est jamais une probabilité météorologique calibrée.
 */
export type PrecipitationModelConsensus = {
  thresholdMm: typeof PRECIPITATION_RAIN_THRESHOLD_MM;
  /** Models physically available for this variable and validTime. */
  expectedModelCount: number;
  modelsExpected: readonly string[];
  /** Static catalogue, shown for context only and never used as a scoring denominator. */
  configuredModelCount: number;
  modelsConfigured: readonly string[];
  availableModelCount: number;
  rainModelCount: number;
  /** Part brute des modèles disponibles au-dessus du seuil, sur une échelle 0–100. */
  frequencyPercent: number | null;
  /** Moyenne conditionnelle des modèles pluvieux, ou valeur pondérée qualifiée. */
  conditionalMeanMm: number | null;
  conditionalMeanMethod: PrecipitationConditionalMethod;
  /** frequencyPercent / 100 × conditionalMeanMm; estimation, jamais probabilité. */
  consensusEstimateMm: number | null;
  modelsWithData: readonly string[];
  modelsPredictingRain: readonly string[];
  /** Valeurs sources exactes prises en compte, pour permettre l'audit du calcul. */
  modelValues: readonly PrecipitationModelValue[];
  isProbabilityCalibrated: false;
};

export type PrecipitationInput = {
  modelName: string;
  amountMm: unknown;
};

export type PrecipitationConsensusOptions = {
  configuredModelNames?: readonly string[];
  /**
   * Remplace la moyenne arithmétique par une moyenne conditionnelle fournie,
   * par exemple lorsqu'elle est issue de poids historiques qualifiés ou d'un
   * fallback robuste. Ce consensus reste une estimation, jamais une probabilité.
   * Une valeur null explicite signifie qu'aucune estimation conditionnelle n'est disponible.
   */
  conditionalMeanMm?: number | null;
  conditionalMeanMethod?: PrecipitationConditionalMethod;
};

export function summarizePrecipitationModels(
  inputs: readonly PrecipitationInput[],
  expectedModelNames: readonly string[],
  options: PrecipitationConsensusOptions = {}
): PrecipitationModelConsensus {
  const modelsExpected = Array.from(new Set(expectedModelNames));
  const modelsConfigured = Array.from(new Set(options.configuredModelNames ?? modelsExpected));
  const expectedSet = new Set(modelsExpected);
  const inputByModel = new Map<string, number>();

  for (const input of inputs) {
    if (!expectedSet.has(input.modelName) || inputByModel.has(input.modelName))
      continue;
    if (
      typeof input.amountMm !== "number" ||
      !Number.isFinite(input.amountMm) ||
      input.amountMm < 0
    )
      continue;
    inputByModel.set(input.modelName, input.amountMm);
  }

  const modelValues = modelsExpected.flatMap(modelName => {
    const amountMm = inputByModel.get(modelName);
    return amountMm == null
      ? []
      : [
          {
            modelName,
            amountMm,
            predictsRain: amountMm >= PRECIPITATION_RAIN_THRESHOLD_MM,
          },
        ];
  });
  const modelsWithData = modelValues.map(({ modelName }) => modelName);
  const wetModelValues = modelValues.filter(({ predictsRain }) => predictsRain);
  const modelsPredictingRain = wetModelValues.map(({ modelName }) => modelName);
  const availableModelCount = modelValues.length;
  const rainModelCount = wetModelValues.length;
  const frequencyPercent =
    availableModelCount > 0
      ? (rainModelCount / availableModelCount) * 100
      : null;

  const hasConditionalOverride = Object.prototype.hasOwnProperty.call(
    options,
    "conditionalMeanMm"
  );
  const conditionalMeanMm =
    rainModelCount === 0
      ? null
      : hasConditionalOverride
        ? options.conditionalMeanMm != null &&
          Number.isFinite(options.conditionalMeanMm) &&
          options.conditionalMeanMm >= 0
          ? options.conditionalMeanMm
          : null
        : wetModelValues.reduce((sum, value) => sum + value.amountMm, 0) /
          rainModelCount;
  const conditionalMeanMethod: PrecipitationConditionalMethod =
    rainModelCount === 0
      ? "unavailable"
      : hasConditionalOverride
        ? conditionalMeanMm == null
          ? "unavailable"
          : (options.conditionalMeanMethod ?? "historical_skill")
        : "arithmetic_mean";
  const consensusEstimateMm =
    availableModelCount === 0
      ? null
      : rainModelCount === 0
        ? 0
        : conditionalMeanMm == null || frequencyPercent == null
          ? null
          : (frequencyPercent / 100) * conditionalMeanMm;

  return {
    thresholdMm: PRECIPITATION_RAIN_THRESHOLD_MM,
    expectedModelCount: modelsExpected.length,
    modelsExpected,
    configuredModelCount: modelsConfigured.length,
    modelsConfigured,
    availableModelCount,
    rainModelCount,
    frequencyPercent,
    conditionalMeanMm,
    conditionalMeanMethod,
    consensusEstimateMm,
    modelsWithData,
    modelsPredictingRain,
    modelValues,
    isProbabilityCalibrated: false,
  };
}
