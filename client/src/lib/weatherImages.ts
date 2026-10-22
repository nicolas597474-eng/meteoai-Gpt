/** Fonds photographiques de la grande carte de conditions actuelles du Dashboard. */
const WEATHER_IMAGES: Record<string, string> = {
  sunny: "/manus-storage/sky-pack-sunny_1500b9a0.jpg",
  few_clouds: "/manus-storage/sky-pack-partly-cloudy_a05dead0.jpg",
  cloudy: "/manus-storage/sky-pack-cloudy_73c1f4de.jpg",
  overcast: "/manus-storage/sky-pack-cloudy_73c1f4de.jpg",
  fog: "/manus-storage/sky-pack-fog_b9e4feed.jpg",
  showers: "/manus-storage/sky-pack-rain_1cfc77ab.jpg",
  drizzle: "/manus-storage/sky-pack-drizzle_7f8dc074.jpg",
  rainy: "/manus-storage/sky-pack-rain_1cfc77ab.jpg",
  heavy_rain: "/manus-storage/sky-pack-heavy-rain_1767119c.jpg",
  thunderstorm: "/manus-storage/sky-pack-thunderstorm_e401a8de.jpg",
  violent_storm: "/manus-storage/sky-pack-violent-storm_6d8ac43d.jpg",
  snow: "/manus-storage/sky-pack-snow_84cfd297.jpg",
  heavy_snow: "/manus-storage/sky-pack-snow_84cfd297.jpg",
  freezing_rain: "/manus-storage/sky-pack-freezing_e4e745b1.jpg",
  frost: "/manus-storage/sky-pack-freezing_e4e745b1.jpg",
  cold_sun: "/manus-storage/sky-pack-partly-cloudy_a05dead0.jpg",
  windy: "/manus-storage/sky-pack-wind_5156d1d8.jpg",
  heat: "/manus-storage/sky-pack-heat_7eae0649.jpg",
  dust_haze: "/manus-storage/sky-pack-dust-haze_5efb030f.jpg",
  clear_night: "/manus-storage/sky-pack-clear-night_2ef41d31.jpg",
};

const DEFAULT_IMAGE = WEATHER_IMAGES.few_clouds;

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s-]+/g, "_").trim();
}

const CONDITION_RULES: Array<[string[], keyof typeof WEATHER_IMAGES]> = [
  [["nuit", "night", "ciel_degagé_nuit", "clear_night"], "clear_night"],
  [["pluie_verglacante", "verglas", "freezing"], "freezing_rain"],
  [["neige_forte", "forte_neige", "heavy_snow"], "heavy_snow"],
  [["neige", "snow"], "snow"],
  [["orage_violent", "violent_storm"], "violent_storm"],
  [["fort_orage", "thunderstorm", "orage"], "thunderstorm"],
  [["pluie_forte", "heavy_rain", "forte_pluie"], "heavy_rain"],
  [["bruine", "drizzle"], "drizzle"],
  [["averse", "showers"], "showers"],
  [["pluie", "rain", "rainy"], "rainy"],
  [["brouillard", "brume", "fog", "mist"], "fog"],
  [["poussiere", "brume_seche", "dust", "haze"], "dust_haze"],
  [["vent_fort", "windy", "rafale", "wind"], "windy"],
  [["givre", "gel", "frost"], "frost"],
  [["grand_soleil", "cold_sun"], "cold_sun"],
  [["canicule", "chaleur", "heat"], "heat"],
  [["couvert", "tres_nuageux", "overcast"], "overcast"],
  [["nuageux", "cloudy"], "cloudy"],
  [["eclaircies", "peu_nuageux", "partiellement_nuageux", "few_clouds", "partly_cloudy"], "few_clouds"],
  [["ensoleille", "sunny", "clear", "soleil"], "sunny"],
];

export function getWeatherLandscapeImage(regime: string | undefined | null): string {
  const normalized = normalize(regime);
  for (const [keywords, key] of CONDITION_RULES) if (keywords.some((keyword) => normalized.includes(keyword))) return WEATHER_IMAGES[key];
  return DEFAULT_IMAGE;
}

export function getWeatherImageFromData(params: { temperature?: number; cloudCover?: number; precipitation?: number; windSpeed?: number; visibility?: number }): string {
  const { temperature, cloudCover, precipitation, windSpeed, visibility } = params;
  if ((precipitation ?? 0) > 10) return WEATHER_IMAGES.heavy_rain;
  if ((windSpeed ?? 0) > 60) return WEATHER_IMAGES.violent_storm;
  if ((visibility ?? Infinity) < 1000) return WEATHER_IMAGES.fog;
  if ((temperature ?? -Infinity) > 33) return WEATHER_IMAGES.heat;
  if ((temperature ?? Infinity) < -5) return WEATHER_IMAGES.cold_sun;
  if ((temperature ?? Infinity) < 0) return WEATHER_IMAGES.frost;
  if ((precipitation ?? 0) > 0.5) return WEATHER_IMAGES.rainy;
  if ((windSpeed ?? 0) > 40) return WEATHER_IMAGES.windy;
  if (cloudCover !== undefined && cloudCover > 80) return WEATHER_IMAGES.overcast;
  if (cloudCover !== undefined && cloudCover > 50) return WEATHER_IMAGES.cloudy;
  if (cloudCover !== undefined && cloudCover > 20) return WEATHER_IMAGES.few_clouds;
  return cloudCover !== undefined ? WEATHER_IMAGES.sunny : DEFAULT_IMAGE;
}

/** La condition de l’heure courante est toujours prioritaire sur le régime journalier. */
export function getDashboardWeatherImage(params: { condition?: string | null; temperature?: number; cloudCover?: number; precipitation?: number; windSpeed?: number; visibility?: number; regime?: string | null }): string {
  if (normalize(params.condition)) return getWeatherLandscapeImage(params.condition);
  if (params.regime) return getWeatherLandscapeImage(params.regime);
  return getWeatherImageFromData(params);
}
