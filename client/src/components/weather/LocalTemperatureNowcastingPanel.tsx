import React from "react";
import { Radar, ShieldCheck, Thermometer, TimerReset } from "lucide-react";

type NowcastingReport = {
  version: string;
  candidateCount: number;
  statuses: { READY: number; BASELINE_ONLY: number; STALE_OBSERVATION: number; UNAVAILABLE: number; LEAKAGE_BLOCKED: number };
  productionReadsEnabled: number;
  appliedToProduction: number;
  shadowModeViolations: number;
  valid: boolean;
  latest: {
    locationKey: string;
    observationDate: string;
    observationHour: number;
    observationReferenceAt: number;
    observedTemperature: number | null;
    stationCount: number;
    confidenceScore: number | null;
    validTime: number;
    horizonMinutes: number | null;
    candidateStatus: string;
    baselineTemperature: number | null;
    rawResidual: number | null;
    appliedCorrection: number | null;
    correctedTemperature: number | null;
    correctionFactor: number;
    correctionClamped: boolean;
    forecastAvailableAt: number | null;
    forecastEvidence: unknown;
    reasons: unknown;
    evaluatedAt: number;
  } | null;
};

const STATUS_STYLE = {
  READY: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
  BASELINE_ONLY: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  STALE_OBSERVATION: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  UNAVAILABLE: "border-slate-500/35 bg-slate-700/20 text-slate-300",
  LEAKAGE_BLOCKED: "border-red-300/25 bg-red-300/10 text-red-100",
};

function temperature(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)} °C`;
}

function parisTime(timestamp: number | null) {
  if (timestamp == null || !Number.isFinite(timestamp)) return "indisponible";
  return new Date(timestamp).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short",
  });
}

function evidenceList(value: unknown) {
  return Array.isArray(value) && value.length > 0
    ? value.slice(0, 3).map((item) => String(item).replaceAll("_", " ")).join(" · ")
    : "aucune anomalie déclarée";
}

function baselineLabel(value: unknown) {
  if (value && typeof value === "object" && (value as { baselineMode?: unknown }).baselineMode === "seven_model_median_shadow") {
    return "Médiane 7 modèles · shadow";
  }
  return "Base officielle qualifiée";
}

/** Panneau admin-only : aucun nowcast de cette vue n’est exposé publiquement. */
export function LocalTemperatureNowcastingPanel({ report }: { report: NowcastingReport }) {
  const latest = report.latest;
  return <section className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-300/[0.045] p-4" aria-labelledby="local-nowcasting-title">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Radar className="mt-0.5 h-5 w-5 shrink-0 text-fuchsia-200" />
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-fuchsia-200/75">Nowcasting local · shadow</p>
          <h2 id="local-nowcasting-title" className="text-sm font-semibold text-slate-100">Correction locale temporaire de température</h2>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">À partir d’un snapshot physique qualifié et de l’archive horaire officielle à sept modèles. La correction décroît de 100 % à 0 % entre maintenant et +6 h.</p>
        </div>
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-semibold ${report.valid ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-red-300/25 bg-red-300/10 text-red-100"}`}>{report.valid ? "Shadow isolé" : "À contrôler"}</span>
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Statuts des nowcasts locaux">
      <div className="rounded-xl border border-white/10 bg-slate-950/25 p-2 text-center"><p className="text-base font-bold text-fuchsia-100">{report.candidateCount}</p><p className="text-[7px] uppercase tracking-wide text-slate-500">Candidats</p></div>
      {(Object.entries(report.statuses) as Array<[keyof typeof STATUS_STYLE, number]>).map(([status, count]) => <div key={status} className={`rounded-xl border p-2 text-center ${STATUS_STYLE[status]}`}><p className="text-base font-bold">{count}</p><p className="text-[7px] font-semibold uppercase tracking-wide">{status.replaceAll("_", " ")}</p></div>)}
    </div>

    {latest ? <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-slate-950/25 p-3 text-[10px] leading-relaxed text-slate-300">
      <div className="flex items-center gap-1.5 font-semibold text-slate-100"><Thermometer className="h-3.5 w-3.5 text-fuchsia-200" />Dernier candidat · {latest.observationDate} · {String(latest.observationHour).padStart(2, "0")} h</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">Observation</span><p className="mt-0.5 font-semibold text-slate-100">{temperature(latest.observedTemperature)}</p></div>
        <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">{baselineLabel(latest.forecastEvidence)}</span><p className="mt-0.5 font-semibold text-slate-100">{temperature(latest.baselineTemperature)}</p></div>
        <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">Résidu</span><p className="mt-0.5 font-semibold text-fuchsia-100">{latest.rawResidual == null ? "—" : `${latest.rawResidual >= 0 ? "+" : ""}${latest.rawResidual.toFixed(1)} °C`}</p></div>
        <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">Candidat</span><p className="mt-0.5 font-semibold text-fuchsia-100">{temperature(latest.correctedTemperature)}</p></div>
      </div>
      <p><span className="font-semibold text-fuchsia-100">Horizon · </span>{latest.horizonMinutes == null ? "indisponible" : `+${Math.round(latest.horizonMinutes / 60)} h`} · facteur {Math.round(latest.correctionFactor * 100)} % · {latest.stationCount} station(s) qualifiée(s).</p>
      <p>Indice descriptif de concordance thermique des stations (dispersion des températures et effectif) : {latest.confidenceScore == null ? "non mesuré" : `${latest.confidenceScore.toFixed(0)}/100`}. Ce score n’est ni une probabilité ni une confiance météorologique calibrée; la fiabilité historique est distincte.</p>
      <p className="text-slate-400"><span className="font-semibold text-slate-300">Pare-feu temporel · </span>prévision archivée disponible {parisTime(latest.forecastAvailableAt)}, observation de référence {parisTime(latest.observationReferenceAt)}. Une prévision postérieure à l’observation est bloquée.</p>
      <p className="text-slate-400">Statut <span className="font-semibold text-fuchsia-100">{latest.candidateStatus}</span> · raisons : {evidenceList(latest.reasons)}{latest.correctionClamped ? " · correction bornée à ±3 °C" : ""}.</p>
    </div> : <div className="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/25 p-3 text-[10px] leading-relaxed text-slate-400">Aucun candidat à afficher. Le module attend un snapshot physique récent, qualifié et temporellement aligné avec une archive horaire disponible.</div>}

    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-100"><TimerReset className="h-3.5 w-3.5" />Limites temporelles</p><p className="mt-1 text-[9px] leading-relaxed text-slate-400">Une observation de plus de 90 min devient explicitement STALE. Aucun lissage ne prolonge le biais local au-delà de +6 h.</p></div>
      <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-100"><ShieldCheck className="h-3.5 w-3.5" />Production verrouillée</p><p className="mt-1 text-[9px] leading-relaxed text-slate-400">Lecteurs publics : {report.productionReadsEnabled} · appliqués à production : {report.appliedToProduction} · violations shadow : {report.shadowModeViolations}. Le calcul réutilise des archives existantes, sans appel fournisseur supplémentaire.</p></div>
    </div>
    <p className="mt-3 text-[9px] text-emerald-200/85">Température seulement · version {report.version} · Best Match exclu</p>
  </section>;
}
