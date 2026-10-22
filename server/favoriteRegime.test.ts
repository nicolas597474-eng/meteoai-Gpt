import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectMultiRegime } from "./fusionEngine";
import { buildFavoriteHourlyRegime } from "./favoriteRegime";

const completePoint = {
  validAt: 1_798_072_200,
  temp: 12,
  precipitation: 0,
  windSpeed: 0,
  cloudCover: 25,
  humidity: 60,
  visibility: 10,
};

describe("buildFavoriteHourlyRegime", () => {
  it("retourne inconnu quand l’instant ou une seule entrée météo requise manque, est null ou non finie", () => {
    expect(buildFavoriteHourlyRegime(null)).toBeNull();
    expect(buildFavoriteHourlyRegime({ ...completePoint, validAt: null })).toBeNull();
    for (const field of ["temp", "precipitation", "windSpeed", "cloudCover", "humidity", "visibility"] as const) {
      expect(buildFavoriteHourlyRegime({ ...completePoint, [field]: undefined })).toBeNull();
      expect(buildFavoriteHourlyRegime({ ...completePoint, [field]: null })).toBeNull();
      expect(buildFavoriteHourlyRegime({ ...completePoint, [field]: Number.NaN })).toBeNull();
    }
  });

  it("conserve les zéros mesurés au lieu de les confondre avec des champs absents", () => {
    const zeroPoint = {
      ...completePoint,
      temp: 0,
      precipitation: 0,
      windSpeed: 0,
      cloudCover: 0,
      humidity: 0,
      visibility: 0,
    };

    expect(buildFavoriteHourlyRegime(zeroPoint)).toEqual(detectMultiRegime({
      temperature: 0,
      precipitation: 0,
      windSpeed: 0,
      cloudCover: 0,
      humidity: 0,
      visibility: 0,
    }));
  });

  it("calcule un régime complet sur le même validAt et convertit explicitement la visibilité km en mètres", () => {
    expect(buildFavoriteHourlyRegime(completePoint)).toEqual(detectMultiRegime({
      temperature: 12,
      precipitation: 0,
      windSpeed: 0,
      cloudCover: 25,
      humidity: 60,
      visibility: 10_000,
    }));
  });

  it("conserve l’incertitude de phase ou utilise le type horaire explicitement fourni", () => {
    const coldPrecipitation = { ...completePoint, temp: -2, precipitation: 1, cloudCover: 65 };
    expect(buildFavoriteHourlyRegime(coldPrecipitation)?.primaryRegime.id).toBe("winter_precipitation_uncertain");
    expect(buildFavoriteHourlyRegime({ ...coldPrecipitation, precipType: "snow" })?.primaryRegime.id).toBe("snow");
    expect(buildFavoriteHourlyRegime({ ...coldPrecipitation, temp: -1, precipType: "freezing_rain" })?.primaryRegime.id).toBe("freezing_rain");
  });

  it("retourne un état unavailable explicite dans l’API favoris sans fabriquer des champs à 15/0/0", () => {
    const source = readFileSync(new URL("./routers/favorites.ts", import.meta.url), "utf8");
    expect(source).toContain("buildFavoriteHourlyRegime(regimeSource)");
    expect(source).toContain('multiRegimeStatus: multiRegimeResult ? "available" : "unknown"');
    expect(source).toContain("multiRegime: multiRegimeResult ? {");
    expect(source).not.toContain("todayForecast?.tempMax ?? todayForecast?.tempMin ?? 15");
    expect(source).not.toContain("todayForecast?.precipitation ?? 0");
    expect(source).not.toContain("todayForecast?.windSpeed ?? 0");
  });
});
