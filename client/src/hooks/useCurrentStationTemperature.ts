import { trpc } from "@/lib/trpc";
import { formatCurrentStateProvenance } from "@/lib/dashboardPresentation";
import { getCurrentStationTemperature, type CurrentStationTemperature } from "@/lib/currentStationTemperature";

/**
 * Température actuelle mesurée par les stations physiques du lieu (Netatmo).
 *
 * La requête et ses options sont identiques à celles du dashboard : le cache
 * react-query est donc partagé, aucune requête supplémentaire n'est émise quand
 * les deux pages utilisent le même lieu.
 */
export function useCurrentStationTemperature(
  coordinates: { lat: number; lon: number },
): CurrentStationTemperature | null {
  const { data: currentDashboardWeather } = trpc.favorites.getCurrentDashboardWeather.useQuery(
    coordinates,
    { staleTime: 60 * 1000, refetchInterval: 5 * 60 * 1000, refetchOnWindowFocus: false, retry: 1 },
  );
  const field = currentDashboardWeather?.fields?.temperature ?? null;
  return getCurrentStationTemperature(field, field ? formatCurrentStateProvenance(field) : null);
}
