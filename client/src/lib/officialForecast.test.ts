import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getActiveOfficialForecastHour, getHourlyForecastAtValidTime, getOfficialForecastCoordinates, getOfficialForecastQueryInput } from "./officialForecast";

const dashboardSource = readFileSync(new URL("../pages/Dashboard.tsx", import.meta.url), "utf8");
const detailsSource = readFileSync(new URL("../pages/WeatherDetails.tsx", import.meta.url), "utf8");
const sharedHookSource = readFileSync(new URL("../hooks/useOfficialForecast.ts", import.meta.url), "utf8");
const pageSkyHookSource = readFileSync(new URL("../hooks/usePageWeatherSky.ts", import.meta.url), "utf8");

describe("prévision horaire officielle partagée", () => {
  it("garde le Dashboard en horizon court et enrichit ensuite les Prévisions avec l’horizon étendu", () => {
    expect(getOfficialForecastCoordinates(null)).toEqual({ lat: 50.7567, lon: 2.5204 });
    const location = { lat: 48.8566, lon: 2.3522, name: "Paris" };
    expect(getOfficialForecastQueryInput(location)).toEqual({
      lat: 48.8566,
      lon: 2.3522,
      includeExtendedPeriods: false,
    });
    expect(getOfficialForecastQueryInput(location, true)).toEqual({
      lat: 48.8566,
      lon: 2.3522,
      includeExtendedPeriods: true,
    });
    expect(dashboardSource).toContain("useOfficialForecast(selectedLocation)");
    expect(dashboardSource).toContain("trpc.weather.getDashboardDailyForecast.useQuery");
    expect(dashboardSource).toContain("enabled: !officialLoading || !!officialForecast");
    expect(dashboardSource).not.toContain("periodHours");
    expect(dashboardSource).not.toContain("includeExtendedPeriods: true");
    expect(detailsSource).toContain("useOfficialForecast(activeLocation);");
    expect(detailsSource).toContain("includeExtendedPeriods: true,");
    expect(detailsSource).toContain("enabled: !!essentialForecast,");
    expect(detailsSource).toContain("usePageWeatherSky();");
    expect(pageSkyHookSource).toContain("useOfficialForecast(activeLocation, options)");
    expect(sharedHookSource).toContain("OFFICIAL_FORECAST_REFETCH_INTERVAL_MS");
    expect(sharedHookSource).toContain("refetchIntervalInBackground: false");
  });

  it("fait afficher la même valeur aux deux vues pour un même lieu et un validTime identique", () => {
    const location = { lat: 48.8566, lon: 2.3522, name: "Paris" };
    const dashboardInput = getOfficialForecastQueryInput(location, false);
    const detailsInput = getOfficialForecastQueryInput({ ...location }, true);
    const validTime = Date.parse("2026-10-07T10:00:00.000Z");
    const hours = [
      { validAt: validTime - 60 * 60_000, temp: 13.1 },
      { validAt: validTime, temp: 17.4, precipitation: 0.6 },
      { validAt: validTime + 60 * 60_000, temp: 18.2 },
    ];
    const dashboardHour = getActiveOfficialForecastHour(hours, validTime + 5 * 60_000);
    const detailsHour = dashboardHour?.hour
      ? getHourlyForecastAtValidTime(hours, dashboardHour.hour.validAt)
      : null;

    expect(dashboardInput).toMatchObject({ lat: 48.8566, lon: 2.3522, includeExtendedPeriods: false });
    expect(detailsInput).toMatchObject({ lat: 48.8566, lon: 2.3522, includeExtendedPeriods: true });
    expect(dashboardInput.lat).toBe(detailsInput.lat);
    expect(dashboardInput.lon).toBe(detailsInput.lon);
    expect(dashboardHour?.hour.validAt).toBe(validTime);
    expect(detailsHour?.validAt).toBe(validTime);
    expect(dashboardHour?.hour.temp).toBe(17.4);
    expect(detailsHour?.temp).toBe(dashboardHour?.hour.temp);
    expect(dashboardSource).toContain("getActiveOfficialForecastHour(hours, forecastNowMs)");
    expect(detailsSource).toContain("getActiveOfficialForecastHour(data.hours, Date.now())");
  });
});
