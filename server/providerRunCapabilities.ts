/**
 * Capacités Single Runs vérifiées dans la documentation Open-Meteo.
 * Elles sont séparées des horizons et des paramètres de collecte officiels.
 */
export const DIRECT_SINGLE_RUN_METADATA_MODEL_IDS = {
  AROME: "meteofrance_arome_france_hd",
  ARPEGE: "meteofrance_arpege_europe",
  ICON: "dwd_icon_eu",
  ECMWF: "ecmwf_ifs025",
  UKMET: "ukmo_seamless",
} as const;

/** IDs Forecast conservés ; les composites sont prouvés par leurs grilles, jamais par un alias /data inexistant. */
export const SINGLE_RUN_MODEL_IDS = {
  ...DIRECT_SINGLE_RUN_METADATA_MODEL_IDS,
  GFS: "gfs_seamless",
  GEM: "gem_seamless",
} as const;
export const COMPOSITE_METADATA_IDS: Record<string, readonly string[]> = {
  gfs_seamless: ["ncep_gfs013", "ncep_gfs025"],
  gem_seamless: ["cmc_gem_gdps_15km", "cmc_gem_gdps"],
  ukmo_seamless: ["ukmo_global_deterministic_10km", "ukmo_uk_deterministic_2km"],
};
export const COMPOSITE_METADATA_LOCATION = "50.757_2.520";

export const SINGLE_RUN_CALIBRATION_VARIABLE_IDS = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "relative_humidity_2m",
  "surface_pressure",
  "pressure_msl",
  "rain",
  "showers",
  "snowfall",
] as const;

const singleRunsDocumentationUrl = "https://open-meteo.com/en/docs/single-runs-api";

export const PROVIDER_RUN_MODEL_CAPABILITIES = [
  {
    modelName: "AROME",
    forecastModelId: "meteofrance_arome_france_hd",
    openMeteoModelId: "meteofrance_arome_france_hd",
    appIdMatchesDocumentedId: true,
    singleRunModelId: "meteofrance_arome_france_hd",
    singleRunEndpointSupportedForDocumentedId: true,
    metadataMappingVerified: true,
    maximumDocumentedForecastDays: 2,
    horizonDescription: "AROME France HD : jusqu’à 2 jours, pas horaire; modèle HD sans niveaux de pression.",
    documentedCalibrationVariables: SINGLE_RUN_CALIBRATION_VARIABLE_IDS,
    modelDocumentationUrl: "https://open-meteo.com/en/docs/meteofrance-api",
    singleRunsDocumentationUrl: singleRunsDocumentationUrl,
    captureUnavailableReason: null,
  },
  {
    modelName: "ARPEGE",
    forecastModelId: "meteofrance_arpege_europe",
    openMeteoModelId: "meteofrance_arpege_europe",
    appIdMatchesDocumentedId: true,
    singleRunModelId: "meteofrance_arpege_europe",
    singleRunEndpointSupportedForDocumentedId: true,
    metadataMappingVerified: true,
    maximumDocumentedForecastDays: 4,
    horizonDescription: "ARPEGE Europe : jusqu’à 4 jours, pas horaire; actualisation documentée toutes les 6 heures.",
    documentedCalibrationVariables: SINGLE_RUN_CALIBRATION_VARIABLE_IDS,
    modelDocumentationUrl: "https://open-meteo.com/en/docs/meteofrance-api",
    singleRunsDocumentationUrl: singleRunsDocumentationUrl,
    captureUnavailableReason: null,
  },
  {
    modelName: "ICON",
    forecastModelId: "dwd_icon_eu",
    openMeteoModelId: "dwd_icon_eu",
    appIdMatchesDocumentedId: true,
    singleRunModelId: "dwd_icon_eu",
    singleRunEndpointSupportedForDocumentedId: true,
    metadataMappingVerified: true,
    maximumDocumentedForecastDays: 5,
    horizonDescription: "ICON Europe : jusqu’à 5 jours; pas natif horaire puis 3 heures après 78 heures.",
    documentedCalibrationVariables: SINGLE_RUN_CALIBRATION_VARIABLE_IDS,
    modelDocumentationUrl: "https://open-meteo.com/en/docs/dwd-api",
    singleRunsDocumentationUrl: singleRunsDocumentationUrl,
    captureUnavailableReason: null,
  },
  {
    modelName: "ECMWF",
    forecastModelId: "ecmwf_ifs025",
    openMeteoModelId: "ecmwf_ifs025",
    appIdMatchesDocumentedId: true,
    singleRunModelId: "ecmwf_ifs025",
    singleRunEndpointSupportedForDocumentedId: true,
    metadataMappingVerified: true,
    maximumDocumentedForecastDays: 15,
    horizonDescription: "IFS Open-Data 0,25° : jusqu’à 15 jours; sorties natives 3 heures puis 6 heures après 144 heures.",
    documentedCalibrationVariables: SINGLE_RUN_CALIBRATION_VARIABLE_IDS,
    modelDocumentationUrl: "https://open-meteo.com/en/docs/ecmwf-api",
    singleRunsDocumentationUrl: singleRunsDocumentationUrl,
    captureUnavailableReason: null,
  },
  {
    modelName: "GFS",
    forecastModelId: "gfs_seamless",
    openMeteoModelId: "ncep_gfs_seamless",
    appIdMatchesDocumentedId: false,
    singleRunModelId: "ncep_gfs_seamless",
    singleRunEndpointSupportedForDocumentedId: true,
    metadataMappingVerified: true,
    maximumDocumentedForecastDays: 16,
    horizonDescription: "GFS global : jusqu’à 16 jours; l’API GFS & HRRR ajoute HRRR en Amérique du Nord, avec un horizon plus court.",
    documentedCalibrationVariables: SINGLE_RUN_CALIBRATION_VARIABLE_IDS,
    modelDocumentationUrl: "https://open-meteo.com/en/docs/gfs-api",
    singleRunsDocumentationUrl: singleRunsDocumentationUrl,
    captureUnavailableReason: "À Hondeghem : grilles GFS 0,13° et 0,25° vérifiées, même cycle requis ; alias Forecast conservé.",
  },
  {
    modelName: "GEM",
    forecastModelId: "gem_seamless",
    openMeteoModelId: "cmc_gem_seamless",
    appIdMatchesDocumentedId: false,
    singleRunModelId: "cmc_gem_seamless",
    singleRunEndpointSupportedForDocumentedId: true,
    metadataMappingVerified: true,
    maximumDocumentedForecastDays: 10,
    horizonDescription: "GEM Global : jusqu’à 10 jours; GEM RDPS : 3,5 jours; GEM HRDPS : 2 jours selon la composante et la région.",
    documentedCalibrationVariables: SINGLE_RUN_CALIBRATION_VARIABLE_IDS,
    modelDocumentationUrl: "https://open-meteo.com/en/docs/gem-api",
    singleRunsDocumentationUrl: singleRunsDocumentationUrl,
    captureUnavailableReason: "À Hondeghem : générations GDPS vérifiées ; une ancienne génération est écartée seulement si son horizon entier est déjà passé.",
  },
  {
    modelName: "UKMET",
    forecastModelId: "ukmo_seamless",
    openMeteoModelId: "ukmo_seamless",
    appIdMatchesDocumentedId: true,
    singleRunModelId: "ukmo_seamless",
    singleRunEndpointSupportedForDocumentedId: true,
    metadataMappingVerified: true,
    maximumDocumentedForecastDays: 7,
    horizonDescription: "UKMO Global : 7 jours; UKV Royaume-Uni/Irlande : 2 jours; le produit seamless sélectionne selon le lieu et le rayonnement est limité à 2 jours.",
    documentedCalibrationVariables: SINGLE_RUN_CALIBRATION_VARIABLE_IDS,
    modelDocumentationUrl: "https://open-meteo.com/en/docs/ukmo-api",
    singleRunsDocumentationUrl: singleRunsDocumentationUrl,
    captureUnavailableReason: null,
  },
] as const;

export type ProviderRunModelCapability = (typeof PROVIDER_RUN_MODEL_CAPABILITIES)[number];

export function getProviderRunModelCapability(modelName: string): ProviderRunModelCapability | null {
  return PROVIDER_RUN_MODEL_CAPABILITIES.find((capability) => capability.modelName === modelName) ?? null;
}
