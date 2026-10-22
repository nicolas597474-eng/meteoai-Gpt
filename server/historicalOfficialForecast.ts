import type { HourlyForecastRunValue } from "../drizzle/schema";
import { computeOfficialHourlyForecast, reconstructOfficialHourlyModelsFromArchive, type OfficialHourlyEvaluationHistoryScore } from "./officialHourlyForecast";
import { getParisDate } from "./weatherTime";
import type { LocalHistoryReading, AvailableOfficialHourlyTemperaturePoint } from "./localOfficialHistory";

type HistoricalScore = OfficialHourlyEvaluationHistoryScore & { computedAt: Date | string };
/** Reconstruct each hour only with runs and calibration actually available before validity. */
export function reconstructHistoricalOfficialHours(
 validTimes: readonly number[], rows: readonly HourlyForecastRunValue[], scores: readonly HistoricalScore[],
) {
 return Array.from(new Set(validTimes.filter(Number.isFinite))).flatMap(validAt => {
  const eligibleRows = rows.filter(row => row.validTime === validAt && Number.isFinite(row.availableAt) && row.availableAt < validAt);
  if (!eligibleRows.length) return [];
  const models = reconstructOfficialHourlyModelsFromArchive(eligibleRows, getParisDate(new Date(validAt)));
  if (!models.length || models.some(model => model.availableAt == null || !Number.isFinite(model.availableAt))) return [];
  const availableAt = Math.max(...models.map(model => model.availableAt!));
  const eligibleScores = scores.filter(score => {
   const computed = score.computedAt instanceof Date ? score.computedAt.getTime() : Date.parse(String(score.computedAt));
   return Number.isFinite(computed) && computed < availableAt;
  });
  const official = computeOfficialHourlyForecast(models, eligibleScores, { historyAvailable: eligibleScores.length > 0 });
  const hour = official.hours.find(point => point.validAt === validAt);
  return hour ? [{ hour, availableAt }] : [];
 });
}
/** Historical temperature projection; never a retroactive use of the latest live run. */
export function reconstructHistoricalOfficialTemperatures(
 readings: readonly LocalHistoryReading[], rows: readonly HourlyForecastRunValue[], scores: readonly HistoricalScore[],
): AvailableOfficialHourlyTemperaturePoint[] {
 const validTimes = readings.filter(r => r.temperature != null && Number.isFinite(r.temperature) && Number.isFinite(r.observedAt)).map(r => Math.floor(r.observedAt / 3_600_000) * 3_600_000);
 return reconstructHistoricalOfficialHours(validTimes, rows, scores).flatMap(({hour, availableAt}) =>
  hour.temp != null && Number.isFinite(hour.temp) ? [{validAt: hour.validAt!, temperature: hour.temp, availableAt}] : [],
 );
}
