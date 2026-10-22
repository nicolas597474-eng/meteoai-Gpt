import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dashboardPageFiles = [
  "Dashboard.tsx",
];

const simplifiedPageFiles = [
  "WeatherDetails.tsx",
  "ReliabilityLaboratory.tsx",
  "Ranking.tsx",
  "WeatherAILab.tsx",
];

describe("provenance unifiée des pages météo", () => {
  it("conserve le contrat et les panneaux repliables sur le Dashboard", () => {
    for (const filename of dashboardPageFiles) {
      const source = readFileSync(new URL(`./${filename}`, import.meta.url), "utf8");
      expect(source).not.toContain("<ForecastProvenanceBadge");
      expect(source).toContain("useOfficialForecast(");
      expect(source).toContain("formatHourlyForecastSource(hourlyForecastSource)");
      expect(source).toContain("formatHourlyForecastComputedAt(hourlyForecastComputedAt)");
      expect(source).toContain("HourlyWeightingNotice");
    }
  });

  it("alimente Dashboard et détails avec le même snapshot et la même pondération horaire", () => {
    const dashboard = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
    const details = readFileSync(new URL("./WeatherDetails.tsx", import.meta.url), "utf8");
    const sharedHook = readFileSync(new URL("../hooks/useOfficialForecast.ts", import.meta.url), "utf8");
    const router = readFileSync(new URL("../../../server/routers/weather.ts", import.meta.url), "utf8");

    expect(dashboard).toContain("useOfficialForecast(selectedLocation)");
    expect(details).toContain("useOfficialForecast(activeLocation);");
    expect(details).toContain("includeExtendedPeriods: true,");
    expect(details).toContain("enabled: !!essentialForecast,");
    expect(details).toContain("usePageWeatherSky();");
    expect(sharedHook).toContain("trpc.weather.getDetailedForecast.useQuery(queryInput");
    expect(sharedHook).toContain("OFFICIAL_FORECAST_REFETCH_INTERVAL_MS");
    expect(dashboard).toContain("getActiveOfficialForecastHour(hours, forecastNowMs)");
    expect(details).toContain("getActiveOfficialForecastHour(data.hours, Date.now())");
    expect(dashboard).toContain("activeHourIndex={currentHourIndex}");
    expect(dashboard).toContain("officialSnapshot?.hourlyWeighting");
    expect(details).toContain("officialSnapshot?.hourlyWeighting");
    expect(router).toContain("hours: snapshot.hourly");
    expect(router).toContain("periodHours,");
    expect(router).toContain("...(includeExtendedPeriods ? {");
    expect(router).toContain('periodHoursSource: "open_meteo_best_match_reference"');
    expect(router).toContain("projectHourlyForecastForDashboard(hourlyFallback.hours)");
    expect(router).toContain("includeDaily: false, signal");
    expect(router).toContain("includeExtendedPeriods ? resolveOfficialDailyForecastSnapshot");
    expect(router).toContain("loadExtendedPeriods: () => withDeadline(collectHourlyForecast(today, coords, 16");
    expect(router).toContain("dailyStatus: snapshot.dailyStatus");
    expect(router).toContain("hourlyWeighting: snapshot.hourlyWeighting");
    expect(dashboard).toContain("hourlyComputedAt={officialForecast?.officialSnapshot?.hourlyComputedAt}");
    expect(dashboard).toContain("computedAt={officialForecast?.officialSnapshot?.computedAt}");
    expect(details).toContain("hourlyComputedAt: data.officialSnapshot?.hourlyComputedAt");
    expect(details).toContain("computedAt: data.officialSnapshot?.computedAt");
  });

  it("retire les deux panneaux des pages volontairement simplifiées", () => {
    for (const filename of simplifiedPageFiles) {
      const source = readFileSync(new URL(`./${filename}`, import.meta.url), "utf8");
      expect(source).not.toContain("<ForecastProvenanceBadge");
      expect(source).not.toContain("<ForecastMetricDefinitions");
    }
  });
});
