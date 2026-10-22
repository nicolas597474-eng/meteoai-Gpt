import { conditionFromWmoWeatherCode } from "@shared/weatherConditionLabels";

export type OfficialHourlyConditionPoint = {
  validAt?: number | null;
  condition?: string | null;
  weatherCode?: number | null;
  precipitation?: number | null;
  cloudCover?: number | null;
};

export const OFFICIAL_HOURLY_CARD_EXCLUDED_DETAIL_KEYS = [
  "precip-type",
  "radiation",
  "weather-code",
  "showers",
] as const;

const excludedDetails = new Set<string>(
  OFFICIAL_HOURLY_CARD_EXCLUDED_DETAIL_KEYS
);

/** Prefer the contract's text; translate a supplied WMO code without exposing its number. */
export function getOfficialHourlyCondition(
  point: OfficialHourlyConditionPoint | null | undefined
): string | null {
  if (!point) return null;
  const suppliedCondition = point.condition?.trim();
  if (suppliedCondition) return suppliedCondition;

  const hasWeatherValue =
    (typeof point.weatherCode === "number" &&
      Number.isFinite(point.weatherCode)) ||
    (typeof point.precipitation === "number" &&
      Number.isFinite(point.precipitation)) ||
    (typeof point.cloudCover === "number" && Number.isFinite(point.cloudCover));
  if (!hasWeatherValue) return null;
  return conditionFromWmoWeatherCode(
    point.weatherCode,
    point.precipitation,
    point.cloudCover
  );
}

/** Find the first descriptive change strictly after the selected UTC validTime. */
export function findNextOfficialHourlyConditionChange<
  T extends OfficialHourlyConditionPoint,
>(
  hours: readonly T[],
  selected: OfficialHourlyConditionPoint | null | undefined
): T | null {
  const selectedValidAt = selected?.validAt;
  if (typeof selectedValidAt !== "number" || !Number.isFinite(selectedValidAt))
    return null;

  const currentCondition = getOfficialHourlyCondition(selected)
    ?.trim()
    .toLocaleLowerCase("fr-FR");
  if (!currentCondition) return null;

  const future = hours
    .filter(
      point =>
        typeof point.validAt === "number" &&
        Number.isFinite(point.validAt) &&
        point.validAt > selectedValidAt
    )
    .slice()
    .sort((left, right) => (left.validAt ?? 0) - (right.validAt ?? 0));

  return (
    future.find(point => {
      const condition = getOfficialHourlyCondition(point)
        ?.trim()
        .toLocaleLowerCase("fr-FR");
      return Boolean(condition && condition !== currentCondition);
    }) ?? null
  );
}

export function filterOfficialHourlyCardDetails<T extends { key: string }>(
  details: readonly T[]
): T[] {
  return details.filter(detail => !excludedDetails.has(detail.key));
}

/** Daily sky state and raw WMO values must not override the selected hourly validTime. */
export function filterDailyMetricsForOfficialHourlyCard<
  T extends { key: string },
>(metrics: readonly T[]): T[] {
  return metrics.filter(
    metric =>
      metric.key !== "tempMax" &&
      metric.key !== "tempMin" &&
      metric.key !== "condition" &&
      metric.key !== "weatherCode"
  );
}
