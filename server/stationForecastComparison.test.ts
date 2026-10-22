import { describe, expect, it } from "vitest";
import type { HourlyPoint } from "./weatherServices";
import { buildStationForecastComparison24h } from "./stationForecastComparison";

function point(date: string, hour: string, validAt: number, temp: number | null): HourlyPoint {
  return { date, hour, validAt, temp, precipitation: null, windSpeed: null } as HourlyPoint;
}

describe("buildStationForecastComparison24h", () => {
  it("compare uniquement avec les relevés du même instant UTC, sans reprendre l’heure du jour précédent", () => {
    const validAt = Date.parse("2026-07-10T07:00:00Z"); // 09 h à Paris
    const result = buildStationForecastComparison24h("2026-07-10", [
      point("2026-07-10", "09:00", validAt, 21),
    ], [
      { observedAt: validAt + 10 * 60_000, temperature: 20, windSpeed: 5, precipitation: 0 },
      { observedAt: validAt + 40 * 60_000, temperature: 22, windSpeed: 7, precipitation: 2 },
      { observedAt: validAt - 24 * 60 * 60_000, temperature: 99, windSpeed: 99, precipitation: 99 },
    ]);

    expect(result).toHaveLength(24);
    expect(result[9]).toMatchObject({
      hour: 9,
      validAt,
      stationTemperature: 21,
      stationWindSpeed: 6,
      stationPrecipitation: 1,
      stationSampleCount: 2,
      officialTemperature: 21,
    });
  });

  it("conserve les deux instants 02 h distincts au retour à l’heure d’hiver", () => {
    const firstValidAt = Date.parse("2026-10-25T00:00:00Z");
    const secondValidAt = Date.parse("2026-10-25T01:00:00Z");
    const result = buildStationForecastComparison24h("2026-10-25", [
      point("2026-10-25", "02:00", firstValidAt, 8),
      point("2026-10-25", "02:00", secondValidAt, 12),
    ], [
      { observedAt: firstValidAt + 20 * 60_000, temperature: 7, windSpeed: 4, precipitation: 0 },
      { observedAt: secondValidAt + 20 * 60_000, temperature: 11, windSpeed: 6, precipitation: 1 },
    ]);
    const repeatedHours = result.filter((item) => item.hour === 2);

    expect(result).toHaveLength(25);
    expect(repeatedHours).toHaveLength(2);
    expect(repeatedHours.map((item) => item.validAt)).toEqual([firstValidAt, secondValidAt]);
    expect(repeatedHours.map((item) => item.stationTemperature)).toEqual([7, 11]);
    expect(new Set(repeatedHours.map((item) => item.label)).size).toBe(2);
  });

  it("n’invente pas de prévision ou de comparaison quand aucune heure officielle n’est qualifiée", () => {
    const result = buildStationForecastComparison24h("2026-07-10", [], [
      { observedAt: Date.parse("2026-07-10T07:10:00Z"), temperature: 20, windSpeed: 5, precipitation: 0 },
    ]);

    expect(result).toHaveLength(24);
    expect(result.every((item) => item.officialTemperature === null && item.stationTemperature === null)).toBe(true);
  });
});
