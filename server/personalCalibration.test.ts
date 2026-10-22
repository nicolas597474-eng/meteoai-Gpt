import { describe, expect, it } from "vitest";
import { personalConditionFromForecast, scorePersonalModelObservation, updatePersonalCalibration } from "./personalCalibration";

describe("calibration par observation personnelle", () => {
  it("favorise le modèle dont la température et la condition correspondent", () => {
    const observation = { temperature: 24, condition: "partly_cloudy" as const, windSpeed: null };
    const close = scorePersonalModelObservation(observation, { temperature: 23.5, windSpeed: null, weatherCode: 2, cloudCover: 65 });
    const distant = scorePersonalModelObservation(observation, { temperature: 26, windSpeed: null, weatherCode: 0, cloudCover: 0 });
    expect(close.overallScore).toBeGreaterThan(distant.overallScore);
    expect(close.conditionScore).toBe(100);
  });

  it("valorise la quantité de pluie observée quand elle est renseignée", () => {
    const observation = { temperature: null, condition: "rain" as const, windSpeed: null, precipitation: 3 };
    const proche = scorePersonalModelObservation(observation, { temperature: null, windSpeed: null, precipitation: 2.8, weatherCode: 61, cloudCover: 100 });
    const lointain = scorePersonalModelObservation(observation, { temperature: null, windSpeed: null, precipitation: 0, weatherCode: 61, cloudCover: 100 });
    expect(proche.precipitationScore).toBeGreaterThan(lointain.precipitationScore ?? 0);
    expect(proche.overallScore).toBeGreaterThan(lointain.overallScore);
  });

  it("distingue les niveaux fins de ciel couvert et de précipitation", () => {
    expect(personalConditionFromForecast(3, 75)).toBe("very_cloudy");
    expect(personalConditionFromForecast(3, 100)).toBe("overcast");
    expect(personalConditionFromForecast(51, 90)).toBe("few_drops");
    expect(personalConditionFromForecast(57, 100)).toBe("light_rain");
    expect(personalConditionFromForecast(65, 100)).toBe("heavy_rain");
  });

  it("ne transforme pas une condition absente ou invalide en ciel ensoleillé", () => {
    expect(personalConditionFromForecast(null, null)).toBe("unknown");
    expect(personalConditionFromForecast(Number.NaN, null)).toBe("unknown");
    expect(personalConditionFromForecast(100, null)).toBe("unknown");
    expect(personalConditionFromForecast(3, null)).toBe("overcast");
    expect(personalConditionFromForecast(null, 0)).toBe("sunny");
  });

  it("n’ajoute pas un score de condition lorsqu’une des conditions est unknown", () => {
    const result = scorePersonalModelObservation(
      { temperature: null, condition: "unknown", windSpeed: null },
      { temperature: null, windSpeed: null, weatherCode: null, cloudCover: null },
    );
    expect(result).toMatchObject({ conditionScore: null, forecastCondition: "unknown", overallScore: null });
    expect(updatePersonalCalibration(undefined, result).comparisonCount).toBe(0);
  });

  it("n’accorde aucune influence opérationnelle avant le seuil de preuve", () => {
    const result = scorePersonalModelObservation({ temperature: 24, condition: "overcast", windSpeed: null }, { temperature: 24, windSpeed: null, weatherCode: 3, cloudCover: 100 });
    const early = updatePersonalCalibration(undefined, result);
    const qualified = updatePersonalCalibration({ comparisonCount: 49, scoreEma: 100, temperatureMaeEma: 0, conditionScoreEma: 100, windScoreEma: null }, result);
    expect(early).toMatchObject({ evidenceState: "insufficient", weightMultiplier: 1 });
    expect(qualified.evidenceState).toBe("qualified");
    expect(qualified.weightMultiplier).toBeGreaterThan(1);
  });
});
