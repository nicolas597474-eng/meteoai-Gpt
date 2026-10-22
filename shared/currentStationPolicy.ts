/** Métadonnées techniques du pont Netatmo, sans mesure de précision individuelle. */
export const NETATMO_BRIDGE_DEFAULTS = {
  reliabilityScore: 72,
  updateFrequencyMin: 10,
  dataAvailability: 0.75,
} as const;

/** Présélection du répertoire, distincte de la décroissance du score de fraîcheur. */
export const STATION_DIRECTORY_MAX_AGE_MINUTES = 90;
