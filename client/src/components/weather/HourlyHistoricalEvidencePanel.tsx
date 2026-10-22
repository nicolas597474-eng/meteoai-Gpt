import React from "react";
import type { HourlyHistoricalEvidence, HourlyHistoricalEvidenceStatus } from "@shared/hourlyModelMetrics";
import { getModelCountCoverageLabel, getModelCountCoverageLevel } from "@shared/modelCoverageConfidence";

type VariableWeighting = {
  variable: string;
  horizonBucket?: string | null;
  contributingModelCount?: number;
  calibrationStatus?: "CALIBRATED" | "PARTIALLY_CALIBRATED" | "UNCALIBRATED_ROBUST" | "UNAVAILABLE";
  historicalEvidence?: HourlyHistoricalEvidence[];
};

type Props = {
  variableWeightings?: VariableWeighting[];
  horizonBucket?: string | null;
  horizonUnavailableReason?: string | null;
};

const VARIABLE_LABELS: Record<string, string> = {
  temperature: "Température",
  precipitation: "Précipitations",
  wind_speed: "Vent moyen",
  wind_gust: "Rafales",
  humidity: "Humidité",
  pressure: "Pression",
};

const VARIABLE_UNITS: Record<string, string> = {
  temperature: "°C",
  precipitation: "mm",
  wind_speed: "km/h",
  wind_gust: "km/h",
  humidity: "%",
  pressure: "hPa",
};

const STATUS_LABELS: Record<HourlyHistoricalEvidenceStatus, string> = {
  qualified: "Seuil d’évidence atteint",
  insufficient_evidence: "Échantillon insuffisant · non qualifié",
  no_evidence: "Aucune comparaison archivée",
  incomplete_metrics: "Mesures historiques incomplètes",
  history_unavailable: "Historique indisponible",
};

function formatMetric(value: number, unit: string, signed = false) {
  const rounded = value.toFixed(1);
  return `${signed && value > 0 ? "+" : ""}${rounded} ${unit}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" })
    : "—";
}

function formatTimestamp(value: string | null) {
  if (!value) return "horodatage indisponible";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })
    : "horodatage indisponible";
}

function windowEvidence(
  evidence: HourlyHistoricalEvidence["trend"]["recent"],
  minimumComparisons: number,
  minimumComparableDays: number,
) {
  return evidence
    ? `${evidence.comparisonCount}/${minimumComparisons} comparaisons · ${evidence.evaluatedDays}/${minimumComparableDays} jours`
    : `0/${minimumComparisons} comparaisons · 0/${minimumComparableDays} jours`;
}

function EvidenceRow({ evidence }: { evidence: HourlyHistoricalEvidence }) {
  const unit = VARIABLE_UNITS[evidence.variable] ?? "";
  const metrics = evidence.metrics;
  const tone = evidence.status === "qualified" ? "text-emerald-200"
    : evidence.status === "insufficient_evidence" ? "text-amber-100" : "text-slate-400";
  const trendDescription = evidence.trend.status === "qualified" && evidence.trend.delta
    ? `Évolution · ${formatDate(evidence.trend.recentWindowStart)}–${formatDate(evidence.trend.recentWindowEnd)} moins ${formatDate(evidence.trend.previousWindowStart)}–${formatDate(evidence.trend.previousWindowEnd)} : MAE ${formatMetric(evidence.trend.delta.mae, unit, true)} · RMSE ${formatMetric(evidence.trend.delta.rmse, unit, true)} · biais ${formatMetric(evidence.trend.delta.bias, unit, true)}`
    : evidence.trend.status === "history_unavailable"
      ? "Évolution indisponible : archive historique illisible ou indisponible."
      : evidence.trend.status === "no_evidence"
        ? "Évolution indisponible : aucune preuve complète dans au moins une des deux fenêtres."
        : `Évolution non qualifiée · fenêtre récente : ${windowEvidence(evidence.trend.recent, evidence.trend.minimumComparisons, evidence.trend.minimumComparableDays)} · précédente : ${windowEvidence(evidence.trend.previous, evidence.trend.minimumComparisons, evidence.trend.minimumComparableDays)} · seuil par fenêtre : ${evidence.trend.minimumComparisons} comparaisons et ${evidence.trend.minimumComparableDays} jours.`;

  return <article className="rounded-lg border border-white/8 bg-black/15 p-2.5">
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <p className="text-[10px] font-semibold text-white">{evidence.modelName}</p>
      <span className={`text-[9px] font-semibold ${tone}`}>{STATUS_LABELS[evidence.status]}</span>
    </div>
    {metrics ? <>
      <div className="mt-1 grid grid-cols-3 gap-1 text-[9px] text-slate-300">
        <span>MAE <b className="text-white">{formatMetric(metrics.mae, unit)}</b></span>
        <span>RMSE <b className="text-white">{formatMetric(metrics.rmse, unit)}</b></span>
        <span>Biais <b className="text-white">{formatMetric(metrics.bias, unit, true)}</b></span>
      </div>
      <p className="mt-1 text-[9px] text-slate-400">n={metrics.comparisonCount} comparaisons · {metrics.evaluatedDays} jours · {formatDate(evidence.firstScoreDate)}–{formatDate(evidence.latestScoreDate)}</p>
      <p className={`mt-1 text-[9px] ${evidence.trend.status === "qualified" ? "text-sky-100" : "text-slate-500"}`}>{trendDescription}</p>
      <p className="mt-1 text-[8px] text-slate-500">Dernière évaluation calculée : {formatTimestamp(evidence.latestComputedAt)}{evidence.incompleteMetricRows > 0 ? ` · ${evidence.incompleteMetricRows} ligne(s) incomplète(s) exclue(s)` : ""}.</p>
    </> : <p className="mt-1 text-[9px] text-slate-400">{evidence.status === "history_unavailable" ? "La lecture de l’archive historique n’a pas abouti." : evidence.status === "incomplete_metrics" ? "Les colonnes MAE, RMSE et biais ne sont pas toutes disponibles pour les comparaisons archivées." : "Aucune valeur brute suffisante pour cette combinaison exacte modèle × variable × horizon."} · aucune comparaison qualifiable.</p>}
  </article>;
}

export function HourlyHistoricalEvidencePanel({
  variableWeightings = [],
  horizonBucket,
  horizonUnavailableReason,
}: Props) {
  const entries = variableWeightings.filter((item) => item.historicalEvidence?.length);
  const coverageSummary = variableWeightings.flatMap((item) => {
    if (item.contributingModelCount == null || !Number.isFinite(item.contributingModelCount)) return [];
    const contributorCount = Math.max(0, Math.floor(item.contributingModelCount));
    const coverageLevel = getModelCountCoverageLevel(contributorCount);
    const calibration = item.calibrationStatus ?? "indisponible";
    const horizon = item.horizonBucket ?? horizonBucket ?? "horizon exact";
    return [`${VARIABLE_LABELS[item.variable] ?? item.variable} (${horizon}) : ${getModelCountCoverageLabel(coverageLevel)} (${contributorCount} contributeur${contributorCount === 1 ? "" : "s"}) · calibration ${calibration}`];
  }).join("; ");
  const coverageNote = coverageSummary ? <div role="note" className="rounded-lg border border-sky-200/10 bg-sky-200/[0.035] p-2">
    <p className="text-[9px] leading-relaxed text-slate-300"><strong>Nombre de modèles contributeurs pour cette échéance et variable :</strong> {coverageSummary}. Cette couverture décrit uniquement l’effectif des modèles; elle ne mesure pas la couverture/qualité physique des stations. L’incertitude statistique n’est pas mesurée ici; la performance historique et son statut de calibration restent distincts.</p>
  </div> : null;
  const hasHorizonContract = horizonBucket !== undefined || horizonUnavailableReason !== undefined;
  const horizonIsUnusable = hasHorizonContract && (
    horizonBucket == null
    || horizonUnavailableReason === "horizon_not_scored"
    || horizonUnavailableReason === "incomparable_horizons"
  );

  if (horizonIsUnusable) {
    const reason = horizonUnavailableReason === "incomparable_horizons"
      ? "Les modèles disponibles ont des échéances incompatibles; aucune échéance voisine n’est utilisée en repli."
      : "L’horizon exact n’est pas archivé séparément; aucune échéance voisine n’est utilisée en repli.";
    return <section className="rounded-xl border border-slate-700/60 bg-slate-900/25 p-3" aria-label="Fiabilité historique horaire indisponible pour cet horizon">
      <p className="text-[11px] font-semibold text-slate-200">Fiabilité historique horaire indisponible · horizon exact</p>
      {coverageNote}
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{reason} La dispersion inter-modèles reste distincte d’une comparaison aux observations.</p>
    </section>;
  }

  if (entries.length === 0) return <section className="rounded-xl border border-slate-700/60 bg-slate-900/25 p-3" aria-label="Fiabilité historique horaire">
    <p className="text-[11px] font-semibold text-slate-200">Fiabilité historique horaire indisponible</p>
    {coverageNote}
    <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Aucune preuve horaire par modèle × variable × horizon n’est attachée à ce créneau. L’accord inter-modèles ne remplace pas une comparaison aux observations.</p>
  </section>;

  const displayedEvidence = entries.flatMap((entry) => entry.historicalEvidence ?? []);
  const displayedHorizon = horizonBucket ?? displayedEvidence.find((evidence) => evidence.horizonBucket !== "unavailable")?.horizonBucket ?? null;
  const minimumComparisons = displayedEvidence[0]?.minimumComparisons ?? null;
  const minimumComparableDays = displayedEvidence[0]?.minimumComparableDays ?? null;
  return <div className="space-y-2">
    {coverageNote}
    <details className="rounded-xl border border-slate-700/60 bg-slate-900/25" aria-label="Fiabilité historique horaire par modèle, variable et horizon">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-[11px] font-semibold text-slate-100">Fiabilité historique · par modèle × variable × horizon <span className="ml-1 text-[9px] font-normal text-slate-400">{displayedHorizon ? `· ${displayedHorizon}` : "· horizon indisponible"}</span></summary>
      <div className="space-y-2 border-t border-white/8 px-3 py-3">
      <p className="text-[9px] leading-relaxed text-slate-400">Erreur contre les observations physiques archivées, distincte de la dispersion entre prévisions. MAE/RMSE/biais restent des mesures brutes. Qualification affichée uniquement au seuil communiqué ci-dessous pour chaque cellule; Best Match et agrégateurs exclus. Seuil actuellement lu : {minimumComparisons ?? "indisponible"} comparaisons et {minimumComparableDays ?? "indisponible"} jours.</p>
      {entries.map((entry) => {
        const evidence = entry.historicalEvidence ?? [];
        const unit = VARIABLE_UNITS[entry.variable] ?? "";
        const qualifiedCount = evidence.filter((item) => item.status === "qualified").length;
        return <details key={`${entry.variable}-${evidence[0]?.horizonBucket ?? "unavailable"}`} className="rounded-lg border border-white/8 bg-black/10">
          <summary className="cursor-pointer px-2.5 py-2 text-[10px] font-semibold text-slate-200">{VARIABLE_LABELS[entry.variable] ?? entry.variable} <span className="font-normal text-slate-400">· {qualifiedCount}/{evidence.length} modèles au seuil</span></summary>
          <div className="space-y-1.5 border-t border-white/5 p-2">
            <p className="text-[8px] text-slate-500">Unités : {unit} · échéance exacte : {evidence[0]?.horizonBucket ?? "indisponible"} · minimum : {evidence[0]?.minimumComparisons ?? "indisponible"} comparaisons, {evidence[0]?.minimumComparableDays ?? "indisponible"} jours.</p>
            {evidence.map((model) => <EvidenceRow key={`${model.modelName}-${model.modelId}`} evidence={model} />)}
          </div>
        </details>;
      })}
      </div>
    </details>
  </div>;
}
