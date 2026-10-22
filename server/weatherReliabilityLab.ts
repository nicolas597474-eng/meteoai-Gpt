import {
  getHourlyForecastEvaluationHistory,
  getHourlyForecastRunValuesByDateRange,
  getQualifiedObservationSnapshotsByDateRange,
  makeLocationKey,
} from "./db";
import {
  getLaboratoryHorizon,
  LABORATORY_HORIZONS,
  PUBLIC_RANKING_EVIDENCE_THRESHOLDS,
  type LaboratoryHorizonId,
} from "./weatherReliabilityConfig";
import {
  evaluateHourlyForecastRuns,
  HOURLY_FORECAST_VARIABLES,
  normalizeHourlyForecastVariable,
} from "./hourlyForecastRunScoring";
import { HOURLY_SCORING_VALIDATION_VERSION } from "../shared/hourlyScoringValidation";
import { OFFICIAL_HOURLY_MODELS } from "./weatherServices";
import { getParisDateDaysAgo } from "./weatherTime";
import { summarizeHourlyHistoricalEvidence, type HourlyHistoricalScoreRow } from "./hourlyHistoricalEvidence";
import { LRUCache } from "./_core/cache";

export const LABORATORY_PERIODS = {
  "24h": { label: "24 h", days: 1 },
  "7d": { label: "7 jours", days: 7 },
  "30d": { label: "30 jours", days: 30 },
  "90d": { label: "90 jours", days: 90 },
  "365d": { label: "365 jours", days: 365 },
} as const;

export type LaboratoryPeriodId = keyof typeof LABORATORY_PERIODS;

export function normalizeLaboratoryServiceName(name: string): string {
  if (name === "best_match") return "Open-Meteo";
  return name.replace(/\s*·\s*validation\s*$/i, "").trim();
}

const VARIABLE_LABELS: Record<(typeof HOURLY_FORECAST_VARIABLES)[number], string> = {
  temperature: "Température",
  precipitation: "Précipitations",
  wind_speed: "Vent moyen",
  wind_gust: "Rafales",
  humidity: "Humidité",
  pressure: "Pression",
};

const VARIABLE_UNITS: Record<(typeof HOURLY_FORECAST_VARIABLES)[number], string> = {
  temperature: "°C",
  precipitation: "mm",
  wind_speed: "km/h",
  wind_gust: "km/h",
  humidity: "%",
  pressure: "hPa",
};

/**
 * Read-only recomputation of the bucket scores missing from the archived
 * aggregate table. The nightly job scores one observation date per run; any
 * date it missed (redeploy, interrupted night, deployment younger than the
 * archive) would otherwise leave the laboratory blind even though the
 * immutable evidence — qualified physical snapshots and verified run values —
 * is already archived. This never writes, never substitutes another horizon,
 * variable or period, and skips dates already present in the stored archive so
 * a sample can never be counted twice.
 */
async function recomputeMissingScoreRows(input: {
  locationKey: string;
  startDate: string;
  throughDate: string;
  storedDates: ReadonlySet<string>;
  storedLegacyDates: ReadonlySet<string>;
}): Promise<{
  rows: HourlyHistoricalScoreRow[];
  legacyRows: HourlyHistoricalScoreRow[];
  recomputedRowCount: number;
}> {
  const [snapshots, runValues] = await Promise.all([
    getQualifiedObservationSnapshotsByDateRange(input.locationKey, input.startDate, input.throughDate),
    getHourlyForecastRunValuesByDateRange(input.locationKey, input.startDate, input.throughDate),
  ]);
  if (snapshots.length === 0 || runValues.length === 0) {
    return { rows: [], legacyRows: [], recomputedRowCount: 0 };
  }
  const datedRunValues = runValues.flatMap((row) => {
    const variable = normalizeHourlyForecastVariable(row.variable);
    return variable ? [{ ...row, variable }] : [];
  });
  const evaluation = evaluateHourlyForecastRuns(snapshots, datedRunValues);
  const rows: HourlyHistoricalScoreRow[] = [];
  const legacyRows: HourlyHistoricalScoreRow[] = [];
  for (const score of evaluation.scores) {
    if (!(score.sampleSize > 0) || score.mae == null || score.rmse == null || score.bias == null) continue;
    const row: HourlyHistoricalScoreRow = {
      date: score.date,
      sourceName: score.sourceName,
      modelName: score.modelName,
      modelId: score.modelId,
      variable: score.variable,
      horizonBucket: score.horizonBucket,
      sampleSize: score.sampleSize,
      mae: score.mae,
      rmse: score.rmse,
      bias: score.bias,
      scoringValidationVersion: score.scoringValidationVersion,
    };
    if (score.scoringValidationVersion === HOURLY_SCORING_VALIDATION_VERSION) {
      if (!input.storedDates.has(score.date)) rows.push(row);
    } else if (!input.storedLegacyDates.has(score.date)) {
      legacyRows.push(row);
    }
  }
  return { rows, legacyRows, recomputedRowCount: rows.length + legacyRows.length };
}

/**
 * Regroupe les lignes de scores par maille source × modèle × variable × bucket.
 * Chaque synthèse ne relit plus tout l'historique : elle démarre des seules
 * lignes de sa maille. Les lignes sans modelId ou avec un horizon exact en
 * millisecondes ne peuvent pas matcher une synthèse par bucket ; elles sont
 * écartées dès le regroupement pour garder un comportement strictement identique.
 */
type HourlyScoreCellKey = string;

function hourlyScoreCellKey(
  sourceName: string,
  modelName: string,
  modelId: string,
  variable: string,
  horizonBucket: string,
): HourlyScoreCellKey {
  return `${sourceName} ${modelName} ${modelId} ${variable} ${horizonBucket}`;
}

function groupHourlyScoreRowsByCell(
  rows: readonly HourlyHistoricalScoreRow[],
): Map<HourlyScoreCellKey, HourlyHistoricalScoreRow[]> {
  const grouped = new Map<HourlyScoreCellKey, HourlyHistoricalScoreRow[]>();
  for (const row of rows) {
    if (row.horizonMilliseconds != null) continue;
    if (typeof row.modelId !== "string") continue;
    const key = hourlyScoreCellKey(row.sourceName, row.modelName, row.modelId, row.variable, row.horizonBucket);
    const cell = grouped.get(key);
    if (cell) cell.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

export async function buildReliabilityLaboratory(input: {
  lat: number;
  lon: number;
  period: LaboratoryPeriodId;
  horizon: LaboratoryHorizonId;
}) {
  const period = LABORATORY_PERIODS[input.period];
  const startDate = getParisDateDaysAgo(period.days);
  const throughDate = getParisDateDaysAgo(1);
  const beforeDate = getParisDateDaysAgo(0);
  const locationKey = makeLocationKey(input.lat, input.lon);
  const selectedHorizon = getLaboratoryHorizon(input.horizon);
  const trendStartDate = getParisDateDaysAgo(Math.max(period.days, 60));
  const history = await getHourlyForecastEvaluationHistory(locationKey, trendStartDate, throughDate, [], { includeLegacy: true });
  const storedRows = history.rows as HourlyHistoricalScoreRow[];
  const storedLegacyRows = history.legacyRows as HourlyHistoricalScoreRow[];
  // Bounded to 30 days so a 90/365-day period never replays months of immutable
  // runs and snapshot JSON in one read; stored aggregates still cover the rest
  // of the window, and 30 days is exactly the trend's recent window.
  const recomputeWindowDays = Math.min(period.days, 30);
  const recomputeStartDate = getParisDateDaysAgo(recomputeWindowDays);
  const storedDates = new Set(storedRows.map((row) => row.date));
  const missingDates = Array.from({ length: recomputeWindowDays }, (_, index) => getParisDateDaysAgo(index + 1))
    .filter((date) => !storedDates.has(date));
  const recomputed = history.available && missingDates.length > 0
    ? await recomputeMissingScoreRows({
      locationKey,
      startDate: recomputeStartDate,
      throughDate,
      storedDates,
      storedLegacyDates: new Set(storedLegacyRows.map((row) => row.date)),
    })
    : { rows: [] as HourlyHistoricalScoreRow[], legacyRows: [] as HourlyHistoricalScoreRow[], recomputedRowCount: 0 };
  const evidenceRows = [...storedRows, ...recomputed.rows];
  const evidenceLegacyRows = [...storedLegacyRows, ...recomputed.legacyRows];
  const evidenceRowsByCell = groupHourlyScoreRowsByCell(evidenceRows);
  const evidenceLegacyRowsByCell = groupHourlyScoreRowsByCell(evidenceLegacyRows);
  const summarizeCell = (
    rowsByCell: Map<HourlyScoreCellKey, HourlyHistoricalScoreRow[]>,
    model: { name: string; modelId: string },
    variable: (typeof HOURLY_FORECAST_VARIABLES)[number],
    storageBucket: string,
  ) => summarizeHourlyHistoricalEvidence(
    rowsByCell.get(hourlyScoreCellKey("open-meteo", model.name, model.modelId, variable, storageBucket)) ?? [],
    {
      modelName: model.name,
      modelId: model.modelId,
      variable,
      horizonBucket: storageBucket,
      beforeDate,
      periodStartDate: startDate,
      historyAvailable: history.available,
    },
  );
  const minimumComparisons = PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparisons;
  const minimumComparableDays = PUBLIC_RANKING_EVIDENCE_THRESHOLDS.minimumComparableDays;
  const expectedEvidenceCellCount = OFFICIAL_HOURLY_MODELS.length * HOURLY_FORECAST_VARIABLES.length;
  const horizonEvidence = LABORATORY_HORIZONS.map((horizon) => {
    const base = {
      id: horizon.id,
      label: horizon.label,
      storageBucket: horizon.storageBucket,
      expectedCellCount: expectedEvidenceCellCount,
    };
    if (!history.available) {
      return {
        ...base,
        status: "history_unavailable" as const,
        rawEvidenceCellCount: null,
        qualifiedCellCount: null,
        insufficientEvidenceCellCount: null,
        incompleteMetricCellCount: null,
        noEvidenceCellCount: null,
      };
    }
    if (!horizon.storageBucket) {
      return {
        ...base,
        status: "horizon_not_stored" as const,
        rawEvidenceCellCount: null,
        qualifiedCellCount: null,
        insufficientEvidenceCellCount: null,
        incompleteMetricCellCount: null,
        noEvidenceCellCount: null,
      };
    }

    let rawEvidenceCellCount = 0;
    let qualifiedCellCount = 0;
    let insufficientEvidenceCellCount = 0;
    let incompleteMetricCellCount = 0;
    let noEvidenceCellCount = 0;
    for (const model of OFFICIAL_HOURLY_MODELS) {
      for (const variable of HOURLY_FORECAST_VARIABLES) {
        const summary = summarizeCell(evidenceRowsByCell, model, variable, horizon.storageBucket);
        const rawCellMetrics = summary.metrics
          ?? summarizeCell(evidenceLegacyRowsByCell, model, variable, horizon.storageBucket).metrics;
        if (rawCellMetrics) rawEvidenceCellCount += 1;
        if (summary.status === "qualified") qualifiedCellCount += 1;
        else if (summary.status === "insufficient_evidence") insufficientEvidenceCellCount += 1;
        else if (summary.status === "incomplete_metrics") incompleteMetricCellCount += 1;
        else if (summary.status === "no_evidence") noEvidenceCellCount += 1;
      }
    }
    return {
      ...base,
      status: "available" as const,
      rawEvidenceCellCount,
      qualifiedCellCount,
      insufficientEvidenceCellCount,
      incompleteMetricCellCount,
      noEvidenceCellCount,
    };
  });

  const evidence = OFFICIAL_HOURLY_MODELS.flatMap((model) => HOURLY_FORECAST_VARIABLES.map((variable) => {
    const base = {
      modelName: model.name,
      modelId: model.modelId,
      variable,
      variableLabel: VARIABLE_LABELS[variable],
      unit: VARIABLE_UNITS[variable],
      horizonId: input.horizon,
      horizonLabel: selectedHorizon?.label ?? input.horizon,
      periodStartDate: startDate,
      periodEndDate: throughDate,
    };
    if (!selectedHorizon?.storageBucket) {
      return {
        ...base,
        horizonBucket: null,
        status: "horizon_not_stored" as const,
        reason: "Cet horizon n’est pas archivé séparément; aucune échéance voisine n’est utilisée en repli.",
        legacyUnversionedRowCount: 0,
        metrics: null,
        rawMetrics: null,
        minimumComparisons,
        minimumComparableDays,
        firstScoreDate: null,
        latestScoreDate: null,
        latestComputedAt: null,
        incompleteMetricRows: 0,
        trend: null,
      };
    }
    const summary = summarizeCell(evidenceRowsByCell, model, variable, selectedHorizon.storageBucket);
    const unvalidatedSummary = summary.metrics == null
      ? summarizeCell(evidenceLegacyRowsByCell, model, variable, selectedHorizon.storageBucket)
      : null;
    const legacyUnversionedRows = (evidenceLegacyRowsByCell.get(
      hourlyScoreCellKey("open-meteo", model.name, model.modelId, variable, selectedHorizon.storageBucket),
    ) ?? []).filter((row) => row.date >= startDate && row.date <= throughDate);
    const legacyUnversionedRowCount = legacyUnversionedRows.length;
    const rawMetrics = summary.metrics ?? unvalidatedSummary?.metrics ?? null;
    const rawNote = summary.metrics == null && rawMetrics != null
      ? `Données brutes non validées consultables (${rawMetrics.comparisonCount} comparaisons sur ${rawMetrics.evaluatedDays} jour(s)); sans version de validation stricte, elles restent exclues des preuves actuelles et des poids officiels.`
      : null;
    const legacyNote = legacyUnversionedRowCount > 0
      ? `${legacyUnversionedRowCount} ligne(s) brute(s) non validée(s) archivée(s) sur cette maille, exclue(s) des preuves actuelles et des poids officiels.`
      : null;
    const reason = summary.status === "history_unavailable"
      ? "Historique illisible ou indisponible; aucune preuve actuelle n’est qualifiée."
      : summary.status === "no_evidence"
        ? rawNote ?? legacyNote ?? "Aucune ligne complète modèle × variable × horizon n’est archivée sur cette période."
        : summary.status === "incomplete_metrics"
          ? `Des lignes versionnées existent, mais au moins une métrique requise est absente ou invalide.${legacyNote ? ` ${legacyNote}` : ""}`
          : summary.status === "insufficient_evidence"
            ? `Valeurs brutes versionnées disponibles; qualification non atteinte (${summary.metrics?.comparisonCount ?? 0}/${minimumComparisons} comparaisons, ${summary.metrics?.evaluatedDays ?? 0}/${minimumComparableDays} jours).${legacyNote ? ` ${legacyNote}` : ""}`
            : legacyNote;
    return {
      ...base,
      ...summary,
      rawMetrics,
      status: summary.status === "no_evidence" && legacyUnversionedRowCount > 0 ? "legacy_unversioned_only" as const : summary.status,
      legacyUnversionedRowCount,
      horizonLabel: selectedHorizon.label,
      reason,
    };
  }));

  return {
    locationKey,
    period: { id: input.period, ...period, startDate, endDate: throughDate },
    trendWindowStartDate: trendStartDate,
    selectedHorizon,
    horizonEvidence,
    evidence: {
      status: history.available ? "available" as const : "history_unavailable" as const,
      source: "hourly_forecast_evaluation_scores" as const,
      expectedModelCount: OFFICIAL_HOURLY_MODELS.length,
      includedModels: OFFICIAL_HOURLY_MODELS.map((model) => model.name),
      bestMatchIncluded: false as const,
      variables: HOURLY_FORECAST_VARIABLES.map((variable) => ({ key: variable, label: VARIABLE_LABELS[variable], unit: VARIABLE_UNITS[variable] })),
      minimumComparisons,
      minimumComparableDays,
      recomputedScoreRows: recomputed.recomputedRowCount,
      note: "Seuls les scores horaires portant la version de validation stricte courante alimentent les preuves et les poids officiels. Les données brutes « non validées » restent consultables séparément dans le diagnostic, mais ne sont jamais traitées comme preuve actuelle. MAE/RMSE/biais ne sont pas fusionnés en note; Best Match et agrégateurs sont exclus.",
    },
    metrics: evidence,
    availability: {
      history: history.available ? "Historique lisible" : "Historique indisponible",
      dailyHorizon: "Les prévisions journalières sans horodatage d’émission exact ne sont pas converties en preuves horaires par horizon.",
      selectedHorizon: selectedHorizon?.storageBucket ? "Horizon archivé séparément" : "Horizon non archivé séparément",
      trend: "Les fenêtres récentes et précédentes sont lues séparément sur 60 jours minimum; leur différence n’est calculée que si chacune atteint les seuils d’évidence.",
      recompute: recomputed.recomputedRowCount > 0
        ? `${recomputed.recomputedRowCount} ligne(s) recalculée(s) en lecture seule depuis les snapshots physiques qualifiés et les runs immuables des dates sans agrégat archivé; aucune écriture, aucun doublon.`
        : "Aucune date de la fenêtre n’a nécessité de recalcul en lecture seule; chaque maille provient de l’archive agrégée.",
    },
  };
}

type ReliabilityLaboratoryReadModel = Awaited<ReturnType<typeof buildReliabilityLaboratory>>;

const RELIABILITY_LABORATORY_CACHE_TTL_MS = 5 * 60 * 1000;
const RELIABILITY_LABORATORY_CACHE_MAX_ENTRIES = 64;

const reliabilityLaboratoryCache = new LRUCache<string, ReliabilityLaboratoryReadModel>(
  RELIABILITY_LABORATORY_CACHE_MAX_ENTRIES,
  RELIABILITY_LABORATORY_CACHE_TTL_MS,
);

export function clearReliabilityLaboratoryCache(): void {
  reliabilityLaboratoryCache.clear();
}

/**
 * Point d'entrée mis en cache du modèle de lecture du laboratoire : une même
 * maille lieu × période × horizon n'est recalculée qu'une fois par fenêtre de
 * cinq minutes. Un historique illisible n'est jamais mis en cache, pour
 * qu'une panne transitoire de la base ne masque pas sa reprise.
 */
export async function buildReliabilityLaboratoryCached(input: {
  lat: number;
  lon: number;
  period: LaboratoryPeriodId;
  horizon: LaboratoryHorizonId;
}): Promise<ReliabilityLaboratoryReadModel> {
  const cacheKey = `${makeLocationKey(input.lat, input.lon)}:${input.period}:${input.horizon}`;
  const cached = reliabilityLaboratoryCache.get(cacheKey);
  if (cached) return cached;
  const result = await buildReliabilityLaboratory(input);
  if (result.evidence.status === "available") {
    reliabilityLaboratoryCache.set(cacheKey, result);
  }
  return result;
}
