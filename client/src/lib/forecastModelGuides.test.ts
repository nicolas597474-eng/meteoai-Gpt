import { describe, expect, it } from "vitest";
import { getForecastModelGuide } from "./forecastModelGuides";

describe("fiches des modèles de prévision", () => {
  it("explique les huit libellés actifs et distingue le service Open-Meteo", () => {
    expect(getForecastModelGuide("AROME").name).toBe("AROME");
    expect(getForecastModelGuide("ARPEGE").name).toBe("ARPEGE");
    expect(getForecastModelGuide("ICON").name).toBe("ICON");
    expect(getForecastModelGuide("ECMWF IFS").name).toBe("ECMWF");
    expect(getForecastModelGuide("GFS").name).toBe("GFS");
    expect(getForecastModelGuide("GEM").name).toBe("GEM");
    expect(getForecastModelGuide("UKMO").name).toBe("UKMET");
    const openMeteo = getForecastModelGuide("Open-Meteo");
    expect(openMeteo.name).toBe("Open-Meteo");
    expect(openMeteo.overview).toContain("n’est pas un modèle physique unique");
  });

  it("conserve une limite et une source consultable pour chaque fiche", () => {
    ["AROME", "ARPEGE", "ICON", "ECMWF", "GFS", "GEM", "UKMET", "Open-Meteo"].forEach((model) => {
      const guide = getForecastModelGuide(model);
      expect(guide.limit.length).toBeGreaterThan(30);
      expect(guide.sourceUrl).toMatch(/^https:\/\//);
    });
  });
});
