import { useState, type SyntheticEvent } from "react";
import { X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { modelColor, number, shortDate } from "@/lib/historyChartFormat";

/**
 * Graphiques historiques isolés dans leur propre module.
 *
 * Ce module est le seul consommateur de la bibliothèque recharts
 * (372 ko brut / ~108 ko gzip). Il est chargé en différé par la page
 * Historique : les en-têtes, filtres, tableaux et preuves du soir s'affichent
 * sans attendre le téléchargement ni l'analyse de la bibliothèque.
 */
export function HistoryChartTooltip({ active, payload, label, unit = "" }: any) {
  const [dismissedLabel, setDismissedLabel] = useState<string | null>(null);
  const tooltipLabel = String(label ?? "");
  const entries = (payload ?? []).filter((entry: any) => entry?.value != null && !Array.isArray(entry.value));
  if (!active || entries.length === 0 || dismissedLabel === tooltipLabel) return null;
  const observation = entries.find((entry: any) => String(entry.name).toLowerCase().includes("observation") || String(entry.name).toLowerCase().includes("observé"));
  const meteoAI = entries.find((entry: any) => String(entry.name).toLowerCase().includes("meteoai"));
  const gap = observation?.value != null && meteoAI?.value != null ? Number(meteoAI.value) - Number(observation.value) : null;
  const dismissTooltip = (event: SyntheticEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDismissedLabel(tooltipLabel);
  };
  return <div role="tooltip" style={{ pointerEvents: "auto" }} className="min-w-48 rounded-xl border border-slate-500/90 bg-[#070b12] p-3 text-left ring-1 ring-black/45">
    <div className="flex items-start justify-between gap-3 border-b border-slate-700/80 pb-2"><p className="text-xs font-semibold text-white">{shortDate(tooltipLabel)}</p><button type="button" onPointerDown={dismissTooltip} onClick={dismissTooltip} aria-label="Fermer le détail d’observation" title="Fermer" style={{ touchAction: "manipulation" }} className="weather-icon-bare -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-300 transition-colors hover:bg-slate-800 hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><X size={16} strokeWidth={2.5} aria-hidden="true" /></button></div>
    <div className="space-y-1.5 pt-2">{entries.map((entry: any) => <div key={`${entry.dataKey}-${entry.name}`} className="flex items-center justify-between gap-5 text-[11px]"><span className="flex min-w-0 items-center gap-1.5 text-slate-300"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color ?? "#94a3b8" }} /> <span className="truncate">{entry.name}</span></span><strong className="shrink-0 font-mono text-slate-100">{number(entry.value, unit, 1)}</strong></div>)}</div>
    {gap != null ? <p className={`mt-2 rounded-lg border px-2 py-1.5 text-[10px] ${Math.abs(gap) <= 1 ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : "border-amber-400/20 bg-amber-400/5 text-amber-100"}`}>Écart MeteoAI / observation : {gap > 0 ? "+" : ""}{gap.toFixed(1)}{unit}</p> : null}
  </div>;
}

export function CurveLegend({ modelLabel }: { modelLabel: string }) {
  const items = [
    { label: "Observation", detail: "référence archivée", color: "#34d399" },
    { label: "MeteoAI", detail: "synthèse", color: "#38bdf8" },
    { label: modelLabel, detail: "modèle comparé", color: modelColor(modelLabel) },
  ];
  return <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/35 p-2.5"><p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Clé de lecture des courbes</p><div className="grid grid-cols-3 gap-1.5">{items.map((item) => <div key={item.label} className="min-w-0 rounded-lg bg-slate-900/60 px-2 py-1.5"><span className="mb-1 block h-1.5 w-full rounded-full" style={{ backgroundColor: item.color }} /><p className="truncate text-[10px] font-semibold text-slate-100">{item.label}</p><p className="truncate text-[9px] text-slate-500">{item.detail}</p></div>)}</div></div>;
}

export function CompactTemperatureChart({ data, observedKey, forecastKey, modelKey, observedLabel, forecastLabel, modelLabel, unit, height = 230 }: { data: any[]; observedKey: string; forecastKey: string; modelKey: string; observedLabel: string; forecastLabel: string; modelLabel: string; unit: string; height?: number }) {
  return <><CurveLegend modelLabel={modelLabel} /><div style={{ height }}><ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke="#1e293b" strokeDasharray="3 4" />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis width={48} domain={["dataMin - 2", "dataMax + 2"]} tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${value}${unit}`} axisLine={false} tickLine={false} />
      <Tooltip content={<HistoryChartTooltip unit={unit} />} cursor={{ stroke: "#7dd3fc", strokeWidth: 1, strokeDasharray: "3 3" }} />
      <Line type="monotone" dataKey={observedKey} name={observedLabel} stroke="#34d399" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
      <Line type="monotone" dataKey={forecastKey} name={forecastLabel} stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
      <Line type="monotone" dataKey={modelKey} name={modelLabel} stroke={modelColor(modelLabel)} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
    </LineChart>
  </ResponsiveContainer></div></>;
}

/** Courbes des cumuls quotidiens ; les valeurs absentes restent des interruptions. */
export function PrecipitationChart({ data, comparisonModel, modelKey }: { data: any[]; comparisonModel: string; modelKey: string }) {
  return <div className="h-60"><ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke="#1e293b" strokeDasharray="3 4" />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
      <YAxis domain={[0, "auto"]} tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${value} mm`} width={48} axisLine={false} tickLine={false} />
      <Tooltip content={<HistoryChartTooltip unit=" mm" />} cursor={{ stroke: "#7dd3fc", strokeWidth: 1, strokeDasharray: "3 3" }} />
      <Line type="monotone" dataKey="obsPrecip" name="Observation" stroke="#34d399" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
      <Line type="monotone" dataKey="meteoAIPrecip" name="MeteoAI" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
      <Line type="monotone" dataKey={modelKey} name={comparisonModel} stroke={modelColor(comparisonModel)} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
    </LineChart>
  </ResponsiveContainer></div>;
}

/** Courbes de vent et rafales observées face à un seul modèle comparé. */
export function WindChart({
  data,
  comparisonModel,
  modelKey,
}: {
  data: any[];
  comparisonModel: string;
  modelKey: string;
}) {
  return <div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}><CartesianGrid vertical={false} stroke="#1e293b" strokeDasharray="3 4" /><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis width={42} tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${value}`} axisLine={false} tickLine={false} /><Tooltip content={<HistoryChartTooltip unit=" km/h" />} cursor={{ stroke: "#7dd3fc", strokeWidth: 1, strokeDasharray: "3 3" }} /><Line type="monotone" dataKey="obsWind" name="Vent observé" stroke="#34d399" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} /><Line type="monotone" dataKey="obsGust" name="Rafales obs." stroke="#fb923c" strokeWidth={2} strokeDasharray="3 3" dot={false} activeDot={{ r: 4 }} connectNulls={false} /><Line type="monotone" dataKey={modelKey} name={comparisonModel} stroke={modelColor(comparisonModel)} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 5 }} connectNulls={false} /></LineChart></ResponsiveContainer></div>;
}
