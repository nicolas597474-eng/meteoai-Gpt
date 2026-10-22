import type { OfficialWeatherSnapshot } from "./officialWeatherSnapshot";
import type { HourlyFusionTrace, HourlyPrecipitationAgreementTrace } from "../shared/hourlyModelMetrics";

function projectHourlyWeighting(point: OfficialWeatherSnapshot["hourly"][number]): HourlyFusionTrace | null {
  const weighting = point.forecastWeighting;
  if (!weighting || !Array.isArray(weighting.variableWeightings)) return null;
  return {
    method: weighting.method,
    availabilityStatus: weighting.availabilityStatus,
    calibrationStatus: weighting.calibrationStatus,
    expectedModelCount: weighting.expectedModelCount,
    availableModelCount: weighting.availableModelCount,
    contributingModelCount: weighting.contributingModelCount,
    horizonBucket: weighting.horizonBucket,
    modelsWithData: [...weighting.modelsWithData],
    variableWeightings: weighting.variableWeightings.map((variable) => ({
      variable: variable.variable,
      method: variable.method,
      selectionStrategy: variable.selectionStrategy,
      selectedModelName: variable.selectedModelName,
      selectionEvidenceBasis: variable.selectionEvidenceBasis,
      selectionReason: variable.selectionReason,
      horizonBucket: variable.horizonBucket,
      availabilityStatus: variable.availabilityStatus,
      calibrationStatus: variable.calibrationStatus,
      expectedModelCount: variable.expectedModelCount,
      availableModelCount: variable.availableModelCount,
      evidenceEligibleModelCount: variable.evidenceEligibleModelCount,
      contributingModelCount: variable.contributingModelCount,
      coverageLevel: variable.coverageLevel,
      modelReasons: variable.modelReasons.map((reason) => ({ ...reason })),
      modelWeights: variable.modelWeights.map((model) => ({
        modelName: model.modelName,
        modelId: model.modelId,
        sourceName: model.sourceName,
        runId: model.runId,
        runIdKind: model.runIdKind,
        requestStartedAt: model.requestStartedAt,
        availableAt: model.availableAt,
        validTime: model.validTime,
        horizonMinutes: model.horizonMinutes,
        horizonBucket: model.horizonBucket,
        value: model.value,
        reliability: model.reliability,
        historicalScore: model.historicalScore,
        calibrationLevel: model.calibrationLevel,
        calibrationStatus: model.calibrationStatus,
        rawWeight: model.rawWeight,
        robustFallbackWeight: model.robustFallbackWeight,
        weight: model.weight,
        contributedToValue: model.contributedToValue,
        ...(model.historicalEvidence ? {
          historicalEvidence: {
            status: model.historicalEvidence.status,
            minimumComparisons: model.historicalEvidence.minimumComparisons,
            minimumComparableDays: model.historicalEvidence.minimumComparableDays,
            latestScoreDate: model.historicalEvidence.latestScoreDate,
            latestComputedAt: model.historicalEvidence.latestComputedAt,
          },
        } : {}),
        ...(model.exactHorizonEvidence ? {
          exactHorizonEvidence: {
            status: model.exactHorizonEvidence.status,
            metrics: model.exactHorizonEvidence.metrics,
            minimumComparisons: model.exactHorizonEvidence.minimumComparisons,
            minimumComparableDays: model.exactHorizonEvidence.minimumComparableDays,
            latestScoreDate: model.exactHorizonEvidence.latestScoreDate,
            latestComputedAt: model.exactHorizonEvidence.latestComputedAt,
          },
        } : {}),
      })),
    })),
  };
}

export function formatAILabLocationLabel(coordinates: { lat: number; lon: number } | null): string {
  if (!coordinates) return "le lieu sélectionné";
  const latitude = `${Math.abs(coordinates.lat).toFixed(4)}°${coordinates.lat >= 0 ? "N" : "S"}`;
  const longitude = `${Math.abs(coordinates.lon).toFixed(4)}°${coordinates.lon >= 0 ? "E" : "O"}`;
  return `le point demandé (${latitude}, ${longitude})`;
}

/**
 * Narrow, read-only projection for the AI Lab comparison panel. All three
 * products come from one resolved official snapshot and one location.
 */
export function buildAILabForecastComparisonReadModel(
  snapshot: OfficialWeatherSnapshot,
  coordinates: { lat: number; lon: number },
) {
  return {
    timeZone: "Europe/Paris" as const,
    coordinates: { lat: coordinates.lat, lon: coordinates.lon },
    assembledAt: snapshot.computedAt,
    currentSnapshotSource: {
      sourceKind: "model_current_snapshot" as const,
      source: "open-meteo" as const,
    },
    currentSnapshot: snapshot.currentSnapshot
      ? {
          sourceKind: snapshot.currentSnapshot.sourceKind,
          source: snapshot.currentSnapshot.source,
          capturedAt: snapshot.currentSnapshot.capturedAt,
          temp: Number.isFinite(snapshot.currentSnapshot.temp) ? snapshot.currentSnapshot.temp : null,
        }
      : null,
    hourlyForecast: {
      sourceKind: snapshot.sourceKind,
      source: snapshot.source,
      computedAt: snapshot.hourlyComputedAt,
      modelsConsidered: [...snapshot.hourlyWeighting.modelsConsidered],
      bestMatchIncluded: snapshot.hourlyWeighting.bestMatchIncluded,
      points: snapshot.hourly.map((point) => ({
        date: point.date ?? null,
        hour: point.hour,
        validAt: Number.isFinite(point.validAt) ? point.validAt ?? null : null,
        temp: Number.isFinite(point.temp) ? point.temp : null,
        finalValues: [
          { variable: "temperature", value: typeof point.temp === "number" && Number.isFinite(point.temp) ? point.temp : null, unit: "°C" },
          { variable: "apparent_temperature", value: typeof point.apparentTemp === "number" && Number.isFinite(point.apparentTemp) ? point.apparentTemp : null, unit: "°C" },
          { variable: "precipitation", value: typeof point.precipitation === "number" && Number.isFinite(point.precipitation) ? point.precipitation : null, unit: "mm" },
          { variable: "wind_speed", value: typeof point.windSpeed === "number" && Number.isFinite(point.windSpeed) ? point.windSpeed : null, unit: "km/h" },
          { variable: "wind_direction", value: typeof point.windDirection === "number" && Number.isFinite(point.windDirection) ? point.windDirection : null, unit: "°" },
          { variable: "wind_gust", value: typeof point.windGust === "number" && Number.isFinite(point.windGust) ? point.windGust : null, unit: "km/h" },
          { variable: "humidity", value: typeof point.humidity === "number" && Number.isFinite(point.humidity) ? point.humidity : null, unit: "%" },
          { variable: "pressure", value: typeof point.pressure === "number" && Number.isFinite(point.pressure) ? point.pressure : null, unit: "hPa" },
          { variable: "cloud_cover", value: typeof point.cloudCover === "number" && Number.isFinite(point.cloudCover) ? point.cloudCover : null, unit: "%" },
          { variable: "weather_code", value: typeof point.weatherCode === "number" && Number.isFinite(point.weatherCode) ? point.weatherCode : null, unit: "WMO" },
        ],
        modelsWithData: [...(point.forecastWeighting?.modelsWithData ?? [])],
        weighting: projectHourlyWeighting(point),
        precipitationAgreement: (point.multiModelMetrics?.precipitation ?? null) as HourlyPrecipitationAgreementTrace | null,
      })),
    },
    dailyForecast: {
      source: "open-meteo" as const,
      computedAt: snapshot.computedAt,
      modelsUsed: [...snapshot.modelsUsed],
      days: snapshot.daily.map((day) => ({
        date: day.date,
        tempMax: Number.isFinite(day.tempMax) ? day.tempMax : null,
        tempMin: Number.isFinite(day.tempMin) ? day.tempMin : null,
      })),
    },
  };
}
