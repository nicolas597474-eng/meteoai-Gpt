import { getParisDateAndHour } from "./parisHourlyTime";

export type HourlyForecastValueRow = Record<string, unknown> & {
  hour?: unknown;
  validAt?: unknown;
  validTime?: unknown;
};

/**
 * A publishable hourly batch must contain each expected UTC instant exactly once
 * and a finite value for every field used by the current projection. UTC instants
 * keep the two repeated Paris autumn hours distinct without inventing a value.
 */
export function isCompleteHourlyForecastBatch<T extends object>(input: {
  rows: readonly T[];
  expectedValidTimes: readonly number[];
  requiredValueFields: readonly string[];
}): boolean {
  const { rows, expectedValidTimes, requiredValueFields } = input;
  if (expectedValidTimes.length === 0 || requiredValueFields.length === 0 || rows.length !== expectedValidTimes.length) {
    return false;
  }

  const expected = new Set(expectedValidTimes);
  if (expected.size !== expectedValidTimes.length || expectedValidTimes.some((time) => !Number.isFinite(time))) {
    return false;
  }

  const received = new Set<number>();
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const validTime = typeof record.validAt === "number" ? record.validAt : record.validTime;
    if (typeof validTime !== "number" || !Number.isFinite(validTime) || !expected.has(validTime) || received.has(validTime)) {
      return false;
    }
    if (requiredValueFields.some((field) => typeof record[field] !== "number" || !Number.isFinite(record[field] as number))) {
      return false;
    }
    received.add(validTime);
  }

  return received.size === expected.size;
}

/**
 * The legacy projection stores only the Paris wall-clock hour, not validAt.
 * This checks its row-count/hour multiplicities and projected values, but exact
 * repeated-hour identity must continue to come from the immutable UTC archive.
 */
export function isCompleteStoredHourlyProjection<T extends object>(input: {
  rows: readonly T[];
  expectedValidTimes: readonly number[];
  requiredValueFields: readonly string[];
}): boolean {
  const { rows, expectedValidTimes, requiredValueFields } = input;
  if (expectedValidTimes.length === 0 || requiredValueFields.length === 0 || rows.length !== expectedValidTimes.length) {
    return false;
  }

  const expectedHours = new Map<number, number>();
  for (const validAt of expectedValidTimes) {
    const localTime = getParisDateAndHour(validAt);
    if (!localTime || localTime.minute !== 0) return false;
    expectedHours.set(localTime.hour, (expectedHours.get(localTime.hour) ?? 0) + 1);
  }

  const receivedHours = new Map<number, number>();
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const hour = record.hour;
    if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) return false;
    if (requiredValueFields.some((field) => typeof record[field] !== "number" || !Number.isFinite(record[field] as number))) {
      return false;
    }
    receivedHours.set(hour, (receivedHours.get(hour) ?? 0) + 1);
  }

  return expectedHours.size === receivedHours.size && Array.from(expectedHours).every(
    ([hour, count]) => receivedHours.get(hour) === count,
  );
}
