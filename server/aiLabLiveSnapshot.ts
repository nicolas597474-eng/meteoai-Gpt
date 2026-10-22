import { computeOfficialDailyForecast } from "./officialForecast";
import type { ForecastData } from "./weatherServices";

export type LiveModelForecast = Pick<ForecastData,
  "serviceName" | "tempMax" | "tempMin" | "precipitation" | "windSpeed" | "windGust" | "humidity" | "cloudCover" | "condition"
> & Partial<Pick<ForecastData,
  "modelId" | "sourceName" | "runId" | "runIdKind" | "requestStartedAt" | "availableAt" | "validTime" | "qualityStatus"
>> & { serviceCategory?: ForecastData["serviceCategory"] | null; rawData?: unknown };

/**
 * Produces a non-persisted, inspectable fusion for an arbitrary geolocated
 * position. It uses the same availability-first official engine as saved places;
 * without exact saved-place evidence, available values remain visible with a
 * robust uncalibrated weight rather than borrowing a global performance score.
 */
export function buildLiveAILabSnapshot(
  date: string,
  forecasts: LiveModelForecast[],
  computedAt = new Date(),
) {
  if (forecasts.length === 0) return null;

  const fusion = computeOfficialDailyForecast(forecasts, {
    locationKey: `unsaved-live-position:${date}`,
    targetDate: date,
    issuedAt: computedAt.getTime(),
    evidenceStoreAvailable: true,
    evidence: [],
  });
  return {
    date,
    tempMax: fusion.tempMax,
    tempMin: fusion.tempMin,
    precipitation: fusion.precipitation,
    windSpeed: fusion.windSpeed,
    computedAt,
    weights: {
      version: 1,
      trigger: "live-position",
      weightByService: fusion.weights,
      trace: fusion.trace,
    },
  };
}
