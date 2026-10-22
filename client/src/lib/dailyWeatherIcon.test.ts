import { describe, expect, it } from "vitest";
import { getDailyWeatherCodeIconName } from "@/lib/dailyWeatherIcon";

describe("icônes des codes météo quotidiens WMO", () => {
  it("associe un pictogramme local à chaque code quotidien pris en charge", () => {
    const validCodes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];

    for (const code of validCodes) {
      expect(getDailyWeatherCodeIconName(code), `code WMO ${code}`).not.toBeNull();
    }
  });

  it("différencie les familles météo avec les pictogrammes déjà intégrés", () => {
    expect(getDailyWeatherCodeIconName(0)).toBe("sunny");
    expect(getDailyWeatherCodeIconName(48)).toBe("fog");
    expect(getDailyWeatherCodeIconName(56)).toBe("freezing_rain");
    expect(getDailyWeatherCodeIconName(65)).toBe("heavy_rain");
    expect(getDailyWeatherCodeIconName(75)).toBe("snow");
    expect(getDailyWeatherCodeIconName(99)).toBe("thunderstorm");
  });

  it("n’invente pas d’icône pour un code absent ou invalide", () => {
    expect(getDailyWeatherCodeIconName(null)).toBeNull();
    expect(getDailyWeatherCodeIconName(undefined)).toBeNull();
    expect(getDailyWeatherCodeIconName(42)).toBeNull();
    expect(getDailyWeatherCodeIconName(3.5)).toBeNull();
  });
});
