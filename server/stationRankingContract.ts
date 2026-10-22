import { GROUND_TRUTH_COMPONENT_SHARES, PHYSICAL_STATION_SOURCES, getStationSourcePriorityDefaults, type StationSource } from "./stationService";
import { STATION_PERFORMANCE_CALCULATION_GATES } from "./stationPerformanceService";
import {
  STATION_RANKING_COMPONENT_WEIGHTS,
  STATION_RANKING_DISTANCE_CUTOFF_KM,
  STATION_RANKING_FRESHNESS_CUTOFF_MINUTES,
} from "./stationRankingScore";

const PHYSICAL_SOURCE_NAMES: Record<StationSource, string> = {
  meteofrance: "Météo-France StatIC",
  netatmo: "Netatmo",
  synop: "Référence ECMWF de grille (non station)",
  noaa: "NOAA / référence non station",
  infoclimat: "Infoclimat",
  openmeteo: "Open-Meteo / référence de grille",
  davis: "Davis Instruments",
  wunderground: "Weather Underground PWS",
};

/** Describes existing production heuristics and the separate empirical station measurement contract. */
export function getStationRankingContract() {
  const physicalSourcePriorities = Array.from(PHYSICAL_STATION_SOURCES).map((source) => {
    const defaults = getStationSourcePriorityDefaults(source);
    return {
      id: source,
      name: PHYSICAL_SOURCE_NAMES[source],
      sourcePriorityScore: defaults.reliability,
      updateFreqMin: defaults.updateFreqMin,
      estimatedAvailability: defaults.availability,
      interpretation: "Priorité technique fixe de la source; ce n’est ni une précision météo ni une performance individuelle de station.",
    };
  });

  return {
    version: "station-ranking-contract-v3" as const,
    criteria: [
      { name: "Distance", weight: 40, description: `Score de proximité borné de 0 à 1 : décroissance linéaire de 0 à ${STATION_RANKING_DISTANCE_CUTOFF_KM} km, puis contribution distance nulle. Part du classement, pas une probabilité.` },
      { name: "Priorité technique du réseau/source", weight: 30, description: "reliabilityScore normalisé de 0 à 1 : prior technique fixe du réseau/source, pas une précision météorologique historique individuelle." },
      { name: "Disponibilité estimée de la source", weight: 20, description: "Disponibilité de source bornée de 0 à 1; métadonnée de réseau, pas une mesure individuelle de performance météo." },
      { name: "Fraîcheur du relevé", weight: 10, description: `Décroît de 1 à 0 sur ${STATION_RANKING_FRESHNESS_CUTOFF_MINUTES} minutes à partir de updatedAt; un horodatage inconnu n’apporte aucun point de fraîcheur.` },
    ],
    rankingScore: {
      unit: "points" as const,
      minimum: 0,
      maximum: 1,
      isProbability: false,
      formula: "0.40 × distanceScore + 0.30 × qualityScore + 0.20 × availabilityScore + 0.10 × freshnessScore",
      componentWeights: {
        distance: STATION_RANKING_COMPONENT_WEIGHTS.distance * 100,
        quality: STATION_RANKING_COMPONENT_WEIGHTS.quality * 100,
        availability: STATION_RANKING_COMPONENT_WEIGHTS.availability * 100,
        freshness: STATION_RANKING_COMPONENT_WEIGHTS.freshness * 100,
      },
      distanceCutoffKm: STATION_RANKING_DISTANCE_CUTOFF_KM,
      freshnessCutoffMinutes: STATION_RANKING_FRESHNESS_CUTOFF_MINUTES,
      unknownDistanceTreatment: "Aucun point de proximité n’est accordé; aucune candidate n’est supprimée par le seul calcul du classement.",
      unknownFreshnessTreatment: "Aucun point de fraîcheur n’est accordé; l’absence d’horodatage n’est pas présentée comme une observation fraîche.",
      interpretation: "Score composite de classement, non une probabilité, un pourcentage de précision ou une mesure historique individuelle de la station.",
    },
    groundTruthWeights: {
      distance: GROUND_TRUTH_COMPONENT_SHARES.distance * 100,
      sourcePriority: GROUND_TRUTH_COMPONENT_SHARES.quality * 100,
      freshness: GROUND_TRUTH_COMPONENT_SHARES.freshness * 100,
    },
    groundTruthWeightNotes: [
      "Chaque composante est normalisée entre stations, les parts sont appliquées, puis les poids finaux sont renormalisés.",
      "La part sourcePriority vient du reliabilityScore fixe du réseau; elle ne correspond pas à une qualité historique mesurée par station.",
    ],
    exclusionRules: [
      "Aucune donnée disponible lorsque température, vent et précipitations sont tous absents.",
      "Présélection physique : relevé plus ancien que 180 minutes.",
      "Priorité technique de source inférieure à 40/100 (seuil de présélection, pas une mesure de précision).",
      "Contrôle spatial de la synthèse : écart de température supérieur à 8 °C lorsque comparable.",
    ],
    sourcePriorityDefinition: "Les valeurs sourcePriorityScore viennent des valeurs par défaut des mappers actifs. Elles servent aux heuristiques de tri/pondération déjà en production; elles ne sont ni des probabilités, ni des pourcentages de précision, ni des scores individuels de station.",
    sources: physicalSourcePriorities,
    stationPerformance: {
      statusWhenEvidenceInsufficient: "non_mesuree" as const,
      unavailableEstimate: null,
      metric: "Pour les variables couvertes : MAE poolée, MAE moyenne par jour utilisée pour le shrinkage, RMSE et biais en unités physiques natives; aucun score individuel composite 0–100 n’est dérivé.",
      comparison: "Comparaison horaire à la médiane de réseaux physiques distincts; le réseau et le site exact de la station cible sont exclus, et les réseaux co-localisés ne comptent pas séparément.",
      upstreamProviderIndependenceVerified: false,
      sourcePrior: "Moyenne empirique des MAE de sites distincts du même réseau, évalués contre des réseaux différents; la cible est exclue. Shrinkage normal-normal empirique : w = tau² / (tau² + s²), estimation = w × MAE cible + (1 − w) × prior réseau.",
      uncertainty: "Intervalle bilatéral nominal à 95 % (alpha 0,05) avec quantile t de Student et degrés de liberté min(jours distincts − 1, sites du prior − 1); approximation à blocs journaliers, non calibrée empiriquement et non interprétable comme probabilité.",
      calculationGates: {
        minimumComparisons: STATION_PERFORMANCE_CALCULATION_GATES.minimumComparisons,
        minimumDistinctDays: STATION_PERFORMANCE_CALCULATION_GATES.minimumDistinctDays,
        minimumDistinctReferenceNetworksPerComparison: STATION_PERFORMANCE_CALCULATION_GATES.minimumDistinctReferenceNetworksPerComparison,
        minimumSourcePriorSites: STATION_PERFORMANCE_CALCULATION_GATES.minimumSourcePriorSites,
      },
      calculationGatesAreEvidence: false,
      scorePublication: {
        compositeScorePublished: false,
        publicationThreshold: null,
        calibratedProbabilityPublished: false,
      },
      precipitationMeasurement: {
        status: "non_mesuree" as const,
        reason: "aucun minimum d’échantillon défendable n’est documenté",
        occurrenceAndQuantityMeasured: false,
        distinctEventDayCountExposed: true,
      },
      operationalProfile: "Le profil complétude/continuité/stabilité décrit la disponibilité et la régularité des relevés; il ne constitue pas une mesure de précision météorologique.",
      historySource: "station_observations",
      historyWindowDays: 30,
      readsExistingStationHistoryAtRuntime: true,
      persistsCalculatedData: false,
      changesProductionForecastsOrWeights: false,
    },
  };
}
