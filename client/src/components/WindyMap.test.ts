import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./WindyMap.tsx", import.meta.url), "utf8");

describe("WindyMap", () => {
  it("verrouille le déplacement compact tout en laissant les boutons et la page accessibles", () => {
    expect(source).not.toContain("isCompactMapInteractive");
    expect(source).not.toContain("event.touches.length >= 2");
    expect(source).toContain("iframe est strictement visuelle ici");
    expect(source).toContain('className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"');
    expect(source).toContain("COMPACT_NATIVE_PLAY_GUTTER_PX = 96");
    expect(source).toContain("COMPACT_NATIVE_DETAIL_GUTTER_PX = 172");
    expect(source).toContain("COMPACT_NATIVE_TIMELINE_GUTTER_PX = 78");
    expect(source).toContain("bottom: `-${compactBottomGutter}px`");
    expect(source).toContain("right: `-${COMPACT_NATIVE_DETAIL_GUTTER_PX}px`");
    expect(source).toContain('className="pointer-events-none h-full w-full border-0"');
    expect(source).not.toContain("hideNativeLegend");
    expect(source).not.toContain("CloudCoverageLegend");
    expect(source).toContain("const fullscreenBottomGutter = 0");
    expect(source).toContain("const compactBottomGutter = COMPACT_NATIVE_TIMELINE_GUTTER_PX");
    expect(source).not.toContain('className="absolute inset-x-0 top-0 z-10 touch-pan-y"');
    expect(source).toContain("Aperçu météo fixe en mode compact");
    expect(source).toContain('aria-label="Boutons de couches météo"');
    expect(source).toContain('MapZoomControl orientation="horizontal" ariaLabel="Zoom de l’aperçu fixe"');
    expect(source).not.toContain('aria-label="Recentrer l’aperçu"');
    expect(source).toContain('className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2"');
    expect(source).toContain('orientation="horizontal"');
    expect(source).toContain('className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2"');
    expect(source).toContain("MapZoomControl");
    expect(source).not.toContain("h-10 w-14");
    expect(source).not.toContain("Aperçu fixe · animation en plein écran");
    expect(source).toContain('activeLayerInfo.windyParam, compactZoom, false');
    expect(source).toMatch(/className="[^"]*\babsolute bottom-3 right-3 z-20 grid h-10 w-11/);
    expect(source).toContain('onClick={() => onSelect(layer.id)}');
    expect(source).not.toContain('aria-label="Ouvrir l’animation météo Windy en plein écran"');
    expect(source).not.toContain("Voir l’animation");
    expect(source).not.toContain("Lecture et timeline");
  });

  it("anime l’ouverture et la fermeture sans perturber les contrôles", () => {
    expect(source).toContain("isFullscreenTransitioning");
    expect(source).toContain("transition-[opacity,transform]");
    expect(source).toContain("duration-250");
    expect(source).toContain("motion-reduce:transition-none");
    expect(source).toContain("setIsFullscreenTransitioning(true)");
    expect(source).toContain("setIsFullscreenTransitioning(false)");
  });

  it("masque le tableau détaillé Windy tout en conservant la vue plein écran", () => {
    expect(source).toContain("windyUrlFullscreen");
    expect(source).toContain("barre temporelle native et son bouton lecture");
    expect(source).toContain("const windyUrlFullscreen = buildWindyUrlWithDetail(");
    expect(source).toContain("windyUrlCompact");
    expect(source).toContain("activeLayerInfo.windyParam, compactZoom, false");
  });

  it("ancre le repère de localisation aux coordonnées Windy plutôt qu’au centre visuel", () => {
    expect(source).toContain('marker: "true"');
    expect(source).toContain("detailLat: lat.toFixed(4)");
    expect(source).toContain("detailLon: lon.toFixed(4)");
    expect(source).not.toContain("function LocationMarker()");
    expect(source).not.toContain("<LocationMarker />");
  });

  it("demande à Windy les vents et rafales en kilomètres par heure", () => {
    expect(source).toContain('metricWind: "km/h"');
  });

  it("conserve les contrôles externes utiles du plein écran", () => {
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toContain("createPortal(fullscreenMap, document.body)");
    expect(source).toContain("document.documentElement.requestFullscreen()");
    expect(source).toContain('aria-label="Fermer la carte plein écran"');
    expect(source).toContain('aria-label="Centrer la carte sur le lieu actif"');
    expect(source).toContain("MapZoomControl");
    expect(source).toContain("<X aria-hidden");
    expect(source).toContain("<Crosshair aria-hidden");
    expect(source).toContain("<MapZoomControl onZoomIn={() => adjustFullscreenZoom(1)} onZoomOut={() => adjustFullscreenZoom(-1)} />");
    expect(source).toContain("bg-[#0d1117]/85");
    expect(source).toContain("MapZoomControl");
    expect(source).toContain("fullscreenZoom");
    expect(source).not.toContain('aria-label="Type de fond de carte"');
    expect(source).not.toContain('>\n              Plan\n            </button>');
    expect(source).not.toContain('>\n              Satellite\n            </button>');
  });

  it("place centrage et zoom en bas à droite sans masquer la timeline native", () => {
    expect(source).toContain('className="absolute bottom-[72px] right-3 z-20 flex flex-col items-center gap-4"');
    expect(source).not.toContain('className="absolute right-3 top-[28%] z-20 flex flex-col items-center gap-4"');
  });

  it("restaure la couche et les zooms selon le lieu actif", () => {
    expect(source).toContain("makeWindyMapLocationKey(lat, lon, favoriteId)");
    expect(source).toContain("makeLegacyWindyMapLocationKey(lat, lon)");
    expect(source).toContain("getWindyMapPreferences(preferenceLocationKey, legacyPreferenceLocationKey)");
    expect(source).toContain("writeWindyMapPreferences(preferenceLocationKey, next)");
    expect(source).toContain("const { layer: activeLayer, compactZoom, fullscreenZoom } = preferences");
    expect(source).toContain("setPreferences(getWindyMapPreferences(preferenceLocationKey, legacyPreferenceLocationKey))");
  });

  it("synchronise une sortie plein écran native et restitue le focus sans retour historique intempestif", () => {
    expect(source).toContain('document.addEventListener("fullscreenchange", handleFullscreenChange)');
    expect(source).toContain("if (document.fullscreenElement || !isFullscreen) return;");
    expect(source).toContain("fullscreenTriggerRef.current?.focus()");
    expect(source).toContain("requestFullscreen().catch");
    expect(source).not.toContain("window.history.pushState");
    expect(source).not.toContain("window.history.back()");
  });

  it("conserve la couche météo sans basculement de fond non fiable", () => {
    expect(source).toContain("overlay: layer");
    expect(source).not.toContain('params.set("map", baseMap)');
    expect(source).not.toContain("fullscreenBaseMap");
  });

  it("masque uniquement la gouttière des contrôles natifs Windy sans supprimer la timeline", () => {
    expect(source).toContain("FULLSCREEN_NATIVE_CONTROL_GUTTER_PX = 72");
    expect(source).toContain("right: `-${FULLSCREEN_NATIVE_CONTROL_GUTTER_PX}px`");
    expect(source).toContain("width: `calc(100% + ${FULLSCREEN_NATIVE_CONTROL_GUTTER_PX}px)`");
    expect(source).toContain("barre temporelle native et son bouton lecture");
  });

  it("décale la vue des deux modes afin de laisser le panneau météo natif entièrement visible", () => {
    expect(source).toContain("WEATHER_PANEL_CENTER_OFFSET_PX = 64");
    expect(source).toContain("const centerLonOffset");
    expect(source).toContain("lon: (lon + centerLonOffset).toFixed(4)");
    expect(source).toContain("detailLon: lon.toFixed(4)");
  });
});
