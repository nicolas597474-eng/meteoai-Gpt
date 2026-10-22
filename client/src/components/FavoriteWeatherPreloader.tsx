import { useEffect, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "@/contexts/LocationContext";
import { trpc } from "@/lib/trpc";

const DAILY_FORECAST_STALE_TIME_MS = 5 * 60_000;

/**
 * Warm scheduled forecast data only after idle time and only when the active
 * location is a favorite. This intentionally never calls a live Dashboard,
 * detailed forecast, or daily-forecast endpoint for every saved city.
 */
export function FavoriteWeatherPreloader() {
  const { user, loading } = useAuth();
  const { activeLocation } = useLocation();
  const utils = trpc.useUtils();
  const scheduledSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user || !activeLocation?.favoriteId) {
      scheduledSessionRef.current = null;
      return;
    }

    const sessionKey = `${user.id}:${activeLocation.favoriteId}`;
    if (scheduledSessionRef.current === sessionKey) return;
    scheduledSessionRef.current = sessionKey;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // This compact authenticated read-model is schedule-backed and is shared
      // by the favorite pills. It is intentionally one request, not one per
      // favorite, and does not trigger live provider collection.
      void utils.favorites.getPreloadedForecasts
        .prefetch(undefined, { staleTime: DAILY_FORECAST_STALE_TIME_MS })
        .catch(() => undefined);
    };
    const idleCallback = window.requestIdleCallback?.(run, { timeout: 2_000 });
    const timeoutId = idleCallback == null ? window.setTimeout(run, 400) : null;

    return () => {
      cancelled = true;
      if (idleCallback != null) window.cancelIdleCallback?.(idleCallback);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [
    activeLocation?.favoriteId,
    loading,
    user?.id,
    utils,
  ]);

  return null;
}
