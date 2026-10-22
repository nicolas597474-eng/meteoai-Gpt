import type { ModelCountCoverageLevel } from "./modelCoverageConfidence";

export type DailyForecastMetric =
  | "temperature_max"
  | "temperature_min"
  | "precipitation_sum"
  | "wind_speed_max"
  | "wind_gust_max";

export type DailyForecastHorizon = "0-6h" | "6-24h" | "1-3d" | "4-7d" | "8-15d";
export type DailyForecastCalibrationStatus =
  | "CALIBRATED"
  | "PARTIALLY_CALIBRATED"
  | "UNCALIBRATED_ROBUST"
  | "UNAVAILABLE";
export type DailyFusionAvailabilityStatus = "FUSED" | "SINGLE_MODEL" | "UNAVAILABLE";
export type DailyFusionCoverageLevel = ModelCountCoverageLevel;
export type DailyFusionVariable = DailyForecastMetric | "humidity" | "cloud_cover";

/** Legacy name retained as a type alias; it describes historical qualification only. */
export type DailyForecastEvidenceStatus = DailyForecastCalibrationStatus;
export type DailyFusionDiagnosticStatus = DailyFusionAvailabilityStatus;

export type DailyFusionModelReason = {
  modelName: string;
  reason: string;
  sourceName?: string | null;
  modelId?: string | null;
  runId?: string | null;
  availableAt?: number | null;
  validTime?: number | null;
  horizonMinutes?: number | null;
  horizonBucket?: DailyForecastHorizon | null;
};

/** Counts describe availability and actual contributions, never source skill. */
export type DailyFusionMetricDiagnostic = {
  status: DailyFusionAvailabilityStatus;
  availabilityStatus: DailyFusionAvailabilityStatus;
  calibrationStatus: DailyForecastCalibrationStatus;
  coverageLevel: DailyFusionCoverageLevel;
  expectedModelCount: number;
  availableValueModelCount: number;
  evidenceEligibleModelCount: number;
  contributingModelCount: number;
  availableModels: string[];
  evidenceEligibleModels: string[];
  modelReasons: DailyFusionModelReason[];
  calibrationReasons: DailyFusionModelReason[];
  reason: string;
};

export type DailyForecastSourceDiagnostic = {
  modelName: string;
  variable: DailyFusionVariable;
  horizonBucket: DailyForecastHorizon | null;
  sourceName: string | null;
  modelId: string | null;
  runId: string | null;
  availableAt: number | null;
  validTime: number | null;
  horizonMinutes: number | null;
  calibrationStatus: DailyForecastCalibrationStatus;
  finalWeight: number;
  rawWeight: number | null;
  robustFallbackWeight: number | null;
  /** Signed forecast-minus-observation error; diagnostic only. */
  signedBias: number | null;
  sampleSize: number | null;
  comparisonCount: number | null;
  evaluatedDays: number | null;
  latestScoreDate: string | null;
};

export type DailyOfficialFusionDisplay = {
  issuedAt: string;
  referenceAt: string;
  horizonBucket: DailyForecastHorizon | null;
  availabilityStatus: {
    tempMax: DailyFusionAvailabilityStatus;
    tempMin: DailyFusionAvailabilityStatus;
    precipitation: DailyFusionAvailabilityStatus;
    windSpeed: DailyFusionAvailabilityStatus;
    windGust: DailyFusionAvailabilityStatus;
    humidity: DailyFusionAvailabilityStatus;
    cloudCover: DailyFusionAvailabilityStatus;
  };
  calibrationStatus: {
    tempMax: DailyForecastCalibrationStatus;
    tempMin: DailyForecastCalibrationStatus;
    precipitation: DailyForecastCalibrationStatus;
    windSpeed: DailyForecastCalibrationStatus;
    windGust: DailyForecastCalibrationStatus;
    humidity: DailyForecastCalibrationStatus;
    cloudCover: DailyForecastCalibrationStatus;
  };
  sourcesByVariable: {
    tempMax: DailyForecastSourceDiagnostic[];
    tempMin: DailyForecastSourceDiagnostic[];
    precipitation: DailyForecastSourceDiagnostic[];
    windSpeed: DailyForecastSourceDiagnostic[];
    windGust: DailyForecastSourceDiagnostic[];
    humidity: DailyForecastSourceDiagnostic[];
    cloudCover: DailyForecastSourceDiagnostic[];
  };
  diagnosticsByVariable?: {
    tempMax: DailyFusionMetricDiagnostic;
    tempMin: DailyFusionMetricDiagnostic;
    precipitation: DailyFusionMetricDiagnostic;
    windSpeed: DailyFusionMetricDiagnostic;
    windGust: DailyFusionMetricDiagnostic;
    humidity: DailyFusionMetricDiagnostic;
    cloudCover: DailyFusionMetricDiagnostic;
  };
};

/** Best Match remains a separately labelled comparator, never an official fusion input. */
export type BestMatchDailyReference = {
  source: "Open-Meteo Best Match";
  role: "derived_reference";
  officialContributor: false;
  tempMax: number | null;
  /** Supplemental values remain a separately sourced reference, never a fusion input. */
  windDirection?: number | null;
  uvIndex?: number | null;
  feelsLikeMax?: number | null;
  feelsLikeMin?: number | null;
  tempMin: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust: number | null;
};
