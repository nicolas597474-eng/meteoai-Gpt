import { HOURLY_FORECAST_VARIABLES } from "../../../../server/forecastVariableCoverage";
import type { HourlyJournalEntry } from "@/lib/hourlyJournalFilter";

export function HourlyJournalVariableCoverage({ entry }: { entry: HourlyJournalEntry }) {
  const summary = entry.variableSummary;
  if (!summary?.length) return <p className="mt-2 text-[10px] leading-relaxed text-slate-400">Le détail des champs n’a pas été conservé dans ce journal. Il sera disponible après une nouvelle collecte.</p>;
  const label = (key: string) => HOURLY_FORECAST_VARIABLES.find(field => field.key === key)?.label ?? key;
  const complete = summary.filter(field => field.receivedCount === field.expectedCount && field.expectedCount > 0);
  const incomplete = summary.filter(field => field.receivedCount < field.expectedCount);
  return <div className="mt-2 space-y-1 text-[10px] leading-relaxed" aria-label="Champs reçus dans ce lot horaire">
    <p className="text-slate-300">Champs complets : {complete.length}/{summary.length}{complete.length > 0 ? ` · ${complete.map(field => label(field.key)).join(', ')}` : ''}.</p>
    {incomplete.length > 0 && <ul className="space-y-0.5 text-amber-100">{incomplete.map(field => <li key={field.key}>{label(field.key)} : {field.receivedCount}/{field.expectedCount} valeurs{field.providerNullCount > 0 ? ` · ${field.providerNullCount} nulles chez le fournisseur` : ''}{field.expectedCount - field.receivedCount - field.providerNullCount > 0 ? ` · ${field.expectedCount - field.receivedCount - field.providerNullCount} absentes ou non exploitables` : ''}.</li>)}</ul>}
    <p className="text-slate-400">Les champs absents restent indisponibles ; ils ne sont pas remplacés par zéro. Ce détail décrit la réponse reçue, pas la confirmation de son archivage.</p>
  </div>;
}
