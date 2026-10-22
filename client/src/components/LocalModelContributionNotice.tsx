import * as React from "react";

export type LocalModelContributionNoticeProps = {
  localMode: "standard" | "local" | "ultra-local";
  isPlaceholderData: boolean;
  estimateTemperature: number | null;
  stationCount: number;
  modelContribution: number | null;
  modelWeight: number | null;
  finalModelWeight?: number | null;
  usesOfficialFallback: boolean;
  usesModelFallback: boolean;
};

export function LocalModelContributionNotice({
  localMode,
  isPlaceholderData,
  estimateTemperature,
  stationCount,
  modelContribution,
  modelWeight,
  finalModelWeight,
  usesOfficialFallback,
  usesModelFallback,
}: LocalModelContributionNoticeProps) {
  const hasValidEstimate = typeof estimateTemperature === "number" && Number.isFinite(estimateTemperature);
  const hasModelInput = typeof modelContribution === "number" && Number.isFinite(modelContribution);
  const hasConfiguredWeight = typeof modelWeight === "number" && Number.isFinite(modelWeight) && modelWeight > 0;

  if (
    localMode === "standard"
    || isPlaceholderData
    || stationCount < 1
    || !hasValidEstimate
    || !hasModelInput
    || !hasConfiguredWeight
    || usesOfficialFallback
    || usesModelFallback
  ) {
    return null;
  }

  const configuredWeightPercent = Math.round(modelWeight * 100);
  if (configuredWeightPercent < 1) return null;

  return (
    <p role="note" aria-label="Contexte courant et poids modèle configuré de l’estimation locale" className="mt-0.5 text-[9px] leading-relaxed text-violet-200/80">
      <span className="font-semibold uppercase tracking-wide text-violet-200">CONTEXTE COURANT · ESTIMATION LOCALE</span>
      <span> · Snapshot de modèle Open-Meteo inclus (pas une observation). Réglage modèle : {configuredWeightPercent} % · part finale appliquée : {typeof finalModelWeight==="number"&&Number.isFinite(finalModelWeight)?`${(finalModelWeight*100).toFixed(1)} %`: "indisponible"}. Distinct de la prévision officielle.</span>
    </p>
  );
}
