export type HourlyConditionPoint = {
  hour: string;
  validAt?: number | null;
  condition?: string | null;
  precipitation?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
};

export type NextWeatherAlert = {
  kind: "thunderstorm" | "rain" | "wind";
  title: string;
  detail: string;
  icon: "thunderstorm" | "rainy" | "windy";
};

function normalizeCondition(condition?: string | null) {
  return condition?.trim().toLocaleLowerCase("fr-FR") ?? "";
}

/** Returns the first future hourly slot whose condition differs from now. */
export function findNextConditionChange<T extends HourlyConditionPoint>(
  hours: T[],
  currentHour: string,
  currentValidAt?: number | null,
): T | null {
  const currentIndex = typeof currentValidAt === "number" && Number.isFinite(currentValidAt)
    ? hours.findIndex((point) => point.validAt === currentValidAt)
    : hours.findIndex((point) => point.hour === currentHour);
  const startIndex = currentIndex >= 0
    ? currentIndex
    : hours.findIndex((point) => point.hour >= currentHour);

  if (startIndex < 0) return null;

  const currentCondition = normalizeCondition(hours[startIndex]?.condition);
  if (!currentCondition) return null;

  for (let index = startIndex + 1; index < hours.length; index += 1) {
    const candidate = hours[index];
    if (normalizeCondition(candidate.condition) && normalizeCondition(candidate.condition) !== currentCondition) {
      return candidate;
    }
  }
  return null;
}

/**
 * Classifies the first upcoming change that warrants a visual alert.
 * Wind is considered strong from 40 km/h sustained or 55 km/h gusts.
 */
export function getNextWeatherAlert(point: HourlyConditionPoint | null): NextWeatherAlert | null {
  if (!point) return null;
  const condition = normalizeCondition(point.condition);
  const windSpeed = point.windSpeed ?? 0;
  const windGust = point.windGust ?? 0;

  if (/(orage|thunder|tempête)/.test(condition)) {
    return {
      kind: "thunderstorm",
      title: "Alerte orage",
      detail: `Risque d’orage prévu à ${point.hour}`,
      icon: "thunderstorm",
    };
  }
  if (windSpeed >= 40 || windGust >= 55) {
    const windValue = windGust >= 55 ? `${Math.round(windGust)} km/h en rafales` : `${Math.round(windSpeed)} km/h`;
    return {
      kind: "wind",
      title: "Alerte vent fort",
      detail: `Vent prévu à ${windValue} à ${point.hour}`,
      icon: "windy",
    };
  }
  if (/(pluie|averse|rain|bruine)/.test(condition) || (point.precipitation ?? 0) > 0.2) {
    const amount = point.precipitation != null && point.precipitation > 0 ? ` (${point.precipitation.toFixed(1)} mm)` : "";
    return {
      kind: "rain",
      title: "Alerte pluie",
      detail: `Précipitations prévues à ${point.hour}${amount}`,
      icon: "rainy",
    };
  }
  return null;
}
