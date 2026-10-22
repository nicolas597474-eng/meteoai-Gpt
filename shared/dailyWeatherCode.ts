export const DAILY_WEATHER_CODE_TIME_ZONE = "Europe/Paris" as const;

const VALID_DAILY_WMO_CODES = new Set([
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67,
  71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99,
]);

export type DailyWeatherCodeValueStatus =
  | "valid"
  | "provider_null"
  | "field_missing"
  | "invalid_value"
  | "request_failed"
  | "date_missing"
  | "duplicate_date"
  | "time_mismatch"
  | "duplicate_conflict";

export type DailyWeatherCodeCandidate = {
  modelName: string;
  modelId: string | null;
  sourceName: string | null;
  runId: string | null;
  runIdKind: "capture" | "provider" | "unknown" | null;
  networkAttemptCount: number | null;
  deliveryMode: "network" | "cache" | "unknown";
  requestStartedAt: number | null;
  availableAt: number | null;
  validTime: number | null;
  weatherCode: number | null;
  valueStatus: DailyWeatherCodeValueStatus;
};

export type DailyWeatherCodeModelRecord = DailyWeatherCodeCandidate;

export type DailyWeatherCodeSelectionMethod =
  | "single_model"
  | "unique_plurality"
  | "tie"
  | "unavailable";

/**
 * Daily-only descriptive selection. This is deliberately not a calibrated
 * fusion, probability, or independent-model count; Best Match is excluded.
 */
export type DailyWeatherCodeSummary = {
  schemaVersion: 1;
  source: "open-meteo-official-models";
  validDate: string;
  timeZone: typeof DAILY_WEATHER_CODE_TIME_ZONE;
  validTime: number | null;
  computedAt: string;
  expectedModelCount: number;
  validModelCount: number;
  supportingModelCount: number;
  largestCodeGroupCount: number;
  weatherCode: number | null;
  condition: string | null;
  selectionMethod: DailyWeatherCodeSelectionMethod;
  calibrated: false;
  duplicateRowsIgnored: number;
  duplicateConflictModelCount: number;
  excludedNonOfficialModelCount: number;
  providerNullModelCount: number;
  missingFieldModelCount: number;
  invalidModelCount: number;
  requestFailedModelCount: number;
  dateMissingModelCount: number;
  duplicateDateModelCount: number;
  timeMismatchModelCount: number;
  modelCodes: DailyWeatherCodeModelRecord[];
  reason: string;
};

export function isValidDailyWmoWeatherCode(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && VALID_DAILY_WMO_CODES.has(value);
}

/** Daily-only label mapping. The hourly/current condition mapper is unchanged. */
export function dailyConditionFromWmoWeatherCode(code: number | null): string | null {
  if (!isValidDailyWmoWeatherCode(code)) return null;
  if (code === 0) return "Ensoleillé";
  if (code === 1) return "Peu nuageux";
  if (code === 2) return "Partiellement nuageux";
  if (code === 3) return "Ciel couvert";
  if (code === 45 || code === 48) return "Brouillard";
  if (code === 56 || code === 57) return "Bruine verglaçante";
  if (code >= 51 && code <= 55) return "Bruine";
  if (code === 66 || code === 67) return "Pluie verglaçante";
  if (code >= 61 && code <= 65) return "Pluie";
  if (code >= 71 && code <= 77) return "Neige";
  if (code >= 80 && code <= 82) return "Averses";
  if (code === 85 || code === 86) return "Averses de neige";
  if (code === 95) return "Orages";
  if (code === 96 || code === 99) return "Orages avec grêle";
  return null;
}

export function summarizeDailyWeatherCodes(input: {
  validDate: string;
  expectedValidTime: number;
  computedAt: number;
  expectedModels: readonly { modelName: string; modelId: string }[];
  candidates: readonly DailyWeatherCodeCandidate[];
}): DailyWeatherCodeSummary {
  const expectedIds = new Set(input.expectedModels.map(({ modelId }) => modelId));
  const grouped = new Map<string, DailyWeatherCodeCandidate[]>();
  let excludedNonOfficialModelCount = 0;
  for (const candidate of input.candidates) {
    if (!candidate.modelId || !expectedIds.has(candidate.modelId)) {
      excludedNonOfficialModelCount += 1;
      continue;
    }
    const rows = grouped.get(candidate.modelId) ?? [];
    rows.push(candidate);
    grouped.set(candidate.modelId, rows);
  }

  let duplicateRowsIgnored = 0;
  const modelCodes: DailyWeatherCodeModelRecord[] = input.expectedModels.map((model) => {
    const rows = grouped.get(model.modelId) ?? [];
    if (rows.length === 0) {
      return {
        modelName: model.modelName,
        modelId: model.modelId,
        sourceName: null,
        runId: null,
        runIdKind: null,
        networkAttemptCount: null,
        deliveryMode: "unknown",
        requestStartedAt: null,
        availableAt: null,
        validTime: null,
        weatherCode: null,
        valueStatus: "request_failed",
      };
    }

    const first = rows[0]!;
    const normalizedFirst = normalizeCandidate(first, input.expectedValidTime);
    if (rows.length === 1) return normalizedFirst;

    const normalizedRows = rows.map((row) => normalizeCandidate(row, input.expectedValidTime));
    const sameEvidence = normalizedRows.every((row) =>
      row.valueStatus === normalizedFirst.valueStatus
      && row.weatherCode === normalizedFirst.weatherCode
      && row.validTime === normalizedFirst.validTime
      && row.runId === normalizedFirst.runId
      && row.networkAttemptCount === normalizedFirst.networkAttemptCount
      && row.deliveryMode === normalizedFirst.deliveryMode
      && row.requestStartedAt === normalizedFirst.requestStartedAt
      && row.availableAt === normalizedFirst.availableAt,
    );
    duplicateRowsIgnored += rows.length - 1;
    if (sameEvidence) return normalizedFirst;
    return { ...normalizedFirst, weatherCode: null, valueStatus: "duplicate_conflict" };
  });

  const validCodes = modelCodes.filter((row) => row.valueStatus === "valid" && row.weatherCode != null);
  const counts = new Map<number, number>();
  for (const row of validCodes) counts.set(row.weatherCode!, (counts.get(row.weatherCode!) ?? 0) + 1);
  const largestCodeGroupCount = counts.size ? Math.max(...Array.from(counts.values())) : 0;
  const leadingCodes = Array.from(counts.entries())
    .filter(([, count]) => count === largestCodeGroupCount)
    .map(([code]) => code)
    .sort((left, right) => left - right);

  let selectionMethod: DailyWeatherCodeSelectionMethod = "unavailable";
  let weatherCode: number | null = null;
  let supportingModelCount = 0;
  if (validCodes.length === 1) {
    selectionMethod = "single_model";
    weatherCode = validCodes[0]!.weatherCode;
    supportingModelCount = 1;
  } else if (validCodes.length > 1 && leadingCodes.length === 1) {
    selectionMethod = "unique_plurality";
    weatherCode = leadingCodes[0]!;
    supportingModelCount = largestCodeGroupCount;
  } else if (validCodes.length > 1) {
    selectionMethod = "tie";
  }

  const condition = dailyConditionFromWmoWeatherCode(weatherCode);
  const reason = selectionMethod === "single_model"
    ? `Code WMO ${weatherCode} directement reçu d’un seul modèle; aucune fusion ni calibration n’est revendiquée.`
    : selectionMethod === "unique_plurality"
      ? `Le code WMO ${weatherCode} est le plus fréquent (${supportingModelCount}/${validCodes.length} codes valides); fréquence descriptive non pondérée, non calibrée et non probabiliste.`
      : selectionMethod === "tie"
        ? `Égalité entre plusieurs codes WMO (${largestCodeGroupCount}/${validCodes.length} au premier rang); condition laissée inconnue.`
        : "Aucun code WMO quotidien valide n’est disponible pour les modèles officiels à cette date.";

  return {
    schemaVersion: 1,
    source: "open-meteo-official-models",
    validDate: input.validDate,
    timeZone: DAILY_WEATHER_CODE_TIME_ZONE,
    validTime: Number.isFinite(input.expectedValidTime) ? input.expectedValidTime : null,
    computedAt: new Date(input.computedAt).toISOString(),
    expectedModelCount: input.expectedModels.length,
    validModelCount: validCodes.length,
    supportingModelCount,
    largestCodeGroupCount,
    weatherCode,
    condition,
    selectionMethod,
    calibrated: false,
    duplicateRowsIgnored,
    duplicateConflictModelCount: modelCodes.filter((row) => row.valueStatus === "duplicate_conflict").length,
    excludedNonOfficialModelCount,
    providerNullModelCount: modelCodes.filter((row) => row.valueStatus === "provider_null").length,
    missingFieldModelCount: modelCodes.filter((row) => row.valueStatus === "field_missing").length,
    invalidModelCount: modelCodes.filter((row) => row.valueStatus === "invalid_value").length,
    requestFailedModelCount: modelCodes.filter((row) => row.valueStatus === "request_failed").length,
    dateMissingModelCount: modelCodes.filter((row) => row.valueStatus === "date_missing").length,
    duplicateDateModelCount: modelCodes.filter((row) => row.valueStatus === "duplicate_date").length,
    timeMismatchModelCount: modelCodes.filter((row) => row.valueStatus === "time_mismatch").length,
    modelCodes,
    reason,
  };
}

function normalizeCandidate(candidate: DailyWeatherCodeCandidate, expectedValidTime: number): DailyWeatherCodeModelRecord {
  if (candidate.valueStatus !== "valid") return { ...candidate, weatherCode: null };
  if (candidate.validTime !== expectedValidTime) {
    return { ...candidate, weatherCode: null, valueStatus: "time_mismatch" };
  }
  if (!isValidDailyWmoWeatherCode(candidate.weatherCode)) {
    return { ...candidate, weatherCode: null, valueStatus: "invalid_value" };
  }
  return { ...candidate };
}
