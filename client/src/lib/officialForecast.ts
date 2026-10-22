import { findActiveHourlyForecastIndex, type HourlyForecastTimestamp } from "@shared/hourlyForecastTime";
import type { ActiveLocation } from "@/contexts/LocationContext";

export const DEFAULT_OFFICIAL_FORECAST_LOCATION = {
  lat: 50.7567,
  lon: 2.5204,
  name: "Hondeghem",
} as const;

export const OFFICIAL_FORECAST_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export type OfficialForecastLocation = Pick<ActiveLocation, "lat" | "lon"> | null | undefined;

export function getOfficialForecastCoordinates(location: OfficialForecastLocation) {
  return {
    lat: location?.lat ?? DEFAULT_OFFICIAL_FORECAST_LOCATION.lat,
    lon: location?.lon ?? DEFAULT_OFFICIAL_FORECAST_LOCATION.lon,
  };
}

export function getOfficialForecastQueryInput(location: OfficialForecastLocation, includeExtendedPeriods = false) {
  return {
    ...getOfficialForecastCoordinates(location),
    includeExtendedPeriods,
  };
}

export function getHourlyForecastAtValidTime<T extends HourlyForecastTimestamp>(
  hours: readonly T[],
  validTime: number | null | undefined,
): T | null {
  if (typeof validTime !== "number" || !Number.isFinite(validTime)) return null;
  return hours.find((hour) => hour.validAt === validTime) ?? null;
}

export function getActiveOfficialForecastHour<T extends HourlyForecastTimestamp>(
  hours: readonly T[],
  nowMs = Date.now(),
): { index: number; hour: T } | null {
  const index = findActiveHourlyForecastIndex(hours, nowMs);
  return index < 0 ? null : { index, hour: hours[index] };
}
