import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HourlyMiniCurve } from "./HourlyMiniCurve";
import { buildHourlyHistogramSeries, type HourlyHistogramForecast } from "@/lib/hourlyMiniHistogram";

describe("rendu des mini-courbes horaires", () => {
  it("garde une ligne visible pour des valeurs nulles au sens physique : zéro reste une mesure", () => {
    const start = Date.parse("2026-10-22T05:00:00Z");
    const hours = [{validAt:start,precipitation:0},{validAt:start+3_600_000,precipitation:0}];
    const series = buildHourlyHistogramSeries("precipitation",hours.map((hour,index)=>({hour,index})),start)[0];
    const html = renderToStaticMarkup(createElement(HourlyMiniCurve,{categoryKey:"precipitation",series,allHours:hours}));
    expect(html).toContain('d="M25,38 L75,38"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("respecte l’écart UTC réel et ne trace pas de liaison par-dessus une heure absente", () => {
    const start = Date.parse("2026-10-22T05:00:00Z");
    const hours = [{validAt:start,dewPoint:-5},{validAt:start+3_600_000,dewPoint:-2},{validAt:start+10_800_000,dewPoint:0}];
    const series = buildHourlyHistogramSeries("humidity",hours.map((hour,index)=>({hour,index})),start).find(s=>s.field==='dewPoint')!;
    const html = renderToStaticMarkup(createElement(HourlyMiniCurve,{categoryKey:"humidity",series,allHours:hours}));
    expect(html.match(/data-hourly-curve-segment="true"/g)).toHaveLength(2);
    expect(html).toContain('d="M25,68 L75,32"');
    expect(html).toContain('d="M175,8"');
    expect(html).toContain('left:150px');
  });

  it("rend un axe dense mais défilable, avec valeurs exactes et les deux instants d’une heure répétée", () => {
    const hours: HourlyHistogramForecast[] = [
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z"), precipitation: 0.2 },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z"), precipitation: null },
      { date: "2026-10-25", hour: "03:00", validAt: Date.parse("2026-10-25T02:00:00.000Z"), precipitation: 1.4 },
    ];
    const series = buildHourlyHistogramSeries(
      "precipitation",
      hours.map((hour, index) => ({ index, hour })),
      hours[0].validAt!,
    )[0];
    const html = renderToStaticMarkup(createElement(HourlyMiniCurve, {
      categoryKey: "precipitation",
      series,
      allHours: hours,
    }));

    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("touch-pan-x");
    expect(html).toContain("w-max min-w-full");
    expect(html.match(/role="listitem"/g)).toHaveLength(3);
    expect(html).toContain("0.2");
    expect(html).toContain("1.4");
    expect(html).toContain("—");
    expect(html).toContain("UTC+02");
    expect(html).toContain("UTC+01");
    expect(html).toContain('stroke="#38bdf8"');
    expect(html.match(/data-hourly-curve-segment="true"/g)).toHaveLength(2);
    expect(html.match(/<circle /g)).toHaveLength(2);
    expect(html).not.toMatch(/ d="[^"]* L/);
    expect(html).toContain("La couleur identifie la variable, pas la qualité ni la confiance");
  });

  it("ne rend aucune courbe s’il n’y a pas de valeur numérique disponible", () => {
    const hours: HourlyHistogramForecast[] = [
      { date: "2026-10-06", hour: "18:00", validAt: Date.parse("2026-10-06T16:00:00.000Z"), precipitation: null },
    ];
    const series = buildHourlyHistogramSeries(
      "precipitation",
      hours.map((hour, index) => ({ index, hour })),
      hours[0].validAt!,
    );

    expect(series).toEqual([]);
    expect(renderToStaticMarkup(createElement(HourlyMiniCurve, {
      categoryKey: "precipitation",
      series: { field: "precipitation", label: "Précipitations", unit: "mm", decimals: 1, points: [] },
      allHours: hours,
    }))).toBe("");
  });

  it("marque exactement l’échéance sélectionnée, même quand sa valeur est absente", () => {
    const hours: HourlyHistogramForecast[] = [
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z"), precipitation: 0.2 },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z"), precipitation: null },
      { date: "2026-10-25", hour: "03:00", validAt: Date.parse("2026-10-25T02:00:00.000Z"), precipitation: 1.4 },
    ];
    const series = buildHourlyHistogramSeries(
      "precipitation",
      hours.map((hour, index) => ({ index, hour })),
      hours[0].validAt!,
    )[0];
    const html = renderToStaticMarkup(createElement(HourlyMiniCurve, {
      categoryKey: "precipitation",
      series,
      allHours: hours,
      selectedValidAt: hours[1].validAt,
    }));

    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("Échéance sélectionnée");
    expect(html).toContain("ring-cyan-100/75");
  });
});
