import React from "react";
import { CloudRain, ShieldCheck, TimerReset } from "lucide-react";
import type { LocalPrecipitationVerificationReport } from "@shared/localPrecipitationNowcastVerification";

type NowcastingReport = {
  version: string;
  candidateCount: number;
  statuses: { WET_SIGNAL: number; BASELINE_WET: number; BASELINE_DRY: number; STALE_OBSERVATION: number; UNAVAILABLE: number; LEAKAGE_BLOCKED: number };
  productionReadsEnabled: number;
  appliedToProduction: number;
  shadowModeViolations: number;
  valid: boolean;
  verification?: LocalPrecipitationVerificationReport;
  latest: {
    locationKey: string;
    observationDate: string;
    observationHour: number;
    observationReferenceAt: number;
    observedPrecipitation: number | null;
    stationCount: number;
    confidenceScore: number | null;
    validTime: number;
    horizonMinutes: number | null;
    candidateStatus: string;
    baselinePrecipitation: number | null;
    baselineWet: boolean | null;
    observedWet: boolean | null;
    localWetSignal: boolean;
    continuationFactor: number;
    forecastAvailableAt: number | null;
    forecastEvidence: unknown;
    reasons: unknown;
    evaluatedAt: number;
  } | null;
};

const STATUS_STYLE = {
  WET_SIGNAL: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  BASELINE_WET: "border-indigo-300/30 bg-indigo-300/10 text-indigo-100",
  BASELINE_DRY: "border-slate-500/35 bg-slate-700/20 text-slate-300",
  STALE_OBSERVATION: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  UNAVAILABLE: "border-slate-500/35 bg-slate-700/20 text-slate-300",
  LEAKAGE_BLOCKED: "border-red-300/25 bg-red-300/10 text-red-100",
};

function precipitation(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)} mm`;
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

function formatFrequency(frequency: { numerator: number; denominator: number; value: number | null }) {
  if (frequency.value == null) return `non calculée (${frequency.numerator}/${frequency.denominator})`;
  return `${(frequency.value * 100).toFixed(1)} % (${frequency.numerator}/${frequency.denominator})`;
}

/** Panneau admin-only : l’occurrence locale ne change jamais le montant officiel en mm. */
export function LocalPrecipitationNowcastingPanel({ report }: { report: NowcastingReport }) {
  const latest = report.latest;
  const verification = report.verification;
  const hasUsablePairs = verification?.horizons.some((horizon) => horizon.usablePairCount > 0) ?? false;
  return (
    <section className="rounded-2xl border border-sky-300/25 bg-sky-300/[0.045] p-4" aria-labelledby="local-precipitation-nowcasting-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <CloudRain className="mt-0.5 h-5 w-5 shrink-0 text-sky-200" />
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-200/75">Nowcasting précipitations · shadow</p>
            <h2 id="local-precipitation-nowcasting-title" className="text-sm font-semibold text-slate-100">Signal local d’occurrence de pluie</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Un signal humide local confronté à la médiane des sept modèles archivés. Les millimètres officiels ne sont jamais modifiés.</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-semibold ${report.valid ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-red-300/25 bg-red-300/10 text-red-100"}`}>{report.valid ? "Shadow isolé" : "À contrôler"}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6" aria-label="Statuts des nowcasts locaux de précipitations">
        <div className="rounded-xl border border-white/10 bg-slate-950/25 p-2 text-center"><p className="text-base font-bold text-sky-100">{report.candidateCount}</p><p className="text-[7px] uppercase tracking-wide text-slate-500">Candidats</p></div>
        {(Object.entries(report.statuses) as Array<[keyof typeof STATUS_STYLE, number]>).map(([status, count]) => <div key={status} className={`rounded-xl border p-2 text-center ${STATUS_STYLE[status]}`}><p className="text-base font-bold">{count}</p><p className="text-[7px] font-semibold uppercase tracking-wide">{status.replaceAll("_", " ")}</p></div>)}
      </div>
      <p className="mt-2 text-[9px] text-slate-400">Les compteurs de statuts sont des états de candidats, pas des scores de performance.</p>

      {latest ? (
        <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-slate-950/25 p-3 text-[10px] leading-relaxed text-slate-300">
          <div className="flex items-center gap-1.5 font-semibold text-slate-100"><CloudRain className="h-3.5 w-3.5 text-sky-200" />Dernier candidat · {latest.observationDate} · {String(latest.observationHour).padStart(2, "0")} h</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">Observation du snapshot de référence</span><p className="mt-0.5 font-semibold text-slate-100">{precipitation(latest.observedPrecipitation)}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">Médiane 7 modèles</span><p className="mt-0.5 font-semibold text-slate-100">{precipitation(latest.baselinePrecipitation)}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">Signal local du candidat</span><p className="mt-0.5 font-semibold text-sky-100">{latest.localWetSignal ? "Pluie au snapshot de référence" : "Aucun ajout"}</p></div>
            <div className="rounded-lg border border-white/10 bg-black/15 p-2"><span className="text-[8px] uppercase text-slate-500">Statut candidat</span><p className="mt-0.5 font-semibold text-sky-100">{latest.candidateStatus.replaceAll("_", " ")}</p></div>
          </div>
          <p><span className="font-semibold text-sky-100">Horizon · </span>{latest.horizonMinutes == null ? "indisponible" : `+${Math.round(latest.horizonMinutes / 60)} h`} · persistance du signal {Math.round(latest.continuationFactor * 100)} % · {latest.stationCount} station(s) qualifiée(s).</p>
          <p>Accord inter-stations pour les précipitations : non mesuré ici. Le score de snapshot conservé au contrat porte sur la concordance thermique et l’effectif; il n’évalue pas la pluie.</p>
          <p className="text-slate-400"><span className="font-semibold text-slate-300">Pare-feu temporel · </span>prévision archivée disponible {parisTime(latest.forecastAvailableAt)}, snapshot de référence {parisTime(latest.observationReferenceAt)}. Une prévision postérieure à la référence est bloquée.</p>
          <p className="text-slate-400">Raisons : {evidenceList(latest.reasons)}.</p>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/25 p-3 text-[10px] leading-relaxed text-slate-400">Aucun candidat à afficher. Le module attend un snapshot physique qualifié et une archive horaire antérieure.</div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-100"><TimerReset className="h-3.5 w-3.5" />Limites de mesure</p><p className="mt-1 text-[9px] leading-relaxed text-slate-400">Les pluviomètres n’exposent pas tous le même intervalle d’accumulation, et le snapshot qualifié ne conserve pas la fenêtre par station. Aucun delta ni montant corrigé n’est calculé ; une station sèche ne retire jamais la pluie modélisée.</p></div>
        <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-100"><ShieldCheck className="h-3.5 w-3.5" />Production verrouillée</p><p className="mt-1 text-[9px] leading-relaxed text-slate-400">Lecteurs publics : {report.productionReadsEnabled} · appliqués à production : {report.appliedToProduction} · violations shadow : {report.shadowModeViolations}. Les données viennent uniquement des archives et snapshots déjà stockés.</p></div>
      </div>

      <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-3" aria-label="Vérification descriptive du nowcasting par horizon">
        <p className="text-[10px] font-semibold text-amber-100">Vérification future · fréquences empiriques descriptives</p>
        {!verification || !verification.schemaAvailable ? (
          <p className="mt-1 text-[9px] leading-relaxed text-slate-400">Données insuffisantes / skill non mesuré. Le stockage des appariements futurs est indisponible{verification?.unavailableReason ? ` (${verification.unavailableReason.replaceAll("_", " ").toLowerCase()})` : ""} ; aucun taux de réussite, POD, FAR ni CSI n’est calculé.</p>
        ) : (
          <>
            {!hasUsablePairs && <p className="mt-1 text-[9px] leading-relaxed text-slate-300">Données insuffisantes / skill non mesuré : aucune paire horaire avec un label futur réellement qualifié et une fenêtre d’accumulation comparable. Les observations du snapshot de référence ne servent jamais de vérité future ; aucun taux de réussite, POD, FAR ni CSI n’est calculé.</p>}
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              {verification.horizons.map((horizon) => (
                <div key={horizon.horizonMinutes} className="rounded-lg border border-white/10 bg-slate-950/30 p-2.5 text-[9px] leading-relaxed text-slate-300" aria-label={`Vérification horizon ${horizon.label}`}>
                  <p className="font-semibold text-slate-100">Horizon {horizon.label} · paires horaires</p>
                  <p>Émissions archivées : {horizon.emissionCount} · prévisions échues baseline/candidat comparables : {horizon.forecastComparableCount} · snapshots futurs liés à l’échéance : {horizon.futureSnapshotPairCount} · paires utilisables / prévisions échues comparables : {horizon.coverage.numerator}/{horizon.coverage.denominator}.</p>
                  <p className="mt-1">Matrice baseline (n={horizon.baseline.matrix.pairCount}) — hits {horizon.baseline.matrix.hit}, misses {horizon.baseline.matrix.miss}, fausses alertes {horizon.baseline.matrix.falseAlarm}, rejets corrects {horizon.baseline.matrix.correctRejection}.</p>
                  <p>Matrice candidat local (n={horizon.candidate.matrix.pairCount}) — hits {horizon.candidate.matrix.hit}, misses {horizon.candidate.matrix.miss}, fausses alertes {horizon.candidate.matrix.falseAlarm}, rejets corrects {horizon.candidate.matrix.correctRejection}.</p>
                  {horizon.usablePairCount > 0 && <p className="mt-1 text-sky-100">Fréquences descriptives baseline (POD {formatFrequency(horizon.baseline.pod)} · FAR {formatFrequency(horizon.baseline.far)} · CSI {formatFrequency(horizon.baseline.csi)}) et candidat local (POD {formatFrequency(horizon.candidate.pod)} · FAR {formatFrequency(horizon.candidate.far)} · CSI {formatFrequency(horizon.candidate.csi)}). Chaque ratio affiche son numérateur/dénominateur ; paires communes n={horizon.usablePairCount}.</p>}
                  {horizon.horizonMinutes === 120 && <p className="mt-1 text-amber-100">À +2 h, le facteur de continuation actuel est nul : le candidat n’ajoute aucune composante locale et sa prédiction d’occurrence est identique au baseline ({horizon.identicalForecastCount}/{horizon.forecastComparableCount} émissions comparables au baseline).</p>}
                  <p className="mt-1 text-slate-400">Paires en attente : {horizon.pendingCount} · issues indisponibles : {horizon.unavailableOutcomeCount}. Les répétitions horaires ne sont pas dédupliquées en épisodes indépendants.</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[8px] text-slate-400">Les tableaux de contingence portent sur les mêmes paires avec labels utilisables. Toute fréquence calculée décrit seulement cet échantillon horaire ; aucune note globale, probabilité, calibration ou fiabilité n’est produite.</p>
          </>
        )}
      </div>

      <p className="mt-3 text-[9px] text-emerald-200/85">Occurrence seulement · {report.version} · Best Match exclu · montants mm inchangés</p>
    </section>
  );
}
