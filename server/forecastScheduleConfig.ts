import {
  FORECAST_HEARTBEAT_CRON_UTC,
  PARIS_FORECAST_RUN_HOURS,
  type ParisForecastRunHour,
} from "./weatherTime";

export const FAVORITES_FORECAST_CADENCE_ENV = "METEOAI_FAVORITES_FORECAST_CADENCE";
export type FavoritesForecastCadence = "daily-05" | "every-4-hours";

/**
 * Four-hour collection is the application default. Set the runtime value to
 * `daily-05` only when the external Heartbeat is intentionally kept daily; the
 * Heartbeat itself remains externally managed and must use the documented UTC
 * guard expression for all six Paris collection slots.
 */
export function getFavoritesForecastCadence(
  env: Record<string, string | undefined> = process.env,
): FavoritesForecastCadence {
  const configuredCadence = env[FAVORITES_FORECAST_CADENCE_ENV];
  if (configuredCadence === undefined || configuredCadence === "4h") return "every-4-hours";
  return "daily-05";
}

export function getActiveParisForecastHours(
  env: Record<string, string | undefined> = process.env,
): readonly ParisForecastRunHour[] {
  return getFavoritesForecastCadence(env) === "every-4-hours" ? PARIS_FORECAST_RUN_HOURS : [5];
}

export function getFavoritesForecastScheduleLabel(
  env: Record<string, string | undefined> = process.env,
): string {
  return getActiveParisForecastHours(env)
    .map((hour) => `${String(hour).padStart(2, "0")}:00`)
    .join(", ");
}

export function getRequiredFavoritesForecastHeartbeatCron(): string {
  return FORECAST_HEARTBEAT_CRON_UTC;
}
