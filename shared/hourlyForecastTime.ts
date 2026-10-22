export type HourlyForecastTimestamp = { validAt?: number | null };

const HOUR_MS = 60 * 60_000;

export function findActiveHourlyForecastIndex<
  T extends HourlyForecastTimestamp,
>(hours: readonly T[], nowMs = Date.now()): number {
  return hours.findIndex(
    hour =>
      typeof hour.validAt === "number" &&
      Number.isFinite(hour.validAt) &&
      hour.validAt <= nowMs &&
      nowMs < hour.validAt + HOUR_MS
  );
}

export function keepCurrentAndFutureHourlyForecasts<
  T extends HourlyForecastTimestamp,
>(hours: readonly T[], nowMs = Date.now()): T[] {
  return hours.filter(
    hour =>
      hour.validAt == null ||
      (Number.isFinite(hour.validAt) && hour.validAt + HOUR_MS > nowMs)
  );
}
