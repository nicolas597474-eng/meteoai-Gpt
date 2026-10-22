export type ForecastFlowOperationalStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "STALE";

export type ForecastFlowStatus = {
  model: string;
  status: ForecastFlowOperationalStatus;
  reason: string;
  dailyCollected: boolean;
  hourlyCollected: boolean;
  collectedAt: Date | null;
  ageHours: number | null;
};

type BuildForecastFlowStatusesInput = {
  expectedModels: readonly string[];
  dailyCollectedModels?: readonly string[];
  hourlyCollectedModels?: readonly string[];
  collectedAt?: Date | string | null;
  now?: Date;
  staleAfterHours?: number;
};

export function buildForecastFlowStatuses({
  expectedModels,
  dailyCollectedModels = [],
  hourlyCollectedModels = [],
  collectedAt = null,
  now = new Date(),
  staleAfterHours = 30,
}: BuildForecastFlowStatusesInput): ForecastFlowStatus[] {
  const parsedCollectedAt = collectedAt == null ? null : new Date(collectedAt);
  const hasValidTimestamp = parsedCollectedAt != null && Number.isFinite(parsedCollectedAt.getTime());
  const ageHours = hasValidTimestamp
    ? Math.max(0, (now.getTime() - parsedCollectedAt.getTime()) / 3_600_000)
    : null;
  const isStale = ageHours != null && ageHours > staleAfterHours;
  const daily = new Set(dailyCollectedModels);
  const hourly = new Set(hourlyCollectedModels);

  return expectedModels.map((model) => {
    const dailyCollected = daily.has(model);
    const hourlyCollected = hourly.has(model);
    let status: ForecastFlowOperationalStatus;
    let reason: string;

    if (!hasValidTimestamp) {
      status = "FAILED";
      reason = "Aucun bilan archivé ne permet de vérifier ce flux.";
    } else if (isStale) {
      status = "STALE";
      reason = `Dernier bilan trop ancien (${Math.floor(ageHours ?? 0)} h, seuil ${staleAfterHours} h).`;
    } else if (dailyCollected && hourlyCollected) {
      status = "SUCCESS";
      reason = "Prévisions quotidienne et horaire archivées dans le dernier bilan.";
    } else if (dailyCollected || hourlyCollected) {
      status = "PARTIAL";
      reason = dailyCollected
        ? "Prévision quotidienne archivée ; prévision horaire absente."
        : "Prévision horaire archivée ; prévision quotidienne absente.";
    } else {
      status = "FAILED";
      reason = "Aucune prévision quotidienne ou horaire archivée dans le dernier bilan.";
    }

    return {
      model,
      status,
      reason,
      dailyCollected,
      hourlyCollected,
      collectedAt: hasValidTimestamp ? parsedCollectedAt : null,
      ageHours: ageHours == null ? null : Number(ageHours.toFixed(1)),
    };
  });
}
