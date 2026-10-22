import type { ForecastRow } from "./statsEngine";

/**
 * `meteoai_forecast.stabilityLabel` remains NOT NULL in the deployed schema and
 * has no SQL default. This adapter preserves the exact pre-change calculation
 * only to satisfy that required storage enum. Its numeric intermediate result
 * is discarded: the label must not leave persistence or be described as forecast
 * reliability. Public products use separate raw measures instead.
 */
export type LegacyStabilityLabel = "stable" | "unstable";

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function legacyStabilityLabelForStorage(forecasts: readonly ForecastRow[]): LegacyStabilityLabel {
  if (forecasts.length < 2) return "stable";
  const temps = forecasts.filter((forecast) => forecast.tempMax != null).map((forecast) => forecast.tempMax!);
  const precipitation = forecasts.filter((forecast) => forecast.precipitation != null).map((forecast) => forecast.precipitation!);
  const tempMean = mean(temps);
  const tempStd = Math.sqrt(mean(temps.map((value) => Math.pow(value - tempMean, 2))));
  const precipMean = precipitation.length > 0 ? mean(precipitation) : 0;
  const precipStd = precipitation.length > 0
    ? Math.sqrt(mean(precipitation.map((value) => Math.pow(value - precipMean, 2))))
    : 0;
  const tempStability = Math.max(0, 100 - (tempStd * 20));
  const precipStability = Math.max(0, 100 - (precipStd * 10));
  const legacyIndex = Math.round((tempStability * 0.6) + (precipStability * 0.4));
  return legacyIndex >= 60 ? "stable" : "unstable";
}
