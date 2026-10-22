import {
  groupOfficialHourlyForecastByDate,
  type DatedForecastHour,
  type ForecastDayGroup,
} from "@/lib/forecastTimeline";
import type { DailyModelAgreement } from "@shared/modelAgreement";
import type {
  BestMatchDailyReference,
  DailyOfficialFusionDisplay,
} from "@shared/dailyForecast";
import type { DailyWeatherCodeSummary } from "@shared/dailyWeatherCode";
import { dailyConditionFromWmoWeatherCode } from "@shared/dailyWeatherCode";

export const OFFICIAL_FORECAST_TIME_ZONE = "Europe/Paris";

/** True only for a valid WMO code explicitly describing snow or snow showers. */
export function isSnowWmoWeatherCode(value: unknown): value is number {
  if (typeof value !== "number") return false;
  const condition = dailyConditionFromWmoWeatherCode(value);
  return condition === "Neige" || condition === "Averses de neige";
}

export type DailyForecastPoint = {
  date?: string | null;
  tempMax?: number | null;
  tempMin?: number | null;
  precipitation?: number | null;
  precipitationConsensus?: {
    thresholdMm?: number | null;
    rainModelCount?: number | null;
    availableModelCount?: number | null;
  } | null;
  windSpeed?: number | null;
  windGust?: number | null;
  windDirection?: number | null;
  humidity?: number | null;
  cloudCover?: number | null;
  condition?: string | null;
  weatherCode?: number | null;
  weatherCodeSummary?: DailyWeatherCodeSummary | null;
  uvIndex?: number | null;
  feelsLikeMax?: number | null;
  feelsLikeMin?: number | null;
  sunrise?: string | null;
  sunset?: string | null;
  officialFusion?: DailyOfficialFusionDisplay | null;
  bestMatchReference?: BestMatchDailyReference | null;
  modelAgreement?: DailyModelAgreement | null;
};

export type DailyForecastMetricSourceKey =
  | "tempMax"
  | "tempMin"
  | "precipitation"
  | "windSpeed"
  | "windGust"
  | "humidity"
  | "cloudCover";

export type DailyForecastDisplayMetric = {
  key: string;
  label: string;
  value: number | string | null | undefined;
  unit: string;
  precision: number;
  sourceKey?: DailyForecastMetricSourceKey;
};

export type ForecastDisplayDay<
  THour extends DatedForecastHour,
  TDay extends DailyForecastPoint,
> = {
  date: string;
  kind: "official-hourly" | "official-daily-fusion";
  hourlyGroup: ForecastDayGroup<THour> | null;
  daily: TDay | null;
};

function isValidDateKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** Date keys in the current official forecast contract are civil dates in Europe/Paris. */
export function getForecastDateKey(
  now: Date | number = Date.now(),
  timeZone = OFFICIAL_FORECAST_TIME_ZONE,
): string {
  const value = typeof now === "number" ? new Date(now) : now;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find(({ type }) => type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function getNextForecastDateKey(date: string): string {
  if (!isValidDateKey(date)) return date;
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function isFiniteValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatDailyTemperature(value: number): string {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} °C`;
}

/** Never substitutes an hourly value when a daily extreme is absent. */
export function getDailyExtremesDisplayLabel(
  day: DailyForecastPoint | null | undefined,
): string {
  const max = isFiniteValue(day?.tempMax) ? formatDailyTemperature(day.tempMax) : null;
  const min = isFiniteValue(day?.tempMin) ? formatDailyTemperature(day.tempMin) : null;
  if (!max && !min) return "Extrêmes journaliers indisponibles";
  return `Tmax ${max ?? "indisponible"} · Tmin ${min ?? "indisponible"}`;
}

/** Every meteorological field currently exposed by the daily DayForecast payload. */
export function getDailyForecastDisplayMetrics(
  day: DailyForecastPoint,
): DailyForecastDisplayMetric[] {
  return [
    { key: "tempMax", label: "Température maximale quotidienne", value: day.tempMax, unit: "°C", precision: 1, sourceKey: "tempMax" },
    { key: "tempMin", label: "Température minimale quotidienne", value: day.tempMin, unit: "°C", precision: 1, sourceKey: "tempMin" },
    { key: "precipitation", label: "Précipitations · cumul quotidien", value: day.precipitation, unit: "mm", precision: 1, sourceKey: "precipitation" },
    { key: "windSpeed", label: "Vent · maximum quotidien", value: day.windSpeed, unit: "km/h", precision: 0, sourceKey: "windSpeed" },
    { key: "windGust", label: "Rafales · maximum quotidien", value: day.windGust, unit: "km/h", precision: 0, sourceKey: "windGust" },
    { key: "windDirection", label: "Direction dominante du vent", value: day.windDirection, unit: "°", precision: 0 },
    { key: "humidity", label: "Humidité moyenne quotidienne", value: day.humidity, unit: "%", precision: 0, sourceKey: "humidity" },
    { key: "cloudCover", label: "Nébulosité moyenne quotidienne", value: day.cloudCover, unit: "%", precision: 0, sourceKey: "cloudCover" },
    { key: "condition", label: "Condition quotidienne", value: day.condition, unit: "", precision: 0 },
    { key: "weatherCode", label: "Code météo WMO quotidien", value: day.weatherCode, unit: "WMO", precision: 0 },
    { key: "uvIndex", label: "Indice UV quotidien", value: day.uvIndex, unit: "indice", precision: 1 },
    { key: "feelsLikeMax", label: "Température ressentie · maximum", value: day.feelsLikeMax, unit: "°C", precision: 1 },
    { key: "feelsLikeMin", label: "Température ressentie · minimum", value: day.feelsLikeMin, unit: "°C", precision: 1 },
    { key: "sunrise", label: "Lever du soleil", value: day.sunrise, unit: "", precision: 0 },
    { key: "sunset", label: "Coucher du soleil", value: day.sunset, unit: "", precision: 0 },
  ];
}

/**
 * Keeps the official hourly series authoritative for its own values. For explicitly
 * selected civil dates, daily payload values are attached as a separate source;
 * no hourly value is aggregated or substituted for a daily field.
 */
export function buildForecastDisplayDays<
  THour extends DatedForecastHour,
  TDay extends DailyForecastPoint,
>(
  hours: readonly THour[],
  dailyDays: readonly TDay[],
  maximumDays = 15,
  dailyDatesToShowAlongsideHourly: readonly string[] = [],
): ForecastDisplayDay<THour, TDay>[] {
  const byDate = new Map<
    string,
    {
      hourlyGroup: ForecastDayGroup<THour> | null;
      daily: TDay | null;
    }
  >();
  const includeDailyForHourlyDate = new Set(
    dailyDatesToShowAlongsideHourly.filter(isValidDateKey),
  );

  for (const group of groupOfficialHourlyForecastByDate(hours).days) {
    byDate.set(group.date, { hourlyGroup: group, daily: null });
  }
  for (const daily of dailyDays) {
    if (!isValidDateKey(daily.date)) continue;
    const current = byDate.get(daily.date);
    if (current?.hourlyGroup) {
      if (includeDailyForHourlyDate.has(daily.date)) current.daily = daily;
      continue;
    }
    byDate.set(daily.date, { hourlyGroup: null, daily });
  }

  const limit = Math.max(0, Math.min(15, Math.floor(maximumDays)));
  const result: ForecastDisplayDay<THour, TDay>[] = [];
  const dates = Array.from(byDate.keys())
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
  for (const date of dates) {
    const entry = byDate.get(date);
    if (!entry) continue;
    if (entry.hourlyGroup) {
      result.push({
        date,
        kind: "official-hourly",
        hourlyGroup: entry.hourlyGroup,
        daily: entry.daily,
      });
    } else if (entry.daily) {
      result.push({
        date,
        kind: "official-daily-fusion",
        hourlyGroup: null,
        daily: entry.daily,
      });
    }
  }
  return result;
}

/** Names Best Match as a separate derived reference, never an official contributor. */
export function getDailyReferenceSourceLabels(
  modelsUsed: readonly string[]
): string[] {
  return Array.from(
    new Set(
      modelsUsed
        .map(source => {
          const normalized = source
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "");
          return normalized === "openmeteo" || normalized === "bestmatch"
            ? "Best Match · référence dérivée, non contributeur officiel"
            : source.trim();
        })
        .filter(Boolean)
    )
  );
}
