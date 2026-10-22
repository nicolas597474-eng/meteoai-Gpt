import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("leaflet", () => ({ default: {} }));
vi.mock("@tomickigrzegorz/leaflet-rotate", () => ({}));

vi.mock("@/lib/trpc", () => {
  const useQuery = () => ({ data: undefined, error: null, isFetching: false, isLoading: false });
  const weather = new Proxy({}, { get: () => ({ useQuery }) });
  return { trpc: { weather } };
});
vi.mock("@/components/MeteoIcon", () => ({ MeteoIcon: () => null }));

let EnvironmentalPanels: typeof import("./EnvironmentalPanels").EnvironmentalPanels;
beforeAll(async () => {
  (globalThis as typeof globalThis & { React?: typeof React }).React = React;
  ({ EnvironmentalPanels } = await import("./EnvironmentalPanels"));
});

const fixture = {
  source: "fixture astronomique",
  air: {
    aqi: 35,
    descriptor: { label: "Acceptable", tone: "lime" as const },
    pm25: 8,
    pm10: 14,
    nitrogenDioxide: 6,
    ozone: 22,
    observedAt: "2026-09-30T04:00:00.000Z",
    hourly: Array.from({ length: 24 }, (_, index) => ({ time: `2026-09-30T${String(index).padStart(2, "0")}:00:00.000Z`, value: 20 + index })),
  },
  astronomy: {
    sunrise: "2026-09-30T05:15:00.000Z",
    sunset: "2026-09-30T17:00:00.000Z",
    daylightDurationSeconds: 42_300,
    moonrise: "2026-09-30T15:00:00.000Z",
    moonset: "2026-09-30T23:00:00.000Z",
    moon: { label: "Gibbeuse décroissante", symbol: "◕" },
    moonIllumination: 85,
    lunar: { angleDeg: 225.1, label: "Gibbeuse décroissante", symbol: "◕", waxing: false, illuminationPct: 85, brightLimbAngleDeg: 41.3 },
    dayProgress: 0.5,
    sunAltitudeDeg: 25,
    moonAltitudeDeg: 14,
    sunAzimuthDeg: 180,
    moonAzimuthDeg: 225,
    sunAboveHorizon: true,
    moonAboveHorizon: true,
    altitudeCalculatedAt: "2026-09-30T04:06:28.000Z",
    timezone: "Europe/Paris",
    cloudCover: 20,
    coordinates: { lat: 50.89, lon: 2.56 },
    outlook: { moonMilestones: [], upcomingEclipses: [], upcomingMeteorShowers: [], daylightChangeTomorrowSeconds: 0, nextSolarMilestone: null },
  },
} as never;

describe("mise en page mobile des panneaux environnementaux", () => {
  it("rend trois surfaces indépendantes dans une grille à une colonne sans cadres météo imbriqués", () => {
    const markup = renderToStaticMarkup(createElement(EnvironmentalPanels, { data: fixture, isLoading: false }));

    expect(markup).toContain('aria-label="Qualité de l’air, soleil et lune"');
    expect(markup).toContain('class="grid min-w-0 w-full grid-cols-1 gap-3 sm:grid-cols-2"');
    expect((markup.match(/weather-surface/g) ?? [])).toHaveLength(3);
    expect((markup.match(/relative w-full min-w-0 max-w-full rounded-2xl border p-3/g) ?? [])).toHaveLength(2);
    expect(markup).toContain("PM2.5");
    expect(markup).toContain("NO₂");
  });

  it("rend le diagramme lunaire sans débordement de largeur et conserve une phase cohérente", () => {
    const markup = renderToStaticMarkup(createElement(EnvironmentalPanels, { data: fixture, isLoading: false }));

    expect(markup).toContain("w-full max-w-[330px] min-w-0 overflow-visible");
    expect(markup).toContain('data-phase-label="Gibbeuse décroissante" data-illumination-pct="85" data-bright-limb-angle-deg="41.3" data-waxing="false"');
    expect(markup).toContain('class="relative grid h-10 w-10 shrink-0 place-items-center"');
    expect(markup).toContain('class="relative grid h-16 w-16 shrink-0 place-items-center"');
    expect(markup).toContain('data-render-mode="loading"');
    expect(markup).toContain("Éclairage 85%");
    expect(markup).toContain("A 35 50");
    expect(markup).not.toContain("conic-gradient(from");
    expect(markup).not.toContain("celestial-arc-scene--night relative mx-auto mt-7");
  });

  it("rend le disque HMI dans les deux tailles solaires avec un fallback 2D étiqueté", () => {
    const markup = renderToStaticMarkup(createElement(EnvironmentalPanels, { data: fixture, isLoading: false }));

    expect(markup).toContain('data-solar-size="header"');
    expect(markup).toContain('data-solar-size="marker"');
    expect(markup).toContain('class="solar-hmi-globe relative grid h-8 w-8 shrink-0 place-items-center"');
    expect(markup).toContain('class="solar-hmi-globe relative grid h-12 w-12 shrink-0 place-items-center"');
    expect(markup).toContain('data-render-mode="loading"');
    expect(markup).toContain(">2D</span>");
    expect(markup).toContain("Image HMI fixe · 23 août 2011, 04:00 UTC");
    expect(markup).toContain("NASA/Goddard Space Flight Center Scientific Visualization Studio");
  });

  it("n’affiche plus la visibilité locale, les alertes visuelle et sonore ni le suivi plein écran", () => {
    const astronomy = (fixture as unknown as { astronomy: Record<string, unknown> }).astronomy;
    const eclipseFixture = {
      ...(fixture as unknown as Record<string, unknown>),
      astronomy: {
        ...astronomy,
        outlook: {
          moonMilestones: [{ id: "full_moon", label: "Pleine lune", date: "2026-10-26" }],
          nextSolarMilestone: { label: "Solstice de décembre", date: "2026-12-21" },
          daylightChangeTomorrowSeconds: -240,
          upcomingEclipses: [
            {
              id: "lunar_partial_2026_08_28",
              title: "Éclipse lunaire partielle",
              date: "2026-08-28",
              visibility: "Visible depuis la France",
              safetyNote: null,
              sourceLabel: "NASA / Timeanddate",
              sourceUrl: "https://example.test/eclipse",
              skyOutlook: null,
            },
          ],
          upcomingMeteorShowers: [],
        },
      },
    } as never;
    const markup = renderToStaticMarkup(createElement(EnvironmentalPanels, { data: eclipseFixture, isLoading: false }));

    expect(markup).toContain("Alerte astronomique");
    expect(markup).toContain("Éclipse lunaire partielle");
    expect(markup).not.toContain("Visibilité locale");
    expect(markup).not.toContain("Alerte visuelle");
    expect(markup).not.toContain("Alerte sonore");
    expect(markup).not.toContain("Suivi plein écran");
    expect(markup).not.toContain("Suivi immersif");
    expect(markup).not.toContain("Quitter le plein écran");
  });
});
