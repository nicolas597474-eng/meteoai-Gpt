import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "@/contexts/LocationContext";
import { shouldRetryWeatherQuery, weatherRetryDelay } from "@/lib/weatherQueryRecovery";

const RELIABILITY_STALE_TIME_MS = 2 * 60 * 1000;
const FORECAST_STALE_TIME_MS = 60 * 1000;

/**
 * Précharge en arrière-plan, quand le navigateur devient inactif, les requêtes
 * que la page Fiabilité lance à l'ouverture : audit (période 7 jours, horizon
 * 6–24 h), vue d'ensemble des stations, comparaison d'hier et ciel de page.
 * Les clés et options sont strictement celles de la page : à l'ouverture,
 * React Query sert le cache au lieu d'attendre chaque réponse serveur.
 * Aucune requête ni donnée n'est modifiée — elles partent simplement plus tôt.
 */
export function ReliabilityLabPreloader() {
  const utils = trpc.useUtils();
  const { activeLocation } = useLocation();
  const lat = activeLocation?.lat ?? 50.7567;
  const lon = activeLocation?.lon ?? 2.5204;
  useEffect(() => {
    let cancelled = false;
    let idleCallbackId: number | null = null;
    let idleTimeoutId: number | null = null;

    const prefetch = () => {
      if (cancelled) return;
      void utils.weather.getReliabilityLaboratory
        .prefetch(
          { lat, lon, period: "7d" as const, horizon: "6-24h" as const },
          { staleTime: RELIABILITY_STALE_TIME_MS },
        )
        .catch(() => undefined);
      void utils.weather.getYesterdayForecastObservation
        .prefetch({ lat, lon }, { staleTime: RELIABILITY_STALE_TIME_MS })
        .catch(() => undefined);
      void utils.weather.getDetailedForecast
        .prefetch(
          { lat, lon, includeExtendedPeriods: false },
          {
            staleTime: FORECAST_STALE_TIME_MS,
            retry: shouldRetryWeatherQuery,
            retryDelay: weatherRetryDelay,
          },
        )
        .catch(() => undefined);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleCallbackId = window.requestIdleCallback(prefetch, { timeout: 2500 });
    } else {
      idleTimeoutId = window.setTimeout(prefetch, 1500);
    }

    return () => {
      cancelled = true;
      if (idleCallbackId !== null) window.cancelIdleCallback(idleCallbackId);
      if (idleTimeoutId !== null) window.clearTimeout(idleTimeoutId);
    };
  }, [utils, lat, lon]);

  return null;
}
