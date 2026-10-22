import { describe, expect, it } from "vitest";
import { buildLocationForecastUpdateData, REFERENCE_COORDINATE_TOLERANCE, referenceCoordinateBounds } from "./db";

describe("coordonnées de référence des stations", () => {
  it("conserve une tolérance faible autour du lieu demandé pour absorber les arrondis SQL", () => {
    const bounds = referenceCoordinateBounds(50.67601);
    expect(bounds).toEqual({
      min: 50.67601 - REFERENCE_COORDINATE_TOLERANCE,
      max: 50.67601 + REFERENCE_COORDINATE_TOLERANCE,
    });
    expect(bounds.min).toBeLessThan(50.67601);
    expect(bounds.max).toBeGreaterThan(50.67601);
  });
});

describe("upsert des prévisions favorites", () => {
  it("ne modifie pas le point météo actuel lors d’un rafraîchissement de prévision", () => {
    const update = buildLocationForecastUpdateData({
      favoriteLocationId: 4,
      userId: 12,
      lat: 50.75,
      lon: 2.52,
      date: "2026-09-30",
      tempMax: 19,
      tempMin: 11,
      tempCurrent: null,
      precipitation: 0,
      windSpeed: 8,
      condition: "Nuageux",
      aiScore: 72,
      confidenceScore: 72,
      stabilityIndex: 80,
    }, new Date("2026-09-30T08:00:00.000Z"));

    expect(update).not.toHaveProperty("tempCurrent");
    expect(update).toMatchObject({ tempMax: 19, tempMin: 11, updatedAt: new Date("2026-09-30T08:00:00.000Z") });
  });
});
