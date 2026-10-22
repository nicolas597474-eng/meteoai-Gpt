import * as React from "react";
import type { ExperimentalForecastConfidenceResult } from "@shared/experimentalForecastConfidence";

function targetLabel(validAt: number | null): string {
  if (validAt == null || !Number.isFinite(validAt))
    return "Aucune échéance horaire exacte disponible";
  const date = new Date(validAt);
  if (!Number.isFinite(date.getTime())) return "Échéance horaire indisponible";
  return `Température à la prochaine échéance · ${date.toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  })}`;
}

export function ExperimentalForecastConfidencePanel({
  result,
}: {
  result: ExperimentalForecastConfidenceResult;
}) {
  const calculated = result.status === "calculated" && result.score != null;
  const statusLabel = calculated
    ? "Toutes les preuves requises sont présentes"
    : result.calculableWeight > 0
      ? "Score masqué · preuves incomplètes"
      : "Aucune preuve exploitable";

  return (
    <section
      className="rounded-2xl border border-violet-300/25 bg-[linear-gradient(135deg,rgba(139,92,246,0.10),rgba(13,19,29,0.98)_48%)] p-4"
      aria-labelledby="experimental-confidence-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-200/80">
            Diagnostic séparé · expérimental / non calibré
          </p>
          <h2
            id="experimental-confidence-title"
            className="mt-1 text-sm font-semibold text-slate-100"
          >
            Indice expérimental de confiance
          </h2>
          <p className="mt-1 text-[10px] text-slate-400">
            {targetLabel(result.targetValidAt)}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-violet-200/20 bg-violet-300/10 px-2 py-1 text-[9px] font-semibold text-violet-100">
          {calculated ? `${result.score}/100` : "—/100"}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-slate-100">
            {statusLabel}
          </p>
          <p className="text-[10px] font-semibold text-violet-100">
            Poids calculable : {result.calculableWeight}/100 (
            {result.coveragePercent} %)
          </p>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-300">
          Cette échelle descriptive n’est ni une probabilité ni une confiance
          météorologique calibrée. Les facteurs manquants gardent leur poids
          fixe et ne sont pas redistribués; aucun calcul n’agit sur les
          prévisions, les scores de fiabilité ou les poids de fusion.
        </p>
      </div>

      <ul
        className="mt-3 space-y-2"
        aria-label="Décomposition des facteurs expérimentaux"
      >
        {result.components.map(component => (
          <li
            key={component.key}
            className="rounded-lg border border-white/10 bg-slate-950/20 px-2.5 py-2"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-[10px] font-semibold text-slate-100">
                {component.label}{" "}
                <span className="font-normal text-slate-500">
                  · poids {component.weight} %
                </span>
              </p>
              <span className="shrink-0 text-[10px] font-semibold text-slate-100">
                {component.score == null
                  ? "non calculable"
                  : `${component.score}/100`}
              </span>
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
              {component.reason ?? component.evidence}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-2.5 py-2 text-[9px] leading-relaxed text-slate-300">
        <p>
          <span className="font-semibold text-amber-100">
            Pénalité extrême ·{" "}
          </span>
          {result.extremePenalty == null
            ? "non vérifiable; le score final reste masqué."
            : result.extremePenalty === 0
              ? "aucun déclencheur détecté dans les champs disponibles (0 point)."
              : `−${result.extremePenalty} points · ${result.extremeReasons.join("; ")}.`}
        </p>
        <p className="mt-1 text-slate-500">
          Pénalité distincte des sept poids; règles expérimentales issues de
          seuils météo existants, cumul plafonné à 30 points.
        </p>
      </div>
    </section>
  );
}
