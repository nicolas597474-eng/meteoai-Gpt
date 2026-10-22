/** The seven sources accepted by the official hourly and daily fusion engines. */
export const OFFICIAL_HOURLY_MODELS = [
  { name: "AROME", modelId: "meteofrance_arome_france_hd" },
  { name: "ARPEGE", modelId: "meteofrance_arpege_europe" },
  { name: "ICON", modelId: "dwd_icon_eu" },
  { name: "ECMWF", modelId: "ecmwf_ifs025" },
  { name: "GFS", modelId: "gfs_seamless" },
  { name: "GEM", modelId: "gem_seamless" },
  { name: "UKMET", modelId: "ukmo_seamless" },
] as const;
