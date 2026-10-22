import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "@tomickigrzegorz/leaflet-rotate";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";

export const OSM_TILE_SOURCE = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Signaler un problème</a>',
};

export const MAP_UNAVAILABLE_MESSAGE =
  "Fond cartographique indisponible. Les marqueurs, zones et données restent accessibles.";

export type MapTileSource = {
  url: string;
  attribution: string;
};

interface MapViewProps {
  className?: string;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  allowPageScroll?: boolean;
  interactive?: boolean;
  enableRotation?: boolean;
  tileSource?: MapTileSource;
  children?: ReactNode;
  onMapReady?: (map: L.Map) => void;
  onFullscreenChange?: (isFullscreen: boolean, map: L.Map | null) => void;
}

export function MapView({
  className,
  initialCenter = { lat: 37.7749, lng: -122.4194 },
  initialZoom = 12,
  minZoom = 2,
  maxZoom = 20,
  allowPageScroll = false,
  interactive = true,
  enableRotation = false,
  tileSource = OSM_TILE_SOURCE,
  children,
  onMapReady,
  onFullscreenChange,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tileLayer = useRef<L.TileLayer | null>(null);
  const onMapReadyRef = useRef(onMapReady);
  const onFullscreenChangeRef = useRef(onFullscreenChange);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  onMapReadyRef.current = onMapReady;
  onFullscreenChangeRef.current = onFullscreenChange;

  useEffect(() => {
    const container = mapContainer.current;
    if (!container) return;

    setIsLoading(true);
    setLoadError(null);
    const mapInstance = L.map(container, {
      attributionControl: true,
      boxZoom: interactive,
      doubleClickZoom: interactive,
      dragging: interactive,
      keyboard: interactive,
      maxZoom,
      minZoom,
      rotate: enableRotation,
      dragRotate: enableRotation,
      shiftKeyRotate: enableRotation,
      touchRotate: enableRotation,
      rotateControl: false,
      scrollWheelZoom: interactive,
      touchZoom: interactive,
      zoomControl: false,
      zoomDelta: 1,
      zoomSnap: 0,
    }).setView([initialCenter.lat, initialCenter.lng], initialZoom);
    const tileLayerInstance = L.tileLayer(tileSource.url, {
      attribution: tileSource.attribution,
      maxNativeZoom: Math.min(19, maxZoom),
      maxZoom,
      minZoom,
      updateWhenIdle: true,
    });
    const onTileLoad = () => {
      setIsLoading(false);
      setLoadError(null);
    };
    const onTileError = () => {
      setIsLoading(false);
      setLoadError(MAP_UNAVAILABLE_MESSAGE);
    };
    tileLayerInstance.on("tileload", onTileLoad);
    tileLayerInstance.on("tileerror", onTileError);
    tileLayerInstance.addTo(mapInstance);
    map.current = mapInstance;
    tileLayer.current = tileLayerInstance;
    onMapReadyRef.current?.(mapInstance);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => mapInstance.invalidateSize({ animate: false, pan: false }));
    resizeObserver?.observe(container);
    const resizeFrame = window.requestAnimationFrame(() => {
      mapInstance.invalidateSize({ animate: false, pan: false });
    });

    return () => {
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      tileLayerInstance.off("tileload", onTileLoad);
      tileLayerInstance.off("tileerror", onTileError);
      mapInstance.off();
      mapInstance.remove();
      if (map.current === mapInstance) map.current = null;
      if (tileLayer.current === tileLayerInstance) tileLayer.current = null;
    };
  }, [
    initialCenter.lat,
    initialCenter.lng,
    initialZoom,
    interactive,
    enableRotation,
    maxZoom,
    minZoom,
    tileSource.attribution,
    tileSource.url,
  ]);

  useEffect(() => {
    if (!onFullscreenChange) return;
    const reportFullscreen = () =>
      onFullscreenChangeRef.current?.(Boolean(document.fullscreenElement), map.current);
    document.addEventListener("fullscreenchange", reportFullscreen);
    return () => document.removeEventListener("fullscreenchange", reportFullscreen);
  }, [onFullscreenChange]);

  const retryTiles = () => {
    setLoadError(null);
    setIsLoading(true);
    tileLayer.current?.redraw();
  };

  const mapView = (
    <div
      data-swipe-exclude
      data-swipe-ignore
      className={cn("relative h-[500px] w-full", className)}
    >
      <div
        ref={mapContainer}
        role="region"
        aria-label="Carte OpenStreetMap"
        className={cn(
          "relative z-0 h-full w-full",
          allowPageScroll ? "touch-pan-y" : "touch-none",
        )}
      />
      {isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
          Chargement de la carte…
        </div>
      )}
      {loadError && (
        <div className="absolute left-1/2 top-3 z-[1100] flex w-[min(92%,26rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-lg">
          <p role="alert">{loadError}</p>
          <button
            type="button"
            onClick={retryTiles}
            className="min-h-9 shrink-0 rounded-md border border-sky-400/50 px-3 font-medium text-sky-100"
          >
            Réessayer
          </button>
        </div>
      )}
      {children}
    </div>
  );

  return className?.includes("eclipse-map-viewport") && typeof document !== "undefined"
    ? createPortal(mapView, document.body)
    : mapView;
}
