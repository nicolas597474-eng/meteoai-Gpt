import { conditionFromWeatherValues } from "@shared/weatherConditionLabels";

/**
 * Keep the source's weather-code condition when present. Cloud cover alone can
 * contradict a valid WMO code (for example partly cloudy with dense high cloud).
 */
export function getHourlyConditionLabel(
  cloudCover: number | null,
  precipitation: number | null,
  condition: string | null
): string {
  if (condition) return condition;
  if (cloudCover != null || precipitation != null) {
    return conditionFromWeatherValues(precipitation, cloudCover);
  }
  return "Conditions indisponibles";
}
