import { useMemo, useState } from "react";
import { AlertTriangle, CircleCheck, Clock3, FileQuestion, SlidersHorizontal } from "lucide-react";
import {
  buildHourlyJournalRows,
  filterHourlyJournalRows,
  getHourlyJournalFilterCounts,
  hourlyJournalStatusLabel,
  isAvailablePartialJournal,
  type HourlyJournalEntry,
  type HourlyJournalFilter,
} from "@/lib/hourlyJournalFilter";

const FILTER_OPTIONS: Array<{ value: HourlyJournalFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "problems", label: "Problèmes" },
  { value: "success", label: "Disponibles" },
  { value: "running", label: "En cours" },
  { value: "missing", label: "Sans trace" },
];

const STATUS_TONES = {
  attempting: "border-sky-300/25 bg-sky-300/[0.07] text-sky-100",
  succeeded: "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-100",
  partial: "border-amber-300/25 bg-amber-300/[0.07] text-amber-100",
  failed: "border-rose-300/25 bg-rose-300/[0.07] text-rose-100",
  safe_error: "border-orange-300/25 bg-orange-300/[0.07] text-orange-100",
  missing: "border-slate-600/50 bg-slate-800/30 text-slate-300",
} as const;

function formatAttemptedAt(value: number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })
    : "heure indisponible";
}

export function HourlyJournalPanel({
  expectedModels,
  entries,
  available,
  onOpenModel,
}: {
  expectedModels: readonly string[];
  entries: readonly HourlyJournalEntry[];
  available: boolean;
  onOpenModel: (model: string) => void;
}) {
  const [filter, setFilter] = useState<HourlyJournalFilter>("all");
  const rows = useMemo(() => buildHourlyJournalRows(expectedModels, entries), [expectedModels, entries]);
  const counts = getHourlyJournalFilterCounts(rows, available);
  const visibleRows = filterHourlyJournalRows(rows, filter, available);

  return <section className="rounded-2xl border border-amber-300/20 bg-[#0d131d] p-4" aria-labelledby="hourly-journal-title">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <div className="min-w-0">
          <h2 id="hourly-journal-title" className="text-sm font-semibold text-slate-100">Journaux horaires détaillés</h2>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Résultats par modèle du dernier lot horaire vérifiable. Collecte à la consultation, distincte d’un passage planifié. Les horaires délimitent le lot ; les écritures d’archive ou de projection restent non confirmées sans preuve séparée.</p>
        </div>
      </div>
      <span className="shrink-0 rounded-full border border-white/10 bg-slate-950/35 px-2 py-1 text-[9px] font-semibold text-slate-300">{available ? `${visibleRows.length}/${rows.length}` : "indisponible"}</span>
    </div>

    <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrer les journaux horaires">
      {FILTER_OPTIONS.map((option) => <button
        key={option.value}
        type="button"
        onClick={() => setFilter(option.value)}
        aria-pressed={filter === option.value}
        disabled={!available}
        className={`min-h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-45 ${filter === option.value ? "border-amber-300/50 bg-amber-300/15 text-amber-100" : "border-slate-700 bg-slate-950/25 text-slate-400 hover:border-slate-500 hover:text-slate-200"}`}
      >{option.label} <span className="ml-0.5 tabular-nums">{counts[option.value]}</span></button>)}
    </div>

    {!available ? <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-[10px] leading-relaxed text-amber-100"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Le journal horaire détaillé est indisponible (base ou migration non vérifiable). Aucun modèle n’est classé comme réussi, en erreur ou sans trace.</p>
      : visibleRows.length === 0 ? <p role="status" className="mt-3 rounded-xl border border-white/10 bg-slate-950/25 p-3 text-[10px] text-slate-400">{filter === "problems" ? "Aucun problème détecté dans le dernier lot horaire." : filter === "success" ? "Aucune tentative réussie dans ce lot." : filter === "running" ? "Aucune tentative en cours." : filter === "missing" ? "Tous les modèles attendus ont une trace dans ce lot." : "Aucun journal horaire enregistré pour ce lieu."}</p>
        : <ul className="mt-3 grid gap-2 sm:grid-cols-2">{visibleRows.map(({ model, isOfficialModel, entry }) => {
          const status = entry?.status ?? "missing";
          const statusLabel = entry ? hourlyJournalStatusLabel(entry) : "Sans trace";
          const technicalDetail = entry?.errorCode==='rate_limit_suspended'?'Aucun appel réseau : délai de quota en cours.':entry?.errorCode==='provider_rate_limited'?'HTTP 429 réellement reçu du fournisseur.':entry?.errorCode ? `Code : ${entry.errorCode}` : entry ? `${entry.hoursReceived}${entry.expectedHoursCount ? `/${entry.expectedHoursCount}` : ''} h reçues · ${entry.valuesReceived}/${entry.expectedValueCount} valeurs` : "Aucune tentative durable connue pour ce modèle dans le dernier lot.";
          return <li key={model}>
            <button type="button" onClick={() => onOpenModel(model)} aria-label={`Ouvrir le détail du journal ${model}, statut ${statusLabel}${entry?.errorCode ? `, code ${entry.errorCode}` : ""}`} className={`w-full rounded-xl border p-3 text-left transition-colors hover:border-amber-200/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${STATUS_TONES[status]}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{model}</span><span className="mt-0.5 block text-[8px] uppercase tracking-[0.1em] opacity-65">{isOfficialModel ? "Modèle officiel" : "Référence agrégée"}</span></span>
                <span className="shrink-0 max-w-[55%] rounded-full border border-current/20 bg-black/10 px-2 py-1 text-[9px] font-semibold">{statusLabel}</span>
              </span>
              <span className="mt-2 flex items-start gap-1.5 text-[9px] leading-relaxed opacity-80"><span className="mt-0.5 shrink-0">{entry?.status === "succeeded" ? <CircleCheck className="h-3 w-3" /> : entry?.status === "attempting" ? <Clock3 className="h-3 w-3" /> : entry ? <AlertTriangle className="h-3 w-3" /> : <FileQuestion className="h-3 w-3" />}</span><span className="min-w-0 break-words">{technicalDetail}</span></span>
              {entry && <span className="mt-1.5 block text-[9px] leading-relaxed opacity-80">Archive : {entry.archiveRowsWritten == null ? "non confirmée par ce journal" : `${entry.archiveRowsWritten} lignes confirmées`} · Vue horaire : {entry.projectionRowsWritten == null ? "non confirmée par ce journal" : `${entry.projectionRowsWritten} lignes confirmées`}.</span>}
              {entry && <span className="mt-1.5 block text-[8px] opacity-60">{entry.requestAttempts} tentative{entry.requestAttempts > 1 ? "s" : ""} · {formatAttemptedAt(entry.attemptedAt)}</span>}
              {entry && isAvailablePartialJournal(entry) && <span className="mt-1.5 block text-[9px] leading-relaxed">Les heures demandées sont reçues ; certains champs restent absents. Valeurs disponibles utilisables. Touchez pour voir le détail.</span>}
            </button>
          </li>;
        })}</ul>}
  </section>;
}
