import { describe, expect, it } from "vitest";
import { buildForecastUpdateSet } from "./forecastWrite";

describe("écriture idempotente des prévisions", () => {
  it("remplace les champs météo et horodate une collecte répétée", () => {
    const collectedAt = new Date("2026-08-12T05:21:59.000Z");
    const update = buildForecastUpdateSet({
      serviceCategory: "expert",
      tempMax: 31.4,
      tempMin: 13.8,
      precipitation: 0,
      windSpeed: 14.6,
      windGust: 25.2,
      humidity: 52,
      cloudCover: 20,
      condition: "Peu nuageux",
      rawData: { source: "test" },
    }, collectedAt);

    expect(update.tempMax).toBe(31.4);
    expect(update.rawData).toEqual({ source: "test" });
    expect(update.collectedAt).toBe(collectedAt);
  });
});
