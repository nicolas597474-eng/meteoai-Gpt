import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePageReady } from "@/contexts/PageReadinessContext";

vi.mock("@/contexts/PageReadinessContext", () => ({ usePageReady: vi.fn() }));
beforeEach(() => vi.mocked(usePageReady).mockReturnValue(true));
import { DashboardWeatherAtmosphere } from "./DashboardWeatherAtmosphere";

describe("DashboardWeatherAtmosphere", () => {
  it("ne monte ni particules ni canvas pendant le chargement de la page", () => {
    vi.mocked(usePageReady).mockReturnValue(false);
    for (const condition of ["Pluie forte", "Neige", "Orage"]) {
      expect(renderToStaticMarkup(createElement(DashboardWeatherAtmosphere, { condition }))).toBe("");
    }
  });

  it("rend la pluie en plusieurs plans avec des reflets sur la surface", () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Pluie forte" })
    );

    expect(markup).toContain('data-weather-atmosphere="rain"');
    expect(markup).toContain('data-weather-intensity="heavy"');
    expect(markup).toContain("dashboard-weather-atmosphere__rain-drop--far");
    expect(markup).toContain("dashboard-weather-atmosphere__rain-drop--near");
    expect(markup).not.toContain("dashboard-weather-atmosphere__water-bead");
    expect(markup).toContain("dashboard-weather-atmosphere__wet-sheen");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("réduit la densité des gouttes et permet de désactiver complètement l’atmosphère", () => {
    const reduced = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Pluie forte",
        effectsMode: "reduced",
      })
    );
    const disabled = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Pluie forte",
        effectsMode: "off",
      })
    );
    const reducedSnow = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Neige",
        effectsMode: "reduced",
      })
    );

    expect(reduced).toContain('data-effects-mode="reduced"');
    expect(
      reduced.match(/dashboard-weather-atmosphere__rain-drop--/g)
    ).toHaveLength(10);
    expect(
      reducedSnow.match(/dashboard-weather-atmosphere__snowflake/g)
    ).toHaveLength(7);
    expect(disabled).toBe("");
  });

  it("rend les nuages, le soleil et le soleil froid avec des lumières distinctes", () => {
    const clouds = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Nuageux" })
    );
    const sun = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Ensoleillé" })
    );
    const coldSun = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Grand soleil" })
    );

    expect(clouds).toContain("dashboard-weather-atmosphere__cloud--far");
    expect(clouds).toContain("dashboard-weather-atmosphere__cloud--near");
    expect(sun).toContain("dashboard-weather-atmosphere__sun-glow");
    expect(sun).not.toContain("dashboard-weather-atmosphere__sun-shaft");
    expect(sun).toContain("--sunlight-opacity:0.14");
    expect(coldSun).toContain('data-weather-atmosphere="cold-sun"');
    expect(coldSun).toContain("dashboard-weather-atmosphere__cold-sun-glow");
  });

  it("rend une pellicule glacée et des cristaux pour le verglas", () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Verglas" })
    );

    expect(markup).toContain('data-weather-atmosphere="ice"');
    expect(markup).toContain("dashboard-weather-atmosphere__ice-film");
    expect(markup).toContain("dashboard-weather-atmosphere__ice-spike");
    expect(markup).toContain("dashboard-weather-atmosphere__ice-crystal");
  });

  it("rend des flocons ou des particules de brume sèche selon le phénomène", () => {
    const snow = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Neige" })
    );
    const dust = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Brume sèche" })
    );

    expect(snow).toContain("dashboard-weather-atmosphere__snowflake");
    expect(dust).toContain('data-weather-atmosphere="dust"');
    expect(dust).toContain("dashboard-weather-atmosphere__dust-haze--far");
    expect(dust).toContain("dashboard-weather-atmosphere__dust-particle");
  });

  it("propose le canvas neige avec le fallback CSS et adapte le brouillard à la visibilité connue", () => {
    const snow = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Neige",
        windSpeed: 24,
        windDirection: 90,
      })
    );
    const unknownFog = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Brouillard",
        visibilityKm: null,
      })
    );
    const measuredFog = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Brouillard",
        visibilityKm: 0,
      })
    );

    expect(snow).toContain('data-snow-renderer="css"');
    expect(snow).toContain('data-snow-canvas="webgl"');
    expect(snow).toContain("dashboard-weather-atmosphere__snowflake");
    expect(unknownFog).toContain('data-fog-visibility="unknown"');
    expect(unknownFog).not.toContain("--fog-mist-far-opacity");
    expect(measuredFog).toContain('data-fog-visibility="reported"');
    expect(measuredFog).toContain("--fog-mist-far-opacity:0.32");
  });

  it("rend la pluie verglaçante et la grêle à partir des codes WMO sélectionnés", () => {
    const freezingRain = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Pluie",
        weatherCode: 67,
        precipitation: null,
      })
    );
    const hailstorm = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Orage violent",
        weatherCode: 99,
        precipitation: null,
      })
    );
    const ordinaryStorm = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Orage violent",
        weatherCode: 95,
        precipitation: null,
      })
    );
    const stormWithOnlyPrecipitation = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Orage",
        weatherCode: 95,
        precipitation: 12,
      })
    );
    const rainyStorm = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Orage avec pluie",
        weatherCode: 95,
        precipitation: null,
      })
    );

    expect(freezingRain).toContain('data-weather-atmosphere="ice"');
    expect(freezingRain).toContain('data-freezing-precipitation="reported"');
    expect(freezingRain).toContain('data-rain-renderer="css"');
    expect(freezingRain).toContain('data-rain-canvas="webgl"');
    expect(hailstorm).toContain('data-weather-atmosphere="storm"');
    expect(hailstorm).toContain('data-hail-signal="reported"');
    expect(hailstorm).toContain('data-hail-renderer="css"');
    expect(hailstorm).toContain('data-hail-canvas="webgl"');
    expect(hailstorm).not.toContain('data-rain-renderer="css"');
    expect(ordinaryStorm).not.toContain('data-hail-signal="reported"');
    expect(ordinaryStorm).not.toContain('data-rain-renderer="css"');
    expect(stormWithOnlyPrecipitation).not.toContain(
      'data-rain-renderer="css"'
    );
    expect(rainyStorm).toContain('data-rain-renderer="css"');
  });

  it("ne fabrique pas de pluie depuis un cumul inconnu ni d’orage depuis une tempête seule", () => {
    const smallAmount = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { precipitation: 0.3 })
    );
    const largeAmount = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { precipitation: 12 })
    );
    const tempest = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, { condition: "Tempête" })
    );

    expect(smallAmount).toBe("");
    expect(largeAmount).toBe("");
    expect(tempest).toBe("");
  });

  it("module les nuages et le vent selon les valeurs disponibles, sans inventer de direction", () => {
    const measuredClouds = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Nuageux",
        cloudCover: 0,
      })
    );
    const unknownClouds = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Nuageux",
        cloudCover: null,
      })
    );
    const reportedWind = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Vent fort",
        windSpeed: 60,
        windDirection: 90,
      })
    );
    const unknownWind = renderToStaticMarkup(
      createElement(DashboardWeatherAtmosphere, {
        condition: "Vent fort",
        windSpeed: 60,
        windDirection: null,
      })
    );

    expect(measuredClouds).toContain('data-cloud-cover="reported"');
    expect(measuredClouds).toContain("--cloud-far-opacity:0");
    expect(unknownClouds).toContain('data-cloud-cover="unknown"');
    expect(unknownClouds).toContain("--cloud-far-opacity:0.18");
    expect(reportedWind).toContain('data-wind-direction="reported"');
    expect(reportedWind).toContain("--wind-direction-angle:180deg");
    expect(unknownWind).toContain('data-wind-direction="unknown"');
    expect(unknownWind).toContain("--wind-drift-x:0vw");
  });

  it("ne rend pas de phénomène décoratif sans condition ni mesure exploitable", () => {
    expect(
      renderToStaticMarkup(createElement(DashboardWeatherAtmosphere, {}))
    ).toBe("");
  });
});
