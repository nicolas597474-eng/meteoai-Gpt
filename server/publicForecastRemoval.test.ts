import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WEATHER_SERVICES } from "./weatherServices";

describe("périmètre actif 7+1 sans services publics", () => {
  it("conserve exactement les sept modèles et Best Match dans le catalogue actif", () => {
    expect(WEATHER_SERVICES.expert.map((service) => service.name)).toEqual([
      "AROME",
      "ARPEGE",
      "ICON",
      "ECMWF",
      "GFS",
      "GEM",
      "UKMET",
      "Open-Meteo",
    ]);
    expect(WEATHER_SERVICES.public).toEqual([]);
  });

  it("n'écrit plus les deux services publics dans le cycle de prévision", () => {
    const source = readFileSync(new URL("./scheduledHandlers.ts", import.meta.url), "utf8");

    expect(source).not.toContain("generatePublicServiceForecasts");
    expect(source).not.toContain("fetchRealPublicForecasts");
    expect(source).not.toContain("publicRowsForLoc");
    expect(source).toContain("await insertForecasts(forecastRowsForLoc);");
    expect(source).toContain("const allForecasts = expertData;");
  });

  it("ne réintroduit pas les services abandonnés dans les catalogues API", () => {
    const source = readFileSync(new URL("./routers/weather.ts", import.meta.url), "utf8");

    expect(source).toContain("allServices: WEATHER_SERVICES.expert");
    expect(source).toContain("totalServices: WEATHER_SERVICES.expert.length");
    expect(source).toContain("const allServicesList = WEATHER_SERVICES.expert;");
    expect(source).not.toContain("...WEATHER_SERVICES.public");
  });
});
