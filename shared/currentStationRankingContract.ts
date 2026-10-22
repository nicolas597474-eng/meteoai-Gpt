import {
  STATION_RANKING_COMPONENT_WEIGHTS as weights,
  STATION_RANKING_DISTANCE_CUTOFF_KM,
  STATION_RANKING_FRESHNESS_CUTOFF_MINUTES,
} from '../server/stationRankingScore';
import {NETATMO_BRIDGE_DEFAULTS, STATION_DIRECTORY_MAX_AGE_MINUTES} from './currentStationPolicy';

/** Contrat du répertoire Sites : décrit le code actif, sans appel fournisseur ni historique. */
export function getCurrentStationRankingContract() {
  return {
    version: 'sites-station-ranking-v1',
    ordering: 'Stations actives d’abord, puis score technique décroissant. Ces parts ne sont ni des probabilités ni des pourcentages de précision météo.',
    criteria: [
      {name: 'Distance', weight: weights.distance * 100, description: `Contribution décroissante jusqu’à ${STATION_RANKING_DISTANCE_CUTOFF_KM} km, nulle au-delà. Une station plus éloignée reste visible dans le rayon choisi.`},
      {name: 'Priorité technique du réseau/source', weight: weights.quality * 100, description: 'Priorité fixe du pont Netatmo, normalisée de 0 à 1. Aucune précision historique individuelle n’est déduite.'},
      {name: 'Disponibilité estimée de la source', weight: weights.availability * 100, description: 'Métadonnée technique du réseau entre 0 et 1, distincte de la disponibilité mesurée dans les archives.'},
      {name: 'Fraîcheur du relevé', weight: weights.freshness * 100, description: `Score décroissant sur ${STATION_RANKING_FRESHNESS_CUTOFF_MINUTES} minutes. Le répertoire écarte déjà des stations actives les relevés de plus de ${STATION_DIRECTORY_MAX_AGE_MINUTES} minutes, futurs ou signalés par Netatmo.`},
    ],
    rankingScore: {
      unit: 'points', minimum: 0, maximum: 1, isProbability: false,
      componentWeights: {...weights},
      distanceCutoffKm: STATION_RANKING_DISTANCE_CUTOFF_KM,
      freshnessCutoffMinutes: STATION_RANKING_FRESHNESS_CUTOFF_MINUTES,
    },
    selection: {activeFirst: true, maximumMeasurementAgeMinutes: STATION_DIRECTORY_MAX_AGE_MINUTES},
    sources: [{id: 'netatmo', name: 'Netatmo', sourcePriorityScore: NETATMO_BRIDGE_DEFAULTS.reliabilityScore, updateFreqMin: NETATMO_BRIDGE_DEFAULTS.updateFrequencyMin, estimatedAvailability: NETATMO_BRIDGE_DEFAULTS.dataAvailability}],
  };
}
