import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FAVORITE_WEATHER_PRELOAD_CONCURRENCY,
  getUniqueFavoriteWeatherCoordinates,
  preloadFavoriteWeatherLocations,
} from "./favoriteWeatherPreload";

describe("préchargement météo des lieux favoris", () => {
  it("déduplique les mêmes coordonnées et ignore celles qui sont invalides", () => {
    expect(
      getUniqueFavoriteWeatherCoordinates([
        { lat: 50.75, lon: 2.52 },
        { lat: 50.75, lon: 2.52 },
        { lat: Number.NaN, lon: 2.52 },
        { lat: 91, lon: 2.52 },
        { lat: 48.85, lon: 2.35 },
      ])
    ).toEqual([
      { lat: 50.75, lon: 2.52 },
      { lat: 48.85, lon: 2.35 },
    ]);
  });

  it("borne les chargements simultanés et continue après l’échec d’un lieu", async () => {
    const locations = [1, 2, 3, 4, 5].map(lat => ({ lat, lon: 2 }));
    const started: number[] = [];
    let active = 0;
    let maximumActive = 0;

    await preloadFavoriteWeatherLocations(locations, async ({ lat }) => {
      started.push(lat);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      if (lat === 2) throw new Error("Échec météo isolé");
    });

    expect(maximumActive).toBe(FAVORITE_WEATHER_PRELOAD_CONCURRENCY);
    expect(started.sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("n’ajoute pas de nouveaux lieux à la file après son annulation", async () => {
    let cancelled = false;
    const started: number[] = [];

    await preloadFavoriteWeatherLocations(
      [
        { lat: 1, lon: 2 },
        { lat: 2, lon: 2 },
        { lat: 3, lon: 2 },
      ],
      async ({ lat }) => {
        started.push(lat);
        cancelled = true;
      },
      { concurrency: 1, shouldCancel: () => cancelled }
    );

    expect(started).toEqual([1]);
  });

  it("ne réchauffe au niveau App que les prévisions planifiées du favori actif, à l’inactivité", () => {
    const component = readFileSync(
      new URL("../components/FavoriteWeatherPreloader.tsx", import.meta.url),
      "utf8"
    );
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

    expect(app).toContain("<FavoriteWeatherPreloader />");
    expect(component).toContain("activeLocation?.favoriteId");
    expect(component).toContain("window.requestIdleCallback");
    expect(component).toContain("window.cancelIdleCallback");
    expect(component).toContain("getPreloadedForecasts");
    expect(component).not.toContain("getDashboard.prefetch");
    expect(component).not.toContain("getDetailedForecast.prefetch");
    expect(component).not.toContain("getDashboardDailyForecast.prefetch");
    expect(component).not.toContain("preloadFavoriteWeatherLocations(");
  });
});
