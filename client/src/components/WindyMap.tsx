import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Crosshair, Maximize2, X } from "lucide-react";
import { MapZoomControl } from "@/components/MapControls";
import { getWindyMapPreferences, makeLegacyWindyMapLocationKey, makeWindyMapLocationKey, type WindyMapPreferences, writeWindyMapPreferences } from "./windyMapPreferences";

type WindyLayer = {
  id: string;
  label: string;
  windyParam: string;
  emoji: string;
};

const WINDY_LAYERS: WindyLayer[] = [
  { id: "rain", label: "Pluie", windyParam: "rain", emoji: "🌧" },
  { id: "wind", label: "Vent", windyParam: "wind", emoji: "💨" },
  { id: "clouds", label: "Nuages", windyParam: "clouds", emoji: "☁️" },
  { id: "temp", label: "Température", windyParam: "temp", emoji: "🌡" },
  { id: "pressure", label: "Pression", windyParam: "pressure", emoji: "📊" },
  { id: "humidity", label: "Humidité", windyParam: "rh", emoji: "💧" },
];

// L’embed Windy est isolé dans une iframe externe : ses boutons ne peuvent pas
// être ciblés par le CSS de l’application. On décale sa gouttière de contrôles
// hors de la zone visible, sans toucher à la timeline en plein écran.
const FULLSCREEN_NATIVE_CONTROL_GUTTER_PX = 72;
// En vue compacte, la lecture native se trouve en bas à gauche de l’embed.
// Cette gouttière est aussi cadrée hors écran : la lecture complète reste
// accessible uniquement après ouverture du plein écran.
const COMPACT_NATIVE_PLAY_GUTTER_PX = 96;
// Le panneau natif de pluie/conditions occupe le haut droit de l’embed. Une
// gouttière plus large le décale hors de l’aperçu compact, sans altérer le
// plein écran où les informations natives restent disponibles.
const COMPACT_NATIVE_DETAIL_GUTTER_PX = 172;
// La date et la barre de lecture natives sont uniquement utiles en plein écran.
// On prolonge l’embed sous le cadre compact afin de les cadrer hors de la vue,
// tout en conservant la carte complète et ses commandes MeteoAI externes.
const COMPACT_NATIVE_TIMELINE_GUTTER_PX = 78;
// Le panneau natif Windy (pluie, vent, etc.) s’ouvre à droite du repère. On
// centre donc légèrement la carte à l’est du lieu pour garder ce panneau dans
// le cadre, sans déplacer le repère géographique de la position réelle.
const WEATHER_PANEL_CENTER_OFFSET_PX = 64;

function buildWindyUrl(lat: number, lon: number, layer: string, zoom: number = 8): string {
  return buildWindyUrlWithDetail(lat, lon, layer, zoom, false);
}

function buildWindyUrlWithDetail(
  lat: number,
  lon: number,
  layer: string,
  zoom: number = 8,
  detail: boolean = false,
): string {
  // Le calcul maintient le même décalage visuel quelle que soit l’échelle.
  const centerLonOffset =
    (WEATHER_PANEL_CENTER_OFFSET_PX * 360) / (256 * 2 ** zoom);

  const params = new URLSearchParams({
    v: "2",
    zoom: String(zoom),
    lat: lat.toFixed(4),
    lon: (lon + centerLonOffset).toFixed(4),
    detailLat: lat.toFixed(4),
    detailLon: lon.toFixed(4),
    detail: detail ? "true" : "false",
    overlay: layer,
    product: "ecmwf",
    level: "surface",
    acTime: "now",
    message: "true",
    // Windy conserve alors le repère aux coordonnées detailLat/detailLon même
    // après un déplacement de la carte ; il ne reste plus figé au centre visuel.
    marker: "true",
    // Valeur officielle de l'embed Windy pour afficher vent et rafales en km/h.
    metricWind: "km/h",
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

type WindyMapProps = {
  lat: number;
  lon: number;
  locationName?: string;
  favoriteId?: number;
};

function LayerSelector({
  activeLayer,
  onSelect,
  compact = false,
}: {
  activeLayer: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid grid-cols-3 gap-1.5" : "flex flex-wrap gap-1.5"}>
      {WINDY_LAYERS.map((layer) => (
        <button
          key={layer.id}
          type="button"
          onClick={() => onSelect(layer.id)}
          aria-pressed={activeLayer === layer.id}
          className={`inline-flex min-w-0 shrink-0 items-center justify-center gap-1 rounded-full border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${compact ? "px-1.5 py-1 text-[9px]" : "px-2.5 py-1 text-[10px]"} ${
            activeLayer === layer.id
              ? "border-sky-400/60 bg-sky-400/20 text-sky-100"
              : "border-white/10 bg-slate-950/40 text-slate-400 hover:border-slate-600 hover:text-slate-200"
          }`}
        >
          <span>{layer.emoji}</span>
          <span>{layer.label}</span>
        </button>
      ))}
    </div>
  );
}

export function WindyMap({ lat, lon, locationName, favoriteId }: WindyMapProps) {
  const preferenceLocationKey = makeWindyMapLocationKey(lat, lon, favoriteId);
  const legacyPreferenceLocationKey = makeLegacyWindyMapLocationKey(lat, lon);
  const [preferences, setPreferences] = useState<WindyMapPreferences>(() => getWindyMapPreferences(preferenceLocationKey, legacyPreferenceLocationKey));
  const { layer: activeLayer, compactZoom, fullscreenZoom } = preferences;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [fullscreenHeight, setFullscreenHeight] = useState<number | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFullscreenTransitioning, setIsFullscreenTransitioning] = useState(false);
  const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPreferences(getWindyMapPreferences(preferenceLocationKey, legacyPreferenceLocationKey));
    setIframeKey((current) => current + 1);
  }, [legacyPreferenceLocationKey, preferenceLocationKey]);

  const handleLayerChange = useCallback((layerId: string) => {
    setPreferences((current) => {
      const next = { ...current, layer: layerId };
      writeWindyMapPreferences(preferenceLocationKey, next);
      return next;
    });
    setIframeKey((prev) => prev + 1);
  }, [preferenceLocationKey]);

  const openFullscreen = useCallback(() => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setIsFullscreenTransitioning(true);
    setIsFullscreen(true);
    if (typeof document !== "undefined" && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {
        // A browser can refuse native fullscreen. Do not leave a React-only
        // fullscreen portal behind; opening the map never changes history.
        setIsFullscreen(false);
        setIsFullscreenTransitioning(false);
        window.requestAnimationFrame(() => fullscreenTriggerRef.current?.focus());
      });
    }
    transitionTimer.current = setTimeout(() => setIsFullscreenTransitioning(false), 260);
  }, [isFullscreen]);

  const adjustFullscreenZoom = useCallback((delta: number) => {
    setPreferences((current) => {
      const next = { ...current, fullscreenZoom: Math.max(3, Math.min(14, current.fullscreenZoom + delta)) };
      writeWindyMapPreferences(preferenceLocationKey, next);
      return next;
    });
    setIframeKey((current) => current + 1);
  }, [preferenceLocationKey]);

  const adjustCompactZoom = useCallback((delta: number) => {
    setPreferences((current) => {
      const next = { ...current, compactZoom: Math.max(5, Math.min(11, current.compactZoom + delta)) };
      writeWindyMapPreferences(preferenceLocationKey, next);
      return next;
    });
    setIframeKey((current) => current + 1);
  }, [preferenceLocationKey]);

  const recenterFullscreenMap = useCallback(() => {
    setPreferences((current) => {
      const next = { ...current, fullscreenZoom: 8 };
      writeWindyMapPreferences(preferenceLocationKey, next);
      return next;
    });
    setIframeKey((current) => current + 1);
  }, [preferenceLocationKey]);

  const closeFullscreen = useCallback(() => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setIsFullscreenTransitioning(true);
    setIsFullscreen(false);
    if (typeof document !== "undefined" && document.fullscreenElement) void document.exitFullscreen();
    transitionTimer.current = setTimeout(() => setIsFullscreenTransitioning(false), 260);
    window.requestAnimationFrame(() => fullscreenTriggerRef.current?.focus());
  }, []);

  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleFullscreenChange = () => {
      if (document.fullscreenElement || !isFullscreen) return;
      // Escape/native browser exit must close the portal too, but must not call
      // history.back(): opening fullscreen intentionally never changes history.
      setIsFullscreen(false);
      setIsFullscreenTransitioning(false);
      window.requestAnimationFrame(() => fullscreenTriggerRef.current?.focus());
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen || typeof window === "undefined") return;

    const updateViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      setFullscreenHeight(Math.max(420, Math.floor(height)));
    };

    const handlePopState = () => {
      setIsFullscreen(false);
    };

    updateViewportHeight();
    window.addEventListener("popstate", handlePopState);
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    window.visualViewport?.addEventListener("scroll", updateViewportHeight);
    window.addEventListener("orientationchange", updateViewportHeight);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      window.visualViewport?.removeEventListener("scroll", updateViewportHeight);
      window.removeEventListener("orientationchange", updateViewportHeight);
    };
  }, [isFullscreen]);

  const activeLayerInfo = WINDY_LAYERS.find((l) => l.id === activeLayer) ?? WINDY_LAYERS[0];
  // La couche Nuages conserve le même cadrage que les autres couches afin que
  // l’interface et la légende natives de Windy restent entièrement visibles.
  const fullscreenBottomGutter = 0;
  const compactBottomGutter = COMPACT_NATIVE_TIMELINE_GUTTER_PX;

  const windyUrlCompact = buildWindyUrlWithDetail(lat, lon, activeLayerInfo.windyParam, compactZoom, false);
  // En plein écran, on conserve la barre temporelle native et son bouton lecture,
  // mais on désactive le panneau détaillé Windy qui affiche le tableau horaire.
  const windyUrlFullscreen = buildWindyUrlWithDetail(
    lat,
    lon,
    activeLayerInfo.windyParam,
    fullscreenZoom,
    false,
  );

  if (isFullscreen) {
    const fullscreenMap = (
      <div
        className={`fixed left-0 top-0 z-[200] flex w-screen flex-col overflow-hidden bg-[#080a0f] px-1.5 pt-1.5 transition-[opacity,transform] duration-250 ease-out motion-reduce:transition-none ${isFullscreenTransitioning ? "scale-[0.985] opacity-0" : "scale-100 opacity-100"}`}
        style={{
          height: fullscreenHeight ? `${fullscreenHeight}px` : "100dvh",
          maxHeight: fullscreenHeight ? `${fullscreenHeight}px` : "100dvh",
          paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* Carte plein écran */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10">
          <div
            className="absolute inset-x-0 top-0 overflow-hidden"
            style={{
              bottom: `-${fullscreenBottomGutter}px`,
              right: `-${FULLSCREEN_NATIVE_CONTROL_GUTTER_PX}px`,
            }}
          >
            <iframe
              key={iframeKey}
              src={windyUrlFullscreen}
              title={`Carte météo Windy — ${activeLayerInfo.label} — ${locationName ?? "lieu actif"}`}
              className="h-full border-0"
              style={{
                width: `calc(100% + ${FULLSCREEN_NATIVE_CONTROL_GUTTER_PX}px)`,
                height: `calc(100% + ${fullscreenBottomGutter}px)`,
              }}
              loading="lazy"
              allow="geolocation"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <button
            type="button"
            onClick={closeFullscreen}
            aria-label="Fermer la carte plein écran"
            className="weather-icon-bare absolute right-3 top-3 z-20 grid h-11 w-12 place-items-center rounded-2xl border border-white/20 bg-[#0d1117]/85 text-slate-100 shadow-lg backdrop-blur-sm transition-[transform,background-color] hover:bg-[#0d1117] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <X aria-hidden="true" className="h-6 w-6" strokeWidth={2.25} />
          </button>
          <div className="absolute bottom-[72px] right-3 z-20 flex flex-col items-center gap-4" aria-label="Commandes de la carte">
            <button
              type="button"
              onClick={recenterFullscreenMap}
              aria-label="Centrer la carte sur le lieu actif"
              className="weather-icon-bare grid h-11 w-12 place-items-center rounded-2xl border border-white/20 bg-[#0d1117]/85 text-slate-100 shadow-lg backdrop-blur-sm transition-[transform,background-color] hover:bg-[#0d1117] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <Crosshair aria-hidden="true" className="h-6 w-6" strokeWidth={2.2} />
            </button>
            <MapZoomControl onZoomIn={() => adjustFullscreenZoom(1)} onZoomOut={() => adjustFullscreenZoom(-1)} />
            <span className="sr-only" aria-live="polite">Niveau de zoom : {fullscreenZoom}</span>
          </div>
        </div>

        {/* Sélecteur sous la carte en plein écran */}
        <div className="mt-1.5 shrink-0 rounded-2xl border border-white/10 bg-[#080a0f]/95 p-1.5 shadow-[0_-10px_30px_rgba(0,0,0,0.28)]">
          <LayerSelector activeLayer={activeLayer} onSelect={handleLayerChange} compact />
        </div>
      </div>
    );

    return typeof document !== "undefined"
      ? createPortal(fullscreenMap, document.body)
      : fullscreenMap;
  }

  return (
      <div className={`flex flex-col gap-0 transition-[opacity,transform] duration-250 ease-out motion-reduce:transition-none ${isFullscreenTransitioning ? "scale-[0.99] opacity-0" : "scale-100 opacity-100"}`}>
      {/* Carte compacte */}
      <div className="relative h-[340px] touch-pan-y overflow-hidden rounded-2xl border border-white/10" aria-label="Aperçu météo fixe en mode compact">
        {/* L’iframe est strictement visuelle ici : son contenu ne reçoit aucun geste.
            Les commandes compactes sont rendues par l’application, hors iframe. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
          style={{
            bottom: `-${compactBottomGutter}px`,
            left: `-${COMPACT_NATIVE_PLAY_GUTTER_PX}px`,
            right: `-${COMPACT_NATIVE_DETAIL_GUTTER_PX}px`,
          }}
          aria-hidden="true"
        >
          <iframe
            key={iframeKey}
            src={windyUrlCompact}
            title={`Aperçu fixe Windy — ${activeLayerInfo.label} — ${locationName ?? "lieu actif"}`}
            className="pointer-events-none h-full w-full border-0"
            tabIndex={-1}
            loading="lazy"
            allow="geolocation"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
        <MapZoomControl orientation="horizontal" ariaLabel="Zoom de l’aperçu fixe" className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2" onZoomIn={() => adjustCompactZoom(1)} onZoomOut={() => adjustCompactZoom(-1)} />
        {/* Bouton plein écran */}
        <button
          type="button"
          onClick={openFullscreen}
          aria-label="Agrandir la carte"
          ref={fullscreenTriggerRef}
          className="weather-icon-bare absolute bottom-3 right-3 z-20 grid h-10 w-11 place-items-center rounded-xl border border-white/20 bg-[#0d1117]/80 text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:bg-[#0d1117] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <Maximize2 className="h-5 w-5" />
        </button>
      </div>

      {/* Sélecteur de couches sous la carte */}
      <div className="mt-2 px-0.5" aria-label="Boutons de couches météo">
        <LayerSelector activeLayer={activeLayer} onSelect={handleLayerChange} />
      </div>

      <p className="mt-1.5 px-0.5 text-[9px] text-slate-500">
        Données animées fournies par{" "}
        <a
          href="https://www.windy.com"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-slate-300"
        >
          Windy.com
        </a>
        {" "}· centré sur {locationName ?? "votre lieu actif"}.
      </p>
    </div>
  );
}
