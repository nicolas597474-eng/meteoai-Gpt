import {
  clearPersonalModelCalibrations,
  getAllPersonalWeatherObservations,
  getPersonalModelObservationScores,
  replacePersonalModelObservationScores,
  upsertPersonalModelCalibration,
} from "./db";
import { scorePersonalModelObservation, updatePersonalCalibration, type PersonalCondition } from "./personalCalibration";

type StoredForecastSnapshot = { temperature: number | null; windSpeed: number | null; precipitation: number | null; weatherCode: number | null; cloudCover: number | null };

function parseSnapshot(value: unknown): StoredForecastSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<StoredForecastSnapshot>;
  return {
    temperature: typeof snapshot.temperature === "number" ? snapshot.temperature : null,
    windSpeed: typeof snapshot.windSpeed === "number" ? snapshot.windSpeed : null,
    precipitation: typeof snapshot.precipitation === "number" ? snapshot.precipitation : null,
    weatherCode: typeof snapshot.weatherCode === "number" ? snapshot.weatherCode : null,
    cloudCover: typeof snapshot.cloudCover === "number" ? snapshot.cloudCover : null,
  };
}

/** Reconstruit les scores dans l’ordre chronologique après toute correction. */
export async function rebuildPersonalCalibration(userId: number, locationKey: string) {
  const observations = await getAllPersonalWeatherObservations(userId, locationKey);
  const existingScores = await getPersonalModelObservationScores(observations.map((observation) => observation.id));
  const scoresByObservation = new Map<number, typeof existingScores>();
  for (const score of existingScores) scoresByObservation.set(score.observationId, [...(scoresByObservation.get(score.observationId) ?? []), score]);
  const calibrationByModel = new Map<string, ReturnType<typeof updatePersonalCalibration>>();
  const rebuiltScores = [] as Parameters<typeof replacePersonalModelObservationScores>[1];

  for (const observation of observations) {
    for (const storedScore of scoresByObservation.get(observation.id) ?? []) {
      const snapshot = parseSnapshot(storedScore.forecastSnapshot);
      if (!snapshot) continue;
      const result = scorePersonalModelObservation({
        temperature: observation.temperature,
        condition: observation.condition as PersonalCondition,
        windSpeed: observation.windSpeed,
        precipitation: observation.precipitation,
      }, snapshot);
      if (result.overallScore == null) continue;
      const updated = updatePersonalCalibration(calibrationByModel.get(storedScore.modelName), result);
      calibrationByModel.set(storedScore.modelName, updated);
      rebuiltScores.push({
        observationId: observation.id,
        modelName: storedScore.modelName,
        temperatureError: result.temperatureError,
        temperatureScore: result.temperatureScore,
        conditionScore: result.conditionScore,
        precipitationError: result.precipitationError,
        precipitationScore: result.precipitationScore,
        windScore: result.windScore,
        overallScore: result.overallScore,
        forecastSnapshot: { ...snapshot, forecastCondition: result.forecastCondition },
      });
    }
  }

  await replacePersonalModelObservationScores(observations.map((observation) => observation.id), rebuiltScores);
  await clearPersonalModelCalibrations(userId, locationKey);
  for (const [modelName, calibration] of Array.from(calibrationByModel.entries())) {
    const lastObservation = observations[observations.length - 1];
    if (!lastObservation) continue;
    await upsertPersonalModelCalibration({ userId, locationKey, modelName, ...calibration, lastObservationAt: lastObservation.observedAt });
  }
  return { observationCount: observations.length, modelCount: calibrationByModel.size };
}
