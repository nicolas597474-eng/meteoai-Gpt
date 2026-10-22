import { useMemo } from "react";
import type { ActiveLocation } from "@/contexts/LocationContext";
import { trpc } from "@/lib/trpc";
import { shouldRetryWeatherQuery, weatherRetryDelay } from "@/lib/weatherQueryRecovery";
import { getOfficialForecastQueryInput, OFFICIAL_FORECAST_REFETCH_INTERVAL_MS } from "@/lib/officialForecast";

export function useOfficialForecast(
  location: ActiveLocation | null | undefined,
  options: { includeExtendedPeriods?: boolean; enabled?: boolean } = {},
) {
  const includeExtendedPeriods = options.includeExtendedPeriods ?? false;
  const enabled = options.enabled ?? true;
  const queryInput = useMemo(
    () => getOfficialForecastQueryInput(location, includeExtendedPeriods),
    [location?.lat, location?.lon, includeExtendedPeriods],
  );
  const query = trpc.weather.getDetailedForecast.useQuery(queryInput, {
    trpc: { abortOnUnmount: true },
    enabled,
    staleTime: 60 * 1000,
    refetchInterval: OFFICIAL_FORECAST_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: shouldRetryWeatherQuery,
    retryDelay: weatherRetryDelay,
  });

  return {
    coordinates: { lat: queryInput.lat, lon: queryInput.lon },
    query,
  };
}
