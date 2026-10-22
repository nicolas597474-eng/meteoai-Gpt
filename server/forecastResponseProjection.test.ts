import { describe, expect, it } from "vitest";
import { projectHourlyForecastForDashboard } from "./forecastResponseProjection";
import type { HourlyPoint } from "./weatherServices";

const hourlyPoint: HourlyPoint = {
  date: "2026-10-09",
  hour: "10:00",
  validAt: Date.parse("2026-10-09T08:00:00.000Z"),
  temp: 16.2,
  apparentTemp: 15.9,
  precipitation: 0.4,
  precipitationComponents: [{ modelName: "AROME", rain: 0.4, showers: 0, snowfall: 0 }],
  windSpeed: 12,
  windGust: 24,
  windDirection: 220,
  cloudCover: 64,
  humidity: 73,
  uvIndex: 2,
  condition: "Averses",
  multiModelMetrics: {
    source: "official_seven_models",
    bestMatchIncluded: false,
    expectedModelCount: 7,
    modelsExpected: ["AROME"],
    configuredModelCount: 7,
    modelsConfigured: ["AROME"],
    temperature: { min: 16.2, max: 16.2, median: 16.2, standardDeviation: null, range: null, availableModelCount: 1, weightedMean: 16.2, modelsWithData: ["AROME"], minModel: "AROME", maxModel: "AROME" },
    precipitation: { thresholdMm: 0.1, availableModelCount: 1, rainModelCount: 1, consensusEstimateMm: 0.4, modelValues: [{ modelName: "AROME", amountMm: 0.4 }] },
    dispersion: {
      windSpeed: { range: null, standardDeviation: null, availableModelCount: 1 },
      windGust: { range: null, standardDeviation: null, availableModelCount: 1 },
      windDirection: { range: null, standardDeviation: null, availableModelCount: 1 },
      humidity: { range: null, standardDeviation: null, availableModelCount: 1 },
      cloudCover: { range: null, standardDeviation: null, availableModelCount: 1 },
    },
  },
  forecastWeighting: {
    method: "robust_fallback",
    availabilityStatus: "AVAILABLE",
    calibrationStatus: "UNCALIBRATED_ROBUST",
    expectedModelCount: 7,
    availableModelCount: 1,
    evidenceEligibleModelCount: 0,
    contributingModelCount: 1,
    horizonBucket: "0-6h",
    unavailableReason: null,
    scoredVariables: [],
    robustVariables: ["temperature"],
    unavailableVariables: [],
    minimumComparisons: null,
    minimumComparableDays: null,
    variableWeightings: [],
    modelsWithData: ["AROME"],
  },
};

describe("projection de réponse horaire du Dashboard", () => {
  it("retire uniquement la trace de pondération lourde", () => {
    const [projected] = projectHourlyForecastForDashboard([hourlyPoint]);

    expect(projected).not.toHaveProperty("forecastWeighting");
    expect(projected).toMatchObject({
      validAt: hourlyPoint.validAt,
      temp: 16.2,
      precipitation: 0.4,
      precipitationComponents: hourlyPoint.precipitationComponents,
      multiModelMetrics: hourlyPoint.multiModelMetrics,
    });
  });

  it("ne mute pas la prévision officielle conservée pour les détails", () => {
    const [projected] = projectHourlyForecastForDashboard([hourlyPoint]);

    expect(hourlyPoint.forecastWeighting?.variableWeightings).toEqual([]);
    expect(projected).not.toBe(hourlyPoint);
    expect(hourlyPoint).toHaveProperty("forecastWeighting");
  });
});
