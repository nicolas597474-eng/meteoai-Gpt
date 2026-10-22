import React from "react";
import { formatOptionalForecastValue } from "@/lib/forecastTimeline";
import { formatHourlyDisplay } from "@/lib/hourlyDisplay";
import {
  HOURLY_HISTOGRAM_PALETTE,
  type HourlyHistogramCategoryKey,
  type HourlyHistogramForecast,
  type HourlyHistogramSeries,
} from "@/lib/hourlyMiniHistogram";

function compactUtcOffset(offsetLabel: string | null): string | null {
  if (!offsetLabel) return null;
  return offsetLabel.replace(/^Europe\/Paris\s+/, "").replace(/:00$/, "");
}

const HOUR_MS = 3_600_000;
const SLOT_WIDTH = 50;
const PLOT_HEIGHT = 76;

function pointY(value: number, minimum: number, maximum: number): number {
  if (minimum === maximum) return PLOT_HEIGHT / 2;
  return 8 + (1 - (value - minimum) / (maximum - minimum)) * (PLOT_HEIGHT - 16);
}

function compactDateLabel(validAt: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Paris",
  }).format(validAt);
}

export function HourlyMiniCurve<T extends HourlyHistogramForecast>({
  categoryKey,
  series,
  allHours,
  selectedValidAt,
}: {
  categoryKey: string;
  series: HourlyHistogramSeries<T>;
  allHours: readonly T[];
  selectedValidAt?: number | null;
}) {
  const palette = HOURLY_HISTOGRAM_PALETTE[
    categoryKey as HourlyHistogramCategoryKey
  ];
  const availableValues = series.points
    .map(({ value }) => value)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!palette || availableValues.length === 0 || series.points.length === 0) return null;

  const minimum = Math.min(...availableValues);
  const maximum = Math.max(...availableValues);
  const firstValidAt = series.points[0].validAt;
  const xFor = (validAt: number) => SLOT_WIDTH / 2 + ((validAt - firstValidAt) / HOUR_MS) * SLOT_WIDTH;
  const plotWidth = xFor(series.points.at(-1)!.validAt) + SLOT_WIDTH / 2;
  const segments: string[] = [];
  let segment = "";
  let previousAt: number | null = null;
  for (const point of series.points) {
    if (point.value == null || !Number.isFinite(point.value)) {
      if (segment) segments.push(segment);
      segment = "";
      previousAt = null;
      continue;
    }
    if (previousAt != null && point.validAt - previousAt !== HOUR_MS) {
      if (segment) segments.push(segment);
      segment = "";
    }
    segment += `${segment ? " L" : "M"}${xFor(point.validAt)},${pointY(point.value, minimum, maximum)}`;
    previousAt = point.validAt;
  }
  if (segment) segments.push(segment);
  const hasOffsetLabels = series.points.some(point => formatHourlyDisplay(point.hour, allHours).offsetLabel);

  return (
    <div
      role="group"
      aria-label={`Courbe ${series.label}${series.unit ? `, ${series.unit}` : ""} · valeurs horaires officielles · la couleur identifie la variable, pas la qualité ni la confiance`}
      className="mt-3 min-w-0 rounded-lg border border-slate-700/60 bg-slate-900/35 p-2"
    >
      <div className="mb-1 flex min-w-0 items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] font-semibold text-slate-100">{series.label}</p>
        {series.unit && <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{series.unit}</span>}
      </div>
      <div className="overflow-x-auto overscroll-x-contain touch-pan-x scrollbar-hide">
        <div role="list" className="relative w-max min-w-full" style={{ width: plotWidth, height: hasOffsetLabels ? 146 : 134 }}>
          <svg aria-hidden="true" className="absolute left-0 top-6" width={plotWidth} height={PLOT_HEIGHT} viewBox={`0 0 ${plotWidth} ${PLOT_HEIGHT}`}>
            {[8, PLOT_HEIGHT / 2, PLOT_HEIGHT - 8].map(y => <line key={y} x1={0} x2={plotWidth} y1={y} y2={y} stroke="#334155" strokeOpacity={0.45} strokeDasharray="2 4" />)}
            {segments.map((d, index) => <path key={index} data-hourly-curve-segment="true" d={d} fill="none" stroke={palette.barColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />)}
            {series.points.filter(point => point.value != null && Number.isFinite(point.value)).map(point => {
              const selected = selectedValidAt != null && point.validAt === selectedValidAt;
              return <circle key={point.key} cx={xFor(point.validAt)} cy={pointY(point.value!, minimum, maximum)} r={selected ? 5 : 3} fill={palette.barColor} stroke={selected ? "#cffafe" : "#0f172a"} strokeWidth={selected ? 2 : 1} />;
            })}
          </svg>
          {series.points.map((point) => {
            const isSelected = selectedValidAt != null && point.validAt === selectedValidAt;
            const display = formatHourlyDisplay(point.hour, allHours);
            const valueLabel = point.value == null
              ? "—"
              : formatOptionalForecastValue(point.value, series.decimals);
            const dateLabel = compactDateLabel(point.validAt);
            const offsetLabel = compactUtcOffset(display.offsetLabel);
            const spokenTime = `${display.dateLabel}, ${display.hourLabel}${display.offsetLabel ? `, ${display.offsetLabel}` : ""}`;
            const spokenValue = point.value == null
              ? "valeur indisponible"
              : `${valueLabel}${series.unit ? ` ${series.unit}` : ""}`;
            return (
              <div
                key={point.key}
                role="listitem"
                aria-current={isSelected ? "true" : undefined}
                aria-label={`${isSelected ? "Échéance sélectionnée, " : ""}${spokenTime} · ${series.label} ${spokenValue}`}
                title={`${spokenTime} · ${series.label} ${spokenValue}`}
                className={`absolute top-0 flex w-[50px] flex-col items-center rounded-md px-0.5 pb-0.5 text-center ${isSelected ? "bg-cyan-100/[0.08] ring-1 ring-inset ring-cyan-100/75" : ""}`}
                style={{ left: xFor(point.validAt) - SLOT_WIDTH / 2 }}
              >
                <span className={`block h-6 max-w-full truncate text-[10px] leading-6 tabular-nums ${isSelected ? "font-semibold text-cyan-100" : "text-slate-200"}`}>
                  {valueLabel}
                </span>
                <span className="block w-full" style={{ height: PLOT_HEIGHT }} aria-hidden="true" />
                <span className={`block w-full truncate text-[10px] leading-3 ${isSelected ? "text-cyan-100" : "text-slate-500"}`}>{dateLabel}</span>
                <span className={`block w-full truncate text-[11px] leading-4 tabular-nums ${isSelected ? "font-semibold text-cyan-100" : "text-slate-200"}`}>{display.hourLabel}</span>
                {offsetLabel && <span className="block w-full truncate text-[8px] leading-3 tabular-nums text-amber-200">{offsetLabel}</span>}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-0.5 text-[9px] leading-relaxed text-slate-500">Valeurs exactes indiquées ; bordure cyan : échéance sélectionnée. Les données absentes interrompent la courbe. La couleur identifie la variable, pas la qualité ni la confiance.</p>
    </div>
  );
}

