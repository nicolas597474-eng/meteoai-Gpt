import { describe, expect, it } from "vitest";
import {
  dailyConditionFromWmoWeatherCode,
  summarizeDailyWeatherCodes,
  type DailyWeatherCodeCandidate,
} from "../shared/dailyWeatherCode";

const validTime = Date.parse("2026-10-08T12:00:00.000Z");
const expectedModels = ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET"].map((modelName) => ({
  modelName,
  modelId: modelName.toLowerCase(),
}));

function candidate(modelName: string, weatherCode: number | null, overrides: Partial<DailyWeatherCodeCandidate> = {}): DailyWeatherCodeCandidate {
  const model = expectedModels.find(({ modelName: expectedName }) => expectedName === modelName);
  return {
    modelName,
    modelId: model?.modelId ?? null,
    sourceName: "open-meteo",
    runId: `capture-${modelName}`,
    runIdKind: "capture",
    networkAttemptCount: 1,
    deliveryMode: "network",
    requestStartedAt: validTime - 60_000,
    availableAt: validTime - 30_000,
    validTime,
    weatherCode,
    valueStatus: weatherCode == null ? "provider_null" : "valid",
    ...overrides,
  };
}

function summarize(candidates: DailyWeatherCodeCandidate[]) {
  return summarizeDailyWeatherCodes({
    validDate: "2026-10-08",
    expectedValidTime: validTime,
    computedAt: validTime,
    expectedModels,
    candidates,
  });
}

describe("daily weather-code summary", () => {
  it("returns a unique most-frequent official code with exact counts and no calibration claim", () => {
    const result = summarize([
      candidate("AROME", null), candidate("ARPEGE", 53), candidate("ICON", 53),
      candidate("ECMWF", 53), candidate("GFS", 61), candidate("GEM", 61), candidate("UKMET", null),
      candidate("Best Match", 0, { modelId: null, modelName: "Best Match" }),
    ]);

    expect(result).toMatchObject({
      source: "open-meteo-official-models",
      validDate: "2026-10-08",
      timeZone: "Europe/Paris",
      validTime,
      expectedModelCount: 7,
      validModelCount: 5,
      supportingModelCount: 3,
      weatherCode: 53,
      condition: "Bruine",
      selectionMethod: "unique_plurality",
      calibrated: false,
      providerNullModelCount: 2,
      excludedNonOfficialModelCount: 1,
    });
    expect(result.reason).toContain("3/5 codes valides");
    expect(result.modelCodes).toHaveLength(7);
    expect(result.modelCodes.some(({ modelName }) => modelName === "Best Match")).toBe(false);
  });

  it("leaves the condition unknown on a tie instead of selecting a value by order", () => {
    const result = summarize([candidate("ARPEGE", 63), candidate("ICON", 81)]);
    expect(result).toMatchObject({
      selectionMethod: "tie",
      weatherCode: null,
      condition: null,
      validModelCount: 2,
      supportingModelCount: 0,
      largestCodeGroupCount: 1,
    });
    expect(result.reason).toContain("condition laissée inconnue");
  });

  it("identifies one contributing model as single-model, not a fusion", () => {
    const result = summarize([candidate("ARPEGE", 0, { networkAttemptCount: 0, deliveryMode: "cache" })]);
    expect(result).toMatchObject({ selectionMethod: "single_model", weatherCode: 0, condition: "Ensoleillé", supportingModelCount: 1 });
    expect(result.reason).toContain("aucune fusion ni calibration");
    expect(result.modelCodes.find(({ modelName }) => modelName === "ARPEGE")).toMatchObject({ networkAttemptCount: 0, deliveryMode: "cache" });
  });

  it("preserves missing, invalid and time-mismatched fields as unavailable", () => {
    const result = summarize([
      candidate("AROME", null, { valueStatus: "provider_null" }),
      candidate("ARPEGE", 9, { valueStatus: "valid" }),
      candidate("ICON", 61, { validTime: validTime + 1 }),
      candidate("ECMWF", null, { valueStatus: "field_missing" }),
    ]);
    expect(result).toMatchObject({
      selectionMethod: "unavailable",
      weatherCode: null,
      condition: null,
      invalidModelCount: 1,
      timeMismatchModelCount: 1,
      missingFieldModelCount: 1,
    });
  });

  it("does not double-count duplicate model rows and invalidates conflicting duplicates", () => {
    const same = candidate("ARPEGE", 61);
    const exactDuplicate = summarize([same, { ...same }]);
    expect(exactDuplicate).toMatchObject({
      selectionMethod: "single_model",
      weatherCode: 61,
      validModelCount: 1,
      duplicateRowsIgnored: 1,
    });

    const conflict = summarize([same, { ...same, weatherCode: 63, runId: "other-capture" }]);
    expect(conflict).toMatchObject({
      selectionMethod: "unavailable",
      weatherCode: null,
      validModelCount: 0,
      duplicateRowsIgnored: 1,
      duplicateConflictModelCount: 1,
    });
  });

  it("ignores a Best Match-only code and maps snow showers only in the daily helper", () => {
    const bestMatch = candidate("Best Match", 0, { modelId: null, modelName: "Best Match" });
    expect(summarize([bestMatch])).toMatchObject({
      selectionMethod: "unavailable",
      weatherCode: null,
      excludedNonOfficialModelCount: 1,
    });
    expect(dailyConditionFromWmoWeatherCode(85)).toBe("Averses de neige");
    expect(dailyConditionFromWmoWeatherCode(9)).toBeNull();
  });
});
