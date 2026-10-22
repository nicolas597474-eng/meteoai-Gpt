import { describe, expect, it } from "vitest";
import { hideUncalibratedCurrentDailyForecast } from "./db";

const today = "2026-10-02";
const baseRow = {
  date: today,
  weights: { version: 1, weightByService: { AROME: 1 } },
  tempMax: 22,
  tempMin: 12,
  precipitation: 1.2,
  windSpeed: 14,
  windGust: 25,
  humidity: 60,
  cloudCover: 40,
  condition: "Nuageux",
  confidenceScore: 78,
  computedAt: new Date("2026-10-02T08:00:00.000Z"),
};

describe("hideUncalibratedCurrentDailyForecast", () => {
  it("masque un instantané v1 encore stocké pour aujourd’hui sans supprimer sa trace ni son horodatage", () => {
    const result = hideUncalibratedCurrentDailyForecast(baseRow, today);
    expect(result).toMatchObject({
      date: today,
      tempMax: null,
      tempMin: null,
      precipitation: null,
      windSpeed: null,
      confidenceScore: null,
      computedAt: baseRow.computedAt,
      weights: baseRow.weights,
    });
  });

  it("préserve une prévision historique v1 et une prévision du jour v2 qualifiée", () => {
    const historical = { ...baseRow, date: "2026-10-01" };
    expect(hideUncalibratedCurrentDailyForecast(historical, today)).toBe(historical);

    const calibrated = {
      ...baseRow,
      weights: {
        version: 2,
        trace: {
          calibrationStatus: {
            tempMax: "calibrated",
            tempMin: "calibrated",
            precipitation: "calibrated",
            windSpeed: "calibrated",
          },
        },
      },
    };
    expect(hideUncalibratedCurrentDailyForecast(calibrated, today)).toBe(calibrated);
  });

  it("masque encore le jour courant si la trace v2 n’a pas les quatre métriques principales", () => {
    const partial = {
      ...baseRow,
      weights: { version: 2, trace: { calibrationStatus: { tempMax: "calibrated" } } },
    };
    expect(hideUncalibratedCurrentDailyForecast(partial, today).tempMax).toBeNull();
  });
});
