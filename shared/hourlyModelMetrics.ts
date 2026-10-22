import type { PrecipitationModelConsensus } from "./precipitationConsensus";

export type ManualHourlyOverride = {
  source: "manual_refresh";
  reason: string;
  computedAt: string;
  officialOriginalComputedAt: string;
  officialOriginalPreserved: true;
  officialOriginalPointCount: number;
};

export type HourlyVariableSelectionStrategy =
  | "qualified_best_model"
  | "weighted_ensemble_fallback"
  | "only_available_model"
  | "unavailable";

export type HourlySelectionEvidenceBasis = "exact_lead" | "horizon_bucket" | null;

export type HourlyVariableSelectionReason =
  | "qualified_comparable_history"
  | "insufficient_qualified_history"
  | "historical_scores_unavailable"
  | "incomparable_horizons"
  | "tied_qualified_scores"
  | "variable_without_station_validation"
  | "only_model_available"
  | "no_admissible_model";

export type HourlyHistoricalEvidenceStatus =
  | "qualified"
  | "insufficient_evidence"
  | "no_evidence"
  | "incomplete_metrics"
  | "history_unavailable";

export type HistoricalMetricValues = {
  mae: number;
  rmse: number;
  bias: number;
  comparisonCount: number;
  evaluatedDays: number;
};

export type HourlyHistoricalTrend = {
  status: "qualified" | "insufficient_evidence" | "no_evidence" | "history_unavailable";
  recentWindowStart: string;
  recentWindowEnd: string;
  previousWindowStart: string;
  previousWindowEnd: string;
  recent: HistoricalMetricValues | null;
  previous: HistoricalMetricValues | null;
  delta: { mae: number; rmse: number; bias: number } | null;
  minimumComparisons: number;
  minimumComparableDays: number;
};

export type HourlyHistoricalEvidence = {
  modelName: string;
  modelId: string;
  variable: string;
  horizonBucket: string;
  status: HourlyHistoricalEvidenceStatus;
  metrics: HistoricalMetricValues | null;
  minimumComparisons: number;
  minimumComparableDays: number;
  firstScoreDate: string | null;
  latestScoreDate: string | null;
  latestComputedAt: string | null;
  incompleteMetricRows: number;
  trend: HourlyHistoricalTrend;
};

export type HourlyModelCalibrationLevel =
  | "EXACT_LOCAL_MODEL_VARIABLE_HORIZON"
  | "EXACT_LOCAL_MODEL_VARIABLE_BUCKET"
  | "UNCALIBRATED_ROBUST";

export type HourlyFusionWeightModelTrace = {
  modelName: string;
  modelId: string;
  sourceName: string;
  runId: string | null;
  runIdKind: "capture" | "provider" | "unknown";
  requestStartedAt: number | null;
  availableAt: number;
  validTime: number;
  horizonMinutes: number | null;
  horizonBucket: string | null;
  value: number;
  reliability: number;
  historicalScore: HistoricalMetricValues | null;
  calibrationLevel: HourlyModelCalibrationLevel;
  calibrationStatus: string;
  rawWeight: number;
  robustFallbackWeight: number | null;
  weight: number;
  contributedToValue: boolean;
  historicalEvidence?: Pick<HourlyHistoricalEvidence,
    "status" | "minimumComparisons" | "minimumComparableDays" | "latestScoreDate" | "latestComputedAt"
  >;
  exactHorizonEvidence?: Pick<HourlyHistoricalEvidence,
    "status" | "metrics" | "minimumComparisons" | "minimumComparableDays" | "latestScoreDate" | "latestComputedAt"
  >;
};

export type HourlyFusionExcludedModelTrace = {
  modelName: string;
  reason: string;
  sourceName: string | null;
  modelId: string | null;
  runId: string | null;
  availableAt: number | null;
  validTime: number | null;
  horizonMinutes: number | null;
  horizonBucket: string | null;
};

export type HourlyFusionVariableTrace = {
  variable: string;
  method: string;
  selectionStrategy: HourlyVariableSelectionStrategy;
  selectedModelName: string | null;
  selectionEvidenceBasis: HourlySelectionEvidenceBasis;
  selectionReason: HourlyVariableSelectionReason;
  horizonBucket: string | null;
  availabilityStatus: string;
  calibrationStatus: string;
  expectedModelCount: number;
  availableModelCount: number;
  evidenceEligibleModelCount: number;
  contributingModelCount: number;
  coverageLevel: string;
  modelReasons: HourlyFusionExcludedModelTrace[];
  modelWeights: HourlyFusionWeightModelTrace[];
};

export type HourlyFusionTrace = {
  method: string;
  availabilityStatus: string;
  calibrationStatus: string;
  expectedModelCount: number;
  availableModelCount: number;
  contributingModelCount: number;
  horizonBucket: string | null;
  variableWeightings: HourlyFusionVariableTrace[];
  modelsWithData: string[];
};

export type HourlyPrecipitationAgreementTrace = PrecipitationModelConsensus;

/**
 * Descriptive summaries of the seven independent hourly forecast models.
 * Null means no admissible value exists at the exact validTime; missing
 * historical evidence affects calibration status, never physical availability.
 * Zero is always a valid meteorological value.
 */
export type HourlyModelSummary = {
  min: number | null;
  max: number | null;
  median: number | null;
  /** Population standard deviation; null when fewer than two valid models exist. */
  standardDeviation: number | null;
  /** Max - min; null when fewer than two valid models exist. */
  range: number | null;
  availableModelCount: number;
};

export type HourlyModelRange = {
  /** Max - min; null when fewer than two valid models exist. */
  range: number | null;
  /** Population standard deviation for scalar variables; null when unavailable or circular. */
  standardDeviation: number | null;
  availableModelCount: number;
};

export type HourlyMultiModelMetrics = {
  /** This object is emitted only by the official seven-model hourly engine. */
  source: "official_seven_models";
  bestMatchIncluded: false;
  /** Models that supplied at least one eligible value at this validTime. */
  expectedModelCount: number;
  modelsExpected: readonly string[];
  /** Static catalogue, context only; not a performance-scoring denominator. */
  configuredModelCount: number;
  modelsConfigured: readonly string[];
  temperature: HourlyModelSummary & {
    /** Official historical-skill or robust-fallback forecast; null only without an admissible value. */
    weightedMean: number | null;
    modelsWithData: readonly string[];
    minModel: string | null;
    maxModel: string | null;
  };
  precipitation: PrecipitationModelConsensus;
  dispersion: {
    windSpeed: HourlyModelRange;
    windGust: HourlyModelRange;
    windDirection: HourlyModelRange;
    humidity: HourlyModelRange;
    cloudCover: HourlyModelRange;
  };
};
