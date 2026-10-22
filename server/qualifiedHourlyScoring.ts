import { calculateReliabilityScore } from "./statsEngine";

type PhysicalSnapshot = {
  hour: number;
  stationCount: number;
  temperature: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGust?: number | null;
  humidity?: number | null;
  pressure?: number | null;
};
type HourlyForecast = {
  modelName: string;
  hour: number;
  temperature: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGusts?: number | null;
  humidity?: number | null;
  pressure?: number | null;
};

export type QualifiedHourlyModelScore = {
  serviceName: string;
  sampleSize: number;
  maeTemp: number | null;
  rmseTemp: number | null;
  biasTemp: number | null;
  maePrecip: number | null;
  rmsePrecip: number | null;
  precipScore: number | null;
  precipPod: number | null;
  precipFar: number | null;
  precipCsi: number | null;
  precipFalsePositives: number | null;
  precipFalseNegatives: number | null;
  maeWind: number | null;
  rmseWind: number | null;
  windScore: number | null;
  windMaeGusts: number | null;
  weightedScore: number | null;
  normalizedScore: number | null;
  humidityScore: number | null;
  humidityMae: number | null;
  humidityRmse: number | null;
  humidityBias: number | null;
  pressureScore: number | null;
  pressureMae: number | null;
  pressureRmse: number | null;
  pressureBias: number | null;
};

const MINIMUM_ALIGNED_HOURS = 18;

/** Scores only exist where an archived model hour and at least one qualified physical field coincide. */
export function scoreQualifiedHourlyModels(snapshots: PhysicalSnapshot[], forecasts: HourlyForecast[]): QualifiedHourlyModelScore[] {
  const physicalByHour = new Map(snapshots.filter((snapshot) => snapshot.stationCount > 0 && [
    snapshot.temperature,
    snapshot.precipitation,
    snapshot.windSpeed,
    snapshot.windGust,
    snapshot.humidity,
    snapshot.pressure,
  ].some((value) => typeof value === "number" && Number.isFinite(value))).map((snapshot) => [snapshot.hour, snapshot]));
  const grouped = new Map<string, HourlyForecast[]>();
  for (const forecast of forecasts) grouped.set(forecast.modelName, [...(grouped.get(forecast.modelName) ?? []), forecast]);

  return Array.from(grouped.entries()).flatMap(([serviceName, rows]) => {
    const pairs = rows.flatMap((forecast) => {
      const observation = physicalByHour.get(forecast.hour);
      return observation ? [{ forecast, observation }] : [];
    });
    if (pairs.length < MINIMUM_ALIGNED_HOURS) return [];
    const score = calculateReliabilityScore(
      pairs.map(({ forecast }) => ({
        tempMax: forecast.temperature,
        tempMin: forecast.temperature,
        precipitation: forecast.precipitation,
        windSpeed: forecast.windSpeed,
        windGust: forecast.windGusts ?? null,
        humidity: forecast.humidity ?? null,
        pressure: forecast.pressure ?? null,
      })),
      pairs.map(({ observation }) => ({
        tempMax: observation.temperature,
        tempMin: observation.temperature,
        precipitation: observation.precipitation,
        windSpeed: observation.windSpeed,
        windGust: observation.windGust ?? null,
        humidity: observation.humidity ?? null,
        pressure: observation.pressure ?? null,
      })),
    );
    return [{
      serviceName,
      sampleSize: pairs.length,
      maeTemp: score.dimensions.temperature.sampleSize > 0 ? score.maeTemp : null,
      rmseTemp: score.dimensions.temperature.sampleSize > 0 ? score.rmseTemp : null,
      biasTemp: score.dimensions.temperature.sampleSize > 0 ? score.biasTemp : null,
      maePrecip: score.dimensions.precipitation.sampleSize > 0 ? score.maePrecip : null,
      rmsePrecip: score.dimensions.precipitation.sampleSize > 0 ? score.rmsePrecip : null,
      precipScore: score.dimensions.precipitation.score,
      precipPod: score.dimensions.precipitation.sampleSize > 0 ? score.dimensions.precipitation.pod : null,
      precipFar: score.dimensions.precipitation.sampleSize > 0 ? score.dimensions.precipitation.far : null,
      precipCsi: score.dimensions.precipitation.sampleSize > 0 ? score.dimensions.precipitation.csi : null,
      precipFalsePositives: score.dimensions.precipitation.sampleSize > 0 ? score.dimensions.precipitation.falsePositives : null,
      precipFalseNegatives: score.dimensions.precipitation.sampleSize > 0 ? score.dimensions.precipitation.falseNegatives : null,
      maeWind: score.dimensions.wind.sampleSize > 0 ? score.maeWind : null,
      rmseWind: score.dimensions.wind.sampleSize > 0 ? score.rmseWind : null,
      windScore: score.dimensions.wind.score,
      windMaeGusts: score.laboratory.gusts.sampleSize > 0 ? score.laboratory.gusts.mae : null,
      weightedScore: score.weightedScore,
      normalizedScore: score.normalizedScore,
      humidityScore: score.laboratory.humidity.score,
      humidityMae: score.laboratory.humidity.sampleSize > 0 ? score.laboratory.humidity.mae : null,
      humidityRmse: score.laboratory.humidity.sampleSize > 0 ? score.laboratory.humidity.rmse : null,
      humidityBias: score.laboratory.humidity.sampleSize > 0 ? score.laboratory.humidity.bias : null,
      pressureScore: score.laboratory.pressure.score,
      pressureMae: score.laboratory.pressure.sampleSize > 0 ? score.laboratory.pressure.mae : null,
      pressureRmse: score.laboratory.pressure.sampleSize > 0 ? score.laboratory.pressure.rmse : null,
      pressureBias: score.laboratory.pressure.sampleSize > 0 ? score.laboratory.pressure.bias : null,
    }];
  });
}
