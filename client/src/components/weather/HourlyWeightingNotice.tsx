import React from "react";
import type {
  HourlyVariableSelectionReason,
  HourlyVariableSelectionStrategy,
  ManualHourlyOverride,
} from "@shared/hourlyModelMetrics";
import {
  getModelCountCoverageLabel,
  MODEL_COUNT_COVERAGE_LEVELS,
  type ModelCountCoverageLevel,
} from "@shared/modelCoverageConfidence";

type HourlyWeightingNoticeProps = {
  weighting?: {
    status?: "historical_skill" | "mixed" | "robust_fallback" | "single_model" | "unavailable";
    availabilityStatus?: "FUSED" | "SINGLE_MODEL" | "UNAVAILABLE";
    calibrationStatus?: "CALIBRATED" | "PARTIALLY_CALIBRATED" | "UNCALIBRATED_ROBUST" | "UNAVAILABLE";
    historyStatus?: "available" | "unavailable";
    minimumComparisons?: number;
    minimumComparableDays?: number;
    bestMatchIncluded?: false;
    manualOverride?: ManualHourlyOverride | null;
    modelsWithData?: readonly string[];
    horizons?: readonly {
      variable: string;
      horizonBucket: string | null;
      method: "historical_skill" | "mixed" | "robust_fallback" | "single_model" | "unavailable";
      availabilityStatus?: "FUSED" | "SINGLE_MODEL" | "UNAVAILABLE";
      calibrationStatus?: "CALIBRATED" | "PARTIALLY_CALIBRATED" | "UNCALIBRATED_ROBUST" | "UNAVAILABLE";
      unavailableReason: string | null;
      hourCount: number;
      availableModelCount?: number;
      evidenceEligibleModelCount?: number;
      contributingModelCount?: number;
      coverageLevelCounts?: Partial<Record<ModelCountCoverageLevel, number>>;
      selectionStrategyCounts?: Partial<Record<HourlyVariableSelectionStrategy, number>>;
      bestModelHourCounts?: readonly { modelName: string; hourCount: number }[];
      selectionReasonCounts?: readonly { reason: HourlyVariableSelectionReason; hourCount: number }[];
      modelNamesWithData: readonly string[];
    }[];
  } | null;
  showCoverageDistribution?: boolean;
  showFallbackDetails?: boolean;
};

const VARIABLE_LABELS: Record<string, string> = {
  temperature: "température",
  precipitation: "précipitations",
  wind_speed: "vent",
  wind_gust: "rafales",
  humidity: "humidité",
  pressure: "pression",
};

const REASON_LABELS: Record<string, string> = {
  insufficient_historical_evidence: "historique de calibration insuffisant",
  history_unavailable: "historique de calibration indisponible",
  horizon_not_scored: "horizon sans bucket historique",
  incomparable_horizons: "horizons différents, évalués séparément",
  no_wet_models: "aucun modèle disponible ne prévoit au moins 0,1 mm",
  no_model_data: "aucune prévision admissible pour cette variable et cette échéance",
};

function formatGroups(
  rows: NonNullable<HourlyWeightingNoticeProps["weighting"]>["horizons"],
  calibrationStatus: "CALIBRATED" | "PARTIALLY_CALIBRATED" | "UNCALIBRATED_ROBUST" | "UNAVAILABLE",
): string {
  const groups = new Map<string, Set<string>>();
  for (const row of rows ?? []) {
    const rowStatus = row.calibrationStatus
      ?? (row.method === "historical_skill" ? "CALIBRATED" : row.method === "mixed" ? "PARTIALLY_CALIBRATED" : row.method === "robust_fallback" ? "UNCALIBRATED_ROBUST" : "UNAVAILABLE");
    if (rowStatus !== calibrationStatus) continue;
    const label = VARIABLE_LABELS[row.variable] ?? row.variable;
    const horizons = groups.get(label) ?? new Set<string>();
    horizons.add(row.horizonBucket ?? "horizon non déterminé");
    groups.set(label, horizons);
  }
  return Array.from(groups, ([variable, horizons]) => `${variable} (${Array.from(horizons).join(", ")})`).join("; ");
}

function formatUnavailableDetails(rows: NonNullable<HourlyWeightingNoticeProps["weighting"]>["horizons"]): string {
  const groups = new Map<string, Set<string>>();
  for (const row of rows ?? []) {
    if (row.availabilityStatus !== "UNAVAILABLE" && row.method !== "unavailable") continue;
    const reason = REASON_LABELS[row.unavailableReason ?? ""] ?? "aucune valeur disponible";
    const variable = VARIABLE_LABELS[row.variable] ?? row.variable;
    const item = `${variable} (${row.horizonBucket ?? "horizon non déterminé"})`;
    const variables = groups.get(reason) ?? new Set<string>();
    variables.add(item);
    groups.set(reason, variables);
  }
  return Array.from(groups, ([reason, variables]) => `${reason} : ${Array.from(variables).join(", ")}`).join("; ");
}

function formatCoverageLevelDistribution(rows: NonNullable<HourlyWeightingNoticeProps["weighting"]>["horizons"]): string {
  const groups = new Map<string, { variable: string; horizon: string; counts: Record<ModelCountCoverageLevel, number> }>();
  for (const row of rows ?? []) {
    if (!row.coverageLevelCounts) continue;
    const horizon = row.horizonBucket ?? "horizon non déterminé";
    const key = `${row.variable}|${horizon}`;
    const group = groups.get(key) ?? {
      variable: VARIABLE_LABELS[row.variable] ?? row.variable,
      horizon,
      counts: { NONE: 0, SINGLE_MODEL: 0, LIMITED: 0, MODERATE: 0, BROAD: 0 },
    };
    for (const level of MODEL_COUNT_COVERAGE_LEVELS) {
      group.counts[level] += row.coverageLevelCounts[level] ?? 0;
    }
    groups.set(key, group);
  }

  const displayOrder: ModelCountCoverageLevel[] = ["BROAD", "MODERATE", "LIMITED", "SINGLE_MODEL", "NONE"];
  return Array.from(groups.values()).map(({ variable, horizon, counts }) => {
    const distribution = displayOrder.flatMap((level) => {
      const count = counts[level];
      if (count <= 0) return [];
      return [`${getModelCountCoverageLabel(level)} sur ${count} échéance${count === 1 ? "" : "s"}`];
    });
    return `${variable} (${horizon}) : ${distribution.join(", ")}`;
  }).join("; ");
}

function formatModelSelectionSummary(rows: NonNullable<HourlyWeightingNoticeProps["weighting"]>["horizons"]) {
  const best: string[] = [];
  const fallback: string[] = [];
  const reasonLabels: Record<HourlyVariableSelectionReason, string> = {
    qualified_comparable_history: "preuve locale comparable qualifiée",
    insufficient_qualified_history: "preuves qualifiées insuffisantes",
    historical_scores_unavailable: "historique local indisponible",
    incomparable_horizons: "horizons non comparables",
    tied_qualified_scores: "pas de gagnant unique",
    variable_without_station_validation: "variable sans validation stationnelle",
    only_model_available: "un seul modèle disponible",
    no_admissible_model: "aucun modèle admissible",
  };
  for (const row of rows ?? []) {
    const variable = VARIABLE_LABELS[row.variable] ?? row.variable;
    const horizon = row.horizonBucket ?? "horizon non déterminé";
    const context = `${variable} (${horizon})`;
    const bestHours = row.selectionStrategyCounts?.qualified_best_model ?? 0;
    if (bestHours > 0) {
      const winners = (row.bestModelHourCounts ?? [])
        .map(({ modelName, hourCount }) => `${modelName} sur ${hourCount} échéance${hourCount === 1 ? "" : "s"}`);
      best.push(`${context} : ${winners.join(", ") || `${bestHours} échéances avec gagnant`}`);
    }
    const fallbackHours = row.selectionStrategyCounts?.weighted_ensemble_fallback ?? 0;
    if (fallbackHours > 0) {
      const reasons = Array.from(new Set((row.selectionReasonCounts ?? []).map(({ reason }) => reasonLabels[reason])));
      fallback.push(`${context} : ${fallbackHours} échéance${fallbackHours === 1 ? "" : "s"}${reasons.length > 0 ? ` (${reasons.join(", ")})` : ""}`);
    }
  }
  return { best, fallback };
}

export function HourlyWeightingNotice({
  weighting,
  showCoverageDistribution = true,
  showFallbackDetails = true,
}: HourlyWeightingNoticeProps) {
  if (!weighting) return null;
  // Bloc retiré de l'interface : le statut robust_fallback n'affiche plus de notice utilisateur.
  if (weighting.status === "robust_fallback") return null;

  const minimumComparisons = weighting.minimumComparisons ?? 30;
  const minimumDays = weighting.minimumComparableDays ?? 7;
  const calibrated = formatGroups(weighting.horizons, "CALIBRATED");
  const partiallyCalibrated = formatGroups(weighting.horizons, "PARTIALLY_CALIBRATED");
  const robust = formatGroups(weighting.horizons, "UNCALIBRATED_ROBUST");
  const unavailable = formatUnavailableDetails(weighting.horizons);
  const coverageDistribution = formatCoverageLevelDistribution(weighting.horizons);
  const selectionSummary = formatModelSelectionSummary(weighting.horizons);
  const modelsWithData = Array.from(new Set([
    ...(weighting.modelsWithData ?? []),
    ...(weighting.horizons ?? []).flatMap((row) => row.modelNamesWithData),
  ]));
  const modelsLabel = modelsWithData.length > 0 ? modelsWithData.join(", ") : "aucun modèle";
  const hasInsufficientHistory = (weighting.horizons ?? []).some((row) =>
    row.unavailableReason === "insufficient_historical_evidence"
      || row.calibrationStatus === "PARTIALLY_CALIBRATED"
      || row.calibrationStatus === "UNCALIBRATED_ROBUST",
  );
  const evidenceLabel = weighting.historyStatus === "unavailable"
    ? "L’historique de calibration n’est pas disponible."
    : hasInsufficientHistory
      ? `L’historique comparable n’atteint pas toujours le seuil de ${minimumComparisons} comparaisons sur ${minimumDays} jours.`
      : `Les preuves historiques qualifiées sont propres à la variable et à l’horizon (seuil : ${minimumComparisons} comparaisons sur ${minimumDays} jours).`;
  const availabilityMessage = "La disponibilité des valeurs des modèles est évaluée séparément de la fiabilité historique : une absence normale hors portée n’est ni une erreur ni un échec de score, et n’entre pas dans les dénominateurs de classement.";

  return (
    <div role="note" className="rounded-lg border border-sky-200/10 bg-sky-200/[0.035] px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
      {weighting.manualOverride && <p className="mb-1 rounded-md border border-amber-200/20 bg-amber-200/[0.05] px-2 py-1 text-amber-100"><span className="font-semibold">Override horaire manuel explicite appliqué.</span> {weighting.manualOverride.reason} Série officielle d’origine conservée ({weighting.manualOverride.officialOriginalPointCount} échéances; calcul officiel du {weighting.manualOverride.officialOriginalComputedAt}).</p>}
      {showCoverageDistribution && coverageDistribution && <div className="mb-1 rounded-md border border-sky-200/10 bg-black/10 px-2 py-1">
        <p><span className="font-semibold text-sky-100">Nombre de modèles contributeurs, par variable et horizon :</span> {coverageDistribution}.</p>
        <p>Ces catégories décrivent uniquement l’effectif des modèles contributeurs, pas la couverture/qualité des stations physiques. L’incertitude statistique n’est pas mesurée ici; la performance historique et son statut de calibration (`CALIBRATED`, `PARTIALLY_CALIBRATED`, `UNCALIBRATED_ROBUST`) restent distincts et sont affichés séparément ci-dessous.</p>
      </div>}
      {selectionSummary.best.length > 0 && <p className="mb-1 rounded-md border border-emerald-200/15 bg-emerald-200/[0.035] px-2 py-1"><span className="font-semibold text-emerald-100">Meilleur modèle retenu sur preuve historique locale comparable :</span> {selectionSummary.best.join("; ")}.</p>}
      {showFallbackDetails && selectionSummary.fallback.length > 0 && <p className="mb-1 rounded-md border border-sky-200/10 bg-black/10 px-2 py-1"><span className="font-semibold text-sky-100">Fallback conservé :</span> mélange pondéré actuel lorsque la preuve ne permet pas de départager sûrement les modèles — {selectionSummary.fallback.join("; ")}.</p>}
      {weighting.status === "unavailable" ? (
        <>
          <p><span className="font-semibold text-amber-100">Prévision officielle horaire indisponible : aucun modèle admissible n’a fourni de valeur.</span> {availabilityMessage} {evidenceLabel} Modèles avec données : {modelsLabel}. Best Match est exclu.</p>
          {unavailable && <p className="mt-1">Détail : {unavailable}.</p>}
        </>
      ) : weighting.status === "single_model" ? (
        <>
          <p><span className="font-semibold text-sky-100">Prévision d’un modèle unique, pas une fusion multimodèle.</span> {modelsLabel}. Disponibilité et calibration sont distinctes; {evidenceLabel} {availabilityMessage} Best Match est exclu.</p>
          {calibrated && <p className="mt-1">Calibration qualifiée : {calibrated}.</p>}
          {robust && <p className="mt-1">Valeur conservée avec repli robuste non calibré : {robust}.</p>}
        </>
      ) : weighting.status === "mixed" ? (
        <>
          <p><span className="font-semibold text-sky-100">Fusion disponible, calibration partielle selon le modèle, la variable et l’horizon.</span> Les autres valeurs exploitables restent incluses avec un repli robuste, et non transformées en absence de prévision. {evidenceLabel} {availabilityMessage} Modèles avec données : {modelsLabel}. Best Match est exclu.</p>
          {calibrated && <p className="mt-1">Calibrées : {calibrated}.</p>}
          {partiallyCalibrated && <p className="mt-1">Partiellement calibrées : {partiallyCalibrated}.</p>}
          {robust && <p className="mt-1">Robustes non calibrées : {robust}.</p>}
        </>
      ) : (
        <>
          <p><span className="font-semibold text-emerald-100">Pondération historique qualifiée.</span> {evidenceLabel} {availabilityMessage} Modèles avec données : {modelsLabel}. Best Match est exclu.</p>
          {calibrated && <p className="mt-1">Calibration qualifiée : {calibrated}.</p>}
        </>
      )}
      {unavailable && weighting.status !== "unavailable" && <p className="mt-1">Champs sans valeur disponible : {unavailable}.</p>}
    </div>
  );
}
