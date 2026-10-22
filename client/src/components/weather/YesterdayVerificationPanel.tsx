import React, { type ReactNode } from "react";

type VerificationPair = {
  serviceName: string;
  modelId: string;
  variable: string;
  horizonBucket: string;
  leadTimeMinutes: number;
  forecastValue: number;
  observedValue: number;
  signedError: number;
  validDate: string;
  forecastIssuedAt: number;
  forecastAvailableAt?: number | null;
  observationWindowStartAt?: number | null;
  observationWindowEndAt?: number | null;
  stationEvidence: Array<{
    stationId: string;
    stationName: string;
    source: string;
    snapshotHour: number;
    observedAt: number;
    value: number;
    weight: number | null;
  }>;
};

type VerificationGroup = {
  serviceName: string;
  modelId: string;
  variable: string;
  horizonBucket: string;
  unit: string;
  mae: number;
  rmse: number;
  bias: number;
  pairCount: number;
  evaluatedDays: number;
  validDates: string[];
};

type VerificationData = {
  status: "available" | "unavailable";
  reason: string | null;
  locationKey: string;
  validDate: string;
  validFromAt: number | null;
  validToAt: number | null;
  timezone: "Europe/Paris";
  forecastRunCount: number;
  qualifiedSnapshotHours: number;
  pairs: VerificationPair[];
  groups: VerificationGroup[];
  meteoai: {
    status: "available" | "unavailable";
    reason: string | null;
    pairCount: number | null;
    groups: VerificationGroup[];
  };
  issues: Array<{ code: string; count: number; variable?: string }>;
};

const VARIABLE_LABELS: Record<string, string> = {
  temperature_max: "Température maximale",
  temperature_min: "Température minimale",
  precipitation_sum: "Précipitations cumulées",
  wind_speed_max: "Vent maximal",
  wind_gust_max: "Rafales maximales",
};

const ISSUE_LABELS: Record<string, string> = {
  no_forecast_runs: "Aucun run de prévision immuable pour cette validité.",
  no_qualified_physical_observation: "Observations physiques qualifiées insuffisantes.",
  insufficient_variable_coverage: "Couverture insuffisante pour au moins une variable.",
  physical_station_provenance_missing: "Provenance d’une station physique incomplète.",
  physical_station_measurement_time_missing: "Heure source de mesure manquante.",
  physical_station_measurement_date_mismatch: "La date locale du relevé ne correspond pas à la validité.",
  forecast_available_after_measurement: "Prévision disponible après le relevé : paire exclue.",
  forecast_value_missing: "Valeur prévue absente pour une variable.",
  no_comparable_pairs: "Aucune paire comparable.",
  meteoai_fusion_run_missing: "Aucune sortie fusionnée MeteoAI archivée pour hier.",
  meteoai_fusion_value_unavailable: "Valeur de la fusion MeteoAI indisponible pour une variable.",
};

function dateTime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Indisponible";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function displayMetric(value: number | null | undefined, unit = ""): string {
  return value == null || !Number.isFinite(value) ? "Indisponible" : `${value.toFixed(2)}${unit ? ` ${unit}` : ""}`;
}

function groupKey(item: Pick<VerificationGroup, "modelId" | "variable" | "horizonBucket">): string {
  return `${item.modelId}:${item.variable}:${item.horizonBucket}`;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3">
    <dt className="text-[10px] text-slate-400">{label}</dt>
    <dd className="mt-1 break-words font-mono text-sm font-semibold text-slate-100">{value}</dd>
  </div>;
}

export function YesterdayVerificationPanel({
  data,
  locationName,
  isLoading = false,
  isError = false,
}: {
  data?: VerificationData;
  locationName: string;
  isLoading?: boolean;
  isError?: boolean;
}) {
  return <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[linear-gradient(140deg,rgba(8,35,45,.55),rgba(13,19,29,.98)_45%)]" aria-labelledby="yesterday-verification-title">
    <div className="border-b border-cyan-400/10 p-4 sm:p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300">Prévision vs observation</p>
      <h2 id="yesterday-verification-title" className="mt-1 text-lg font-bold text-white">Est-ce que MeteoAI avait raison hier ?</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">Prévision archivée → relevé physique réel → erreur → modèle et horizon. Aucun score global; la fiabilité de la station source reste distincte de la performance du modèle.</p>
      <p className="mt-2 text-[11px] font-medium text-slate-300">{locationName} · validité Europe/Paris · station physique qualifiée uniquement</p>
    </div>

    {isLoading ? <div className="m-4 h-24 animate-pulse rounded-xl bg-slate-800/70" aria-label="Chargement de la comparaison d’hier" />
      : isError || !data ? <div className="m-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs text-amber-100">Indisponible : les archives de comparaison ne peuvent pas être lues; aucune métrique n’est estimée.</div>
        : <div className="space-y-4 p-4 sm:p-5">
          <div className={`rounded-xl border p-3 ${data.meteoai.status === "available" ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-amber-400/25 bg-amber-400/[0.05]"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">MeteoAI · fusion quotidienne</h3>
                <p className="mt-1 text-xs text-slate-300">{data.meteoai.status === "available" ? "Comparaison disponible sur les paires admissibles." : `Indisponible : ${data.meteoai.reason ?? "aucune paire qualifiée"}`}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${data.meteoai.status === "available" ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-100"}`}>
                {data.meteoai.status === "available" ? `${data.meteoai.pairCount} paire${data.meteoai.pairCount === 1 ? "" : "s"}` : "Indisponible"}
              </span>
            </div>
            {data.meteoai.groups.length > 0 && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {data.meteoai.groups.map((group) => {
                const pairs = data.pairs.filter((pair) => groupKey(pair) === groupKey(group));
                return <details key={groupKey(group)} className="min-w-0 rounded-lg border border-white/10 bg-black/20">
                  <summary className="cursor-pointer list-none p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                    <span className="block text-xs font-semibold text-slate-100">{VARIABLE_LABELS[group.variable] ?? group.variable} · {group.horizonBucket}</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-slate-300">MAE {displayMetric(group.mae, group.unit)} · RMSE {displayMetric(group.rmse, group.unit)} · biais {displayMetric(group.bias, group.unit)}</span>
                    <span className="mt-1 block text-[10px] text-slate-500">n = {group.pairCount} paire{group.pairCount === 1 ? "" : "s"} · {group.evaluatedDays} jour évalué</span>
                  </summary>
                  <div className="space-y-2 border-t border-slate-800 p-3">
                    {pairs.map((pair) => <article key={`${pair.modelId}:${pair.variable}:${pair.horizonBucket}:${pair.forecastIssuedAt}`} className="min-w-0 rounded-lg border border-white/10 bg-slate-950/60 p-3 text-[10px] leading-relaxed text-slate-300">
                      <p className="font-semibold text-white">Prévu {displayMetric(pair.forecastValue, group.unit)} · observé {displayMetric(pair.observedValue, group.unit)} · erreur {displayMetric(pair.signedError, group.unit)}</p>
                      <p className="mt-1">Émis : {dateTime(pair.forecastIssuedAt)} · disponible : {dateTime(pair.forecastAvailableAt)}</p>
                      <p>Valide : {pair.validDate} · horizon : {pair.horizonBucket} ({pair.leadTimeMinutes} min vers la fin du jour local)</p>
                      <p>Mesures retenues : {dateTime(pair.observationWindowStartAt)} → {dateTime(pair.observationWindowEndAt)}</p>
                      <p className="mt-1 font-medium text-cyan-100">Stations sources — aucun score de station calculé</p>
                      <ul className="mt-1 space-y-1">{pair.stationEvidence.map((station, index) => <li key={`${station.stationId}:${station.observedAt}:${index}`} className="break-words text-slate-400">{station.stationName} ({station.source}) · {dateTime(station.observedAt)} · {displayMetric(station.value, group.unit)}</li>)}</ul>
                    </article>)}
                  </div>
                </details>;
              })}
            </div>}
          </div>

          {data.status === "unavailable" && <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.045] p-3 text-xs leading-relaxed text-amber-100">
            <p className="font-semibold">Comparaison indisponible</p>
            <p className="mt-1">{data.reason ?? "Aucune paire complète n’est disponible."}</p>
          </div>}

          {data.status === "available" && <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Metric label="Lieu / archive" value={<>{locationName}<span className="mt-0.5 block break-all text-[9px] font-normal text-slate-500">{data.locationKey}</span></>} />
              <Metric label="Période de validité · Europe/Paris" value={<>{dateTime(data.validFromAt)}<span className="mt-0.5 block text-[9px] font-normal text-slate-500">jusqu’au {dateTime(data.validToAt)}</span></>} />
              <Metric label="Runs immuables · snapshots physiques" value={<>{data.forecastRunCount} · {data.qualifiedSnapshotHours}<span className="mt-0.5 block text-[9px] font-normal text-slate-500">runs sélectionnés · heures archivées</span></>} />
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-200">Comparaisons sous-jacentes · modèle × variable × horizon</h3>
              {data.groups.filter((group) => group.modelId !== "meteoai-official-daily-v2").map((group) => {
                const key = groupKey(group);
                const pairs = data.pairs.filter((pair) => groupKey(pair) === key);
                return <details key={key} className="rounded-xl border border-slate-700/80 bg-black/15">
                  <summary className="cursor-pointer list-none p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                    <span className="block text-xs font-semibold text-slate-100">{group.serviceName} · {VARIABLE_LABELS[group.variable] ?? group.variable} · {group.horizonBucket}</span>
                    <span className="mt-1 block text-[10px] text-slate-400">MAE {displayMetric(group.mae, group.unit)} · RMSE {displayMetric(group.rmse, group.unit)} · biais {displayMetric(group.bias, group.unit)} · n = {group.pairCount}</span>
                  </summary>
                  <div className="grid grid-cols-1 gap-2 border-t border-slate-800 p-3 sm:grid-cols-2">
                    {pairs.map((pair) => <article key={`${pair.modelId}:${pair.variable}:${pair.horizonBucket}:${pair.forecastIssuedAt}`} className="min-w-0 rounded-lg border border-white/10 bg-slate-950/60 p-3 text-[10px] leading-relaxed text-slate-300">
                      <p className="font-semibold text-white">Prévu {displayMetric(pair.forecastValue, group.unit)} · observé {displayMetric(pair.observedValue, group.unit)} · erreur {displayMetric(pair.signedError, group.unit)}</p>
                      <p className="mt-1">Émis : {dateTime(pair.forecastIssuedAt)} · disponible : {dateTime(pair.forecastAvailableAt)}</p>
                      <p>Valide : {pair.validDate} · horizon : {pair.horizonBucket} ({pair.leadTimeMinutes} min vers la fin du jour local)</p>
                      <p>Mesures retenues : {dateTime(pair.observationWindowStartAt)} → {dateTime(pair.observationWindowEndAt)}</p>
                      <p className="mt-1 font-medium text-cyan-100">Stations sources — aucun score de station calculé</p>
                      <ul className="mt-1 space-y-1">{pair.stationEvidence.map((station, index) => <li key={`${station.stationId}:${station.observedAt}:${index}`} className="break-words text-slate-400">{station.stationName} ({station.source}) · {dateTime(station.observedAt)} · {displayMetric(station.value, group.unit)}</li>)}</ul>
                    </article>)}
                  </div>
                </details>;
              })}
              {data.groups.filter((group) => group.modelId !== "meteoai-official-daily-v2").length === 0 && <p className="rounded-xl border border-slate-700/70 p-3 text-xs text-slate-400">Aucune comparaison de modèle fournisseur n’est disponible; aucune métrique n’est remplacée par zéro.</p>}
            </div>
          </>}

          {data.issues.length > 0 && <div className="border-t border-slate-800 pt-3">
            <p className="text-[10px] font-semibold text-slate-300">Limites / paires écartées</p>
            <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-slate-500">{Array.from(new Set(data.issues.map((issue) => `${issue.variable ? `${VARIABLE_LABELS[issue.variable] ?? issue.variable} — ` : ""}${ISSUE_LABELS[issue.code] ?? "Certaines preuves ne satisfont pas les critères d’appariement."}`))).map((label) => <li key={label}>· {label}</li>)}</ul>
          </div>}
        </div>}
  </section>;
}
