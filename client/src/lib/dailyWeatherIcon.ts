import { isValidDailyWmoWeatherCode } from "@shared/dailyWeatherCode";

const DAILY_WMO_ICON_NAMES: Record<number, string> = {
  0: "sunny",
  1: "few_clouds",
  2: "partly_cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "showers",
  53: "showers",
  55: "showers",
  56: "freezing_rain",
  57: "freezing_rain",
  61: "rainy",
  63: "rainy",
  65: "heavy_rain",
  66: "freezing_rain",
  67: "freezing_rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "showers",
  81: "showers",
  82: "heavy_rain",
  85: "snow",
  86: "snow",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
};

/** Choisit une icône uniquement pour un code quotidien WMO reconnu. */
export function getDailyWeatherCodeIconName(code: number | null | undefined): string | null {
  if (!isValidDailyWmoWeatherCode(code)) return null;
  return DAILY_WMO_ICON_NAMES[code] ?? null;
}
