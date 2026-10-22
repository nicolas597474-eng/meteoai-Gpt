import { describe, expect, it } from "vitest";
import {
  buildForecastDisplayDays,
  formatDailyTemperature,
  getDailyExtremesDisplayLabel,
  getDailyForecastDisplayMetrics,
  getForecastDateKey,
  getNextForecastDateKey,
  getDailyReferenceSourceLabels,
  isSnowWmoWeatherCode,
} from "@/lib/forecastDayDisplay";

describe("forecast display days", () => {
  it("keeps official hourly dates distinct and uses only real daily dates after them, capped at 15", () => {
    const dailyDays = Array.from({ length: 16 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 9, 3 + index)).toISOString().slice(0, 10),
      tempMax: 18 + index,
      tempMin: 8 + index,
    }));
    const hours = [
      { date: "2026-10-03", hour: "09:00", temp: 12 },
      { date: "2026-10-03", hour: "10:00", temp: 13 },
      { date: "2026-10-04", hour: "00:00", temp: 11 },
    ];

    const result = buildForecastDisplayDays(hours, dailyDays);

    expect(result).toHaveLength(15);
    expect(result[0]).toMatchObject({
      date: "2026-10-03",
      kind: "official-hourly",
      daily: null,
    });
    expect(result[1]).toMatchObject({
      date: "2026-10-04",
      kind: "official-hourly",
      daily: null,
    });
    expect(result[2]).toMatchObject({
      date: "2026-10-05",
      kind: "official-daily-fusion",
      hourlyGroup: null,
    });
    expect(result.at(-1)?.date).toBe("2026-10-17");
    expect(
      result.every(day => day.kind !== "official-hourly" || day.daily === null)
    ).toBe(true);
  });

  it("attaches exact daily values alongside an hourly date without changing the hourly series", () => {
    const date = "2026-10-06";
    const daily = {
      date,
      tempMax: 21.4,
      tempMin: 8.2,
      precipitation: 2.3,
      windSpeed: 18,
      windGust: 31,
      humidity: 72,
      cloudCover: 48,
      weatherCode: 53,
      sunrise: "07:42",
      sunset: "19:03",
    };
    const hours = [
      { date, hour: "10:00", temp: 13.6 },
      { date, hour: "11:00", temp: 14.1 },
    ];

    const [result] = buildForecastDisplayDays(hours, [daily], 15, [date]);

    expect(result).toMatchObject({ date, kind: "official-hourly", daily });
    expect(result.hourlyGroup?.hours.map(({ hour }) => hour.temp)).toEqual([13.6, 14.1]);
    expect(formatDailyTemperature(21.4)).toBe("21,4 °C");
    expect(getDailyExtremesDisplayLabel(result.daily)).toBe("Tmax 21,4 °C · Tmin 8,2 °C");
    expect(getDailyForecastDisplayMetrics(daily).find(({ key }) => key === "precipitation")).toMatchObject({ value: 2.3, unit: "mm" });
    expect(getDailyForecastDisplayMetrics(daily).find(({ key }) => key === "weatherCode")).toMatchObject({ value: 53, unit: "WMO" });
    expect(result.daily?.weatherCode).toBe(53);
    expect(result.hourlyGroup?.hours[0]?.hour).not.toHaveProperty("weatherCode");
  });

  it("keeps daily metrics explicitly unavailable when only hourly data exists", () => {
    const date = "2026-10-06";
    const [result] = buildForecastDisplayDays(
      [{ date, hour: "10:00", temp: 19 }],
      [],
      15,
      [date],
    );

    expect(result).toMatchObject({ kind: "official-hourly", daily: null });
    expect(getDailyExtremesDisplayLabel(result.daily)).toBe("Extrêmes journaliers indisponibles");
  });

  it("reports a missing daily extreme without substituting the hourly temperature", () => {
    const date = "2026-10-06";
    const daily = { date, tempMax: 20.5, tempMin: null };
    const [result] = buildForecastDisplayDays(
      [{ date, hour: "13:00", temp: 30 }],
      [daily],
      15,
      [date],
    );

    expect(result.hourlyGroup?.hours[0]?.hour.temp).toBe(30);
    expect(getDailyExtremesDisplayLabel(result.daily)).toBe("Tmax 20,5 °C · Tmin indisponible");
    expect(getDailyForecastDisplayMetrics(result.daily!).find(({ key }) => key === "tempMin")?.value).toBeNull();
  });

  it("uses the forecast contract timezone for today/tomorrow and leaves date keys unshifted", () => {
    expect(getForecastDateKey(Date.parse("2026-10-06T21:59:00.000Z"))).toBe("2026-10-06");
    expect(getForecastDateKey(Date.parse("2026-10-06T22:00:00.000Z"))).toBe("2026-10-07");
    expect(getNextForecastDateKey("2026-10-31")).toBe("2026-11-01");
  });

  it("does not invent dates when either source is sparse or undated", () => {
    const result = buildForecastDisplayDays(
      [{ date: "2026-10-03", hour: "09:00" }, { hour: "10:00" }],
      [
        { date: "2026-10-06", tempMax: 19 },
        { date: "not-a-date", tempMax: 20 },
      ]
    );

    expect(result.map(({ date, kind }) => [date, kind])).toEqual([
      ["2026-10-03", "official-hourly"],
      ["2026-10-06", "official-daily-fusion"],
    ]);
  });

  it("names Best Match only as a non-independent aggregator and preserves sources actually returned", () => {
    expect(
      getDailyReferenceSourceLabels([
        "ECMWF",
        "GFS",
        "ICON",
        "Open-Meteo",
        "ECMWF",
      ])
    ).toEqual([
      "ECMWF",
      "GFS",
      "ICON",
      "Best Match · référence dérivée, non contributeur officiel",
    ]);
    expect(getDailyReferenceSourceLabels([])).toEqual([]);
  });

  it("recognizes only valid WMO snow and snow-shower codes", () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
      expect(isSnowWmoWeatherCode(code)).toBe(true);
    }
    for (const code of [0, 61, 82, 95, null, undefined, 999, 71.5]) {
      expect(isSnowWmoWeatherCode(code)).toBe(false);
    }
  });
});
