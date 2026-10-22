import { describe, expect, it } from "vitest";
import {
  buildHourlyHistogramSeries,
  getHourlyHistogramStartValidAt,
  HOURLY_HISTOGRAM_PALETTE,
  type HourlyHistogramForecast,
} from "./hourlyMiniHistogram";

function indexed(hours: HourlyHistogramForecast[]) {
  return hours.map((hour, index) => ({ index, hour }));
}

describe("mini-histogrammes horaires officiels", () => {
  it("prend le validTime explicitement cliqué comme départ commun", () => {
    const hours = indexed([
      { validAt: 10_000, precipitation: 0.2 },
      { validAt: 20_000, precipitation: 0.4 },
    ]);

    expect(getHourlyHistogramStartValidAt(hours, 0, 20_000, 15_000)).toBe(20_000);
  });

  it("démarre à l’heure active puis à la première heure future selon validTime réel", () => {
    const now = Date.parse("2026-10-25T00:35:00.000Z");
    const hours = indexed([
      { date: "2026-10-25", hour: "03:00", validAt: Date.parse("2026-10-25T02:00:00.000Z") },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z") },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z") },
    ]);

    expect(getHourlyHistogramStartValidAt(hours, 1, null, now)).toBe(Date.parse("2026-10-25T00:00:00.000Z"));
    expect(getHourlyHistogramStartValidAt(hours, -1, null, now)).toBe(Date.parse("2026-10-25T00:00:00.000Z"));
    const futureOnly = hours.filter(({ hour }) => hour.validAt !== Date.parse("2026-10-25T00:00:00.000Z"));
    expect(getHourlyHistogramStartValidAt(futureOnly, -1, null, now)).toBe(Date.parse("2026-10-25T01:00:00.000Z"));
  });

  it("trie par instant UTC, garde les deux heures répétées et laisse les trous sans interpolation", () => {
    const hours = indexed([
      { date: "2026-10-25", hour: "03:00", validAt: Date.parse("2026-10-25T02:00:00.000Z"), precipitation: 1.3, humidity: 61 },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z"), precipitation: 0.2, humidity: 65 },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z"), precipitation: null, humidity: 63 },
      { date: "2026-10-25", hour: "04:00", validAt: Date.parse("2026-10-25T03:00:00.000Z"), precipitation: 0.8, humidity: null },
    ]);

    const rain = buildHourlyHistogramSeries("precipitation", hours, Date.parse("2026-10-25T00:00:00.000Z"))[0];
    const humidity = buildHourlyHistogramSeries("humidity", hours, Date.parse("2026-10-25T00:00:00.000Z"))[0];

    expect(rain.points.map(({ validAt }) => validAt)).toEqual([
      Date.parse("2026-10-25T00:00:00.000Z"),
      Date.parse("2026-10-25T01:00:00.000Z"),
      Date.parse("2026-10-25T02:00:00.000Z"),
      Date.parse("2026-10-25T03:00:00.000Z"),
    ]);
    expect(rain.points.map(({ value }) => value)).toEqual([0.2, null, 1.3, 0.8]);
    expect(humidity.points.map(({ validAt }) => validAt)).toEqual(rain.points.map(({ validAt }) => validAt));
    expect(humidity.points.map(({ value }) => value)).toEqual([65, 63, 61, null]);
  });

  it("exclut les échéances avant le départ et ne fabrique pas de série catégorielle ou indisponible", () => {
    const hours = indexed([
      { validAt: 1_000, precipitation: 0.1, weatherCode: 3 },
      { validAt: 2_000, precipitation: 0.4, weatherCode: 4 },
    ]);

    expect(buildHourlyHistogramSeries("precipitation", hours, 2_000)[0]?.points.map(({ validAt }) => validAt)).toEqual([2_000]);
    expect(buildHourlyHistogramSeries("precip-type", hours, 1_000)).toEqual([]);
    expect(buildHourlyHistogramSeries("weather-code", hours, 1_000)).toEqual([]);
    expect(buildHourlyHistogramSeries("air-quality", hours, 1_000)).toEqual([]);
    expect(buildHourlyHistogramSeries("precipitation", hours, null)).toEqual([]);
  });

  it("attribue une couleur stable et distincte aux rubriques numériques, sans encoder une confiance", () => {
    const variableColors = Object.entries(HOURLY_HISTOGRAM_PALETTE)
      .filter(([category]) => category !== "air-quality")
      .map(([, palette]) => palette.barClassName);

    expect(variableColors).toHaveLength(9);
    expect(new Set(variableColors).size).toBe(variableColors.length);
    expect(HOURLY_HISTOGRAM_PALETTE.precipitation.barClassName).toBe("bg-sky-400");
    expect(HOURLY_HISTOGRAM_PALETTE.wind.barClassName).toBe("bg-teal-400");
    expect(HOURLY_HISTOGRAM_PALETTE.humidity.barClassName).toBe("bg-cyan-400");
    expect(HOURLY_HISTOGRAM_PALETTE.clouds.barClassName).toBe("bg-slate-400");
    expect(HOURLY_HISTOGRAM_PALETTE.pressure.barClassName).toBe("bg-violet-400");
    expect(HOURLY_HISTOGRAM_PALETTE.uv.barClassName).toBe("bg-amber-400");
    expect(HOURLY_HISTOGRAM_PALETTE.apparent.barClassName).toBe("bg-rose-400");
    expect(HOURLY_HISTOGRAM_PALETTE.visibility.barClassName).toBe("bg-blue-300");
    expect(HOURLY_HISTOGRAM_PALETTE.radiation.barClassName).toBe("bg-orange-400");
    expect(HOURLY_HISTOGRAM_PALETTE["air-quality"].barClassName).toBe("bg-emerald-400");
  });
});
