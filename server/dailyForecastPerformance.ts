import type { ForecastRun, InsertForecastRun, InsertDailyForecastObservationComparison } from "../drizzle/schema";
import { OFFICIAL_HOURLY_MODELS, WEATHER_SERVICES, type ForecastData } from "./weatherServices";
import type { PhysicalSnapshot } from "./physicalObservationAggregation";
import type { DailyFusionMetric, ModelPerformanceEvidence } from "./fusionPerformance";
import { buildDailyForecastVerificationReadModel, getDailyForecastHorizon, isComparableDailyForecastObservationPair } from "./dailyForecastVerification";
export { getDailyForecastHorizon } from "./dailyForecastVerification";

const MODEL_SERVICES = new Map(WEATHER_SERVICES.expert.map((service) => [service.name, service]));
const OFFICIAL_DAILY_MODEL_BY_NAME = new Map<string, (typeof OFFICIAL_HOURLY_MODELS)[number]>(
  OFFICIAL_HOURLY_MODELS.map((model) => [model.name, model]),
);
function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function isOfficialDailyModel(serviceName: string, modelId: string | null | undefined): boolean {
  return OFFICIAL_DAILY_MODEL_BY_NAME.get(serviceName)?.modelId === modelId;
}

/** Derive every target-day row from the already-fetched 16-day provider payload. */
export function buildForecastRunArchiveRows(
  forecasts: ForecastData[],
  locationKey: string,
  requestedDate: string,
  issuedAt: number,
): InsertForecastRun[] {
  if (!Number.isFinite(issuedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return [];
  const rows: InsertForecastRun[] = [];

  for (const forecast of forecasts) {
    const service = MODEL_SERVICES.get(forecast.serviceName);
    if (!service || forecast.serviceCategory !== "expert") continue;
    // New captures store each model's actual response time. Older/non-diagnostic
    // callers retain their post-collection timestamp; historical rows are untouched.
    const modelAvailableAt = finiteOrNull(forecast.availableAt) ?? issuedAt;

    const raw = isRecord(forecast.rawData) ? forecast.rawData : null;
    const daily = raw && isRecord(raw.daily) ? raw.daily : null;
    const times = Array.isArray(daily?.time) ? daily.time : [];
    const hasDatedDailyPayload = times.some((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));

    if (hasDatedDailyPayload && daily) {
      for (let index = 0; index < times.length; index++) {
        const validDate = times[index];
        if (typeof validDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(validDate) || validDate < requestedDate) continue;
        rows.push({
          locationKey,
          validDate,
          serviceName: forecast.serviceName,
          provider: "open-meteo",
          modelId: service.modelId,
          sourceKind: "model_forecast",
          issuedAt: modelAvailableAt,
          tempMax: finiteOrNull(daily.temperature_2m_max?.[index]),
          tempMin: finiteOrNull(daily.temperature_2m_min?.[index]),
          precipitation: finiteOrNull(daily.precipitation_sum?.[index]),
          windSpeed: finiteOrNull(daily.wind_speed_10m_max?.[index]),
          windGust: finiteOrNull(daily.wind_gusts_10m_max?.[index]),
          humidity: finiteOrNull(daily.relative_humidity_2m_mean?.[index]),
          cloudCover: finiteOrNull(daily.cloud_cover_mean?.[index]),
          condition: validDate === requestedDate ? forecast.condition : null,
          // Keep the full provider payload once per emission, not once per target date.
          rawData: validDate === requestedDate ? forecast.rawData as any : null,
        });
      }
      continue;
    }

    // Older mocks or provider responses without a dated daily array remain current-day only.
    rows.push({
      locationKey,
      validDate: requestedDate,
      serviceName: forecast.serviceName,
      provider: "open-meteo",
      modelId: service.modelId,
      sourceKind: "model_forecast",
      issuedAt: modelAvailableAt,
      tempMax: finiteOrNull(forecast.tempMax),
      tempMin: finiteOrNull(forecast.tempMin),
      precipitation: finiteOrNull(forecast.precipitation),
      windSpeed: finiteOrNull(forecast.windSpeed),
      windGust: finiteOrNull(forecast.windGust),
      humidity: finiteOrNull(forecast.humidity),
      cloudCover: finiteOrNull(forecast.cloudCover),
      condition: forecast.condition,
      rawData: forecast.rawData as any,
    });
  }
  return rows;
}

/**
 * Create strict comparison rows only when the immutable forecast was available
 * before every source-station measurement contributing to the daily value.
 */
export function buildDailyForecastObservationComparisons(
  locationKey: string,
  validDate: string,
  forecasts: ForecastRun[],
  snapshots: PhysicalSnapshot[],
): InsertDailyForecastObservationComparison[] {
  return buildDailyForecastVerificationReadModel(locationKey, validDate, forecasts, snapshots).pairs
    .map(({ forecastIssuedAt: _forecastIssuedAt, ...row }) => row);
}

type StoredComparison = InsertDailyForecastObservationComparison;

/** Aggregate by model/location/variable/horizon, with valid dates as independent units. */
export function aggregateDailyForecastPerformance(rows: StoredComparison[]): ModelPerformanceEvidence[] {
  const groups = new Map<string, StoredComparison[]>();
  for (const row of rows) {
    if (row.evidenceType !== "physical_observation" || row.observationIsQualified !== 1
      || !isOfficialDailyModel(row.serviceName, row.modelId)
      || !isComparableDailyForecastObservationPair(row)) continue;
    const key = [row.locationKey, row.serviceName, row.modelId, row.variable, row.horizonBucket].join("\u001f");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const evidence: ModelPerformanceEvidence[] = [];
  for (const group of Array.from(groups.values())) {
    const days = new Map<string, Array<{ absoluteError: number; squaredError: number; signedError: number }>>();
    for (const row of group) {
      const forecast = finiteOrNull(row.forecastValue);
      const observed = finiteOrNull(row.observedValue);
      if (forecast == null || observed == null || !/^\d{4}-\d{2}-\d{2}$/.test(row.validDate)) continue;
      const error = forecast - observed;
      const values = days.get(row.validDate) ?? [];
      values.push({ absoluteError: Math.abs(error), squaredError: error * error, signedError: error });
      days.set(row.validDate, values);
    }
    if (days.size === 0) continue;

    const dailyScores = Array.from(days.entries()).map(([date, values]) => ({
      date,
      mae: values.reduce((sum, item) => sum + item.absoluteError, 0) / values.length,
      mse: values.reduce((sum, item) => sum + item.squaredError, 0) / values.length,
      signedBias: values.reduce((sum, item) => sum + item.signedError, 0) / values.length,
    }));
    const mae = dailyScores.reduce((sum, item) => sum + item.mae, 0) / dailyScores.length;
    const rmse = Math.sqrt(dailyScores.reduce((sum, item) => sum + item.mse, 0) / dailyScores.length);
    const signedBias = dailyScores.reduce((sum, item) => sum + item.signedBias, 0) / dailyScores.length;
    const variance = dailyScores.length > 1
      ? dailyScores.reduce((sum, item) => sum + (item.mae - mae) ** 2, 0) / (dailyScores.length - 1)
      : 0;
    const sampleSize = dailyScores.length;
    const latestScoreDate = dailyScores.reduce((latest, item) => item.date > latest ? item.date : latest, "");
    const first = group[0];
    evidence.push({
      locationKey: first.locationKey,
      serviceName: first.serviceName,
      modelId: first.modelId,
      variable: first.variable,
      horizonBucket: first.horizonBucket,
      comparisonCount: dailyScores.reduce((sum, item) => sum + (days.get(item.date)?.length ?? 0), 0),
      sampleSize,
      evaluatedDays: sampleSize,
      mae,
      rmse,
      standardError: sampleSize > 1 ? Math.sqrt(variance / sampleSize) : 0,
      signedBias,
      latestScoreDate,
    });
  }
  return evidence;
}
