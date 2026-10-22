import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAIN_PAGE_PATHS, getSwipeNavigationTarget, isQualifiedPageSwipe, PAGE_SWIPE_IGNORE_SELECTOR } from "./lib/pageNavigation";

describe("navigation entre pages par glissement", () => {
  it("ordonne uniquement les pages qui ont une entrée visible de navigation", () => {
    expect(MAIN_PAGE_PATHS).toEqual(["/", "/details", "/laboratoire", "/ranking", "/ai-lab"]);
    expect(MAIN_PAGE_PATHS).not.toContain("/history");
  });

  it("navigue dans les deux sens sans dépasser les extrémités", () => {
    expect(getSwipeNavigationTarget("/", -120)).toBe("/details");
    expect(getSwipeNavigationTarget("/details", 120)).toBe("/");
    expect(getSwipeNavigationTarget("/ai-lab", -120)).toBeNull();
    expect(getSwipeNavigationTarget("/", 120)).toBeNull();
    expect(getSwipeNavigationTarget("/ranking", -120)).toBe("/ai-lab");
  });

  it("ignore les routes secondaires", () => {
    expect(getSwipeNavigationTarget("/report", -120)).toBeNull();
  });

  it("ne qualifie que les gestes rapides, horizontaux et suffisamment amples", () => {
    expect(isQualifiedPageSwipe(-90, 12, 220)).toBe(true);
    expect(isQualifiedPageSwipe(-50, 4, 220)).toBe(false);
    expect(isQualifiedPageSwipe(-100, 90, 220)).toBe(false);
    expect(isQualifiedPageSwipe(-100, 8, 1_100)).toBe(false);
  });

  it("protège les contrôles et contenus susceptibles de défiler horizontalement", () => {
    expect(PAGE_SWIPE_IGNORE_SELECTOR).toContain("button");
    expect(PAGE_SWIPE_IGNORE_SELECTOR).toContain("[data-swipe-exclude]");
    expect(PAGE_SWIPE_IGNORE_SELECTOR).toContain(".overflow-x-auto");
    expect(PAGE_SWIPE_IGNORE_SELECTOR).toContain("[data-horizontal-scroll]");
    expect(PAGE_SWIPE_IGNORE_SELECTOR).toContain("canvas");
  });

  it("anime la page cible selon le sens du geste sans animer les préférences de mouvement réduit", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    expect(appSource).toContain("page-swipe-transition--${transition.direction}");
    expect(appSource).toContain('deltaX < 0 ? "forward" : "backward"');
    expect(appSource).toContain('className="touch-auto"');
    expect(appSource).toContain("onPointerCancel={onPointerCancel}");
    expect(styles).toContain("touch-action: pan-x pan-y");
    expect(styles).toContain("page-content-fade-in");
    expect(styles).toContain("page-content-enter");
    expect(styles).toContain("prefers-reduced-motion: no-preference");
  });

  it("diffère les décorations et ne précharge que la route visée", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    const readiness = readFileSync(new URL("./contexts/PageReadinessContext.tsx", import.meta.url), "utf8");
    expect(readiness).toContain("const isFetching = useIsFetching();");
    expect(readiness).toContain("if (ready || routeLoading || isFetching > 0) return;");
    expect(readiness).toContain("window.requestIdleCallback");
    expect(appSource).toContain("useRouteLoading();");
    expect(appSource).toContain("onPointerEnter={() => activateNavItem(item.path)}");
    expect(appSource).toContain("onFocus={() => activateNavItem(item.path)}");
    expect(appSource).toContain("onPointerDown={() => activateNavItem(item.path)}");
    expect(appSource).not.toContain("window.setTimeout(preload, 250)");
    expect(appSource).not.toContain("loadWeatherAILab(),");
    expect(appSource).not.toContain("loadWeatherDetails(),");
    expect(appSource).toContain("setTransition(null), 240");
    expect(styles).toContain("220ms ease-out");
  });
});
