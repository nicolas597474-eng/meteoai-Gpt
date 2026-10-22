import type { HourlyPoint } from "./weatherServices";
import { detectMultiRegime, type MultiRegimeResult } from "./fusionEngine";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A favorite regime is derived only from one exact hourly point. The regime
 * engine requires all of these inputs; missing fields must not trigger its
 * internal defaults. HourlyPoint.visibility is in km while the regime engine
 * expects meters, so that conversion is explicit here.
 */
export function buildFavoriteHourlyRegime(
  point: Partial<HourlyPoint> | null | undefined,
): MultiRegimeResult | null {
  if (!point || !isFiniteNumber(point.validAt)
    || !isFiniteNumber(point.temp)
    || !isFiniteNumber(point.precipitation)
    || !isFiniteNumber(point.windSpeed)
    || !isFiniteNumber(point.cloudCover)
    || !isFiniteNumber(point.humidity)
    || !isFiniteNumber(point.visibility)) {
    return null;
  }

  return detectMultiRegime({
    temperature: point.temp,
    precipitation: point.precipitation,
    precipitationType: point.precipType ?? null,
    windSpeed: point.windSpeed,
    cloudCover: point.cloudCover,
    humidity: point.humidity,
    visibility: point.visibility * 1000,
  });
}
