import { describe, expect, it } from "vitest";
import {
  calculateReliabilityScore,
  type ForecastRow,
  type ObservationRow,
} from "./statsEngine";
import {
  conditionFromWeatherValues,
  conditionFromWmoWeatherCode,
} from "../shared/weatherConditionLabels";

function forecastRow(overrides: Partial<ForecastRow> = {}): ForecastRow {
  return {
    tempMax: null,
    tempMin: null,
    precipitation: null,
    windSpeed: null,
    cloudCover: null,
    condition: null,
    ...overrides,
  };
}

function observationRow(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    tempMax: null,
    tempMin: null,
    precipitation: null,
    windSpeed: null,
    cloudCover: null,
    condition: null,
    ...overrides,
  };
}

const categoryReference = {
  0: "Ensoleillé",
  1: "Partiellement nuageux",
  2: "Ciel couvert",
} as const;

describe("condition scoring — category unknown", () => {
  it("exclut un ID inconnu face à une condition partiellement nuageuse", () => {
    const result = calculateReliabilityScore(
      [forecastRow({ condition: "freezing_rain" })],
      [observationRow({ condition: "Partiellement nuageux" })],
      "stable",
    );

    expect(result.dimensions.condition).toMatchObject({ sampleSize: 0, score: null });
    expect(result.weightedScore).toBeNull();
  });

  it("exclut une paire de slugs inconnus anglais et français sans leur attribuer de catégorie", () => {
    const result = calculateReliabilityScore(
      [forecastRow({ condition: "freezing_rain" })],
      [observationRow({ condition: "pluie_verglacante" })],
      "stable",
    );

    expect(result.dimensions.condition).toMatchObject({ sampleSize: 0, score: null });
    expect(result.weightedScore).toBeNull();
  });

  it("n’inclut pas les paires inconnues dans sampleSize lorsqu’une paire valide subsiste", () => {
    const result = calculateReliabilityScore(
      [
        forecastRow({ tempMax: 22, tempMin: 12, condition: "freezing_rain" }),
        forecastRow({ tempMax: 22, tempMin: 12, condition: "Ensoleillé" }),
      ],
      [
        observationRow({ tempMax: 22, tempMin: 12, condition: "Partiellement nuageux" }),
        observationRow({ tempMax: 22, tempMin: 12, condition: "Clair" }),
      ],
      "stable",
    );

    expect(result.dimensions.condition).toMatchObject({ sampleSize: 1, concordance: 100, score: 100 });
    expect(result.weightedScore).toBe(100);
  });

  it("reconnaît les libellés français réellement émis par les mappings WMO et de valeurs météo", () => {
    const wmoCases: Array<{ code: number; category: 0 | 1 | 2 }> = [
      { code: 0, category: 0 },
      { code: 1, category: 1 },
      { code: 2, category: 1 },
      { code: 3, category: 2 },
      { code: 45, category: 2 }, // Brouillard
      { code: 51, category: 2 }, // Bruine
      { code: 61, category: 2 }, // Pluie
      { code: 71, category: 2 }, // Neige
      { code: 80, category: 1 }, // Averses, classification existante
      { code: 95, category: 2 }, // Orage violent
    ];

    for (const { code, category } of wmoCases) {
      const condition = conditionFromWmoWeatherCode(code, null, null);
      const result = calculateReliabilityScore(
        [forecastRow({ condition })],
        [observationRow({ condition: categoryReference[category] })],
      );
      expect(result.dimensions.condition.sampleSize, `WMO ${code}: ${condition}`).toBe(1);
      expect(result.dimensions.condition.concordance, `WMO ${code}: ${condition}`).toBe(100);
      expect(result.dimensions.condition.score, `WMO ${code}: ${condition}`).toBe(100);
    }

    const valueCases: Array<{ precipitation: number; cloudCover: number; category: 0 | 1 | 2 }> = [
      { precipitation: 0, cloudCover: 10, category: 0 },
      { precipitation: 0.5, cloudCover: 60, category: 2 },
      { precipitation: 2, cloudCover: 60, category: 1 }, // Averses, classification existante
      { precipitation: 6, cloudCover: 10, category: 2 },
    ];

    for (const { precipitation, cloudCover, category } of valueCases) {
      const condition = conditionFromWeatherValues(precipitation, cloudCover);
      const result = calculateReliabilityScore(
        [forecastRow({ condition })],
        [observationRow({ condition: categoryReference[category] })],
      );
      expect(result.dimensions.condition.sampleSize, condition).toBe(1);
      expect(result.dimensions.condition.concordance, condition).toBe(100);
    }
  });

  it("utilise une couverture nuageuse disponible et conserve sa MAE, sans inventer de label", () => {
    const partlyCloudyFallback = calculateReliabilityScore(
      [forecastRow({ condition: "freezing_rain", cloudCover: 60 })],
      [observationRow({ condition: "Partiellement nuageux" })],
    );
    expect(partlyCloudyFallback.dimensions.condition).toMatchObject({
      sampleSize: 1,
      concordance: 100,
      maeCloudCover: 0,
      score: 100,
    });

    const cloudError = calculateReliabilityScore(
      [forecastRow({ condition: "unknown_condition", cloudCover: 90 })],
      [observationRow({ condition: "unknown_observation", cloudCover: 10 })],
    );
    expect(cloudError.dimensions.condition).toMatchObject({
      sampleSize: 1,
      concordance: 0,
      maeCloudCover: 80,
    });
  });
});
