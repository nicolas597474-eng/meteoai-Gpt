import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Map.tsx", import.meta.url), "utf8");

describe("cartographie OpenStreetMap", () => {
  it("charge les tuiles standard et affiche l’attribution OSM et le lien de signalement", () => {
    expect(source).toContain("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(source).toContain("OpenStreetMap contributors");
    expect(source).toContain("https://www.openstreetmap.org/copyright");
    expect(source).toContain("https://www.openstreetmap.org/fixthemap");
    expect(source).toContain("L.tileLayer(tileSource.url");
    expect(source).toContain("attribution: tileSource.attribution");
  });

  it("isole les couches Leaflet sous les commandes React superposées", () => {
    expect(source).toContain('"relative z-0 h-full w-full"');
  });

  it("signale l’échec des tuiles et permet de relancer leur chargement", () => {
    expect(source).toContain("Fond cartographique indisponible");
    expect(source).toContain('tileLayerInstance.on("tileerror", onTileError)');
    expect(source).toContain("tileLayer.current?.redraw()");
    expect(source).toContain("Réessayer");
  });

  it("conserve les interactions, le défilement mobile et le redimensionnement plein écran", () => {
    expect(source).toContain("interactive?: boolean");
    expect(source).toContain("scrollWheelZoom: interactive");
    expect(source).toContain("allowPageScroll ? \"touch-pan-y\" : \"touch-none\"");
    expect(source).toContain("ResizeObserver");
    expect(source).toContain("mapInstance.invalidateSize");
    expect(source).toContain("window.requestAnimationFrame");
    expect(source).toContain("window.cancelAnimationFrame");
    expect(source).toContain("onFullscreenChange?:");
    expect(source).toContain('document.addEventListener("fullscreenchange", reportFullscreen)');
    expect(source).toContain('className?.includes("eclipse-map-viewport")');
    expect(source).toContain("createPortal(mapView, document.body)");
  });

  it("active les gestes de rotation uniquement sur les cartes qui le demandent", () => {
    expect(source).toContain('import "@tomickigrzegorz/leaflet-rotate"');
    expect(source).toContain("enableRotation?: boolean");
    expect(source).toContain("enableRotation = false");
    expect(source).toContain("rotate: enableRotation");
    expect(source).toContain("dragRotate: enableRotation");
    expect(source).toContain("shiftKeyRotate: enableRotation");
    expect(source).toContain("touchRotate: enableRotation");
    expect(source).toContain("rotateControl: false");
  });

  it("ne charge plus de script de cartographie Google", () => {
    expect(source).not.toContain("google.maps");
    expect(source).not.toContain("maps.googleapis.com");
    expect(source).not.toContain("VITE_FRONTEND_FORGE_API_KEY");
  });
});
