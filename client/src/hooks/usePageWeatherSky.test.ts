import { describe, expect, it } from "vitest";
import { selectPageWeatherSky } from "./usePageWeatherSky";

describe("selectPageWeatherSky", () => {
  it("sélectionne un ciel de pluie lorsque la condition officielle indique la pluie", () => {
    expect(selectPageWeatherSky({ condition: "Pluie" })).toContain("sky-pack-rain");
  });

  it("sélectionne un ciel nocturne pour une condition de nuit", () => {
    expect(selectPageWeatherSky({ condition: "Nuit claire" })).toContain("sky-pack-clear-night");
  });
});
