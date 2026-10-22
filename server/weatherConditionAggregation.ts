import { conditionFromWeatherValues } from "./weatherConditionLabels";

type ForecastConditionValues = {
  precipitation?: unknown;
  cloudCover?: unknown;
};

function meanFinite(values: unknown[]): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

/** Summarizes only received finite source values; absent fields are never replaced with climatological defaults. */
export function aggregateForecastCondition(forecasts: ForecastConditionValues[]): string {
  const precipitation = meanFinite(forecasts.map((forecast) => forecast.precipitation));
  const cloudCover = meanFinite(forecasts.map((forecast) => forecast.cloudCover));
  return conditionFromWeatherValues(precipitation, cloudCover);
}
