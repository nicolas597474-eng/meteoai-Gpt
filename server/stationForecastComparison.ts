import type { HourlyPoint } from "./weatherServices";
import type { StationMeasurementTimes } from "./stationMeasurementFreshness";

const HOUR_MS = 60 * 60 * 1000;

export type StationForecastReading = {
  observedAt: number | Date | string;
  temperature: number | null;
  windSpeed: number | null;
  precipitation: number | null;
};

export type StationForecastComparisonPoint = {
  hour: number;
  label: string;
  validAt: number | null;
  stationTemperature: number | null;
  stationWindSpeed: number | null;
  stationPrecipitation: number | null;
  stationSampleCount: number;
  officialTemperature: number | null;
  officialWindSpeed: number | null;
  officialPrecipitation: number | null;
};

function toEpoch(value: number | Date | string): number | null {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 10) / 10 : null;
}

/** No archive-time substitution; a rain accumulation needs an attested one-hour period. */
export function qualifyStationForecastReadings(
  readings: readonly (StationForecastReading & { measurementTimes?: StationMeasurementTimes | null; precipitationPeriodHours?: number | null })[],
  now = Date.now(),
): StationForecastReading[] {
  return readings.flatMap(reading => {
    const archivedAt = toEpoch(reading.observedAt);
    const groups = new Map<number, StationForecastReading>();
    for (const field of ["temperature", "windSpeed", "precipitation"] as const) {
      if (field === "precipitation" && reading.precipitationPeriodHours !== 1) continue;
      const raw = reading.measurementTimes?.[field];
      const at = typeof raw === "string" ? Date.parse(raw) : NaN;
      if (!Number.isFinite(at) || archivedAt == null || at > archivedAt || at > now || reading[field] == null || !Number.isFinite(reading[field])) continue;
      const key = Math.floor(at / HOUR_MS) * HOUR_MS;
      const point = groups.get(key) ?? { observedAt: at, temperature: null, windSpeed: null, precipitation: null };
      point[field] = reading[field];
      groups.set(key, point);
    }
    return Array.from(groups.values());
  });
}

function getLocalHour(hour: string): number | null {
  const match = hour.match(/^(\d{1,2}):/);
  return match ? Number(match[1]) : null;
}

function repeatedHourLabel(hour: number, validAt: number): string {
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(validAt)).find((part) => part.type === "timeZoneName")?.value;
  return `${String(hour).padStart(2, "0")}h (${offset?.replace(/^GMT/, "UTC") ?? "heure de Paris"})`;
}

/** Aligns observation and official model values to the same absolute UTC hour. */
export function buildStationForecastComparison24h(
  targetDate: string,
  officialHours: readonly HourlyPoint[],
  stationReadings: readonly StationForecastReading[],
): StationForecastComparisonPoint[] {
  const readingsByValidAt = new Map<number, StationForecastReading[]>();
  for (const reading of stationReadings) {
    const observedAt = toEpoch(reading.observedAt);
    if (observedAt == null) continue;
    const validAt = Math.floor(observedAt / HOUR_MS) * HOUR_MS;
    const readings = readingsByValidAt.get(validAt) ?? [];
    readings.push(reading);
    readingsByValidAt.set(validAt, readings);
  }

  const forecastsByHour = new Map<number, Array<{ forecast: HourlyPoint; validAt: number }>>();
  for (const forecast of officialHours) {
    const validAt = forecast.validAt;
    if (forecast.date !== targetDate || typeof validAt !== "number" || !Number.isFinite(validAt)) continue;
    const hour = getLocalHour(forecast.hour);
    if (hour == null || hour < 0 || hour > 23) continue;
    const forecasts = forecastsByHour.get(hour) ?? [];
    forecasts.push({ forecast, validAt });
    forecastsByHour.set(hour, forecasts);
  }
  forecastsByHour.forEach((forecasts) => forecasts.sort((left, right) => left.validAt - right.validAt));

  return Array.from({ length: 24 }, (_, hour) => {
    const forecasts = forecastsByHour.get(hour) ?? [];
    if (forecasts.length === 0) {
      return [{
        hour,
        label: `${String(hour).padStart(2, "0")}h`,
        validAt: null,
        stationTemperature: null,
        stationWindSpeed: null,
        stationPrecipitation: null,
        stationSampleCount: 0,
        officialTemperature: null,
        officialWindSpeed: null,
        officialPrecipitation: null,
      }];
    }
    return forecasts.map(({ forecast, validAt }) => {
      const readings = readingsByValidAt.get(validAt) ?? [];
      const label = forecasts.length > 1 ? repeatedHourLabel(hour, validAt) : `${String(hour).padStart(2, "0")}h`;
      return {
        hour,
        label,
        validAt,
        stationTemperature: average(readings.map((reading) => reading.temperature)),
        stationWindSpeed: average(readings.map((reading) => reading.windSpeed)),
        stationPrecipitation: average(readings.map((reading) => reading.precipitation)),
        stationSampleCount: readings.length,
        officialTemperature: forecast.temp,
        officialWindSpeed: forecast.windSpeed,
        officialPrecipitation: forecast.precipitation,
      };
    });
  }).flat();
}
