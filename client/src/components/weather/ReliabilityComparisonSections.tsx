import { useMemo } from "react";
import { Activity, ChevronDown, Database, ShieldCheck } from "lucide-react";
import { MeteoSurface } from "@/components/weather/MeteoSurface";
import { WeatherStatusBadge } from "@/components/weather/WeatherStatusBadge";
import {
  formatDate,
  formatTimestamp,
  metric,
  signedMetric,
  statusLabel,
  statusTone,
  VARIABLES,
  type ReliabilityMetricRow,
  type VerificationPair,
} from "@/components/weather/ReliabilityEvidenceSections";

const DAILY_VARIABLE_LABELS: Record<string, string> = {
  temperature_max: "Température maximale",
  temperature_min: "Température minimale",
  precipitation_sum: "Précipitations cumulées",
  wind_speed_max: "Vent maximal",
  wind_gust_max: "Rafales maximales",
};
const DAILY_VARIABLE_UNITS: Record<string, string> = {
  temperature_max: "°C",
  temperature_min: "°C",
  precipitation_sum: "mm",
  wind_speed_max: "km/h",
  wind_gust_max: "km/h",
};

function largestErrorPairs(pairs: VerificationPair[]) {
  const largestByVariable = new Map<string, VerificationPair>();
  for (const pair of pairs) {
    const current = largestByVariable.get(pair.variable);
    if (!current || Math.abs(pair.signedError) > Math.abs(current.signedError))
      largestByVariable.set(pair.variable, pair);
  }
  const order = Object.keys(DAILY_VARIABLE_LABELS);
  return Array.from(largestByVariable.values()).sort(
    (a, b) => order.indexOf(a.variable) - order.indexOf(b.variable)
  );
}

export function physicalStationCount(evidence:VerificationPair['stationEvidence']){
  return new Set(evidence.map(station=>station.stationId)).size;
}

export function LargestErrorsSection({
  pairs,
  isLoading,
  isError,
  emptyMessage,
}: {
  pairs: VerificationPair[];
  isLoading: boolean;
  isError: boolean;
  emptyMessage: string;
}) {
  const errors = useMemo(() => largestErrorPairs(pairs), [pairs]);
  return (
    <MeteoSurface
      tone="lab"
      as="section"
      className="rounded-[1.6rem] p-4 sm:p-5"
      aria-labelledby="largest-errors-title"
    >
      <div className="flex items-start gap-3">
        <span className="weather-icon-bare grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-amber-300/20 bg-amber-300/10">
          <Activity className="h-4 w-4 text-amber-200" />
        </span>
        <div>
          <h2
            id="largest-errors-title"
            className="text-lg font-semibold tracking-tight text-white"
          >
            Plus gros écarts vérifiés
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Un écart maximum par variable, sur les paires d’hier comparables à
            des stations physiques qualifiées.
          </p>
        </div>
      </div>
      {isLoading ? (
        <div
          className="mt-4 h-28 animate-pulse rounded-2xl bg-slate-800/45"
          aria-label="Chargement des écarts vérifiés"
        />
      ) : isError ? (
        <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3 text-xs leading-relaxed text-slate-300">
          L’archive de vérification d’hier est momentanément indisponible. Aucun
          écart n’est estimé.
        </p>
      ) : errors.length === 0 ? (
        <p className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/25 p-3 text-xs leading-relaxed text-slate-400">
          {emptyMessage ||
            "Aucune paire complète ne peut être comparée pour hier."}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {errors.map(pair => {
              const label =
                DAILY_VARIABLE_LABELS[pair.variable] ?? pair.variable;
              const unit = DAILY_VARIABLE_UNITS[pair.variable] ?? "";
              const missedRain =
                pair.variable === "precipitation_sum" &&
                pair.forecastValue < 0.2 &&
                pair.observedValue >= 0.2;
              return (
                <article
                  key={`${pair.modelId}:${pair.variable}:${pair.horizonBucket}`}
                  className="rounded-2xl border border-slate-700/65 bg-slate-950/25 p-3.5 sm:p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug text-slate-100">
                        {missedRain ? "Pluie constatée, non annoncée" : label}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {pair.serviceName} · {pair.horizonBucket}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-slate-700/75 bg-slate-900/65 px-2 py-1 text-[11px] text-slate-400">
                      {formatDate(pair.validDate)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <div className="min-w-0 rounded-xl border border-slate-700/50 bg-slate-900/55 px-2.5 py-2">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Annoncé
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-sky-100">
                        {metric(pair.forecastValue, unit, 1)}
                      </p>
                    </div>
                    <div className="min-w-0 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] px-2.5 py-2">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Constaté
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-emerald-100">
                        {metric(pair.observedValue, unit, 1)}
                      </p>
                    </div>
                    <div className="min-w-0 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-2.5 py-2">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                        Écart signé
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-amber-100">
                        {signedMetric(pair.signedError, unit, 1)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                    {physicalStationCount(pair.stationEvidence)} station
                    {physicalStationCount(pair.stationEvidence) === 1 ? "" : "s"} physique
                    {physicalStationCount(pair.stationEvidence) === 1 ? "" : "s"} · émission{" "}
                    {formatTimestamp(
                      new Date(pair.forecastIssuedAt).toISOString()
                    )}
                  </p>
                </article>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Les écarts restent regroupés par variable : °C, mm et km/h ne sont
            jamais additionnés ni classés sur une échelle commune.
          </p>
        </>
      )}
    </MeteoSurface>
  );
}

function MetricCell({
  label,
  value,
  color = "text-slate-100",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-700/55 bg-slate-900/50 px-2.5 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 truncate font-mono text-xs font-semibold tabular-nums ${color}`}
      >
        {value}
      </p>
    </div>
  );
}

export function ModelComparisonSection({
  rows,
  selectedVariable,
  onSelectVariable,
}: {
  rows: ReliabilityMetricRow[];
  selectedVariable: string;
  onSelectVariable: (variable: string) => void;
}) {
  const config =
    VARIABLES.find(item => item.id === selectedVariable) ?? VARIABLES[0]!;
  const modelRows = rows
    .filter(row => row.variable === config.id)
    .slice()
    .sort((a, b) => {
      const metricsOf = (row: ReliabilityMetricRow) => row.metrics ?? row.rawMetrics;
      const rank = (row: ReliabilityMetricRow) =>
        row.status === "qualified" ? 0
          : row.status === "insufficient_evidence" ? 1
            : metricsOf(row) != null ? 2
              : 3;
      const difference = rank(a) - rank(b);
      if (difference) return difference;
      const aValues = metricsOf(a);
      const bValues = metricsOf(b);
      if (aValues && bValues) return aValues.mae - bValues.mae;
      if (aValues) return -1;
      if (bValues) return 1;
      return a.modelName.localeCompare(b.modelName);
    });

  return (
    <MeteoSurface
      tone="lab"
      as="section"
      className="overflow-hidden rounded-[1.6rem]"
      aria-labelledby="model-comparison-title"
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="weather-icon-bare grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10">
            <Database className="h-4 w-4 text-sky-300" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-300">
              Fiabilité historique · modèle × variable × horizon
            </p>
            <h2
              id="model-comparison-title"
              className="mt-0.5 text-lg font-semibold tracking-tight text-white"
            >
              Quel modèle a le moins d’erreur ?
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Comparaison brute à variable, période et horizon identiques. La
              MAE est triée par ordre croissant parmi les mêmes unités; aucune
              note globale n’est calculée.
            </p>
          </div>
        </div>
        <div
          className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide"
          role="group"
          aria-label="Variable à comparer"
        >
          {VARIABLES.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectVariable(item.id)}
              aria-pressed={config.id === item.id}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${config.id === item.id ? "border-sky-300/40 bg-sky-300/12 text-sky-100" : "border-slate-700/75 bg-slate-950/25 text-slate-400 hover:text-slate-100"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {config.label} · {config.unit} · horizon exact. Une cellule « — »
          signifie non disponible, pas zéro.
        </p>
      </div>
      {modelRows.length === 0 ? (
        <p className="border-t border-slate-800/80 px-4 py-6 text-center text-xs text-slate-400">
          Aucune combinaison modèle × variable n’est renvoyée pour cette
          sélection.
        </p>
      ) : (
        <>
          <div className="space-y-2 border-t border-slate-800/80 p-3 md:hidden">
            {modelRows.map(row => (
              <article
                key={`${row.modelId}-${row.variable}-${row.horizonId}`}
                className="rounded-2xl border border-slate-700/60 bg-slate-950/25 p-3.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-100">
                      {row.modelName}
                    </h3>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                      {row.modelId}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {row.variableLabel} · {row.horizonId}
                    </p>
                  </div>
                  <span
                    title={row.reason ?? statusLabel(row.status)}
                    className={`max-w-[45%] shrink-0 rounded-full border px-2 py-1 text-right text-[11px] font-semibold leading-tight ${row.status === "qualified" ? "border-emerald-300/20 bg-emerald-300/8 text-emerald-100" : ["insufficient_evidence", "incomplete_metrics", "legacy_unversioned_only"].includes(row.status) ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100" : "border-slate-700 bg-slate-900/60 text-slate-400"}`}
                  >
                    {statusLabel(row.status)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <MetricCell
                    label={row.metrics == null && row.rawMetrics != null ? row.rawValidated ? row.status === "incomplete_metrics" ? "MAE · lecture partielle" : "MAE · provisoire" : "MAE · brut non validé" : "MAE"}
                    value={metric((row.metrics ?? row.rawMetrics)?.mae, row.unit, 2)}
                    color="text-orange-100"
                  />
                  <MetricCell
                    label="RMSE"
                    value={metric((row.metrics ?? row.rawMetrics)?.rmse, row.unit, 2)}
                    color="text-amber-100"
                  />
                  <MetricCell
                    label="Biais"
                    value={signedMetric((row.metrics ?? row.rawMetrics)?.bias, row.unit, 2)}
                    color="text-sky-100"
                  />
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <span>
                    n = {(row.metrics ?? row.rawMetrics)?.comparisonCount ?? "—"} ·{" "}
                    {(row.metrics ?? row.rawMetrics)?.evaluatedDays ?? "—"} jours
                  </span>
                  <span>
                    {formatDate(row.firstScoreDate)} →{" "}
                    {formatDate(row.latestScoreDate)}
                  </span>
                </div>
                {row.reason ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                    {row.reason}
                  </p>
                ) : null}
                <p className="mt-2 border-t border-slate-800/70 pt-2 text-[11px] leading-relaxed text-slate-400">
                  {trendText(row)}
                </p>
                {row.incompleteMetricRows > 0 ||
                row.legacyUnversionedRowCount > 0 ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
                    {row.incompleteMetricRows > 0
                      ? `${row.incompleteMetricRows} ligne(s) incomplète(s) exclue(s)`
                      : ""}
                    {row.incompleteMetricRows > 0 &&
                    row.legacyUnversionedRowCount > 0
                      ? " · "
                      : ""}
                    {row.legacyUnversionedRowCount > 0
                      ? `${row.legacyUnversionedRowCount} ligne(s) brute(s) non validée(s), hors preuves`
                      : ""}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto border-t border-slate-800/80 md:block">
            <table className="w-full min-w-[950px] text-xs">
              <thead className="bg-slate-950/35 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="p-3 text-left">Modèle</th>
                  <th className="p-3 text-right">MAE</th>
                  <th className="p-3 text-right">RMSE</th>
                  <th className="p-3 text-right">Biais signé</th>
                  <th className="p-3 text-right">n · jours</th>
                  <th className="p-3 text-left">Dates des scores</th>
                  <th className="p-3 text-left">Évolution</th>
                  <th className="p-3 text-left">Statut</th>
                </tr>
              </thead>
              <tbody>
                {modelRows.map(row => (
                  <tr
                    key={`${row.modelId}-${row.variable}-${row.horizonId}`}
                    className="border-t border-slate-800/70 align-top"
                  >
                    <td className="p-3">
                      <p className="font-semibold text-slate-100">
                        {row.modelName}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {row.modelId}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {row.variableLabel} · {row.horizonId}
                      </p>
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums text-orange-100">
                      {metric((row.metrics ?? row.rawMetrics)?.mae, row.unit, 2)}
                      {row.metrics == null && row.rawMetrics != null ? (
                        <span className="mt-1 block font-sans text-[11px] font-semibold text-amber-300">
                          {row.rawValidated ? row.status==='incomplete_metrics' ? "lecture partielle" : "seuil non atteint" : "brut non validé"}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums text-amber-100">
                      {metric((row.metrics ?? row.rawMetrics)?.rmse, row.unit, 2)}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums text-sky-100">
                      {signedMetric((row.metrics ?? row.rawMetrics)?.bias, row.unit, 2)}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums text-slate-300">
                      {row.metrics
                        ? `${row.metrics.comparisonCount} · ${row.metrics.evaluatedDays}`
                        : row.rawMetrics
                          ? `${row.rawMetrics.comparisonCount} · ${row.rawMetrics.evaluatedDays}`
                          : "—"}
                      <span className="mt-1 block text-[11px] text-slate-400">
                        seuil {row.minimumComparisons} ·{" "}
                        {row.minimumComparableDays} j
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">
                      {formatDate(row.firstScoreDate)}
                      <span className="block">
                        → {formatDate(row.latestScoreDate)}
                      </span>
                      {row.latestComputedAt ? (
                        <span className="mt-1 block text-[11px] text-slate-400">
                          calcul {formatTimestamp(row.latestComputedAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[260px] p-3 text-[11px] leading-relaxed text-slate-400">
                      {trendText(row)}
                    </td>
                    <td className="p-3">
                      <WeatherStatusBadge
                        compact
                        tone={statusTone(row.status)}
                        label="Statut"
                        value={statusLabel(row.status)}
                        description={
                          row.reason ??
                          "Le seuil d’évidence qualifie uniquement la quantité de données; les métriques restent brutes."
                        }
                      />
                      {row.incompleteMetricRows > 0 ? (
                        <p className="mt-1 text-[11px] text-amber-200">
                          {row.incompleteMetricRows} ligne(s) incomplète(s)
                          exclue(s)
                        </p>
                      ) : null}
                      {row.legacyUnversionedRowCount > 0 ? (
                        <p className="mt-1 text-[11px] text-amber-200">
                          {row.legacyUnversionedRowCount} ligne(s) brute(s) non
                          validée(s), hors preuves
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="border-t border-slate-800/80 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
        Les lignes qualifiées sont affichées d’abord, puis triées par MAE
        croissante pour la variable sélectionnée; les autres restent visibles
        avec leur statut. Les cellules marquées « brut non validé » proviennent
        de lignes archivées sans version de validation stricte : elles restent
        indicatives, hors preuves et hors poids officiels. Une comparaison n’est
        valable que dans sa maille exacte modèle × variable × horizon.
      </p>
    </MeteoSurface>
  );
}

function trendText(row: ReliabilityMetricRow) {
  const trend = row.trend;
  if (!trend) return row.status === "history_unavailable" ? "Évolution indisponible : historique non lisible." : row.status === "horizon_not_stored" ? "Évolution indisponible : horizon non archivé séparément." : "Évolution indisponible : aucune comparaison vérifiée.";
  if (trend.status === "history_unavailable")
    return trend.reason ?? "Évolution indisponible : historique non lisible.";
  if (trend.status === "no_evidence")
    return "Évolution indisponible : une fenêtre n’a pas de preuves complètes.";
  if (trend.status !== "qualified" || !trend.delta)
    return "Évolution non qualifiée : les deux fenêtres n’atteignent pas le seuil.";
  const d = trend.delta;
  return `Δ MAE ${signedMetric(d.mae)} · RMSE ${signedMetric(d.rmse)} · biais ${signedMetric(d.bias)} ${row.unit}; récent ${trend.recentWindowStart}–${trend.recentWindowEnd}, précédent ${trend.previousWindowStart}–${trend.previousWindowEnd}.`;
}

export function MethodologySection({ data }: { data?: any }) {
  return (
    <details className="group rounded-[1.6rem] border border-slate-800/80 bg-[#0d131d] p-4 sm:p-5">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
        <span className="flex min-w-0 items-center gap-3">
          <span className="weather-icon-bare grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10">
            <ShieldCheck className="h-4 w-4 text-sky-300" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-white">
              Méthode de mesure
            </span>
            <span className="mt-0.5 block text-[11px] text-slate-400">
              Comment lire les métriques, les seuils et leurs limites
            </span>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4 space-y-4 border-t border-slate-800/80 pt-4 text-xs leading-relaxed text-slate-300">
        <p>
          Les valeurs sont calculées séparément pour chaque modèle × variable ×
          horizon, sur les dates et la période affichées. Seules les prévisions
          historiques archivées, antérieures aux relevés et comparables à des
          observations physiques qualifiées, alimentent la preuve.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
            <p className="font-semibold text-orange-100">MAE</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Moyenne des erreurs absolues. Plus elle est basse, plus les
              valeurs sont proches pour cette maille.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
            <p className="font-semibold text-amber-100">RMSE</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Racine de la moyenne des erreurs au carré; les écarts importants
              pèsent davantage.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
            <p className="font-semibold text-sky-100">Biais signé</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Prévision moins observation : positif = surestimation, négatif =
              sous-estimation.
            </p>
          </div>
        </div>
        <ul className="list-disc space-y-2 pl-5 text-[11px] text-slate-400">
          <li>
            MAE et biais sont pondérés par le nombre de comparaisons archivé;
            RMSE est la racine de la moyenne des RMSE² pondérées par le même
            effectif.
          </li>
          <li>
            Pour qualifier les métriques des modèles, le seuil exige au moins {data?.evidence.minimumComparisons ?? "—"}{" "}
            comparaisons et {data?.evidence.minimumComparableDays ?? "—"} jours
            évalués distincts. Il qualifie la couverture, pas la performance ni
            une probabilité.
          </li>
          <li>
            Lignes incomplètes exclues; les données brutes « non validées »
            restent affichées mais hors preuves et hors poids officiels. Best
            Match et autres horizons exclus; aucune échéance voisine ou période
            extérieure n’est utilisée en repli.
          </li>
          <li>
            L’accord inter-modèles, la qualité des stations et l’incertitude
            statistique sont distincts. Les notes MeteoAI en haut de page comparent ses propres prévisions archivées aux observations, sur tout l’historique. Elles sont provisoires dès les premières paires ; les seuils des modèles ne bloquent pas leur affichage.
          </li>
        </ul>
        {data?.evidence?.note ? (
          <p className="rounded-xl border border-sky-400/15 bg-sky-400/[0.035] p-3 text-[11px] leading-relaxed text-slate-400">
            {data.evidence.note}
          </p>
        ) : null}
      </div>
    </details>
  );
}
