export type ForecastRunDisplayStatus = "pending" | "running" | "completed" | "partial" | "failed";

export function getForecastRunDisplayStatus(job: {
  status: "pending" | "running" | "completed" | "failed";
  errorMessage?: string | null;
  dailyModelsCollected?: number | null;
  dailyModelsExpected?: number | null;
  hourlyModelsCollected?: number | null;
  hourlyModelsExpected?: number | null;
}): ForecastRunDisplayStatus {
  if (job.status !== "completed") return job.status;
  const incompleteDailyCoverage = (job.dailyModelsExpected ?? 0) > 0
    && (job.dailyModelsCollected ?? 0) < (job.dailyModelsExpected ?? 0);
  const incompleteHourlyCoverage = (job.hourlyModelsExpected ?? 0) > 0
    && (job.hourlyModelsCollected ?? 0) < (job.hourlyModelsExpected ?? 0);
  return job.errorMessage || incompleteDailyCoverage || incompleteHourlyCoverage ? "partial" : "completed";
}
