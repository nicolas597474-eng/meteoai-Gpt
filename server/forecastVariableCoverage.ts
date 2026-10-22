export type VariableCoverageStatus =
  | "available"
  | "partial"
  | "missing"
  | "out_of_horizon"
  | "not_requested"
  | "request_failed"
  | "unconfirmed";

export type HourlySourceValueStatus =
  | "valid"
  | "normalized"
  | "provider_null"
  | "field_missing"
  | "invalid_value"
  | "unit_mismatch"
  | "no_model_data"
  | "time_mismatch"
  | "source_error";

export type HourlyVariableSourceDiagnostic = {
  key: string;
  slots: Array<{
    validAt: number;
    status: HourlySourceValueStatus;
    rawType: string | null;
    rawValue: string | null;
    rawUnit: string | null;
  }>;
};

export const HOURLY_FORECAST_VARIABLES = [
  { key: "temperature", apiKey: "temperature_2m", label: "Température", valueField: "temperature", unitField: "temperature", defaultUnit: "°C", consumerProjected: true },
  { key: "apparent_temperature", apiKey: "apparent_temperature", label: "Ressenti", valueField: "apparentTemperature", unitField: "apparentTemperature", defaultUnit: "°C", consumerProjected: true },
  { key: "precipitation", apiKey: "precipitation", label: "Précipitations totales", valueField: "precipitation", unitField: "precipitation", defaultUnit: "mm", consumerProjected: true },
  { key: "rain", apiKey: "rain", label: "Pluie", valueField: "rain", unitField: "rain", defaultUnit: "mm", consumerProjected: false },
  { key: "showers", apiKey: "showers", label: "Averses", valueField: "showers", unitField: "showers", defaultUnit: "mm", consumerProjected: false },
  { key: "snowfall", apiKey: "snowfall", label: "Neige", valueField: "snowfall", unitField: "snowfall", defaultUnit: "cm", consumerProjected: false },
  { key: "wind_speed", apiKey: "wind_speed_10m", label: "Vitesse du vent", valueField: "windSpeed", unitField: "windSpeed", defaultUnit: "km/h", consumerProjected: true },
  { key: "wind_direction", apiKey: "wind_direction_10m", label: "Direction du vent", valueField: "windDirection", unitField: "windDirection", defaultUnit: "°", consumerProjected: true },
  { key: "wind_gust", apiKey: "wind_gusts_10m", label: "Rafales", valueField: "windGusts", unitField: "windGusts", defaultUnit: "km/h", consumerProjected: true },
  { key: "humidity", apiKey: "relative_humidity_2m", label: "Humidité relative", valueField: "humidity", unitField: "humidity", defaultUnit: "%", consumerProjected: true },
  { key: "surface_pressure", apiKey: "surface_pressure", label: "Pression", valueField: "pressure", unitField: "pressure", defaultUnit: "hPa", consumerProjected: true },
  { key: "cloud_cover", apiKey: "cloud_cover", label: "Nuages totaux", valueField: "cloudCover", unitField: "cloudCover", defaultUnit: "%", consumerProjected: true },
  { key: "cloud_cover_low", apiKey: "cloud_cover_low", label: "Nuages bas", valueField: "cloudLow", unitField: "cloudLow", defaultUnit: "%", consumerProjected: false },
  { key: "cloud_cover_mid", apiKey: "cloud_cover_mid", label: "Nuages moyens", valueField: "cloudMid", unitField: "cloudMid", defaultUnit: "%", consumerProjected: false },
  { key: "cloud_cover_high", apiKey: "cloud_cover_high", label: "Nuages hauts", valueField: "cloudHigh", unitField: "cloudHigh", defaultUnit: "%", consumerProjected: false },
  { key: "weather_code", apiKey: "weather_code", label: "Code météo WMO", valueField: "weatherCode", unitField: "weatherCode", defaultUnit: "wmo code", consumerProjected: true },
  { key: "uv_index", apiKey: "uv_index", label: "Indice UV", valueField: "uvIndex", unitField: "uvIndex", defaultUnit: "", consumerProjected: false },
  { key: "dew_point", apiKey: "dew_point_2m", label: "Point de rosée", valueField: "dewPoint", unitField: "dewPoint", defaultUnit: "°C", consumerProjected: false },
  { key: "visibility", apiKey: "visibility", label: "Visibilité", valueField: "visibility", unitField: "visibility", defaultUnit: "km", consumerProjected: false },
  { key: "shortwave_radiation", apiKey: "shortwave_radiation", label: "Rayonnement solaire", valueField: "solarRadiation", unitField: "solarRadiation", defaultUnit: "W/m²", consumerProjected: false },
] as const;

export const DAILY_FORECAST_VARIABLES = [
  { key: "temperature_2m_max", label: "Température maximale", requested: true, documentationStatus: "documented", forecastField: "tempMax", archiveField: "tempMax" },
  { key: "temperature_2m_min", label: "Température minimale", requested: true, documentationStatus: "documented", forecastField: "tempMin", archiveField: "tempMin" },
  { key: "precipitation_sum", label: "Précipitations quotidiennes", requested: true, documentationStatus: "documented", forecastField: "precipitation", archiveField: "precipitation" },
  { key: "wind_speed_10m_max", label: "Vitesse maximale du vent", requested: true, documentationStatus: "documented", forecastField: "windSpeed", archiveField: "windSpeed" },
  { key: "wind_gusts_10m_max", label: "Rafales maximales", requested: true, documentationStatus: "documented", forecastField: "windGust", archiveField: "windGust" },
  { key: "relative_humidity_2m_mean", label: "Humidité relative moyenne", requested: true, documentationStatus: "unconfirmed", forecastField: "humidity", archiveField: "humidity" },
  { key: "cloud_cover_mean", label: "Nébulosité moyenne", requested: true, documentationStatus: "unconfirmed", forecastField: "cloudCover", archiveField: "cloudCover" },
] as const;

export const DAILY_FORECAST_REQUEST_KEYS = DAILY_FORECAST_VARIABLES
  .filter((variable) => variable.requested)
  .map((variable) => variable.key);

export const MODEL_FORECAST_HORIZONS: Record<string, { maximumDocumentedDays: number | null; sourceUrl: string }> = {
  AROME: { maximumDocumentedDays: 2, sourceUrl: "https://open-meteo.com/en/docs/meteofrance-api" },
  ARPEGE: { maximumDocumentedDays: 4, sourceUrl: "https://open-meteo.com/en/docs/meteofrance-api" },
  ICON: { maximumDocumentedDays: 5, sourceUrl: "https://open-meteo.com/en/docs/dwd-api" },
  ECMWF: { maximumDocumentedDays: 15, sourceUrl: "https://open-meteo.com/en/docs/ecmwf-api" },
  GFS: { maximumDocumentedDays: 16, sourceUrl: "https://open-meteo.com/en/docs/gfs-api" },
  GEM: { maximumDocumentedDays: 10, sourceUrl: "https://open-meteo.com/en/docs/gem-api" },
  UKMET: { maximumDocumentedDays: 7, sourceUrl: "https://open-meteo.com/en/docs/ukmo-api" },
  "Open-Meteo": { maximumDocumentedDays: null, sourceUrl: "https://open-meteo.com/en/docs" },
  best_match: { maximumDocumentedDays: null, sourceUrl: "https://open-meteo.com/en/docs" },
};

export type DailyVariableCoverage = {
  key: string;
  label: string;
  requested: boolean;
  documentationStatus: "documented" | "unconfirmed";
  status: VariableCoverageStatus;
  requestedCount: number;
  returnedCount: number;
  receivedCount: number;
  missingCount: number;
  outOfHorizonCount: number;
  archivedCount: number | null;
  exposedCount: number;
};

export type DailyModelCollectionCoverage = {
  schemaVersion: 1;
  modelName: string;
  modelId: string | null;
  isOfficialModel: boolean;
  status: "succeeded" | "partial" | "failed" | "safe_error";
  requestAttempts: number;
  errorCode: string | null;
  requestedDays: number;
  returnedDays: number;
  targetDateInResponse: boolean;
  firstReturnedDate: string | null;
  lastReturnedDate: string | null;
  maximumDocumentedDays: number | null;
  horizonSourceUrl: string;
  archiveRowsExpected: number;
  archiveRowsWritten: number | null;
  archiveWriteConfirmed: boolean | null;
  variables: DailyVariableCoverage[];
};

export function finiteCoverageValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function buildDailyModelCollectionCoverage(input: {
  modelName: string;
  modelId: string | null;
  isOfficialModel: boolean;
  status: DailyModelCollectionCoverage["status"];
  requestAttempts: number;
  errorCode: string | null;
  requestedDays: number;
  targetDate?: string;
  daily?: Record<string, unknown> | null;
}): DailyModelCollectionCoverage {
  const rawDates = Array.isArray(input.daily?.time) ? input.daily!.time as unknown[] : [];
  const validDates = rawDates.filter(validIsoDate).slice(0, input.requestedDays);
  const returnedDays = validDates.length;
  const horizon = MODEL_FORECAST_HORIZONS[input.modelName] ?? MODEL_FORECAST_HORIZONS.best_match;
  const failed = input.status === "failed" || input.status === "safe_error" || returnedDays === 0;
  const variables: DailyVariableCoverage[] = DAILY_FORECAST_VARIABLES.map((definition) => {
    if (!definition.requested) {
      return {
        key: definition.key,
        label: definition.label,
        requested: false,
        documentationStatus: definition.documentationStatus,
        status: "unconfirmed",
        requestedCount: 0,
        returnedCount: returnedDays,
        receivedCount: 0,
        missingCount: 0,
        outOfHorizonCount: 0,
        archivedCount: 0,
        exposedCount: 0,
      };
    }
    const series = Array.isArray(input.daily?.[definition.key]) ? input.daily![definition.key] as unknown[] : [];
    const receivedCount = failed ? 0 : validDates.reduce((count, date) => {
      const index = rawDates.indexOf(date);
      return count + (finiteCoverageValue(series[index]) == null ? 0 : 1);
    }, 0);
    const missingCount = failed ? 0 : Math.max(0, returnedDays - receivedCount);
    const outOfHorizonCount = failed ? 0 : Math.max(0, input.requestedDays - returnedDays);
    const status: VariableCoverageStatus = failed
      ? "request_failed"
      : outOfHorizonCount > 0
        ? "out_of_horizon"
        : receivedCount === input.requestedDays
          ? "available"
          : receivedCount > 0
            ? "partial"
            : "missing";
    return {
      key: definition.key,
      label: definition.label,
      requested: true,
      documentationStatus: definition.documentationStatus,
      status,
      requestedCount: input.requestedDays,
      returnedCount: returnedDays,
      receivedCount,
      missingCount,
      outOfHorizonCount,
      archivedCount: null,
      exposedCount: 0,
    };
  });
  return {
    schemaVersion: 1,
    modelName: input.modelName,
    modelId: input.modelId,
    isOfficialModel: input.isOfficialModel,
    status: input.status,
    requestAttempts: input.requestAttempts,
    errorCode: input.errorCode,
    requestedDays: input.requestedDays,
    returnedDays,
    targetDateInResponse: input.targetDate ? validDates.includes(input.targetDate) : true,
    firstReturnedDate: validDates[0] ?? null,
    lastReturnedDate: validDates.at(-1) ?? null,
    maximumDocumentedDays: horizon.maximumDocumentedDays,
    horizonSourceUrl: horizon.sourceUrl,
    archiveRowsExpected: 0,
    archiveRowsWritten: null,
    archiveWriteConfirmed: null,
    variables,
  };
}

export function confirmDailyArchiveCoverage(
  diagnostics: DailyModelCollectionCoverage[],
  input: {
    targetDate: string;
    forecasts: Array<Record<string, unknown> & { serviceName: string }>;
    archiveRows: Array<Record<string, unknown> & { serviceName: string }>;
    archiveRowsWritten: number;
  },
): DailyModelCollectionCoverage[] {
  const archiveWriteConfirmed = input.archiveRows.length === 0 ? null : input.archiveRowsWritten === input.archiveRows.length;
  return diagnostics.map((diagnostic) => {
    const archiveRows = input.archiveRows.filter((row) => row.serviceName === diagnostic.modelName);
    const targetForecast = input.forecasts.find((forecast) => forecast.serviceName === diagnostic.modelName);
    const modelRowsWritten = archiveWriteConfirmed ? archiveRows.length : 0;
    const variables = diagnostic.variables.map((variable) => {
      if (!variable.requested) return { ...variable, archivedCount: 0, exposedCount: 0 };
      const definition = DAILY_FORECAST_VARIABLES.find((item) => item.key === variable.key)!;
      const archivedCount = archiveWriteConfirmed === true
        ? archiveRows.reduce((count, row) => count + (finiteCoverageValue(row[definition.archiveField]) == null ? 0 : 1), 0)
        : archiveWriteConfirmed === null ? 0 : null;
      const exposedCount = targetForecast && finiteCoverageValue(targetForecast[definition.forecastField]) != null ? 1 : 0;
      return { ...variable, archivedCount, exposedCount };
    });
    return {
      ...diagnostic,
      archiveRowsExpected: archiveRows.length,
      archiveRowsWritten: modelRowsWritten,
      archiveWriteConfirmed,
      variables,
    };
  });
}

export type HourlyVariableCoverage = {
  key: string;
  label: string;
  requested: true;
  status: VariableCoverageStatus;
  requestedCount: number;
  receivedCount: number;
  missingCount: number;
  archivedCount: number;
  exposedCount: number;
  consumerProjected: boolean;
  unit: string | null;
  sourceStatusCounts: Record<HourlySourceValueStatus, number>;
  sourceIssues: Array<{
    validAt: string;
    status: Exclude<HourlySourceValueStatus, "valid">;
    rawType: string | null;
    rawValue: string | null;
    rawUnit: string | null;
  }>;
};

export type HourlyModelCollectionCoverage = {
  schemaVersion: 2;
  modelName: string;
  modelId: string | null;
  isOfficialModel: boolean;
  status: "succeeded" | "partial" | "failed" | "safe_error";
  requestAttempts: number;
  errorCode: string | null;
  requestedForecastDays: number;
  returnedHours: number;
  expectedHoursCount: number;
  receivedUniqueHours: number;
  missingHoursCount: number;
  unexpectedHoursCount: number;
  duplicateHoursCount: number;
  projectionReady: boolean;
  archiveRowsComplete: boolean;
  firstValidAt: string | null;
  lastValidAt: string | null;
  maximumDocumentedDays: number | null;
  horizonSourceUrl: string;
  expectedArchiveRows: number;
  archiveRowsWritten: number;
  projectionRowsWritten: number;
  variables: HourlyVariableCoverage[];
};

export function buildHourlyModelCollectionCoverage(input: {
  modelName: string;
  modelId: string | null;
  isOfficialModel: boolean;
  status: HourlyModelCollectionCoverage["status"];
  requestAttempts: number;
  errorCode: string | null;
  requestedForecastDays: number;
  expectedHoursCount?: number;
  expectedValidTimes?: readonly number[];
  hours: Array<Record<string, unknown> & { validAt: number }>;
  projectionReady?: boolean;
  units?: Record<string, unknown> | null;
  archiveRowsWritten: number;
  projectionRowsWritten: number;
  variableDiagnostics?: HourlyVariableSourceDiagnostic[];
}): HourlyModelCollectionCoverage {
  const horizon = MODEL_FORECAST_HORIZONS[input.modelName] ?? MODEL_FORECAST_HORIZONS.best_match;
  const expectedValidTimes = input.expectedValidTimes?.filter((value) => Number.isFinite(value)) ?? [];
  const expectedHoursCount = input.expectedHoursCount ?? (expectedValidTimes.length || input.hours.length);
  const expectedTimeSet = expectedValidTimes.length > 0 ? new Set(expectedValidTimes) : null;
  const receivedTimes = new Set(input.hours.map((hour) => hour.validAt).filter((value) => Number.isFinite(value)));
  const validTimeCounts = new Map<number, number>();
  for (const hour of input.hours) {
    if (Number.isFinite(hour.validAt)) validTimeCounts.set(hour.validAt, (validTimeCounts.get(hour.validAt) ?? 0) + 1);
  }
  const duplicateHoursCount = Array.from(validTimeCounts.values()).reduce((count, occurrences) => count + Math.max(0, occurrences - 1), 0);
  const receivedExpectedTimes = expectedTimeSet
    ? Array.from(expectedTimeSet).filter((validAt) => receivedTimes.has(validAt)).length
    : Math.min(expectedHoursCount, receivedTimes.size);
  const missingHoursCount = Math.max(0, expectedHoursCount - receivedExpectedTimes);
  const unexpectedHoursCount = Math.max(0, receivedTimes.size - receivedExpectedTimes);
  const archiveVariablesPerHour = HOURLY_FORECAST_VARIABLES.length;
  const expectedArchiveRows = expectedHoursCount * archiveVariablesPerHour;
  const archiveRowsComplete = expectedArchiveRows > 0 && input.archiveRowsWritten === expectedArchiveRows;
  const projectionReady = input.projectionReady ?? (expectedHoursCount > 0 && input.projectionRowsWritten === expectedHoursCount);
  const projectionCompleted = projectionReady && expectedHoursCount > 0 && input.projectionRowsWritten === expectedHoursCount;
  const variables: HourlyVariableCoverage[] = HOURLY_FORECAST_VARIABLES.map((definition) => {
    const hasValueAt = (validAt: number) => input.hours.some((hour) => hour.validAt === validAt && finiteCoverageValue(hour[definition.valueField]) != null);
    const receivedCount = expectedTimeSet
      ? Array.from(expectedTimeSet).reduce((count, validAt) => count + (hasValueAt(validAt) ? 1 : 0), 0)
      : input.hours.reduce((count, hour) => count + (finiteCoverageValue(hour[definition.valueField]) == null ? 0 : 1), 0);
    const status: VariableCoverageStatus = expectedHoursCount === 0
      ? "request_failed"
      : receivedCount === expectedHoursCount
        ? "available"
        : receivedCount > 0
          ? "partial"
          : "missing";
    const consumerProjected = definition.consumerProjected;
    const sourceDiagnostic = input.variableDiagnostics?.find((diagnostic) => diagnostic.key === definition.key);
    const diagnosticTimes = expectedValidTimes.length > 0
      ? expectedValidTimes
      : input.hours.map((hour) => hour.validAt).filter((validAt) => Number.isFinite(validAt));
    const sourceStates = diagnosticTimes.map((validAt) => {
      const supplied = sourceDiagnostic?.slots.find((slot) => slot.validAt === validAt);
      if (supplied) return supplied;
      const hour = input.hours.find((candidate) => candidate.validAt === validAt);
      const fallbackStatus: HourlySourceValueStatus = input.status === "failed" || input.status === "safe_error"
        ? "source_error"
        : !hour ? "no_model_data"
          : finiteCoverageValue(hour[definition.valueField]) != null ? "valid" : "provider_null";
      return { validAt, status: fallbackStatus, rawType: null, rawValue: null, rawUnit: null };
    });
    const sourceStatusCounts = Object.fromEntries(
      (["valid", "normalized", "provider_null", "field_missing", "invalid_value", "unit_mismatch", "no_model_data", "time_mismatch", "source_error"] as const)
        .map((sourceStatus) => [sourceStatus, sourceStates.filter((slot) => slot.status === sourceStatus).length]),
    ) as Record<HourlySourceValueStatus, number>;
    return {
      key: definition.key,
      label: definition.label,
      requested: true,
      status,
      requestedCount: expectedHoursCount,
      receivedCount,
      missingCount: Math.max(0, expectedHoursCount - receivedCount),
      archivedCount: archiveRowsComplete ? expectedHoursCount : Math.min(expectedHoursCount, Math.floor(input.archiveRowsWritten / archiveVariablesPerHour)),
      exposedCount: consumerProjected && projectionCompleted ? receivedCount : 0,
      consumerProjected,
      unit: typeof input.units?.[definition.unitField] === "string" ? input.units[definition.unitField] as string : definition.defaultUnit || null,
      sourceStatusCounts,
      sourceIssues: sourceStates
        .filter((slot) => slot.status !== "valid")
        .map((slot) => ({
          validAt: new Date(slot.validAt).toISOString(),
          status: slot.status as Exclude<HourlySourceValueStatus, "valid">,
          rawType: slot.rawType,
          rawValue: slot.rawValue,
          rawUnit: slot.rawUnit,
        })),
    };
  });
  const validTimes = input.hours.map((hour) => hour.validAt).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    schemaVersion: 2,
    modelName: input.modelName,
    modelId: input.modelId,
    isOfficialModel: input.isOfficialModel,
    status: input.status,
    requestAttempts: input.requestAttempts,
    errorCode: input.errorCode,
    requestedForecastDays: input.requestedForecastDays,
    returnedHours: input.hours.length,
    expectedHoursCount,
    receivedUniqueHours: receivedTimes.size,
    missingHoursCount,
    unexpectedHoursCount,
    duplicateHoursCount,
    projectionReady,
    archiveRowsComplete,
    firstValidAt: validTimes.length ? new Date(validTimes[0]).toISOString() : null,
    lastValidAt: validTimes.length ? new Date(validTimes[validTimes.length - 1]).toISOString() : null,
    maximumDocumentedDays: horizon.maximumDocumentedDays,
    horizonSourceUrl: horizon.sourceUrl,
    expectedArchiveRows,
    archiveRowsWritten: input.archiveRowsWritten,
    projectionRowsWritten: input.projectionRowsWritten,
    variables,
  };
}

export function buildHourlyArchiveValues(input: {
  values: Record<string, unknown>;
  units?: Record<string, unknown> | null;
}): Array<{ variable: string; value: number | null; unit: string | null }> {
  return HOURLY_FORECAST_VARIABLES.map((definition) => ({
    variable: definition.key,
    value: finiteCoverageValue(input.values[definition.valueField]),
    unit: typeof input.units?.[definition.unitField] === "string"
      ? input.units[definition.unitField] as string
      : definition.defaultUnit || null,
  }));
}
