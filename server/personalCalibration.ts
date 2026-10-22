export const PERSONAL_CONDITIONS = [
  "sunny", "few_clouds", "partly_cloudy", "very_cloudy", "overcast", "fog", "few_drops", "drizzle", "light_rain", "rain", "heavy_rain", "showers", "storm", "snow",
] as const;

export type PersonalCondition = (typeof PERSONAL_CONDITIONS)[number] | "unknown";

export const PERSONAL_CONDITION_LABELS: Record<PersonalCondition, string> = {
  sunny: "Ensoleillé",
  few_clouds: "Quelques nuages",
  partly_cloudy: "Partiellement nuageux",
  very_cloudy: "Très nuageux",
  overcast: "Ciel couvert",
  fog: "Brouillard",
  few_drops: "Quelques gouttes",
  drizzle: "Bruine",
  light_rain: "Pluie faible",
  rain: "Pluie",
  heavy_rain: "Forte pluie",
  showers: "Averses",
  storm: "Orage",
  snow: "Neige",
  unknown: "Conditions indisponibles",
};

type PersonalObservationInput = {
  temperature: number | null;
  condition: PersonalCondition;
  windSpeed: number | null;
  precipitation?: number | null;
};

type ArchivedModelForecast = {
  temperature: number | null;
  windSpeed: number | null;
  precipitation?: number | null;
  weatherCode: number | null;
  cloudCover: number | null;
};

type PriorCalibration = {
  comparisonCount: number;
  scoreEma: number | null;
  temperatureMaeEma: number | null;
  conditionScoreEma: number | null;
  precipitationScoreEma?: number | null;
  windScoreEma: number | null;
};

const EMA_ALPHA = 0.15;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const ema = (current: number | null, next: number | null) => next == null ? current : current == null ? next : EMA_ALPHA * next + (1 - EMA_ALPHA) * current;

export function personalConditionFromForecast(weatherCode: number | null, cloudCover: number | null): PersonalCondition {
  const code = typeof weatherCode === "number" && Number.isInteger(weatherCode) && weatherCode >= 0 && weatherCode <= 99
    ? weatherCode
    : null;
  if (code === 0) return "sunny";
  if (code === 1) return "few_clouds";
  if (code === 2) return "partly_cloudy";
  if (code === 3) {
    return typeof cloudCover === "number" && Number.isFinite(cloudCover) && cloudCover < 90
      ? "very_cloudy"
      : "overcast";
  }
  if (code != null && code <= 49) return "fog";
  if (code === 51) return "few_drops";
  if (code != null && code <= 55) return "drizzle";
  if (code != null && code <= 59) return "light_rain";
  if (code != null && code <= 63) return "rain";
  if (code != null && code <= 69) return "heavy_rain";
  if (code != null && code <= 79) return "snow";
  if (code != null && code <= 84) return "showers";
  if (code != null) return "storm";
  if (typeof cloudCover !== "number" || !Number.isFinite(cloudCover)) return "unknown";
  if (cloudCover > 80) return "overcast";
  if (cloudCover > 65) return "very_cloudy";
  if (cloudCover > 50) return "partly_cloudy";
  if (cloudCover > 20) return "few_clouds";
  return "sunny";
}

export function conditionAgreementScore(observed: PersonalCondition, forecast: PersonalCondition): number | null {
  if (observed === "unknown" || forecast === "unknown") return null;
  if (observed === forecast) return 100;
  const sky = ["sunny", "few_clouds", "partly_cloudy", "very_cloudy", "overcast"];
  const precipitation = ["few_drops", "drizzle", "light_rain", "rain", "heavy_rain", "showers", "storm"];
  if (sky.includes(observed) && sky.includes(forecast)) return 60;
  if (precipitation.includes(observed) && precipitation.includes(forecast)) return 60;
  return 0;
}

export function scorePersonalModelObservation(observation: PersonalObservationInput, forecast: ArchivedModelForecast) {
  const temperatureError = observation.temperature != null && forecast.temperature != null
    ? Math.abs(forecast.temperature - observation.temperature)
    : null;
  const temperatureScore = temperatureError == null ? null : 100 * Math.exp(-temperatureError / 2);
  const forecastCondition = personalConditionFromForecast(forecast.weatherCode, forecast.cloudCover);
  const conditionScore = conditionAgreementScore(observation.condition, forecastCondition);
  const windScore = observation.windSpeed != null && forecast.windSpeed != null
    ? 100 * Math.exp(-Math.abs(forecast.windSpeed - observation.windSpeed) / 10)
    : null;
  const precipitationError = observation.precipitation != null && forecast.precipitation != null
    ? Math.abs(forecast.precipitation - observation.precipitation)
    : null;
  const precipitationScore = precipitationError == null ? null : 100 * Math.exp(-precipitationError / 1.5);
  const dimensions = [
    { weight: 0.5, score: temperatureScore },
    { weight: 0.3, score: conditionScore },
    { weight: 0.12, score: precipitationScore },
    { weight: 0.08, score: windScore },
  ].filter((entry): entry is { weight: number; score: number } => entry.score != null);
  const totalWeight = dimensions.reduce((sum, entry) => sum + entry.weight, 0);
  const overallScore = totalWeight > 0
    ? dimensions.reduce((sum, entry) => sum + entry.weight * entry.score, 0) / totalWeight
    : null;
  return { temperatureError, temperatureScore, conditionScore, precipitationError, precipitationScore, windScore, overallScore, forecastCondition };
}

export function updatePersonalCalibration(prior: PriorCalibration | undefined, result: ReturnType<typeof scorePersonalModelObservation>) {
  const hasComparableValue = result.overallScore != null
    || result.temperatureError != null
    || result.conditionScore != null
    || result.precipitationError != null
    || result.windScore != null;
  const comparisonCount = (prior?.comparisonCount ?? 0) + (hasComparableValue ? 1 : 0);
  const scoreEma = ema(prior?.scoreEma ?? null, result.overallScore);
  const temperatureMaeEma = ema(prior?.temperatureMaeEma ?? null, result.temperatureError);
  const conditionScoreEma = ema(prior?.conditionScoreEma ?? null, result.conditionScore);
  const precipitationScoreEma = ema(prior?.precipitationScoreEma ?? null, result.precipitationScore);
  const windScoreEma = ema(prior?.windScoreEma ?? null, result.windScore);
  const evidenceState = comparisonCount < 20 ? "insufficient" : comparisonCount < 50 ? "provisional" : "qualified";
  // Aucun modèle ne reçoit une influence opérationnelle avant 50 comparaisons.
  const weightMultiplier = evidenceState === "qualified" && scoreEma != null
    ? clamp(0.85 + (scoreEma / 100) * 0.3, 0.85, 1.15)
    : 1;
  return { comparisonCount, scoreEma, temperatureMaeEma, conditionScoreEma, precipitationScoreEma, windScoreEma, evidenceState, weightMultiplier };
}
