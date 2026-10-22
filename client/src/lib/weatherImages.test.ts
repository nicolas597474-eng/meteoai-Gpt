import { describe, expect, it } from "vitest";
import { getDashboardWeatherImage, getWeatherImageFromData } from "./weatherImages";

describe("getDashboardWeatherImage", () => {
  it("priorise la condition de l’heure actuelle sur le régime journalier", () => {
    expect(getDashboardWeatherImage({ condition: "Pluie forte", regime: "Ensoleillé" })).toContain("sky-pack-heavy-rain");
  });

  it("couvre les conditions de fond principales de la carte Dashboard", () => {
    expect(getDashboardWeatherImage({ condition: "Brouillard" })).toContain("sky-pack-fog");
    expect(getDashboardWeatherImage({ condition: "Orage violent" })).toContain("sky-pack-violent-storm");
    expect(getDashboardWeatherImage({ condition: "Neige forte" })).toContain("sky-pack-snow");
    expect(getDashboardWeatherImage({ condition: "Ensoleillé" })).toContain("sky-pack-sunny");
    expect(getDashboardWeatherImage({ condition: "Ciel dégagé nuit" })).toContain("sky-pack-clear-night");
  });

  it("conserve une sélection déterministe par données quand la condition manque", () => {
    expect(getWeatherImageFromData({ cloudCover: 95 })).toContain("sky-pack-cloudy");
    expect(getWeatherImageFromData({ precipitation: 12 })).toContain("sky-pack-heavy-rain");
  });
});
