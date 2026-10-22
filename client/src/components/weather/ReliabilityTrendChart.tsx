import { useMemo, useState } from "react";
import { Activity, CalendarDays, Clock3 } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MeteoSurface } from "@/components/weather/MeteoSurface";

type HourlyPoint = {
  hour: number;
  label: string;
  stationTemperature: number | null;
  stationPrecipitation: number | null;
  stationSampleCount: number;
  officialTemperature: number | null;
  officialPrecipitation: number | null;
};

type DailyPoint = {
  label: string;
  stationTemperature: number | null;
  stationSampleCount: number;
  officialTemperature: number | null;
};

type Props = {
  hourlyPoints: HourlyPoint[];
  dailyPoints: DailyPoint[];
  periodLabel?: string;
  hourlyWindow?: string;
  basis?: string;
  isLoading?: boolean;
  isError?: boolean;
};

type View = "hourly" | "daily";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-700/65 bg-slate-950/30 px-3 py-2.5">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-100">
        {value}
      </p>
    </div>
  );
}

function LegendItem({
  color,
  label,
  dashed = false,
  bar = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  bar?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-700/70 bg-slate-950/30 px-2.5 py-1.5 text-[11px] text-slate-300">
      <span
        className={
          bar
            ? "h-2.5 w-2.5 rounded-[3px]"
            : `h-0 w-4 border-t-2 ${dashed ? "border-dashed" : "border-solid"}`
        }
        style={bar ? { backgroundColor: color } : { borderColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export function ReliabilityTrendChart({
  hourlyPoints,
  dailyPoints,
  periodLabel = "Période sélectionnée",
  hourlyWindow = "Fenêtre sélectionnée",
  basis = "Comparaisons archivées",
  isLoading = false,
  isError = false,
}: Props) {
  const [view, setView] = useState<View>("hourly");
  const hasRainData = useMemo(
    () =>
      hourlyPoints.some(
        point =>
          point.stationPrecipitation != null ||
          point.officialPrecipitation != null
      ),
    [hourlyPoints]
  );
  const matchedHours = hourlyPoints.filter(
    point =>
      point.stationTemperature != null && point.officialTemperature != null
  ).length;
  const observedHours = hourlyPoints.filter(
    point => point.stationTemperature != null
  ).length;
  const matchedDays = dailyPoints.filter(
    point =>
      point.stationTemperature != null && point.officialTemperature != null
  ).length;
  const points = view === "hourly" ? hourlyPoints : dailyPoints;
  const hasData =
    view === "hourly"
      ? hourlyPoints.some(
          point =>
            point.stationTemperature != null ||
            point.officialTemperature != null ||
            point.stationPrecipitation != null ||
            point.officialPrecipitation != null
        )
      : dailyPoints.some(
          point =>
            point.stationTemperature != null ||
            point.officialTemperature != null
        );

  return (
    <MeteoSurface
      tone="lab"
      as="section"
      className="overflow-hidden rounded-[1.6rem] p-4 sm:p-5"
      aria-labelledby="reliability-chart-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="weather-icon-bare grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-sky-400/20 bg-sky-400/10">
            <Activity className="h-5 w-5 text-sky-300" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="reliability-chart-title"
              className="text-lg font-semibold tracking-tight text-white"
            >
              Annoncé contre constaté
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {basis} · {periodLabel}
            </p>
          </div>
        </div>
        <div
          className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-700/75 bg-slate-950/45 p-1"
          role="group"
          aria-label="Période du graphique"
        >
          <button
            type="button"
            onClick={() => setView("hourly")}
            aria-pressed={view === "hourly"}
            className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${view === "hourly" ? "bg-sky-400/15 text-sky-100 ring-1 ring-sky-400/25" : "text-slate-400 hover:text-slate-100"}`}
          >
            <Clock3 className="h-3.5 w-3.5" /> Horaire
          </button>
          <button
            type="button"
            onClick={() => setView("daily")}
            aria-pressed={view === "daily"}
            className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${view === "daily" ? "bg-sky-400/15 text-sky-100 ring-1 ring-sky-400/25" : "text-slate-400 hover:text-slate-100"}`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Quotidien
          </button>
        </div>
      </div>

      <div
        className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide"
        aria-label="Légende du graphique"
      >
        <LegendItem color="#34d399" label="Constaté · stations" />
        <LegendItem color="#38bdf8" label="Annoncé · moyenne des modèles" dashed />
        {view === "hourly" && hasRainData ? (
          <>
            <LegendItem color="#2dd4bf" label="Pluie constatée" bar />
            <LegendItem color="#60a5fa" label="Pluie annoncée" bar />
          </>
        ) : null}
      </div>

      <div className="mt-1 min-h-[16rem] rounded-2xl border border-slate-800/80 bg-slate-950/25 px-1 py-3 sm:px-3">
        {isLoading ? (
          <div
            className="h-60 animate-pulse rounded-xl bg-slate-800/45"
            aria-label="Chargement du graphique"
          />
        ) : isError ? (
          <div className="grid h-60 place-items-center px-5 text-center text-xs leading-relaxed text-slate-400">
            Les comparaisons de stations sont momentanément indisponibles.
            Aucune courbe n’est estimée.
          </div>
        ) : !hasData ? (
          <div className="grid h-60 place-items-center px-5 text-center text-xs leading-relaxed text-slate-400">
            Aucune paire prévision–observation n’est disponible sur cette
            période pour le lieu choisi.
          </div>
        ) : (
          <div className="h-60 w-full sm:h-[18rem]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={points}
                margin={{
                  top: 8,
                  right: view === "hourly" && hasRainData ? 2 : 4,
                  left: -16,
                  bottom: 0,
                }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="#243244"
                  strokeDasharray="3 5"
                />
                <XAxis
                  dataKey="label"
                  interval="preserveStartEnd"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={12}
                />
                <YAxis
                  yAxisId="temperature"
                  width={42}
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickFormatter={(value: number) => `${value}°`}
                  axisLine={false}
                  tickLine={false}
                  domain={["auto", "auto"]}
                />
                {view === "hourly" && hasRainData ? (
                  <YAxis
                    yAxisId="precipitation"
                    orientation="right"
                    width={42}
                    tick={{ fill: "#64748b", fontSize: 9 }}
                    tickFormatter={(value: number) => `${value} mm`}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, "auto"]}
                  />
                ) : null}
                <Tooltip
                  cursor={{
                    stroke: "#7dd3fc",
                    strokeWidth: 1,
                    strokeDasharray: "4 4",
                  }}
                  contentStyle={{
                    backgroundColor: "#0b111a",
                    border: "1px solid rgba(100,116,139,.55)",
                    borderRadius: 12,
                    color: "#e2e8f0",
                    fontSize: 11,
                  }}
                  labelStyle={{
                    color: "#f1f5f9",
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                  itemStyle={{
                    color: "#cbd5e1",
                    paddingTop: 2,
                    paddingBottom: 2,
                  }}
                  formatter={(value, name) => {
                    if (value == null) return ["—", String(name)];
                    const precipitation = String(name)
                      .toLowerCase()
                      .includes("pluie");
                    return [
                      `${Number(value).toFixed(1)} ${precipitation ? "mm" : "°C"}`,
                      String(name),
                    ];
                  }}
                />
                {view === "hourly" && hasRainData ? (
                  <>
                    <Bar
                      yAxisId="precipitation"
                      dataKey="stationPrecipitation"
                      name="Pluie constatée"
                      fill="#2dd4bf"
                      fillOpacity={0.55}
                      maxBarSize={11}
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      yAxisId="precipitation"
                      dataKey="officialPrecipitation"
                      name="Pluie annoncée"
                      fill="#60a5fa"
                      fillOpacity={0.45}
                      maxBarSize={11}
                      radius={[3, 3, 0, 0]}
                    />
                  </>
                ) : null}
                <Line
                  yAxisId="temperature"
                  type="monotone"
                  dataKey="stationTemperature"
                  name="Température constatée"
                  stroke="#34d399"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#6ee7b7",
                    stroke: "#052e2b",
                    strokeWidth: 2,
                  }}
                  connectNulls={false}
                />
                <Line
                  yAxisId="temperature"
                  type="monotone"
                  dataKey="officialTemperature"
                  name="Température annoncée"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#7dd3fc",
                    stroke: "#082f49",
                    strokeWidth: 2,
                  }}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {!isLoading && !isError && hasData ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label={view === "hourly" ? "Heures appariées" : "Jours appariés"}
            value={`${view === "hourly" ? matchedHours : matchedDays}`}
          />
          <Stat
            label={view === "hourly" ? "Température mesurée" : "Jours avec température"}
            value={
              view === "hourly"
                ? `${observedHours} h`
                : `${dailyPoints.filter(point => point.stationTemperature != null).length} j`
            }
          />
          {view === "daily" ? (
            <Stat label="Fenêtre" value={periodLabel} />
          ) : (
            <Stat label="Fenêtre" value={hourlyWindow} />
          )}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        {view === "hourly"
          ? `${hourlyWindow}. Heures locales Europe/Paris ; mêmes instants comparés. Une absence de mesure reste vide, jamais remplacée par zéro.`
          : "Moyennes journalières calculées sur les mêmes heures appariées, dans la période et l’échéance choisies. Cette courbe des modèles archivés ne représente ni la fusion officielle ni une note de fiabilité."}
      </p>
    </MeteoSurface>
  );
}
