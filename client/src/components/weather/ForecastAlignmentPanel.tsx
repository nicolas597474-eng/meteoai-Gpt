import { BarChart3, CalendarDays, Clock3, Thermometer } from "lucide-react";
import {
  buildForecastAlignmentReport,
  type AlignmentStatus,
  type ForecastAlignmentReadModel,
} from "@/lib/forecastAlignment";
import { HourlyFusionDebugPanel } from "./HourlyFusionDebugPanel";

const parisInstantFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
  hourCycle: "h23",
});

function formatInstant(value: string | number | null | undefined): string {
  if (value == null) return "horodatage indisponible";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? parisInstantFormatter.format(date) : "horodatage indisponible";
}

function formatLocalDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date indisponible";
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "date indisponible";
}

function formatTemperature(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "indisponible";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)} °C`;
}

function formatDifference(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "indisponible";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatTemperature(value)}`;
}

function statusLabel(status: AlignmentStatus): string {
  if (status === "comparable") return "Comparables · échéance alignée";
  if (status === "non_comparable") return "Non comparable";
  return "Indisponible";
}

function statusTone(status: AlignmentStatus): string {
  if (status === "comparable") return "border-sky-300/25 bg-sky-300/[0.07] text-sky-100";
  if (status === "non_comparable") return "border-amber-300/20 bg-amber-300/[0.045] text-amber-100";
  return "border-slate-700 bg-slate-900/70 text-slate-400";
}

function StatusBadge({ status }: { status: AlignmentStatus }) {
  return <span className={`inline-flex max-w-full rounded-full border px-2 py-1 text-[9px] font-semibold leading-tight ${statusTone(status)}`}>{statusLabel(status)}</span>;
}

function dailyModelsLabel(models: string[]): string {
  if (models.length === 0) return "modèles réellement disponibles non précisés";
  return models.map((model) => model === "Open-Meteo" ? "Best Match (agrégateur dérivé)" : model).join(" · ");
}

function hourlyModelsLabel(models: string[]): string {
  return models.length > 0 ? models.join(" · ") : "modèles présents à cette échéance non précisés";
}

function ComparisonCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <article className={`min-w-0 rounded-xl border border-slate-700/80 bg-slate-950/35 p-3 ${className}`}>{children}</article>;
}

export function ForecastAlignmentPanel({
  comparison,
  requestedLocation,
}: {
  comparison: ForecastAlignmentReadModel;
  requestedLocation?: { lat: number; lon: number } | null;
}) {
  const report = buildForecastAlignmentReport(comparison, requestedLocation);
  const dailySource = `Open-Meteo · ${dailyModelsLabel(comparison.dailyForecast.modelsUsed)}`;
  const hourlySource = `Prévision horaire officielle · ${comparison.hourlyForecast.source}`;

  return <section className="rounded-2xl border border-violet-300/25 bg-[linear-gradient(135deg,rgba(124,58,237,0.09),rgba(13,19,29,0.96)_48%)] p-4" aria-labelledby="forecast-alignment-title">
    <div className="flex items-start gap-2.5">
      <span className="weather-icon-bare grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-300/20 bg-violet-300/10"><BarChart3 className="h-4 w-4 text-violet-200" /></span>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-200/75">Écarts descriptifs · température</p>
        <h2 id="forecast-alignment-title" className="text-sm font-semibold text-slate-100">Snapshot du modèle et prévisions</h2>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Les différences affichées sont brutes en °C : elles ne constituent ni une erreur vérifiée, ni un verdict, ni un score. Aucun seuil n’est appliqué.</p>
      </div>
    </div>

    {report.unavailableReason && <p role="status" className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] px-2.5 py-2 text-[10px] leading-relaxed text-amber-100">{report.unavailableReason}</p>}

    <div className="mt-3 grid gap-2 md:grid-cols-2">
      <ComparisonCard>
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-100"><Thermometer className="h-3.5 w-3.5 text-orange-200" />Snapshot modèle ↔ prévision horaire</h3><StatusBadge status={report.snapshotVsHourly.status} /></div>
        <div className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-slate-300">
          <p><span className="font-semibold text-orange-100">Instantané courant du modèle</span> · {comparison.currentSnapshotSource.source} · pas un relevé physique<br />Instant : {formatInstant(report.snapshotVsHourly.snapshotAt)} · {formatTemperature(report.snapshotVsHourly.snapshotTemp)}</p>
          <p><span className="font-semibold text-sky-100">Prévision horaire officielle</span> · {hourlySource}<br />Échéance : {formatInstant(report.snapshotVsHourly.hourlyAt)} · {formatTemperature(report.snapshotVsHourly.hourlyTemp)}</p>
          <p className="text-slate-500">Modèles considérés : {comparison.hourlyForecast.modelsConsidered.join(" · ") || "non précisés"} · Best Match {comparison.hourlyForecast.bestMatchIncluded ? "inclus" : "exclu"}. Présents à cette échéance : {hourlyModelsLabel(report.snapshotVsHourly.hourlyModelsWithData)}.</p>
          {report.snapshotVsHourly.status === "comparable"
            ? <p className="rounded-lg border border-sky-300/20 bg-sky-300/[0.055] px-2 py-1.5 font-semibold text-sky-100">Écart brut (prévision horaire − snapshot modèle) : {formatDifference(report.snapshotVsHourly.difference)}</p>
            : <p className="text-amber-100/90">{report.snapshotVsHourly.reason}</p>}
        </div>
      </ComparisonCard>

      <ComparisonCard>
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-100"><CalendarDays className="h-3.5 w-3.5 text-emerald-200" />Snapshot modèle ↔ prévision quotidienne</h3><StatusBadge status={report.snapshotVsDaily.status} /></div>
        <div className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-slate-300">
          <p>Snapshot {formatInstant(report.snapshotVsDaily.snapshotAt)} : {formatTemperature(report.snapshotVsDaily.snapshotTemp)} · source : {comparison.currentSnapshotSource.source}, sortie de modèle.</p>
          <p>Échéance quotidienne : {formatLocalDate(report.snapshotVsDaily.dailyDate)} · Tmin {formatTemperature(report.snapshotVsDaily.dailyTempMin)} · Tmax {formatTemperature(report.snapshotVsDaily.dailyTempMax)}.</p>
          <p>Source quotidienne : {dailySource}. Heure d’émission fournisseur exacte : non archivée.</p>
          <p className="text-amber-100/90">{report.snapshotVsDaily.reason}</p>
        </div>
      </ComparisonCard>

      <ComparisonCard className="md:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-100"><Clock3 className="h-3.5 w-3.5 text-cyan-200" />Extrêmes horaires ↔ extrema quotidiens</h3><span className="text-[9px] text-slate-500">Date de validité Europe/Paris</span></div>
        {report.hourlyVsDaily.length > 0 ? <div className="mt-2 space-y-2">{report.hourlyVsDaily.map((day) => <div key={day.date} className="rounded-lg border border-slate-700/70 bg-slate-900/45 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-semibold capitalize text-slate-100">{formatLocalDate(day.date)}</p><StatusBadge status={day.status} /></div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-300">Horaire officiel · min/max parmi les valeurs présentes : {formatTemperature(day.hourlyTempMin)} / {formatTemperature(day.hourlyTempMax)} · couverture {day.coveredHours}/{day.expectedHours} heures locales.</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-300">Quotidien · Tmin/Tmax : {formatTemperature(day.dailyTempMin)} / {formatTemperature(day.dailyTempMax)} · source : {dailySource}.</p>
          {day.status === "comparable"
            ? <p className="mt-1.5 text-[10px] font-semibold text-sky-100">Écarts bruts (extrêmes horaires − extrema quotidiens) : Δ Tmin {formatDifference(day.differenceMin)} · Δ Tmax {formatDifference(day.differenceMax)}.</p>
            : <p className="mt-1.5 text-[10px] leading-relaxed text-amber-100/90">{day.reason}</p>}
        </div>)}</div> : <p className="mt-2 rounded-lg border border-slate-700/70 bg-slate-900/45 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">Aucune date locale commune exploitable entre les séries horaires et quotidiennes.</p>}
      </ComparisonCard>

      <ComparisonCard className="md:col-span-2">
        <HourlyFusionDebugPanel points={comparison.hourlyForecast.points} preferredValidAt={report.snapshotVsHourly.hourlyAt} />
      </ComparisonCard>
    </div>

    <p className="mt-2.5 text-[9px] leading-relaxed text-slate-500">Lecture AI Lab assemblée à {formatInstant(comparison.assembledAt)} · série horaire calculée à {formatInstant(comparison.hourlyForecast.computedAt)} ; ces heures de lecture ne remplacent pas un run fournisseur. Les relevés de stations sont une source physique distincte, exclus de ce panneau et ne corrigent pas les prévisions futures.</p>
  </section>;
}
