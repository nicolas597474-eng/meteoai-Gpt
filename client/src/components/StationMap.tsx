import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { LocateFixed, Maximize2, Undo2, X } from "lucide-react";
import { MapControlButton, MapZoomControl, mapActionButtonClass } from "@/components/MapControls";
import { MapView } from "@/components/Map";
import { stationInfoHtml, stationTooltipHtml, stationMarkerColor, stationPopupWidth, stationPopupHeight, type StationMarker } from "@/lib/stationMapPresentation";

export function StationMap({
  center,
  stations,
}: {
  center: { lat: number; lon: number };
  stations: StationMarker[];
}) {
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const nativeFullscreenOwnedRef = useRef(false);
  const [readyMap, setReadyMap] = useState<L.Map | null>(null);
  const mapReady = readyMap !== null;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isFocusedOnLocation, setIsFocusedOnLocation] = useState(false);
  const normalZoom = stations.length > 0 ? 11 : 10;
  const [zoomLevel, setZoomLevel] = useState(normalZoom);

  const focusCurrentLocation = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([center.lat, center.lon], 14);
    setIsFocusedOnLocation(true);
  }, [center.lat, center.lon]);

  const restoreNormalView = useCallback(() => {
    mapRef.current?.setView([center.lat, center.lon], normalZoom);
    setIsFocusedOnLocation(false);
  }, [center.lat, center.lon, normalZoom]);

  const adjustExpandedZoom = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const currentZoom = map.getZoom() ?? normalZoom;
    map.setZoom(Math.max(2, Math.min(20, currentZoom + delta)));
    setIsFocusedOnLocation(false);
  }, [normalZoom]);

  const openImmersiveMap = useCallback(() => {
    setIsExpanded(true);
    if (typeof document !== "undefined" && !document.fullscreenElement) {
      if (typeof document.documentElement.requestFullscreen === 'function') {
        nativeFullscreenOwnedRef.current = true;
        void document.documentElement.requestFullscreen().catch(() => { nativeFullscreenOwnedRef.current = false; });
      }
    }
  }, []);

  const closeImmersiveMap = useCallback(() => {
    if (typeof document !== "undefined" && nativeFullscreenOwnedRef.current && document.fullscreenElement === document.documentElement) {
      nativeFullscreenOwnedRef.current = false;
      void document.exitFullscreen?.().catch(() => undefined);
    }
    setIsExpanded(false);
  }, []);

  const renderMarkers = useCallback((map: L.Map) => {
    const markerLayer = markerLayerRef.current ?? L.layerGroup().addTo(map);
    markerLayerRef.current = markerLayer;
    markerLayer.clearLayers();

    L.circleMarker([center.lat, center.lon], {
      color: "#dbeafe",
      fillColor: "#2563eb",
      fillOpacity: 1,
      radius: 8,
      weight: 2,
    })
      .bindPopup("Lieu de référence")
      .bindTooltip("Lieu de référence")
      .addTo(markerLayer);

    stations.forEach((station) => {
      const freshness = stationMarkerColor(station);
      L.circleMarker([station.lat, station.lon], {
        color: "#071018",
        fillColor: freshness,
        fillOpacity: 1,
        radius: 7,
        weight: 2,
      })
        .bindPopup(stationInfoHtml(station), { maxWidth: stationPopupWidth(map.getSize().x), maxHeight: stationPopupHeight(map.getSize().y), minWidth: 120, autoPanPadding: L.point(12, 12) })
        .on('popupopen', (event: L.PopupEvent) => {
          event.popup.options.maxWidth = stationPopupWidth(map.getSize().x);
          event.popup.options.maxHeight = stationPopupHeight(map.getSize().y);
          event.popup.update();
        })
        .bindTooltip(stationTooltipHtml(station))
        .addTo(markerLayer);
    });
  }, [center.lat, center.lon, stations]);

  useEffect(() => {
    if (mapRef.current) renderMarkers(mapRef.current);
  }, [renderMarkers]);

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.setView([center.lat, center.lon], normalZoom);
    setIsFocusedOnLocation(false);
  }, [center.lat, center.lon, readyMap, normalZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    setZoomLevel(map.getZoom() ?? normalZoom);
    setIsPopupOpen(false);
    const updateZoom = () => setZoomLevel(map.getZoom() ?? normalZoom);
    const popupOpened = () => setIsPopupOpen(true);
    const popupClosed = () => setIsPopupOpen(false);
    map.on("zoomend", updateZoom);
    map.on('popupopen', popupOpened);
    map.on('popupclose', popupClosed);
    return () => {
      map.off("zoomend", updateZoom);
      map.off('popupopen', popupOpened);
      map.off('popupclose', popupClosed);
    };
  }, [readyMap, normalZoom]);

  useEffect(() => {
    if (!isExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeImmersiveMap();
    };
    const onNativeExit = () => {
      if (!document.fullscreenElement && nativeFullscreenOwnedRef.current) {
        nativeFullscreenOwnedRef.current = false;
        setIsExpanded(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener('fullscreenchange', onNativeExit);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener('fullscreenchange', onNativeExit);
      if (nativeFullscreenOwnedRef.current && document.fullscreenElement === document.documentElement) {
        nativeFullscreenOwnedRef.current = false;
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [isExpanded, closeImmersiveMap]);

  const mapShell = (
    <div className={isExpanded ? "fixed inset-0 z-[200] bg-[#070b13]" : "space-y-2"}>
      <div className={`relative overflow-hidden bg-[#090b10] ${isExpanded ? "h-[100dvh] border-0" : "h-72 rounded-xl border border-slate-800 sm:h-80"}`}>
        <MapView
          className="h-full w-full"
          initialCenter={{ lat: center.lat, lng: center.lon }}
          initialZoom={normalZoom}
          onMapReady={(map) => {
            mapRef.current = map;
            markerLayerRef.current = L.layerGroup().addTo(map);
            renderMarkers(map);
            setReadyMap(map);
          }}
        >
          {!isExpanded && mapReady && !isPopupOpen && (
            <div className="absolute bottom-12 right-3 z-20" data-swipe-exclude>
              <MapZoomControl
                onZoomIn={() => adjustExpandedZoom(1)}
                onZoomOut={() => adjustExpandedZoom(-1)}
                ariaLabel="Zoom manuel de la carte des stations"
              />
            </div>
          )}
        </MapView>
        {isExpanded && mapReady && (
          <>
            <MapControlButton
              onClick={closeImmersiveMap}
              aria-label="Fermer la carte agrandie"
              className="absolute right-3 top-3 z-10"
            >
              <X aria-hidden="true" className="h-6 w-6" strokeWidth={2.2} />
            </MapControlButton>
            {!isPopupOpen && <div className="absolute right-3 top-[28%] z-10 flex flex-col items-center gap-4" aria-label="Commandes de la carte">
              <MapControlButton onClick={focusCurrentLocation} aria-label="Centrer la carte sur le lieu actif">
                <LocateFixed aria-hidden="true" className="h-6 w-6" strokeWidth={2.25} />
              </MapControlButton>
              <MapZoomControl onZoomIn={() => adjustExpandedZoom(1)} onZoomOut={() => adjustExpandedZoom(-1)} />
              <span className="sr-only" aria-live="polite">Niveau de zoom : {zoomLevel}</span>
            </div>}
          </>
        )}
        {!mapReady && (
          <div className="absolute inset-0 grid place-items-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.16),transparent_34%),linear-gradient(rgba(30,41,59,0.32)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.32)_1px,transparent_1px)] bg-[size:auto,24px_24px,24px_24px]">
            <div className="absolute h-36 w-36 rounded-full border border-blue-500/20" />
            <div className="absolute h-24 w-24 rounded-full border border-blue-500/30" />
            <div className="relative flex flex-col items-center"><span className="grid h-10 w-10 place-items-center rounded-full border-2 border-blue-200 bg-blue-600 text-base text-white">●</span><span className="mt-2 rounded-full border border-slate-700 bg-[#10131a] px-2 py-1 text-[10px] text-slate-300">Lieu de référence</span></div>
            <p className="absolute bottom-3 text-[10px] text-slate-500">Repère local — fond cartographique en chargement</p>
          </div>
        )}
      </div>
      {mapReady && !isExpanded && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={isFocusedOnLocation ? restoreNormalView : focusCurrentLocation}
              aria-label={isFocusedOnLocation ? "Revenir au cadrage normal de la carte" : "Recentrer et zoomer sur le lieu actuel"}
              className={`${mapActionButtonClass} ${isFocusedOnLocation ? "border-sky-300/80 bg-sky-400/20 text-sky-100" : "text-slate-100"}`}
            >
              {isFocusedOnLocation ? <Undo2 aria-hidden="true" className="h-4 w-4" /> : <LocateFixed aria-hidden="true" className="h-4 w-4 text-sky-300" />}
              {isFocusedOnLocation ? "Vue normale" : "Zoom sur le lieu"}
            </button>
            <button
              type="button"
              onClick={openImmersiveMap}
              aria-label="Agrandir la carte"
              className={`${mapActionButtonClass} border-sky-300/70 bg-sky-400/15 text-sky-100`}
            >
              <Maximize2 aria-hidden="true" className="h-4 w-4" />
              Agrandir la carte
            </button>
          </div>
          <details className="group rounded-xl border border-slate-700 bg-[#0b1524]">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold text-slate-200 [&::-webkit-details-marker]:hidden">
              <span>Légende des marqueurs</span>
              <span aria-hidden="true" className="text-sky-300 transition-transform duration-200 group-open:rotate-180">⌄</span>
            </summary>
            <div className="grid gap-2 border-t border-slate-700 px-3 py-3 text-[11px] text-slate-300">
              <div className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-blue-100 bg-blue-600" /><span><strong className="text-slate-100">Bleu</strong> — lieu de référence.</span></div>
              <div className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-[#071018] bg-emerald-400" /><span><strong className="text-slate-100">Vert</strong> — station utilisée dans la synthèse locale.</span></div>
              <div className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-[#071018] bg-amber-400" /><span><strong className="text-slate-100">Ambre</strong> — station non utilisée sur ce cycle ; le relevé peut être récent.</span></div>
            </div>
          </details>
        </div>
      )}
    </div>
  );

  return isExpanded && typeof document !== "undefined"
    ? createPortal(mapShell, document.body)
    : mapShell;
}
