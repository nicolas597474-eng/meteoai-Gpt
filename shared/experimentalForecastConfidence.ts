export const EXPERIMENTAL_FORECAST_CONFIDENCE_WEIGHTS = {
  agreement: 20,
  observationQuality: 20,
  historicalPerformance: 20,
  freshnessCoverage: 15,
  spatialCoherence: 10,
  horizon: 10,
  sampleSize: 5,
} as const;

export type ExperimentalConfidenceComponentKey =
  keyof typeof EXPERIMENTAL_FORECAST_CONFIDENCE_WEIGHTS;
export type ExperimentalConfidenceComponent = {
  key: ExperimentalConfidenceComponentKey;
  label: string;
  weight: number;
  score: number | null;
  evidence: string;
  reason: string | null;
};

export type ExperimentalConfidenceModelValue = {
  modelId?: unknown;
  modelName?: unknown;
  value?: unknown;
  validTime?: unknown;
  availableAt?: unknown;
  horizonMinutes?: unknown;
  horizonBucket?: unknown;
  calibrationLevel?: unknown;
  calibrationStatus?: unknown;
  historicalScore?: {
    mae?: unknown;
    comparisonCount?: unknown;
    evaluatedDays?: unknown;
  } | null;
};

export type ExperimentalConfidenceStation = {
  stationId?: unknown;
  sourceKind?: unknown;
  isActive?: unknown;
  temperature?: unknown;
  reliabilityScore?: unknown;
  measurementTimes?: { temperature?: unknown } | null;
};

export type ExperimentalConfidenceForecastPoint = {
  validAt?: unknown;
  temp?: unknown;
  precipitation?: unknown;
  windSpeed?: unknown;
  weatherCode?: unknown;
  weighting?: {
    variableWeightings?: readonly {
      variable?: unknown;
      expectedModelCount?: unknown;
      availableModelCount?: unknown;
      modelWeights?: readonly ExperimentalConfidenceModelValue[];
    }[];
  } | null;
};

export type ExperimentalForecastConfidenceInput = {
  point: ExperimentalConfidenceForecastPoint | null;
  forecastComputedAt: unknown;
  stations: readonly ExperimentalConfidenceStation[];
  nowMs?: number;
};

export type ExperimentalForecastConfidenceResult = {
  version: "experimental-v4";
  status: "calculated" | "partial" | "unavailable";
  score: number | null;
  calculableWeight: number;
  coveragePercent: number;
  targetValidAt: number | null;
  extremePenalty: number | null;
  extremeReasons: string[];
  components: ExperimentalConfidenceComponent[];
};

const MAX_TEMPERATURE_SPREAD_C = 8;
const MAX_HISTORICAL_MAE_C = 5;
const SAMPLE_SIZE_REFERENCE_DAYS = 30;
const FRESHNESS_REFERENCE_MINUTES = 180;
const STATION_MAX_AGE_MINUTES = 180;
const STATION_ALIGNMENT_MINUTES = 60;
const MAX_FORECAST_HORIZON_MINUTES = 15 * 24 * 60;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTimestamp(value: unknown): number | null {
  if (finite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function spreadScore(range: number): number {
  return clampScore(100 * (1 - range / MAX_TEMPERATURE_SPREAD_C));
}

function isPhysicalActiveTemperatureStation(
  station: ExperimentalConfidenceStation
): boolean {
  return (
    station.sourceKind === "physical" &&
    station.isActive === true &&
    finite(station.temperature)
  );
}

function modelValuesAtTarget(
  weighting: {
    modelWeights?: readonly ExperimentalConfidenceModelValue[];
  },
  targetValidAt: number
): { models: ExperimentalConfidenceModelValue[]; duplicateIds: boolean } {
  const byId = new Map<string, ExperimentalConfidenceModelValue>();
  let duplicateIds = false;
  for (const model of weighting?.modelWeights ?? []) {
    const modelId =
      typeof model.modelId === "string" ? model.modelId.trim() : "";
    if (
      !modelId ||
      !finite(model.validTime) ||
      model.validTime !== targetValidAt ||
      !finite(model.value)
    )
      continue;
    if (byId.has(modelId)) {
      duplicateIds = true;
      continue;
    }
    byId.set(modelId, model);
  }
  return { models: Array.from(byId.values()), duplicateIds };
}

function unavailableComponent(
  key: ExperimentalConfidenceComponentKey,
  label: string,
  reason: string,
  evidence = "Aucune preuve exploitable."
): ExperimentalConfidenceComponent {
  return {
    key,
    label,
    weight: EXPERIMENTAL_FORECAST_CONFIDENCE_WEIGHTS[key],
    score: null,
    evidence,
    reason,
  };
}

function availableComponent(
  key: ExperimentalConfidenceComponentKey,
  label: string,
  score: number,
  evidence: string
): ExperimentalConfidenceComponent {
  return {
    key,
    label,
    weight: EXPERIMENTAL_FORECAST_CONFIDENCE_WEIGHTS[key],
    score: clampScore(score),
    evidence,
    reason: null,
  };
}

function buildAgreementComponent(
  modelWeights: readonly ExperimentalConfidenceModelValue[],
  targetValidAt: number | null
): ExperimentalConfidenceComponent {
  if (targetValidAt == null)
    return unavailableComponent(
      "agreement",
      "Accord inter-sources",
      "Échéance UTC exacte absente."
    );
  const { models, duplicateIds } = modelValuesAtTarget(
    { modelWeights },
    targetValidAt
  );
  if (duplicateIds)
    return unavailableComponent(
      "agreement",
      "Accord inter-sources",
      "Plusieurs lignes portent le même modelId; le nombre de modelId distincts est ambigu."
    );
  if (models.length < 2)
    return unavailableComponent(
      "agreement",
      "Accord inter-sources",
      "Au moins deux modelId distincts avec une température au même validAt sont requis.",
      `${models.length} modèle(s) distinct(s) exploitable(s) à cette échéance sur ${modelWeights.length} valeur(s) reçue(s).`
    );
  const values = models.map(model => model.value as number);
  const range = Math.max(...values) - Math.min(...values);
  return availableComponent(
    "agreement",
    "Accord inter-sources",
    spreadScore(range),
    `${models.length}/${modelWeights.length} modelId distincts alignés au même validAt; étendue thermique ${range.toFixed(1)} °C. Les valeurs non alignées au validAt exact sont exclues sans annuler le facteur. Des identifiants distincts ne prouvent pas une indépendance statistique entre fournisseurs. Échelle expérimentale : 0 °C → 100, 8 °C ou plus → 0.`
  );
}

function buildObservationQualityComponent(
  stations: readonly ExperimentalConfidenceStation[]
): ExperimentalConfidenceComponent {
  const candidates = stations.filter(isPhysicalActiveTemperatureStation);
  if (candidates.length === 0)
    return unavailableComponent(
      "observationQuality",
      "Qualité des observations",
      "Aucune observation de température provenant d’une station physique active."
    );
  if (
    candidates.some(
      station =>
        !finite(station.reliabilityScore) ||
        station.reliabilityScore < 0 ||
        station.reliabilityScore > 100
    )
  ) {
    return unavailableComponent(
      "observationQuality",
      "Qualité des observations",
      "Au moins une station physique active n’a pas de score de qualité source valide.",
      `${candidates.length} station(s) physique(s) active(s) avec température; la qualité n’est pas complète.`
    );
  }
  const mean =
    candidates.reduce(
      (sum, station) => sum + (station.reliabilityScore as number),
      0
    ) / candidates.length;
  return availableComponent(
    "observationQuality",
    "Qualité des observations",
    mean,
    `${candidates.length} station(s) physique(s) active(s); moyenne des scores qualité source existants. Ce score source n’est pas une exactitude historique de la station.`
  );
}

function buildSpatialCoherenceComponent(
  stations: readonly ExperimentalConfidenceStation[],
  nowMs: number
): ExperimentalConfidenceComponent {
  const candidates = stations.filter(isPhysicalActiveTemperatureStation);
  if (candidates.length < 2)
    return unavailableComponent(
      "spatialCoherence",
      "Cohérence spatiale",
      "Deux observations physiques actives de température au minimum sont requises.",
      `${candidates.length} station(s) avec température.`
    );

  // Sous-ensemble exploitable : chaque station doit porter l'heure de mesure
  // propre à sa température, non future et fraîche (≤180 min). Les autres
  // stations sont exclues sans annuler le facteur; updatedAt n'est jamais un
  // substitut.
  const exploitable: Array<{
    station: ExperimentalConfidenceStation;
    timestamp: number;
  }> = [];
  let withoutOwnTimestamp = 0;
  let staleOrFuture = 0;
  for (const station of candidates) {
    const timestamp = parseTimestamp(station.measurementTimes?.temperature);
    if (timestamp == null) {
      withoutOwnTimestamp++;
      continue;
    }
    if (
      timestamp > nowMs ||
      nowMs - timestamp > STATION_MAX_AGE_MINUTES * 60_000
    ) {
      staleOrFuture++;
      continue;
    }
    exploitable.push({ station, timestamp });
  }
  if (exploitable.length < 2)
    return unavailableComponent(
      "spatialCoherence",
      "Cohérence spatiale",
      withoutOwnTimestamp > 0
        ? "L’heure de mesure propre à la température manque pour au moins une station; updatedAt n’est pas utilisé comme substitut."
        : "Au moins un relevé thermique est futur ou dépasse la limite de fraîcheur de 180 min.",
      `${exploitable.length} station(s) exploitable(s) sur ${candidates.length} avec température; les autres sont exclues sans annuler le facteur.`
    );
  const timestamps = exploitable.map(({ timestamp }) => timestamp);
  const timeRangeMinutes =
    (Math.max(...timestamps) - Math.min(...timestamps)) / 60_000;
  if (timeRangeMinutes > STATION_ALIGNMENT_MINUTES) {
    return unavailableComponent(
      "spatialCoherence",
      "Cohérence spatiale",
      "Les relevés ne sont pas comparables : plus de 60 min séparent leurs heures de mesure.",
      `Écart temporel constaté : ${Math.round(timeRangeMinutes)} min sur ${exploitable.length} station(s) exploitable(s).`
    );
  }
  const values = exploitable.map(({ station }) => station.temperature as number);
  const range = Math.max(...values) - Math.min(...values);
  return availableComponent(
    "spatialCoherence",
    "Cohérence spatiale",
    spreadScore(range),
    `${exploitable.length} station(s) physique(s) exploitable(s) sur ${candidates.length} (horodatage propre à la température, fraîches ≤180 min, espacées de ${Math.round(timeRangeMinutes)} min au plus); étendue ${range.toFixed(1)} °C. Les stations sans heure de mesure valide ou avec relevé futur ou périmé sont exclues sans annuler le facteur. Échelle expérimentale : 0 °C → 100, 8 °C ou plus → 0.`
  );
}

function hasQualifiedHistoricalScore(
  model: ExperimentalConfidenceModelValue
): boolean {
  return (
    model.calibrationStatus === "CALIBRATED" &&
    finite(model.historicalScore?.mae) &&
    (model.historicalScore?.mae as number) >= 0 &&
    finite(model.historicalScore?.evaluatedDays) &&
    (model.historicalScore?.evaluatedDays as number) > 0 &&
    finite(model.historicalScore?.comparisonCount) &&
    (model.historicalScore?.comparisonCount as number) > 0
  );
}

function qualifiedComparableSubset(
  models: readonly ExperimentalConfidenceModelValue[],
  targetValidAt: number | null
): {
  models: ExperimentalConfidenceModelValue[];
  total: number;
  alignedCount: number;
  qualifiedCount: number;
  basis: "lead exact commun" | "tranche locale commune" | null;
  reason: string | null;
} {
  const empty = (reason: string, alignedCount = 0, qualifiedCount = 0): {
    models: ExperimentalConfidenceModelValue[];
    total: number;
    alignedCount: number;
    qualifiedCount: number;
    basis: "lead exact commun" | "tranche locale commune" | null;
    reason: string;
  } => ({
    models: [] as ExperimentalConfidenceModelValue[],
    total: models.length,
    alignedCount,
    qualifiedCount,
    basis: null,
    reason,
  });
  if (targetValidAt == null) return empty("Échéance exacte absente.");
  const { models: atTarget, duplicateIds } = modelValuesAtTarget(
    { modelWeights: models },
    targetValidAt
  );
  if (duplicateIds) return empty("Plusieurs lignes portent le même modelId.");
  if (atTarget.length === 0)
    return empty("Aucun modèle température aligné au validAt exact.");
  // Seuls les modèles alignés au validAt exact avec une preuve historique
  // qualifiée portent le facteur : les autres sont exclus de l'agrégat sans
  // annuler la mesure.
  const qualified = atTarget.filter(hasQualifiedHistoricalScore);
  if (qualified.length === 0)
    return {
      models: [],
      total: models.length,
      alignedCount: atTarget.length,
      qualifiedCount: 0,
      basis: null,
      reason:
        "Aucun modèle aligné n’a de preuve historique qualifiée (CALIBRATED avec MAE et effectifs valides); aucun poids n’est réalloué aux autres facteurs.",
    };
  // Chaque modèle n’est comparable que sur sa base exacte propre (lead exact
  // ou tranche d’horizon) : les modèles qualifiés sont regroupés par base et
  // l’agrégat suit le groupe comparable portant la plus grande masse de
  // preuve (puis le plus grand effectif, puis l’ordre de déclaration); les
  // autres sont exclus sans annuler le facteur.
  type ComparableGroup = {
    models: ExperimentalConfidenceModelValue[];
    mass: number;
    basis: "lead exact commun" | "tranche locale commune";
  };
  const groups = new Map<string, ComparableGroup>();
  for (const model of qualified) {
    const level = model.calibrationLevel;
    let key: string | null = null;
    let basis: ComparableGroup["basis"] | null = null;
    if (
      level === "EXACT_LOCAL_MODEL_VARIABLE_HORIZON" &&
      finite(model.horizonMinutes)
    ) {
      key = `horizon:${model.horizonMinutes}`;
      basis = "lead exact commun";
    } else if (
      level === "EXACT_LOCAL_MODEL_VARIABLE_BUCKET" &&
      typeof model.horizonBucket === "string" &&
      model.horizonBucket.trim() !== ""
    ) {
      key = `bucket:${model.horizonBucket.trim()}`;
      basis = "tranche locale commune";
    }
    if (key == null || basis == null) continue;
    const group = groups.get(key) ?? { models: [], mass: 0, basis };
    group.models.push(model);
    group.mass += model.historicalScore!.comparisonCount as number;
    groups.set(key, group);
  }
  const ranked = Array.from(groups.values()).sort(
    (left, right) =>
      right.mass - left.mass || right.models.length - left.models.length
  );
  const heaviest = ranked[0];
  if (!heaviest || heaviest.models.length === 0)
    return {
      models: [],
      total: models.length,
      alignedCount: atTarget.length,
      qualifiedCount: qualified.length,
      basis: null,
      reason:
        "Aucun modèle avec preuve historique qualifiée ne repose sur une base exacte modèle × variable × horizon.",
    };
  return {
    models: heaviest.models,
    total: models.length,
    alignedCount: atTarget.length,
    qualifiedCount: qualified.length,
    basis: heaviest.basis,
    reason: null,
  };
}

function buildHistoricalPerformanceComponent(
  modelWeights: readonly ExperimentalConfidenceModelValue[],
  targetValidAt: number | null
): ExperimentalConfidenceComponent {
  const result = qualifiedComparableSubset(modelWeights, targetValidAt);
  if (result.reason)
    return unavailableComponent(
      "historicalPerformance",
      "Performance historique",
      result.reason
    );
  // La MAE est pondérée par la masse de preuve (comparaisons historiques
  // indépendantes) : plus un modèle dispose de preuve qualifiée, plus il pèse.
  const comparisonCount = result.models.reduce(
    (sum, model) => sum + (model.historicalScore!.comparisonCount as number),
    0
  );
  const weightedMae =
    result.models.reduce(
      (sum, model) =>
        sum +
        (model.historicalScore!.mae as number) *
          (model.historicalScore!.comparisonCount as number),
      0
    ) / comparisonCount;
  return availableComponent(
    "historicalPerformance",
    "Performance historique",
    100 * (1 - weightedMae / MAX_HISTORICAL_MAE_C),
    `${result.models.length}/${result.total} modèle(s) aligné(s) avec preuve historique qualifiée sur ${result.basis}; MAE température pondérée par la masse de preuve : ${weightedMae.toFixed(2)} °C. Les modèles non alignés, sans preuve qualifiée ou sur une autre base exacte sont exclus de l’agrégat sans annuler le facteur. Échelle expérimentale : MAE 0 °C → 100, 5 °C ou plus → 0.`
  );
}

function buildFreshnessCoverageComponent(
  modelWeights: readonly ExperimentalConfidenceModelValue[],
  expectedModelCount: unknown,
  availableModelCount: unknown,
  targetValidAt: number | null,
  nowMs: number
): ExperimentalConfidenceComponent {
  if (
    !finite(expectedModelCount) ||
    !Number.isInteger(expectedModelCount) ||
    expectedModelCount <= 0 ||
    !finite(availableModelCount) ||
    !Number.isInteger(availableModelCount) ||
    availableModelCount < 0 ||
    availableModelCount > expectedModelCount
  ) {
    return unavailableComponent(
      "freshnessCoverage",
      "Fraîcheur et couverture",
      "Les effectifs attendus/reçus ne sont pas valides."
    );
  }
  const distinctModelIds = new Set(
    modelWeights.flatMap(model =>
      typeof model.modelId === "string" && model.modelId.trim()
        ? [model.modelId.trim()]
        : []
    )
  );
  if (
    distinctModelIds.size !== availableModelCount ||
    modelWeights.length !== availableModelCount
  ) {
    return unavailableComponent(
      "freshnessCoverage",
      "Fraîcheur et couverture",
      "Les horodatages de tous les modèles comptés ne sont pas exposés; la fraîcheur globale n’est pas estimable sans sous-échantillonnage.",
      `${availableModelCount}/${expectedModelCount} valeur(s) annoncée(s), ${distinctModelIds.size} modelId(s) projeté(s).`
    );
  }
  const { models } =
    targetValidAt == null
      ? { models: [] }
      : modelValuesAtTarget({ modelWeights }, targetValidAt);
  if (modelWeights.length > 0 && models.length !== modelWeights.length) {
    return unavailableComponent(
      "freshnessCoverage",
      "Fraîcheur et couverture",
      "Les valeurs ne sont pas toutes alignées sur un même validAt exact."
    );
  }
  const timestamps = modelWeights.map(model =>
    parseTimestamp(model.availableAt)
  );
  if (
    availableModelCount === 0 ||
    timestamps.some(timestamp => timestamp == null || timestamp > nowMs)
  ) {
    return unavailableComponent(
      "freshnessCoverage",
      "Fraîcheur et couverture",
      "Aucun horodatage de disponibilité valide pour tous les modèles reçus."
    );
  }
  const oldestAgeMinutes = Math.max(
    0,
    (nowMs - Math.min(...(timestamps as number[]))) / 60_000
  );
  const freshnessScore = Math.max(
    0,
    100 * (1 - oldestAgeMinutes / FRESHNESS_REFERENCE_MINUTES)
  );
  const coverageScore = (100 * availableModelCount) / expectedModelCount;
  return availableComponent(
    "freshnessCoverage",
    "Fraîcheur et couverture",
    (freshnessScore + coverageScore) / 2,
    `${availableModelCount}/${expectedModelCount} modèles pour la température; disponibilité la plus ancienne âgée de ${Math.round(oldestAgeMinutes)} min. Score = moyenne égale couverture/fraîcheur; fraîcheur nulle à 180 min.`
  );
}

function buildHorizonComponent(
  targetValidAt: number | null,
  forecastComputedAt: unknown
): ExperimentalConfidenceComponent {
  const referenceAt = parseTimestamp(forecastComputedAt);
  if (
    targetValidAt == null ||
    referenceAt == null ||
    targetValidAt < referenceAt
  ) {
    return unavailableComponent(
      "horizon",
      "Horizon",
      "validAt futur et horodatage du snapshot comparables indisponibles."
    );
  }
  const leadMinutes = (targetValidAt - referenceAt) / 60_000;
  const score = 100 * (1 - leadMinutes / MAX_FORECAST_HORIZON_MINUTES);
  return availableComponent(
    "horizon",
    "Horizon",
    score,
    `Échéance à ${Math.round(leadMinutes)} min du snapshot; repère linéaire 0 min → 100, 15 jours → 0. Ce repère ne mesure pas une fréquence d’erreur calibrée.`
  );
}

function buildSampleSizeComponent(
  modelWeights: readonly ExperimentalConfidenceModelValue[],
  targetValidAt: number | null
): ExperimentalConfidenceComponent {
  const result = qualifiedComparableSubset(modelWeights, targetValidAt);
  if (result.reason)
    return unavailableComponent(
      "sampleSize",
      "Taille d’échantillon",
      result.reason
    );
  const minimumDays = Math.min(
    ...result.models.map(
      model => model.historicalScore!.evaluatedDays as number
    )
  );
  const minimumComparisons = Math.min(
    ...result.models.map(
      model => model.historicalScore!.comparisonCount as number
    )
  );
  return availableComponent(
    "sampleSize",
    "Taille d’échantillon",
    (100 * minimumDays) / SAMPLE_SIZE_REFERENCE_DAYS,
    `Borne conservatrice sur les ${result.models.length}/${result.total} modèle(s) aligné(s) avec preuve historique qualifiée sur ${result.basis} : ${minimumDays} jour(s) indépendant(s) et ${minimumComparisons} comparaison(s) au minimum; les autres sont exclus sans annuler le facteur; score saturé à 30 jours. Les jours, pas les heures, portent l’échantillon.`
  );
}

function buildExtremePenalty(
  point: ExperimentalConfidenceForecastPoint | null
): { penalty: number | null; reasons: string[] } {
  if (
    !point ||
    !finite(point.temp) ||
    !finite(point.precipitation) ||
    !finite(point.windSpeed) ||
    !finite(point.weatherCode)
  ) {
    return { penalty: null, reasons: [] };
  }
  const reasons = new Set<string>();
  if (point.windSpeed > 60) reasons.add("vent > 60 km/h");
  if (
    (point.windSpeed > 35 && point.precipitation > 5) ||
    [95, 96, 99].includes(point.weatherCode)
  )
    reasons.add("orage / vent et pluie intenses");
  if (point.precipitation > 5) reasons.add("précipitations > 5 mm sur l’heure");
  if (point.temp < -5) reasons.add("gel intense < −5 °C");
  if (point.temp > 33 && point.precipitation < 0.5)
    reasons.add("chaleur > 33 °C, temps sec");
  if ([66, 67].includes(point.weatherCode))
    reasons.add("pluie verglaçante WMO");
  return {
    penalty: Math.min(30, reasons.size * 10),
    reasons: Array.from(reasons),
  };
}

/**
 * Read-only, explicitly experimental index for one exact next-hour temperature
 * point. Weights are fixed; missing components are never renormalized.
 * The historical-performance and sample-size factors aggregate only the
 * models holding a qualified historical proof on one comparable exact basis:
 * models not aligned at the target validAt, without a qualified proof, or on
 * another exact basis are excluded without voiding the factor, and each
 * retained model is weighted by its evidence mass (comparison count). The
 * spatial-coherence factor aggregates only the physical active stations
 * carrying their own valid, fresh temperature measurement time; other
 * stations are excluded without voiding the factor. The agreement factor
 * measures the spread only over the model values aligned at the exact target
 * validAt; non-aligned values are excluded without voiding the factor.
 * The score is withheld until every weighted factor and the extreme check are
 * known.
 */
export function calculateExperimentalForecastConfidence(
  input: ExperimentalForecastConfidenceInput
): ExperimentalForecastConfidenceResult {
  const nowMs = finite(input.nowMs) ? input.nowMs : Date.now();
  const targetValidAt =
    input.point && finite(input.point.validAt) ? input.point.validAt : null;
  const temperatureWeighting =
    input.point?.weighting?.variableWeightings?.find(
      item => item.variable === "temperature"
    ) ?? null;
  const modelWeights = temperatureWeighting?.modelWeights ?? [];

  const components: ExperimentalConfidenceComponent[] = [
    buildAgreementComponent(modelWeights, targetValidAt),
    buildObservationQualityComponent(input.stations),
    buildHistoricalPerformanceComponent(modelWeights, targetValidAt),
    buildFreshnessCoverageComponent(
      modelWeights,
      temperatureWeighting?.expectedModelCount,
      temperatureWeighting?.availableModelCount,
      targetValidAt,
      nowMs
    ),
    buildSpatialCoherenceComponent(input.stations, nowMs),
    buildHorizonComponent(targetValidAt, input.forecastComputedAt),
    buildSampleSizeComponent(modelWeights, targetValidAt),
  ];
  const calculableWeight = components.reduce(
    (sum, component) => sum + (component.score == null ? 0 : component.weight),
    0
  );
  const coveragePercent = calculableWeight;
  const { penalty: extremePenalty, reasons: extremeReasons } =
    buildExtremePenalty(input.point);
  const fullyCalculable = calculableWeight === 100 && extremePenalty != null;
  const weightedScore = fullyCalculable
    ? components.reduce(
        (sum, component) => sum + component.weight * (component.score ?? 0),
        0
      ) / 100
    : null;
  const score =
    weightedScore == null ? null : clampScore(weightedScore - extremePenalty!);

  return {
    version: "experimental-v4",
    status: fullyCalculable
      ? "calculated"
      : calculableWeight > 0
        ? "partial"
        : "unavailable",
    score,
    calculableWeight,
    coveragePercent,
    targetValidAt,
    extremePenalty,
    extremeReasons,
    components,
  };
}
