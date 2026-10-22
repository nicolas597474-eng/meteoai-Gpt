import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const pages = ["WeatherDetails", "History", "Ranking", "ReliabilityLaboratory", "WeatherAILab"];

describe("fonds de ciel partagés", () => {
  it("préserve une couche de ciel réutilisable et contrastée", () => {
    expect(styles).toContain(".weather-page-sky");
    expect(styles).toContain("--page-weather-sky-image");
    expect(styles).toContain("sky-pack-sunny_1500b9a0.jpg");
    expect(styles).toContain(".weather-page-sky h1");
    expect(styles).toContain("button[class*=\"bg-sky-400/15\"]");
    expect(styles).toContain("border-violet");
  });

  it("active cette couche sur les cinq pages météo principales", () => {
    for (const page of pages) {
      const source = readFileSync(new URL(`./pages/${page}.tsx`, import.meta.url), "utf8");
      expect(source).toContain("weather-page-sky");
    }
  });
});
