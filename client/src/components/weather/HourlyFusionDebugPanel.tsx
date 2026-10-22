import React, { useState } from "react";
import type { HourlyFusionTrace, HourlyPrecipitationAgreementTrace } from "@shared/hourlyModelMetrics";
import { getModelCountCoverageLabel } from "@shared/modelCoverageConfidence";

type HourlyDebugPoint = {
  date: string | null;
  hour: string;
  validAt: number | null;
  finalValues?: Array<{ variable: string; value: number | null; unit: string }>;
  weighting?: HourlyFusionTrace | null;
  precipitationAgreement?: HourlyPrecipitationAgreementTrace | null;
};

export function selectHourlyDebugTarget(
  points: HourlyDebugPoint[],
  selectedValidAt?: number | null,
  preferredValidAt?: number | null,
): HourlyDebugPoint | null {
  const targets = points.filter((point) => point.validAt != null && Number.isFinite(point.validAt));
  return targets.find((point) => point.validAt === selectedValidAt)
    ?? targets.find((point) => point.validAt === preferredValidAt)
    ?? targets[0]
    ?? null;
}

const parisTime = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatInstant(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "indisponible";
  return parisTime.format(timestamp);
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "indisponible";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);
}

function variableLabel(variable: string): string {
  const labels: Record<string, string> = {
    temperature: "Température",
    apparent_temperature: "Ressenti",
    precipitation: "Précipitations",
    wind_speed: "Vent",
    wind_direction: "Direction du vent",
    wind_gust: "Rafales",
    humidity: "Humidité",
    pressure: "Pression",
    cloud_cover: "Nébulosité",
    cloud_cover_low: "Nuages bas",
    cloud_cover_mid: "Nuages moyens",
    cloud_cover_high: "Nuages hauts",
    uv_index: "Indice UV",
    dew_point: "Point de rosée",
    visibility: "Visibilité",
    shortwave_radiation: "Rayonnement solaire",
  };
  return labels[variable] ?? variable;
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    FUSED: "fusion disponible",
    SINGLE_MODEL: "modèle unique",
    UNAVAILABLE: "indisponible",
    CALIBRATED: "calibrée sur preuve historique qualifiée",
    PARTIALLY_CALIBRATED: "calibration historique partielle",
    UNCALIBRATED_ROBUST: "repli robuste non calibré",
    EXACT_LOCAL_MODEL_VARIABLE_HORIZON: "lead exact local modèle × variable",
    EXACT_LOCAL_MODEL_VARIABLE_BUCKET: "bucket exact lieu × modèle × variable",
    qualified: "qualifiée",
    insufficient_evidence: "insuffisante",
    no_evidence: "aucune preuve",
    incomplete_metrics: "métriques incomplètes",
    history_unavailable: "historique indisponible",
  };
  return labels[value] ?? value;
}

function calibrationLevelLabel(level: string): string {
  if (level === "EXACT_LOCAL_MODEL_VARIABLE_HORIZON") return "preuve locale (modèle × variable × lead exact)";
  if (level === "EXACT_LOCAL_MODEL_VARIABLE_BUCKET") return "fallback local (modèle × variable × bucket)";
  return "repli robuste non calibré";
}

function selectionDescription(variable: HourlyFusionTrace["variableWeightings"][number]): string {
  if (variable.selectionStrategy === "qualified_best_model") {
    const basis = variable.selectionEvidenceBasis === "exact_lead" ? "lead exact local" : "bucket local";
    return `meilleur modèle unique : ${variable.selectedModelName ?? "nom indisponible"} (${basis} qualifié)`;
  }
  if (variable.selectionStrategy === "only_available_model") {
    return `un seul modèle disponible : ${variable.selectedModelName ?? "nom indisponible"}; aucun classement comparatif`;
  }
  if (variable.selectionStrategy === "unavailable") return "aucune prévision admissible";
  const reason: Record<string, string> = {
    insufficient_qualified_history: "preuve historique qualifiée insuffisante",
    historical_scores_unavailable: "historique local indisponible",
    incomparable_horizons: "horizons historiques non comparables",
    tied_qualified_scores: "aucun gagnant unique dans les scores qualifiés",
    variable_without_station_validation: "variable sans validation stationnelle suffisante",
    only_model_available: "un seul modèle disponible",
    no_admissible_model: "aucune valeur admissible",
    qualified_comparable_history: "preuve historique qualifiée",
  };
  return `fallback : mélange pondéré actuel (${reason[variable.selectionReason] ?? variable.selectionReason})`;
}

export function HourlyFusionDebugPanel({
  points,
  preferredValidAt,
}: {
  points: HourlyDebugPoint[];
  preferredValidAt?: number | null;
}) {
  const targets = points.filter((point) => point.validAt != null && Number.isFinite(point.validAt));
  const [selectedValidAt, setSelectedValidAt] = useState<number | null>(null);
  const selected = selectHourlyDebugTarget(targets, selectedValidAt, preferredValidAt);
  const weighting = selected?.weighting ?? null;
  const precipitation = selected?.precipitationAgreement ?? null;

  return <div className="space-y-2.5" aria-label="Débogage de la fusion horaire">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="text-[11px] font-semibold text-slate-100">Sélection et disponibilité par variable</p>
        <p className="text-[9px] text-slate-400">Un gagnant n’est utilisé que si les preuves locales comparables sont qualifiées; sinon, le mélange pondéré actuel reste le fallback.</p>
      </div>
      <label className="flex items-center gap-1.5 text-[9px] text-slate-300">
        <span>Cible</span>
        <select
          aria-label="Choisir l’échéance horaire à déboguer"
          className="max-w-52 rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-[10px] text-slate-100"
          value={selected?.validAt == null ? "" : String(selected.validAt)}
          onChange={(event) => setSelectedValidAt(event.target.value ? Number(event.target.value) : null)}
        >
          {targets.map((point) => <option key={point.validAt} value={String(point.validAt)}>{formatInstant(point.validAt)}</option>)}
        </select>
      </label>
    </div>

    {!selected ? <p className="rounded-lg border border-slate-700 bg-slate-950/35 px-2.5 py-2 text-[10px] text-slate-400">Aucune échéance horaire vérifiable n’est disponible.</p> : <>
      <p className="text-[9px] text-slate-400">TARGET : {formatInstant(selected.validAt)} · {weighting ? `${weighting.contributingModelCount}/${weighting.expectedModelCount} contributeurs tous champs confondus` : "diagnostics de fusion indisponibles"}. La disponibilité et la calibration restent deux statuts distincts.</p>

      {selected.finalValues && <section className="rounded-lg border border-sky-300/15 bg-sky-300/[0.035] p-2" aria-label="Valeurs finales fusionnées par variable">
        <p className="text-[10px] font-semibold text-sky-100">Valeurs finales de la fusion · cette échéance</p>
        <p className="mt-0.5 text-[9px] text-slate-400">Valeurs réellement renvoyées par le moteur; zéro est conservé et une valeur null reste indisponible.</p>
        <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {selected.finalValues.map((finalValue) => {
            const variableWeighting = weighting?.variableWeightings.find((item) => item.variable === finalValue.variable);
            const status = variableWeighting
              ? statusLabel(variableWeighting.availabilityStatus)
              : finalValue.value == null ? "aucune valeur finale" : "trace de pondération indisponible";
            const digits = finalValue.variable === "weather_code" ? 0 : 2;
            return <p key={finalValue.variable} className="rounded-md bg-slate-950/35 px-2 py-1 text-[9px] text-slate-300">
              {variableLabel(finalValue.variable)} : <span className="font-semibold text-slate-100">{finalValue.value == null ? "indisponible" : `${formatNumber(finalValue.value, digits)} ${finalValue.unit}`}</span> · {status}
            </p>;
          })}
        </div>
      </section>}

      {weighting ? <div className="space-y-1.5">
        {weighting.variableWeightings.map((variable) => <details key={variable.variable} className="rounded-lg border border-slate-700/80 bg-slate-950/30 p-2" open={variable.variable === "temperature"}>
          <summary className="cursor-pointer text-[10px] font-semibold text-slate-100">
            {variableLabel(variable.variable)} · {variable.contributingModelCount}/{variable.expectedModelCount} contributeurs · {getModelCountCoverageLabel(variable.coverageLevel as Parameters<typeof getModelCountCoverageLabel>[0])} · {statusLabel(variable.calibrationStatus)}
          </summary>
          <p className="mt-1 text-[9px] leading-relaxed text-sky-100">Sélection : {selectionDescription(variable)}. Aucune mesure instantanée n’est injectée dans cette prévision future.</p>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-400">Disponibles : {variable.availableModelCount} · preuves qualifiées : {variable.evidenceEligibleModelCount} · résumé bucket : {variable.horizonBucket ?? "mixte ou non classé"}. Le gagnant exige une preuve comparable au lead exact ou dans un bucket commun; en cas contraire, le mélange pondéré peut conserver plusieurs buckets. La couverture décrit l’effectif de modèles contributeurs, pas la couverture/qualité des stations physiques. L’incertitude statistique n’est pas mesurée ici; la fiabilité historique est affichée séparément.</p>
          {variable.modelWeights.length > 0 && <ul className="mt-1.5 space-y-1.5">
            {variable.modelWeights.map((model) => <li key={`${variable.variable}-${model.modelName}`} className="rounded-md border border-emerald-300/10 bg-emerald-300/[0.035] px-2 py-1.5 text-[9px] leading-relaxed text-slate-300">
              <p className="font-semibold text-emerald-100">{model.modelName} · disponible · {model.contributedToValue ? "contributeur" : "valeur conservée, non contributrice à la quantité"}</p>
              <p>Valeur {formatNumber(model.value, 2)} · availableAt {formatInstant(model.availableAt)} · validTime {formatInstant(model.validTime)} · horizon {formatNumber(model.horizonMinutes, 2)} min · bucket {model.horizonBucket ?? "non classé"}.</p>
              <p>Calibration : {statusLabel(model.calibrationStatus)} · niveau : {calibrationLevelLabel(model.calibrationLevel)} · facteur de fiabilité historique {formatNumber(model.reliability, 3)}.</p>
              <p>Poids brut {formatNumber(model.rawWeight, 4)} · facteur robuste {model.robustFallbackWeight == null ? "aucun" : formatNumber(model.robustFallbackWeight, 4)} · poids final {formatNumber(model.weight * 100, 2)} %.</p>
              <p>Score historique (MAE / RMSE / biais) : {model.historicalScore
                ? `${formatNumber(model.historicalScore.mae)} / ${formatNumber(model.historicalScore.rmse)} / ${formatNumber(model.historicalScore.bias)} · ${model.historicalScore.comparisonCount} comparaisons / ${model.historicalScore.evaluatedDays} jours`
                : "aucune métrique qualifiée"}. Dernier score : {model.historicalEvidence?.latestScoreDate ?? "date indisponible"}.</p>
              <p>Preuve strictement au lead exact : {model.exactHorizonEvidence
                ? `${statusLabel(model.exactHorizonEvidence.status)} · ${model.exactHorizonEvidence.metrics?.comparisonCount ?? 0} comparaisons / ${model.exactHorizonEvidence.metrics?.evaluatedDays ?? 0} jours (seuil ${model.exactHorizonEvidence.minimumComparisons}/${model.exactHorizonEvidence.minimumComparableDays})`
                : "aucune ligne exacte disponible"}.</p>
              <p>Run {model.runId ?? "inconnu"} · source {model.sourceName} · requête démarrée {formatInstant(model.requestStartedAt)}.</p>
            </li>)}
          </ul>}
          {variable.modelReasons.length > 0 && <ul className="mt-1.5 space-y-1">
            {variable.modelReasons.map((model) => <li key={`${variable.variable}-${model.modelName}`} className="rounded-md border border-amber-300/10 bg-amber-300/[0.035] px-2 py-1 text-[9px] leading-relaxed text-amber-100">
              {model.modelName} · exclu/indisponible : {model.reason} · availableAt {formatInstant(model.availableAt)} · validTime {formatInstant(model.validTime)} · horizon {formatNumber(model.horizonMinutes, 2)} min · bucket {model.horizonBucket ?? "indisponible"}.
            </li>)}
          </ul>}
        </details>)}
      </div> : <p className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-2.5 py-2 text-[10px] text-amber-100">Cette cible n’a pas de trace détaillée dans le snapshot chargé.</p>}

      {precipitation && <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.035] px-2.5 py-2 text-[9px] leading-relaxed text-slate-300">
        <p className="font-semibold text-cyan-100">Précipitations · accord des modèles</p>
        <p>{precipitation.rainModelCount}/{precipitation.availableModelCount} modèles disponibles prévoient au moins {formatNumber(precipitation.thresholdMm, 1)} mm · accord brut {formatNumber(precipitation.frequencyPercent, 1)} % · probabilité calibrée : non.</p>
        <p>Estimation de consensus : {formatNumber(precipitation.consensusEstimateMm, 2)} mm · moyenne conditionnelle des modèles pluvieux : {formatNumber(precipitation.conditionalMeanMm, 2)} mm ({precipitation.conditionalMeanMethod}).</p>
        <p>Cette fréquence décrit un accord de modèles, pas une probabilité météorologique calibrée; l’estimation de consensus reste distincte de la valeur finale affichée plus haut si un modèle unique a été retenu. Valeurs par modèle : {precipitation.modelValues.map((model) => `${model.modelName} ${formatNumber(model.amountMm, 2)} mm`).join(" · ") || "aucune valeur disponible"}.</p>
      </div>}
    </>}
  </div>;
}
