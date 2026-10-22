import { describe, expect, it } from "vitest";
import { buildWeatherProvenance } from "./weatherProvenance";

const hourlyPoint = { hour: "14:00", temp: 20, apparentTemp: 20, precipitation: 0, windSpeed: 10, windGust: 15, windDirection: 180, cloudCover: 50, humidity: 60, uvIndex: 3, condition: "Nuageux" };
const dailyPoint = { date: "2026-08-20", tempMax: 22, tempMin: 13, precipitation: 0, windSpeed: 15, windGust: 22, windDirection: 180, cloudCover: 50, humidity: 60, condition: "Nuageux", uvMax: 5, sunrise: "06:30", sunset: "20:45" };

describe("buildWeatherProvenance", () => {
  it("décrit une source horaire réellement disponible", () => {
    const provenance = buildWeatherProvenance({ computedAt: "2026-08-20T12:00:00.000Z", source: "open-meteo_best_match", hourly: [hourlyPoint], daily: [dailyPoint], modelsUsed: ["ECMWF"] }, null);

    expect(provenance).toMatchObject({ kind: "hourly_forecast", hourlyCoverage: 1, dailyCoverage: 1, modelsUsed: 1, fallbackReason: null });
  });

  it("explique le repli quotidien réel lorsque les heures sont absentes", () => {
    const provenance = buildWeatherProvenance({ computedAt: "2026-08-20T12:00:00.000Z", source: "open-meteo_best_match", hourly: [], daily: [], modelsUsed: [] }, {
      kind: "daily_fusion", date: "2026-08-19", computedAt: "2026-08-19T03:05:00.000Z", tempMax: 21, tempMin: 11, precipitation: 1, windSpeed: 12, condition: "Nuageux", confidenceScore: 70,
    });

    expect(provenance).toMatchObject({ kind: "daily_fusion", fallbackReason: "hourly_unavailable", updatedAt: "2026-08-19T03:05:00.000Z" });
  });

  it("signale explicitement l’absence de provenance exploitable", () => {
    const provenance = buildWeatherProvenance({ computedAt: "2026-08-20T12:00:00.000Z", source: "open-meteo_best_match", hourly: [], daily: [], modelsUsed: [] }, null);

    expect(provenance).toMatchObject({ kind: "unavailable", updatedAt: null, fallbackReason: "no_hourly_or_daily_fusion" });
  });
});
