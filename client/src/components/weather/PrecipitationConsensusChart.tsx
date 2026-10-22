import * as React from "react";
import type { PrecipitationModelConsensus } from "@shared/precipitationConsensus";

type Props = {
  summary: PrecipitationModelConsensus | null | undefined;
};

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 1,
});
const millimeterFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatPercent(value: number): string {
  return `${percentFormatter.format(value)} %`;
}

function formatMillimeters(value: number): string {
  return `${millimeterFormatter.format(value)} mm`;
}

function isFiniteAmount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function conditionalMethodLabel(
  method: PrecipitationModelConsensus["conditionalMeanMethod"]
): string {
  if (method === "historical_skill") return "pondération historique qualifiée";
  if (method === "arithmetic_mean")
    return "moyenne descriptive des modèles pluvieux";
  return "conditionnel indisponible sans poids qualifiés";
}

export function PrecipitationConsensusChart({ summary }: Props) {
  const frequencyPercent =
    summary?.availableModelCount &&
    summary.frequencyPercent != null &&
    Number.isFinite(summary.frequencyPercent)
      ? summary.frequencyPercent
      : null;
  const conditionalMeanMm =
    summary?.rainModelCount && isFiniteAmount(summary.conditionalMeanMm)
      ? summary.conditionalMeanMm
      : null;
  const consensusEstimateMm = isFiniteAmount(summary?.consensusEstimateMm)
    ? summary.consensusEstimateMm
    : null;
  const quantityValues = [conditionalMeanMm, consensusEstimateMm].filter(
    (value): value is number => value != null
  );
  const quantityAxisMaxMm = Math.max(
    1,
    Math.ceil(Math.max(0, ...quantityValues))
  );
  const conditionalDescription =
    summary == null
      ? "données indisponibles"
      : summary.availableModelCount === 0
        ? "aucune valeur valide"
        : summary.rainModelCount === 0
          ? "aucun modèle pluvieux"
          : conditionalMethodLabel(summary.conditionalMeanMethod);

  const quantityBar = (label: string, value: number | null) => {
    if (value == null) return null;
    const width = Math.min(100, Math.max(0, (value / quantityAxisMaxMm) * 100));
    return (
      <div
        role="progressbar"
        aria-label={`${label}, échelle en millimètres`}
        aria-valuemin={0}
        aria-valuemax={quantityAxisMaxMm}
        aria-valuenow={value}
        aria-valuetext={formatMillimeters(value)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-700/80"
      >
        <div
          className="h-full rounded-full bg-sky-400 transition-[width]"
          style={{ width: `${width}%` }}
        />
      </div>
    );
  };

  return (
    <section
      aria-labelledby="precipitation-consensus-chart-title"
      className="rounded-2xl border border-sky-300/20 bg-[#0a0e14] p-3 shadow-[0_12px_28px_rgba(15,23,42,0.25)] sm:p-4"
    >
      <header className="mb-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-sky-200/75">
          Pluie prévue · bilan journalier
        </p>
        <h2
          id="precipitation-consensus-chart-title"
          className="text-sm font-semibold text-slate-100 sm:text-base"
        >
          Fréquence des modèles et quantité
        </h2>
        <p className="mt-0.5 text-[10px] text-slate-400">
          Seuil inclusif : ≥{" "}
          {summary?.thresholdMm.toLocaleString("fr-FR") ?? "0,1"} mm
        </p>
      </header>

      {!summary ? (
        <p
          role="status"
          className="rounded-lg border border-slate-500/15 bg-slate-900/25 px-3 py-2 text-xs text-slate-400"
        >
          Données de fréquence et de quantité indisponibles pour cette
          prévision.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <section
            aria-label="Fréquence des modèles, pas une probabilité calibrée"
            className="min-w-0 rounded-xl border border-sky-300/15 bg-sky-300/[0.035] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="max-w-[15rem] text-[11px] font-semibold leading-snug text-sky-100">
                Fréquence des modèles, pas une probabilité calibrée
              </h3>
              <strong className="shrink-0 text-lg leading-none text-white">
                {frequencyPercent == null
                  ? "Indisponible"
                  : formatPercent(frequencyPercent)}
              </strong>
            </div>
            {frequencyPercent != null && (
              <div
                role="progressbar"
                aria-label="Fréquence brute des modèles pluvieux"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={clampPercent(frequencyPercent)}
                aria-valuetext={formatPercent(frequencyPercent)}
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-700/80"
              >
                <div
                  className="h-full rounded-full bg-sky-400 transition-[width]"
                  style={{ width: `${clampPercent(frequencyPercent)}%` }}
                />
              </div>
            )}
            <div className="mt-2 flex justify-between text-[9px] text-slate-500">
              <span>0 %</span>
              <span>100 %</span>
            </div>
            <div className="mt-2 border-t border-white/5 pt-2 text-[10px] leading-relaxed text-slate-300">
              <p>
                Modèles pluvieux / modèles valides :{" "}
                <b className="text-white">
                  {summary.rainModelCount} / {summary.availableModelCount}
                </b>
              </p>
              <p className="text-slate-400">
                {summary.availableModelCount} / {summary.expectedModelCount}{" "}
                modèles attendus disponibles
              </p>
            </div>
          </section>

          <section
            aria-label="Quantités de pluie, échelle distincte en millimètres"
            className="min-w-0 rounded-xl border border-blue-300/15 bg-blue-300/[0.035] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[11px] font-semibold text-blue-100">
                Quantités · échelle indépendante en mm
              </h3>
              <span className="shrink-0 text-[9px] text-slate-400">
                {quantityValues.length > 0
                  ? `0–${quantityAxisMaxMm} mm`
                  : "échelle indisponible"}
              </span>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <div className="flex items-start justify-between gap-2 text-[10px]">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-200">
                      Quantité conditionnelle
                    </p>
                    <p className="text-[9px] leading-relaxed text-slate-400">
                      Uniquement parmi les modèles pluvieux ·{" "}
                      {conditionalDescription}
                    </p>
                  </div>
                  <strong className="shrink-0 text-slate-100">
                    {summary.availableModelCount === 0
                      ? "Indisponible"
                      : summary.rainModelCount === 0
                        ? "Aucun modèle pluvieux"
                        : conditionalMeanMm == null
                          ? "Indisponible"
                          : formatMillimeters(conditionalMeanMm)}
                  </strong>
                </div>
                {quantityBar(
                  "Quantité conditionnelle parmi les modèles pluvieux",
                  conditionalMeanMm
                )}
                {summary.availableModelCount === 0 ? (
                  <p className="mt-1 text-[9px] text-slate-500">
                    Aucune quantité valide : la quantité conditionnelle reste
                    indéterminée.
                  </p>
                ) : summary.rainModelCount === 0 ? (
                  <p className="mt-1 text-[9px] text-slate-500">
                    Aucun modèle pluvieux : aucune quantité conditionnelle n’est
                    définie.
                  </p>
                ) : null}
              </div>

              <div className="border-t border-white/5 pt-2">
                <div className="flex items-start justify-between gap-2 text-[10px]">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-200">
                      Estimation de quantité
                    </p>
                    <p className="text-[9px] leading-relaxed text-slate-400">
                      Valeur déjà calculée dans le résumé partagé
                    </p>
                  </div>
                  <strong className="shrink-0 text-blue-100">
                    {consensusEstimateMm == null
                      ? "Indisponible"
                      : formatMillimeters(consensusEstimateMm)}
                  </strong>
                </div>
                {quantityBar("Estimation de quantité", consensusEstimateMm)}
              </div>
            </div>

            {quantityValues.length > 0 && (
              <div className="mt-2 flex justify-between border-t border-white/5 pt-1.5 text-[9px] text-slate-500">
                <span>0 mm</span>
                <span>{quantityAxisMaxMm} mm</span>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
