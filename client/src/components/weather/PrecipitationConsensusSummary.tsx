import type { PrecipitationModelConsensus } from "@shared/precipitationConsensus";

type Props = {
  summary: PrecipitationModelConsensus | null | undefined;
  compact?: boolean;
};

function conditionalMethodLabel(
  method: PrecipitationModelConsensus["conditionalMeanMethod"]
): string {
  if (method === "historical_skill")
    return "moyenne pondérée par historique qualifié";
  if (method === "arithmetic_mean")
    return "moyenne descriptive des modèles pluvieux";
  return "indisponible sans conditionnel exploitable";
}

export function PrecipitationConsensusSummary({
  summary,
  compact = false,
}: Props) {
  if (!summary) {
    return (
      <p className="rounded-lg border border-slate-500/15 bg-slate-900/25 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
        Détail de fréquence et de consensus pluie indisponible pour cette
        source.
      </p>
    );
  }

  const conditional =
    summary.rainModelCount === 0
      ? "aucun modèle au seuil"
      : summary.conditionalMeanMm == null
        ? "indisponible sans poids historiques qualifiés"
        : `${summary.conditionalMeanMm.toFixed(1)} mm`;
  const estimate =
    summary.consensusEstimateMm == null
      ? "—"
      : `${summary.consensusEstimateMm.toFixed(1)} mm`;

  return (
    <section
      aria-label="Fréquence et estimation de consensus des modèles pour la pluie"
      className="rounded-lg border border-sky-300/15 bg-sky-300/[0.035] px-2.5 py-2 text-[10px] leading-relaxed text-slate-300"
    >
      <p className="font-semibold text-sky-100">
        Fréquence / estimation de consensus des modèles
      </p>
      <p>
        Seuil : ≥{summary.thresholdMm.toFixed(1)} mm · modèles au seuil :{" "}
        <b className="text-white">
          {summary.rainModelCount}/{summary.availableModelCount} modèles
          disponibles
        </b>{" "}
        ({summary.availableModelCount}/{summary.expectedModelCount} modèles
        attendus ont fourni une valeur)
      </p>
      <p>
        Quantité conditionnelle (
        {conditionalMethodLabel(summary.conditionalMeanMethod)}) :{" "}
        <b className="text-white">{conditional}</b>
      </p>
      <p>
        Estimation de quantité = fréquence brute × quantité conditionnelle :{" "}
        <b className="text-sky-100">{estimate}</b>
      </p>
      <p className="text-[9px] text-slate-400">
        La fréquence et le produit décrivent un consensus des modèles
        disponibles; ce ne sont pas des probabilités météorologiques calibrées.
      </p>
      {!compact && (
        <details className="mt-1 border-t border-white/5 pt-1">
          <summary className="cursor-pointer text-sky-200/80">
            Valeurs sources par modèle ({summary.modelsWithData.length}/
            {summary.expectedModelCount})
          </summary>
          <p className="mt-1 text-[9px] text-slate-400">
            Modèles attendus : {summary.modelsExpected.join(", ") || "aucun"}.
          </p>
          <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
            {summary.modelValues.map(value => (
              <li key={value.modelName}>
                <b className="text-slate-200">{value.modelName}</b>:{" "}
                {value.amountMm.toFixed(2)} mm ·{" "}
                {value.predictsRain ? "au seuil" : "sous le seuil"}
              </li>
            ))}
            {summary.modelValues.length === 0 && (
              <li>Aucune valeur pluie disponible.</li>
            )}
          </ul>
        </details>
      )}
    </section>
  );
}
