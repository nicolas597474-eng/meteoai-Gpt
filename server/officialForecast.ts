import { computeFusion, type FusionResult, type FusionSource } from "./fusionEngine";
import { getDailyForecastHorizon } from "./dailyForecastPerformance";
import { getDailyForecastValidTime } from "./dailyForecastVerification";
import { OFFICIAL_HOURLY_MODELS, type ForecastData } from "./weatherServices";
import {
  getEvidenceIneligibilityReason,
  type DailyFusionMetric,
  type DailyFusionHorizon,
  type ModelPerformanceContext,
  type ModelPerformanceEvidence,
} from "./fusionPerformance";
import {
  PRECIPITATION_RAIN_THRESHOLD_MM,
  summarizePrecipitationModels,
  type PrecipitationModelConsensus,
} from "../shared/precipitationConsensus";
import { getModelCountCoverageLevel } from "../shared/modelCoverageConfidence";
import type {
  DailyForecastHorizon,
  DailyForecastCalibrationStatus,
  DailyFusionAvailabilityStatus,
  DailyFusionCoverageLevel,
  DailyFusionMetricDiagnostic,
  DailyFusionVariable,
} from "../shared/dailyForecast";
import {
  selectEligibleModelsForHorizon,
  type ForecastModelEligibilityDiagnostic,
  type SelectedForecastModel,
} from "./forecastModelSelection";

export type OfficialDailyForecastInput = Pick<ForecastData,
  "serviceName" | "tempMax" | "tempMin" | "precipitation" | "windSpeed" | "windGust" | "humidity" | "cloudCover"
> & Partial<Pick<ForecastData,
  "modelId" | "sourceName" | "runId" | "runIdKind" | "requestStartedAt" | "availableAt" | "validTime" | "qualityStatus"
>>;
export type DailyCalibrationStatus = DailyForecastCalibrationStatus;

type DailyVariable = DailyFusionVariable;
type DailyTraceKey = "tempMax" | "tempMin" | "precipitation" | "windSpeed" | "windGust" | "humidity" | "cloudCover";

type DailyMetricSpec = { key: DailyVariable; traceKey: DailyTraceKey };

export type OfficialDailyForecastOptions = {
  locationKey: string;
  targetDate: string;
  /** Compatibility field; for new callers this is the fusion/reference timestamp after collection. */
  issuedAt: number;
  referenceAt?: number;
  evidenceStoreAvailable: boolean;
  evidence: ModelPerformanceEvidence[];
  /** Collection-layer explanations for models which returned no run/value at this validTime. */
  availabilityReasonByModel?: Readonly<Record<string, string>>;
};

export type ForecastTraceSource = {
  id: string;
  name: string;
  type: "station" | "model" | "service";
  sourceName: string | null;
  modelId: string | null;
  runId: string | null;
  runIdKind: "capture" | "provider" | "unknown";
  availableAt: number | null;
  validTime: number | null;
  horizonMinutes: number | null;
  horizonBucket: DailyFusionHorizon | null;
  calibrationStatus: DailyCalibrationStatus;
  finalWeight: number;
  rawWeight: number | null;
  robustFallbackWeight: number | null;
  distanceKm: number;
  distanceWeight: number;
  qualityWeight: number;
  freshnessWeight: number;
  performanceWeight: number;
  sampleSize?: number;
  comparisonCount?: number;
  evaluatedDays?: number;
  mae?: number;
  rmse?: number;
  standardError?: number;
  /** Signed forecast-minus-observation error; diagnostic only, never applied. */
  signedBias?: number;
  latestScoreDate?: string;
  uncertaintyAdjustedMae?: number;
  regularizedMae?: number;
  sampleReliability?: number;
  variable: DailyVariable;
};

export type ForecastTrace = {
  version: 4;
  issuedAt: string;
  referenceAt: string;
  method: string;
  sourceCount: number;
  horizonBucket: DailyForecastHorizon | null;
  evidenceStoreAvailable: boolean;
  availabilityStatus: Record<DailyVariable, DailyFusionAvailabilityStatus>;
  calibrationStatus: Record<DailyTraceKey, DailyCalibrationStatus>;
  parameterSources: Record<DailyTraceKey, ForecastTraceSource[]>;
  eligibilityByVariable: Record<DailyVariable, ForecastModelEligibilityDiagnostic[]>;
  precipitationConsensus: PrecipitationModelConsensus;
  excludedSources: Array<{ id: string; name: string; reason: string }>;
};

const OFFICIAL_DAILY_MODEL_BY_NAME = new Map<string, (typeof OFFICIAL_HOURLY_MODELS)[number]>(
  OFFICIAL_HOURLY_MODELS.map((model) => [model.name, model]),
);
const DAILY_PRECIPITATION_MODEL_NAMES = OFFICIAL_HOURLY_MODELS.map((model) => model.name);
const METRICS: DailyMetricSpec[] = [
  { key: "temperature_max", traceKey: "tempMax" },
  { key: "temperature_min", traceKey: "tempMin" },
  { key: "precipitation_sum", traceKey: "precipitation" },
  { key: "wind_speed_max", traceKey: "windSpeed" },
  { key: "wind_gust_max", traceKey: "windGust" },
  { key: "humidity", traceKey: "humidity" },
  { key: "cloud_cover", traceKey: "cloudCover" },
];

function forecastValue(forecast: OfficialDailyForecastInput, metric: DailyVariable): number | null {
  const value = metric === "temperature_max" ? forecast.tempMax
    : metric === "temperature_min" ? forecast.tempMin
      : metric === "precipitation_sum" ? forecast.precipitation
        : metric === "wind_speed_max" ? forecast.windSpeed
          : metric === "wind_gust_max" ? forecast.windGust
            : metric === "humidity" ? forecast.humidity
              : forecast.cloudCover;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getAvailabilityStatus(count: number): DailyFusionAvailabilityStatus {
  return count >= 2 ? "FUSED" : count === 1 ? "SINGLE_MODEL" : "UNAVAILABLE";
}

function coverageLevel(count: number): DailyFusionCoverageLevel {
  return getModelCountCoverageLevel(count);
}

function traceCalibrationStatus(selectedCount: number, qualifiedCount: number): DailyCalibrationStatus {
  if (selectedCount === 0) return "UNAVAILABLE";
  if (qualifiedCount === selectedCount) return "CALIBRATED";
  if (qualifiedCount > 0) return "PARTIALLY_CALIBRATED";
  return "UNCALIBRATED_ROBUST";
}

function calibrationReason(
  modelName: string,
  selected: SelectedForecastModel<OfficialDailyForecastInput>,
  options: OfficialDailyForecastOptions,
  metric: DailyVariable,
): string {
  if (metric === "humidity" || metric === "cloud_cover") return "Aucune série d’observations physiques quotidienne ne qualifie cette variable; la valeur disponible est conservée avec le fallback robuste.";
  if (selected.horizonBucket == null) return "Valeur disponible, mais cet horizon n’a pas de tranche de calibration historisée; aucune tranche voisine n’est empruntée.";
  if (!options.evidenceStoreAvailable) return "Archive historique indisponible; la valeur reste disponible avec un poids robuste non calibré.";
  return `Aucune preuve qualifiée exacte modèle × lieu × variable × horizon pour ${modelName}; la valeur reste incluse avec le fallback robuste.`;
}

function toTraceSources(
  fusion: FusionResult,
  variable: DailyVariable,
  selectedByModel: ReadonlyMap<string, SelectedForecastModel<OfficialDailyForecastInput>>,
  evidenceEligibleModels: ReadonlySet<string>,
): ForecastTraceSource[] {
  return fusion.usedSources.map((source) => {
    const evidence = source.performanceEvidence;
    const selected = selectedByModel.get(source.name);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      sourceName: selected?.sourceName ?? null,
      modelId: selected?.modelId ?? null,
      runId: selected?.runId ?? null,
      runIdKind: selected?.runIdKind ?? "unknown",
      availableAt: selected?.availableAt ?? null,
      validTime: selected?.validTime ?? null,
      horizonMinutes: selected?.horizonMinutes ?? null,
      horizonBucket: selected?.horizonBucket as DailyForecastHorizon | null ?? null,
      calibrationStatus: evidenceEligibleModels.has(source.name) ? "CALIBRATED" : "UNCALIBRATED_ROBUST",
      finalWeight: source.finalWeight,
      rawWeight: source.rawWeight ?? null,
      robustFallbackWeight: source.robustFallbackWeight ?? null,
      distanceKm: source.distanceKm,
      distanceWeight: source.distanceWeight,
      qualityWeight: source.qualityWeight,
      freshnessWeight: source.freshnessWeight,
      performanceWeight: source.performanceWeight,
      ...(evidence ? {
        sampleSize: evidence.sampleSize,
        comparisonCount: evidence.comparisonCount,
        evaluatedDays: evidence.evaluatedDays,
        mae: evidence.mae,
        rmse: evidence.rmse,
        standardError: evidence.standardError,
        ...(typeof evidence.signedBias === "number" && Number.isFinite(evidence.signedBias) ? { signedBias: evidence.signedBias } : {}),
        latestScoreDate: evidence.latestScoreDate,
        uncertaintyAdjustedMae: source.uncertaintyAdjustedMae,
        regularizedMae: source.regularizedMae,
        sampleReliability: source.sampleReliability,
      } : {}),
      variable,
    };
  });
}

/** Official daily fusion: availability → exact run selection → historical reliability → robust weighting → renormalization → fusion. */
function computeOfficialDailyForecastInternal(
  forecasts: OfficialDailyForecastInput[],
  options: OfficialDailyForecastOptions,
) {
  const referenceAt = options.referenceAt ?? options.issuedAt;
  const validTime = getDailyForecastValidTime(options.targetDate);
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const officialForecasts = forecasts.filter((forecast) => OFFICIAL_DAILY_MODEL_BY_NAME.has(forecast.serviceName));
  const candidates = officialForecasts.flatMap((forecast) => {
    const model = OFFICIAL_DAILY_MODEL_BY_NAME.get(forecast.serviceName)!;
    const identityMatches = (forecast.modelId == null || forecast.modelId === model.modelId)
      && (forecast.sourceName == null || forecast.sourceName === "open-meteo");
    return [{
      modelName: forecast.serviceName,
      modelId: forecast.modelId ?? model.modelId,
      sourceName: forecast.sourceName ?? "open-meteo",
      runId: forecast.runId ?? null,
      runIdKind: forecast.runIdKind ?? "unknown",
      requestStartedAt: forecast.requestStartedAt ?? null,
      availableAt: forecast.availableAt ?? null,
      validTime: typeof forecast.validTime === "number" && Number.isFinite(forecast.validTime) ? forecast.validTime : validTime,
      value: forecastValue(forecast, "temperature_max"),
      qualityStatus: identityMatches ? forecast.qualityStatus ?? "unknown" : "rejected" as const,
      qualityReason: identityMatches ? undefined : "Le nom du modèle, modelId ou source ne correspond pas au catalogue officiel.",
      metadata: forecast,
    }];
  });

  const selections = new Map<DailyVariable, ReturnType<typeof selectEligibleModelsForHorizon<OfficialDailyForecastInput>>>();
  const fusions = new Map<DailyVariable, FusionResult>();
  const qualifiedByVariable = new Map<DailyVariable, Set<string>>();
  const sourceByVariable = new Map<DailyVariable, Map<string, SelectedForecastModel<OfficialDailyForecastInput>>>();
  const config = {
    idwExponent: 2,
    maxDistanceKm: 5,
    // Daily forecasts are values from a newly received provider payload; availability is
    // checked explicitly below, while freshness only adjusts rather than rejects weight.
    maxFreshnessMin: 15 * 24 * 60,
    minReliabilityScore: 0,
    anomalyDetectionEnabled: false,
    adaptiveWeightingEnabled: true,
    modelWeightFraction: 1,
    allowRobustUncalibratedModels: true,
    referenceAt,
  };

  const diagnosticsByVariable = {} as Record<DailyVariable, DailyFusionMetricDiagnostic>;
  for (const { key } of METRICS) {
    const selection = validTime == null
      ? { eligible: [], diagnostics: OFFICIAL_HOURLY_MODELS.map((model) => ({
          modelName: model.name,
          variable: key,
          eligible: false,
          reason: "La date cible ne produit pas de validTime journalier Paris valide.",
          sourceName: "open-meteo",
          modelId: model.modelId,
          runId: null,
          availableAt: null,
          validTime: null,
          horizonMinutes: null,
          horizonBucket: null,
        })) }
      : selectEligibleModelsForHorizon(candidates.map((candidate) => ({
          ...candidate,
          value: (() => {
            const value = forecastValue(candidate.metadata, key);
            return key === "precipitation_sum" && value != null && value < 0 ? null : value;
          })(),
        })), {
          expectedModelNames: DAILY_PRECIPITATION_MODEL_NAMES,
          variable: key,
          validTime,
          referenceAt,
          horizonBucketForMinutes: (minutes) => getDailyForecastHorizon(validTime - minutes * 60_000, options.targetDate)?.bucket as DailyFusionHorizon | undefined ?? null,
          allowUnscoredHorizons: true,
          missingReasonByModel: options.availabilityReasonByModel,
        });
    selections.set(key, selection);
    const selectedByModel = new Map(selection.eligible.map((item) => [item.modelName, item]));
    sourceByVariable.set(key, selectedByModel);

    const isHistoricalMetric = key !== "humidity" && key !== "cloud_cover";
    const qualifiedModels = new Set<string>();
    const sourceInputs: FusionSource[] = selection.eligible.map((selected) => {
      const matchingEvidence = isHistoricalMetric && selected.horizonBucket != null
        ? evidence.find((item) => item.serviceName === selected.modelName
          && item.modelId === selected.modelId
          && item.locationKey === options.locationKey
          && item.variable === key
          && item.horizonBucket === selected.horizonBucket) ?? null
        : null;
      const context: ModelPerformanceContext | undefined = isHistoricalMetric && selected.horizonBucket != null
        ? { locationKey: options.locationKey, variable: key as DailyFusionMetric, horizonBucket: selected.horizonBucket as DailyFusionHorizon }
        : undefined;
      if (context && matchingEvidence
        && getEvidenceIneligibilityReason(matchingEvidence, context, new Date(referenceAt)) == null
        && matchingEvidence.serviceName === selected.modelName
        && matchingEvidence.modelId === selected.modelId) qualifiedModels.add(selected.modelName);
      return {
        id: `model:${selected.modelName}`,
        name: selected.modelName,
        modelId: selected.modelId,
        distanceKm: 1,
        temperature: selected.value,
        updatedAt: new Date(selected.availableAt!),
        reliabilityScore: 50,
        performanceEvidence: matchingEvidence,
        ...(context ? { performanceContext: context } : {}),
        type: "model" as const,
      };
    });
    qualifiedByVariable.set(key, qualifiedModels);

    const modelsWithRain = key === "precipitation_sum"
      ? selection.eligible.filter((item) => item.value >= PRECIPITATION_RAIN_THRESHOLD_MM)
      : selection.eligible;
    // Precipitation's conditional amount uses wet models; if every available model
    // is dry, fuse the real dry values for trace/weights and emit consensus 0 below.
    const fusionInputs = key === "precipitation_sum" && modelsWithRain.length > 0
      ? sourceInputs.filter((source) => (source.temperature ?? -1) >= PRECIPITATION_RAIN_THRESHOLD_MM)
      : sourceInputs;
    const fusion = computeFusion(fusionInputs, config);
    fusions.set(key, fusion);

    const availableCount = selection.eligible.length;
    const qualifiedCount = qualifiedModels.size;
    const calibration = traceCalibrationStatus(availableCount, qualifiedCount);
    const status = getAvailabilityStatus(availableCount);
    const ineligible = selection.diagnostics.filter((item) => !item.eligible).map((item) => {
      const official = OFFICIAL_DAILY_MODEL_BY_NAME.get(item.modelName);
      return {
        modelName: item.modelName,
        reason: item.reason ?? "Ce modèle n’a pas été retenu pour cette variable et cette échéance.",
        sourceName: item.sourceName ?? "open-meteo",
        modelId: item.modelId ?? official?.modelId ?? null,
        runId: item.runId,
        availableAt: item.availableAt,
        validTime: item.validTime,
        horizonMinutes: item.horizonMinutes,
        horizonBucket: item.horizonBucket as DailyForecastHorizon | null,
      };
    });
    const calibrationReasons = selection.eligible.filter((item) => !qualifiedModels.has(item.modelName)).map((item) => ({
      modelName: item.modelName,
      reason: calibrationReason(item.modelName, item, options, key),
      sourceName: item.sourceName,
      modelId: item.modelId,
      runId: item.runId,
      availableAt: item.availableAt,
      validTime: item.validTime,
      horizonMinutes: item.horizonMinutes,
      horizonBucket: item.horizonBucket as DailyForecastHorizon | null,
    }));
    const contributingCount = key === "precipitation_sum"
      ? selection.eligible.length
      : fusion.usedSources.length;
    const reason = availableCount === 0
      ? `Aucun run admissible ne fournit une valeur finie pour cette variable à cette validTime. Les limites normales de couverture (dont J+7 à J+15) ne constituent ni un échec ni une pénalité de performance.`
      : status === "SINGLE_MODEL"
        ? `Valeur conservée depuis un seul modèle disponible; il s’agit d’un résultat single-model, pas d’une fusion multi-modèles.`
        : calibration === "CALIBRATED"
          ? `Fusion de ${availableCount} modèles disponibles; tous disposent d’une preuve historique exacte pour ce lieu, cette variable et leur horizon réel.`
          : calibration === "PARTIALLY_CALIBRATED"
            ? `Fusion de ${availableCount} modèles disponibles; seuls ${qualifiedCount} ont une preuve historique exacte. Les autres restent inclus avec une pondération robuste non calibrée.`
            : `Fusion robuste de ${availableCount} modèles disponibles; preuves historiques insuffisantes, sans transformer une absence de run en erreur.`;
    diagnosticsByVariable[key] = {
      status,
      availabilityStatus: status,
      calibrationStatus: calibration,
      coverageLevel: coverageLevel(contributingCount),
      expectedModelCount: DAILY_PRECIPITATION_MODEL_NAMES.length,
      availableValueModelCount: availableCount,
      evidenceEligibleModelCount: qualifiedCount,
      contributingModelCount: contributingCount,
      availableModels: selection.eligible.map((item) => item.modelName),
      evidenceEligibleModels: Array.from(qualifiedModels),
      modelReasons: ineligible,
      calibrationReasons,
      reason,
    };
  }

  const getFusion = (key: DailyVariable) => fusions.get(key)!;
  const getSelection = (key: DailyVariable) => selections.get(key)!;
  const getSelectedByModel = (key: DailyVariable) => sourceByVariable.get(key)!;
  const getQualifiedModels = (key: DailyVariable) => qualifiedByVariable.get(key)!;
  const precipitationSelection = getSelection("precipitation_sum");
  const precipitationInputs = precipitationSelection.eligible.map((item) => ({ modelName: item.modelName, amountMm: item.value }));
  const precipitationFusion = getFusion("precipitation_sum");
  const precipitationHasRain = precipitationSelection.eligible.some((item) => item.value >= PRECIPITATION_RAIN_THRESHOLD_MM);
  const precipitationQualified = diagnosticsByVariable.precipitation_sum.calibrationStatus === "CALIBRATED";
  const precipitationConsensus = summarizePrecipitationModels(
    precipitationInputs,
    precipitationInputs.map((item) => item.modelName),
    precipitationHasRain && precipitationFusion.temperature != null ? {
      conditionalMeanMm: precipitationFusion.temperature,
      conditionalMeanMethod: precipitationQualified ? "historical_skill" : "robust_fallback",
      configuredModelNames: DAILY_PRECIPITATION_MODEL_NAMES,
    } : { configuredModelNames: DAILY_PRECIPITATION_MODEL_NAMES },
  );

  const getTraceSources = (key: DailyVariable) => toTraceSources(
    getFusion(key), key, getSelectedByModel(key), getQualifiedModels(key),
  );
  const availabilityStatus = Object.fromEntries(METRICS.map(({ key, traceKey }) => [
    traceKey,
    diagnosticsByVariable[key].availabilityStatus,
  ])) as Record<DailyTraceKey, DailyFusionAvailabilityStatus>;
  const calibrationStatus = Object.fromEntries(METRICS.map(({ key, traceKey }) => [
    traceKey,
    diagnosticsByVariable[key].calibrationStatus,
  ])) as Record<DailyTraceKey, DailyCalibrationStatus>;
  const parameterSources = Object.fromEntries(METRICS.map(({ key, traceKey }) => [traceKey, getTraceSources(key)])) as Record<DailyTraceKey, ForecastTraceSource[]>;
  const eligibilityByVariable = Object.fromEntries(METRICS.map(({ key }) => [key, getSelection(key).diagnostics])) as Record<DailyVariable, ForecastModelEligibilityDiagnostic[]>;
  const distinctBuckets = new Set(METRICS.flatMap(({ key }) => getSelection(key).eligible.flatMap((item) => item.horizonBucket ? [item.horizonBucket] : [])));
  const horizonBucket = (distinctBuckets.size === 1 ? Array.from(distinctBuckets)[0]! : null) as DailyForecastHorizon | null;
  const eligibleModelNames = new Set(METRICS.flatMap(({ key }) => getSelection(key).eligible.map((item) => item.modelName)));
  const excludedSources = METRICS.flatMap(({ key }) => getSelection(key).diagnostics.filter((item) => !item.eligible).map((item) => ({
    id: `${key}:${item.modelName}`,
    name: item.modelName,
    reason: `${key}: ${item.reason ?? "run ou valeur indisponible"}`,
  })));
  const trace: ForecastTrace = {
    version: 4,
    issuedAt: new Date(referenceAt).toISOString(),
    referenceAt: new Date(referenceAt).toISOString(),
    method: "availability → sélection par location/validTime/variable/horizon/run → fiabilité historique exacte disponible → pondération robuste → cap adaptatif → renormalisation → fusion; Best Match comparatif uniquement",
    sourceCount: eligibleModelNames.size,
    horizonBucket,
    evidenceStoreAvailable: options.evidenceStoreAvailable,
    availabilityStatus: Object.fromEntries(METRICS.map(({ key }) => [key, diagnosticsByVariable[key].availabilityStatus])) as Record<DailyVariable, DailyFusionAvailabilityStatus>,
    calibrationStatus,
    parameterSources,
    eligibilityByVariable,
    precipitationConsensus,
    excludedSources,
  };

  const weights: Record<string, { tempWeight: number; precipWeight: number; windWeight: number; humidityWeight: number; cloudCoverWeight: number }> = {};
  for (const model of OFFICIAL_HOURLY_MODELS) {
    const findWeight = (fusion: FusionResult, name: string) => fusion.usedSources.find((entry) => entry.name === name)?.finalWeight ?? 0;
    weights[model.name] = {
      tempWeight: findWeight(getFusion("temperature_max"), model.name),
      precipWeight: findWeight(precipitationFusion, model.name),
      windWeight: findWeight(getFusion("wind_speed_max"), model.name),
      humidityWeight: findWeight(getFusion("humidity"), model.name),
      cloudCoverWeight: findWeight(getFusion("cloud_cover"), model.name),
    };
  }

  const requiredCoreKeys: DailyVariable[] = ["temperature_max", "temperature_min", "precipitation_sum", "wind_speed_max"];
  const coreCalibrationComplete = requiredCoreKeys.every((key) => diagnosticsByVariable[key].calibrationStatus === "CALIBRATED");
  const coreFusionAvailable = requiredCoreKeys.every((key) => diagnosticsByVariable[key].availabilityStatus !== "UNAVAILABLE");
  const coreMultiModel = requiredCoreKeys.every((key) => diagnosticsByVariable[key].availabilityStatus === "FUSED");
  const fusionByMetric = Object.fromEntries(METRICS.map(({ key }) => [key, getFusion(key).temperature])) as Record<DailyVariable, number | null>;
  const parameterDiagnostics = Object.fromEntries(METRICS.map(({ key }) => [key, diagnosticsByVariable[key]])) as Record<DailyVariable, DailyFusionMetricDiagnostic>;
  // Humidity and cloud cover have no daily physical observation series: they can never
  // carry a calibrated proof, so the calibration denominator counts only calibrable variables.
  const calibrableMetrics = METRICS.filter(({ key }) => key !== "humidity" && key !== "cloud_cover");
  const calibratedCount = calibrableMetrics.filter(({ key }) => diagnosticsByVariable[key].calibrationStatus === "CALIBRATED").length;
  const forecast = {
    tempMax: getSelection("temperature_max").eligible.length > 0 ? fusionByMetric.temperature_max : null,
    tempMin: getSelection("temperature_min").eligible.length > 0 ? fusionByMetric.temperature_min : null,
    precipitation: precipitationConsensus.consensusEstimateMm,
    windSpeed: getSelection("wind_speed_max").eligible.length > 0 ? fusionByMetric.wind_speed_max : null,
    windGust: getSelection("wind_gust_max").eligible.length > 0 ? fusionByMetric.wind_gust_max : null,
    humidity: getSelection("humidity").eligible.length > 0 ? fusionByMetric.humidity : null,
    cloudCover: getSelection("cloud_cover").eligible.length > 0 ? fusionByMetric.cloud_cover : null,
    confidenceScore: coreCalibrationComplete && coreMultiModel ? getFusion("temperature_max").confidenceScore : null,
    availabilityStatus,
    calibrationStatus,
    coreFusionAvailable,
    coreCalibrationComplete,
    weights,
    trace,
    methodNote: `Fusion quotidienne par disponibilité réelle: valeurs disponibles pour ${Object.values(availabilityStatus).filter((status) => status !== "UNAVAILABLE").length}/7 variables; preuves calibrées exactes pour ${calibratedCount}/${calibrableMetrics.length} variables calibrables (humidité et nébulosité non calibrables: aucune série d'observations physiques quotidienne). Les autres valeurs disponibles restent robustes et explicitement non calibrées; les absences de couverture normale ne sont pas des échecs.`,
  };
  return { forecast, parameterDiagnostics };
}

/** Production/archive result: retains the forecast, now with additive availability/calibration trace. */
export function computeOfficialDailyForecast(
  forecasts: OfficialDailyForecastInput[],
  options: OfficialDailyForecastOptions,
) {
  return computeOfficialDailyForecastInternal(forecasts, options).forecast;
}

/** Live-only additive per-variable diagnostics. */
export function computeOfficialDailyForecastWithDiagnostics(
  forecasts: OfficialDailyForecastInput[],
  options: OfficialDailyForecastOptions,
) {
  const { forecast, parameterDiagnostics } = computeOfficialDailyForecastInternal(forecasts, options);
  return { ...forecast, parameterDiagnostics };
}
