import { isCompleteHourlyForecastBatch } from "./hourlyForecastCompleteness";
import { HOURLY_FORECAST_VARIABLES } from "./forecastVariableCoverage";
import { getParisDateAndHour } from "./parisHourlyTime";

export type ArchivedHourlyForecastValue = {
  captureRunId: string;
  modelName: string;
  validTime: number;
  variable: string;
  value: number | null;
  availableAt: number;
};

export type PersonalHourlyModelForecast = {
  captureRunId: string;
  modelName: string;
  availableAt: number;
  validAt: number;
  date: string;
  hour: number;
  temperature: number | null;
  apparentTemperature: number | null;
  precipitation: number | null;
  rain: number | null;
  showers: number | null;
  snowfall: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGusts: number | null;
  humidity: number | null;
  pressure: number | null;
  cloudCover: number | null;
  cloudLow: number | null;
  cloudMid: number | null;
  cloudHigh: number | null;
  weatherCode: number | null;
  uvIndex: number | null;
  dewPoint: number | null;
  visibility: number | null;
  solarRadiation: number | null;
};

const VARIABLE_BY_ARCHIVE_KEY: Map<string, typeof HOURLY_FORECAST_VARIABLES[number]> = new Map(
  HOURLY_FORECAST_VARIABLES.map((definition): [string, typeof HOURLY_FORECAST_VARIABLES[number]] => [definition.key, definition]),
);
const REQUIRED_PROJECTION_FIELDS = HOURLY_FORECAST_VARIABLES
  .filter((definition) => definition.consumerProjected)
  .map((definition) => definition.valueField);

/**
 * Reconstruct the latest complete exact-time run for each model from the existing
 * immutable archive. Partial later attempts stay archived but cannot displace the
 * last complete run. When supplied, availableBefore is an exclusive cutoff applied
 * before selecting the latest eligible run. Secondary archive-only variables may remain null.
 */
export function getLatestCompletePersonalHourlyForecasts(
  rows: readonly ArchivedHourlyForecastValue[],
  expectedValidTimes: readonly number[],
  availableBefore?: number,
): PersonalHourlyModelForecast[] {
  if (expectedValidTimes.length === 0) return [];
  const expectedTimes = new Set(expectedValidTimes);
  if (expectedTimes.size !== expectedValidTimes.length || expectedValidTimes.some((time) => !Number.isFinite(time))) return [];
  if (availableBefore !== undefined && !Number.isFinite(availableBefore)) return [];

  const runs = new Map<string, {
    captureRunId: string;
    modelName: string;
    availableAt: number;
    hours: Map<number, Record<string, unknown>>;
  }>();

  for (const row of rows) {
    if (!row || typeof row.captureRunId !== "string" || typeof row.modelName !== "string"
      || !Number.isFinite(row.validTime) || !expectedTimes.has(row.validTime)) continue;
    const definition = VARIABLE_BY_ARCHIVE_KEY.get(row.variable);
    if (!definition) continue;
    const runKey = `${row.modelName}\u0000${row.captureRunId}`;
    let run = runs.get(runKey);
    if (!run) {
      run = { captureRunId: row.captureRunId, modelName: row.modelName, availableAt: row.availableAt, hours: new Map() };
      runs.set(runKey, run);
    }
    if (Number.isFinite(row.availableAt)) run.availableAt = Math.max(run.availableAt, row.availableAt);
    const point = run.hours.get(row.validTime) ?? { validAt: row.validTime };
    point[definition.valueField] = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
    run.hours.set(row.validTime, point);
  }

  const latestCompleteRunByModel = new Map<string, {
    captureRunId: string;
    modelName: string;
    availableAt: number;
    hours: Map<number, Record<string, unknown>>;
  }>();
  for (const run of Array.from(runs.values())) {
    if (availableBefore !== undefined && (!Number.isFinite(run.availableAt) || run.availableAt >= availableBefore)) continue;
    const completeRows: Array<Record<string, unknown>> = Array.from(run.hours.values());
    if (!isCompleteHourlyForecastBatch({
      rows: completeRows,
      expectedValidTimes,
      requiredValueFields: REQUIRED_PROJECTION_FIELDS,
    })) continue;
    const current = latestCompleteRunByModel.get(run.modelName);
    if (!current || run.availableAt > current.availableAt
      || (run.availableAt === current.availableAt && run.captureRunId > current.captureRunId)) {
      latestCompleteRunByModel.set(run.modelName, run);
    }
  }

  const forecasts: PersonalHourlyModelForecast[] = [];
  for (const run of Array.from(latestCompleteRunByModel.values())) {
    for (const validAt of expectedValidTimes) {
      const localTime = getParisDateAndHour(validAt);
      const point = run.hours.get(validAt);
      if (!localTime || !point) continue;
      const value = (field: string) => {
        const candidate = point[field];
        return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
      };
      forecasts.push({
        captureRunId: run.captureRunId,
        modelName: run.modelName,
        availableAt: run.availableAt,
        validAt,
        date: localTime.date,
        hour: localTime.hour,
        temperature: value("temperature"),
        apparentTemperature: value("apparentTemperature"),
        precipitation: value("precipitation"),
        rain: value("rain"),
        showers: value("showers"),
        snowfall: value("snowfall"),
        windSpeed: value("windSpeed"),
        windDirection: value("windDirection"),
        windGusts: value("windGusts"),
        humidity: value("humidity"),
        pressure: value("pressure"),
        cloudCover: value("cloudCover"),
        cloudLow: value("cloudLow"),
        cloudMid: value("cloudMid"),
        cloudHigh: value("cloudHigh"),
        weatherCode: value("weatherCode"),
        uvIndex: value("uvIndex"),
        dewPoint: value("dewPoint"),
        visibility: value("visibility"),
        solarRadiation: value("solarRadiation"),
      });
    }
  }
  return forecasts.sort((a, b) => a.validAt - b.validAt || a.modelName.localeCompare(b.modelName));
}
