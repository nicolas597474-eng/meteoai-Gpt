import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "@/contexts/LocationContext";
import { getOfficialForecastQueryInput } from "@/lib/officialForecast";
import { shouldRetryWeatherQuery, weatherRetryDelay } from "@/lib/weatherQueryRecovery";

/**
 * Précharge la réponse « Prévisions » avec exactement la même clé de requête et
 * les mêmes options que useOfficialForecast({ includeExtendedPeriods: true }).
 * Au montage de la page, React Query sert alors la réponse du cache au lieu de
 * réexécuter la requête : plus de squelette « Chargement des prévisions » tant
 * qu'une réponse réelle existe déjà. La requête serveur reste inchangée et
 * aucune donnée n'est inventée ni substituée.
 */
export function useDetailedForecastPrefetch() {
  const utils = trpc.useUtils();
  const { activeLocation } = useLocation();

  return useCallback(() => {
    void utils.weather.getDetailedForecast
      .prefetch(getOfficialForecastQueryInput(activeLocation, true), {
        staleTime: 60 * 1000,
        retry: shouldRetryWeatherQuery,
        retryDelay: weatherRetryDelay,
      })
      .catch(() => undefined);
  }, [utils, activeLocation]);
}
