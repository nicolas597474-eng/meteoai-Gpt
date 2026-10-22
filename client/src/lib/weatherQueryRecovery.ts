export const WEATHER_QUERY_SLOW_MS = 8_000;

export function isRetriableWeatherError(error: unknown): boolean {
  const candidate = error as { data?: { code?: string }; message?: string } | null;
  const code = candidate?.data?.code;
  if (code && ["TIMEOUT", "INTERNAL_SERVER_ERROR", "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "TOO_MANY_REQUESTS"].includes(code)) {
    return true;
  }
  return /timeout|délai|network|réseau|fetch|aborted|temporar/i.test(candidate?.message ?? "");
}

export function shouldRetryWeatherQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && isRetriableWeatherError(error);
}

export function weatherRetryDelay(attemptIndex: number): number {
  return Math.min(800 * 2 ** attemptIndex, 4_000);
}
