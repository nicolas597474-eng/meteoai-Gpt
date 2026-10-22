import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useLocation } from "wouter";

const PageReadinessContext = createContext(false);
const RouteLoadingContext = createContext<(loading: boolean) => void>(() => {});

/** Decorative work must not compete with the first render and its requests. */
export function PageReadinessProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isFetching = useIsFetching();
  const [routeLoading, setRouteLoading] = useState(false);
  const [readyLocation, setReadyLocation] = useState<string | null>(null);
  const ready = readyLocation === location && !routeLoading;

  useEffect(() => {
    // Latch readiness: periodic refreshes must not restart the animations.
    if (ready || routeLoading || isFetching > 0) return;
    let idleId: number | undefined;
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => setReadyLocation(location));
      } else {
        setReadyLocation(location);
      }
    }, 500);
    return () => {
      window.clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
  }, [location, isFetching, ready, routeLoading]);

  return (
    <PageReadinessContext.Provider value={ready}>
      <RouteLoadingContext.Provider value={setRouteLoading}>
        <div data-page-loading={ready ? undefined : "true"}>{children}</div>
      </RouteLoadingContext.Provider>
    </PageReadinessContext.Provider>
  );
}

export function usePageReady() {
  return useContext(PageReadinessContext);
}

/** Suspense can be waiting for a JS chunk while no API request is active. */
export function useRouteLoading() {
  const setLoading = useContext(RouteLoadingContext);
  useEffect(() => {
    setLoading(true);
    return () => setLoading(false);
  }, [setLoading]);
}
