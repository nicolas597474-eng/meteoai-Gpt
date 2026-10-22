import { describe, expect, it } from "vitest";
import {
  getDashboardWeatherAtmosphere,
  getDashboardWeatherCloudOpacity,
  getDashboardWeatherFogOpacity,
  getDashboardWeatherHailIntensity,
  getDashboardWeatherSunlightOpacity,
  getDashboardWeatherWindMotion,
  hasDashboardHail,
  isDashboardFreezingPrecipitation,
} from "./dashboardWeatherAtmosphere";

describe("getDashboardWeatherAtmosphere", () => {
  it("choisit la pluie et son intensité uniquement à partir de libellés explicites", () => {
    expect(getDashboardWeatherAtmosphere({ condition: "Pluie forte" })).toEqual(
      {
        kind: "rain",
        intensity: "heavy",
      }
    );
    expect(getDashboardWeatherAtmosphere({ condition: "Bruine" })).toEqual({
      kind: "rain",
      intensity: "light",
    });
    expect(getDashboardWeatherAtmosphere({ condition: "Averses" }).kind).toBe(
      "rain"
    );
    expect(
      getDashboardWeatherAtmosphere({ condition: "Pluie", precipitation: 12 })
    ).toEqual({ kind: "rain", intensity: "steady" });
  });

  it("distingue orage, neige, grêle, brouillard, chaleur et vent", () => {
    expect(
      getDashboardWeatherAtmosphere({ condition: "Orage violent" }).kind
    ).toBe("storm");
    expect(getDashboardWeatherAtmosphere({ condition: "Tempête" })).toEqual({
      kind: "none",
      intensity: "steady",
    });
    expect(
      getDashboardWeatherAtmosphere({ condition: "Neige forte" }).kind
    ).toBe("snow");
    expect(getDashboardWeatherAtmosphere({ condition: "Grésil" }).kind).toBe(
      "hail"
    );
    expect(
      getDashboardWeatherAtmosphere({ condition: "Brouillard" }).kind
    ).toBe("fog");
    expect(getDashboardWeatherAtmosphere({ condition: "Canicule" }).kind).toBe(
      "heat"
    );
    expect(getDashboardWeatherAtmosphere({ windSpeed: 70 })).toEqual({
      kind: "wind",
      intensity: "heavy",
    });
  });

  it("sépare le verglas et le givre de la neige sans l’inférer du froid seul", () => {
    expect(getDashboardWeatherAtmosphere({ condition: "Verglas" }).kind).toBe(
      "ice"
    );
    expect(
      getDashboardWeatherAtmosphere({ condition: "Pluie verglaçante" }).kind
    ).toBe("ice");
    expect(getDashboardWeatherAtmosphere({ condition: "Givre" }).kind).toBe(
      "ice"
    );
    expect(getDashboardWeatherAtmosphere({ condition: "Neige" }).kind).toBe(
      "snow"
    );
    expect(getDashboardWeatherAtmosphere({ temperature: -2 }).kind).toBe(
      "none"
    );
    expect(getDashboardWeatherAtmosphere({ condition: "Froid" }).kind).toBe(
      "none"
    );
  });

  it("reconnaît les codes WMO de bruine/pluie verglaçante et de grêle", () => {
    expect(
      getDashboardWeatherAtmosphere({ condition: "Bruine", weatherCode: 56 })
    ).toEqual({ kind: "ice", intensity: "light" });
    expect(
      getDashboardWeatherAtmosphere({ condition: "Bruine", weatherCode: 57 })
    ).toEqual({ kind: "ice", intensity: "heavy" });
    expect(
      getDashboardWeatherAtmosphere({ condition: "Pluie", weatherCode: 66 })
    ).toEqual({ kind: "ice", intensity: "light" });
    expect(
      getDashboardWeatherAtmosphere({ condition: "Pluie", weatherCode: 67 })
    ).toEqual({ kind: "ice", intensity: "heavy" });
    expect(isDashboardFreezingPrecipitation({ weatherCode: 67 })).toBe(true);
    expect(isDashboardFreezingPrecipitation({ weatherCode: 65 })).toBe(false);
    expect(
      getDashboardWeatherAtmosphere({
        condition: "Orage violent",
        weatherCode: 96,
      }).kind
    ).toBe("storm");
    expect(hasDashboardHail({ weatherCode: 96 })).toBe(true);
    expect(hasDashboardHail({ weatherCode: 99 })).toBe(true);
    expect(hasDashboardHail({ condition: "Grésil" })).toBe(true);
    expect(getDashboardWeatherHailIntensity({ weatherCode: 96 })).toBe(
      "steady"
    );
    expect(getDashboardWeatherHailIntensity({ weatherCode: 99 })).toBe("heavy");
    expect(hasDashboardHail({ weatherCode: 95 })).toBe(false);
  });

  it("n’utilise pas un cumul de précipitations sans période pour intensifier la neige", () => {
    expect(
      getDashboardWeatherAtmosphere({ condition: "Neige", precipitation: 18 })
    ).toEqual({ kind: "snow", intensity: "steady" });
    expect(
      getDashboardWeatherAtmosphere({
        condition: "Neige forte",
        precipitation: null,
      })
    ).toEqual({ kind: "snow", intensity: "heavy" });
  });

  it("rend la brume sèche et le soleil froid distincts", () => {
    expect(
      getDashboardWeatherAtmosphere({ condition: "Brume sèche" }).kind
    ).toBe("dust");
    expect(getDashboardWeatherAtmosphere({ condition: "Poussière" }).kind).toBe(
      "dust"
    );
    expect(
      getDashboardWeatherAtmosphere({ condition: "Grand soleil" }).kind
    ).toBe("cold-sun");
    expect(
      getDashboardWeatherAtmosphere({ condition: "Soleil froid" }).kind
    ).toBe("cold-sun");
  });

  it("sélectionne le ciel, la nuit et les nuages selon la condition observée", () => {
    expect(
      getDashboardWeatherAtmosphere({ condition: "Ensoleillé" }).kind
    ).toBe("sun");
    expect(
      getDashboardWeatherAtmosphere({ condition: "Partiellement nuageux" }).kind
    ).toBe("clouds");
    expect(
      getDashboardWeatherAtmosphere({ condition: "Nuit claire" }).kind
    ).toBe("night");
    expect(
      getDashboardWeatherAtmosphere({ condition: "Nuageux", cloudCover: 95 })
    ).toEqual({ kind: "clouds", intensity: "heavy" });
  });

  it("n’infère pas la pluie depuis une quantité sans période documentée", () => {
    expect(getDashboardWeatherAtmosphere({ precipitation: 0.3 })).toEqual({
      kind: "none",
      intensity: "steady",
    });
    expect(getDashboardWeatherAtmosphere({ precipitation: 12 })).toEqual({
      kind: "none",
      intensity: "steady",
    });
    expect(
      getDashboardWeatherAtmosphere({ condition: "Pluie", precipitation: 12 })
    ).toEqual({ kind: "rain", intensity: "steady" });
  });

  it("réutilise les autres mesures météo en l’absence de libellé", () => {
    expect(getDashboardWeatherAtmosphere({ windSpeed: 45 }).kind).toBe("wind");
    expect(getDashboardWeatherAtmosphere({ visibilityKm: 0.8 }).kind).toBe(
      "fog"
    );
    expect(getDashboardWeatherAtmosphere({ visibilityKm: 0.1 }).intensity).toBe(
      "heavy"
    );
    expect(getDashboardWeatherAtmosphere({ temperature: 34 }).kind).toBe(
      "heat"
    );
    expect(getDashboardWeatherAtmosphere({ regime: "Neige forte" })).toEqual({
      kind: "snow",
      intensity: "heavy",
    });
  });

  it("garde la visibilité inconnue distincte de zéro et module seulement l’opacité visuelle", () => {
    expect(getDashboardWeatherFogOpacity(null)).toBeNull();
    expect(getDashboardWeatherFogOpacity(Number.NaN)).toBeNull();
    expect(getDashboardWeatherFogOpacity(-1)).toBeNull();
    expect(getDashboardWeatherFogOpacity(0)).toEqual({ far: 0.32, near: 0.23 });
    expect(getDashboardWeatherFogOpacity(1)).toEqual({ far: 0.14, near: 0.1 });
    expect(getDashboardWeatherFogOpacity(24)).toEqual({ far: 0.14, near: 0.1 });
  });

  it("module les nuages et la lumière sans transformer null en zéro", () => {
    expect(getDashboardWeatherCloudOpacity(null)).toBeNull();
    expect(getDashboardWeatherCloudOpacity(-1)).toBeNull();
    expect(getDashboardWeatherCloudOpacity(0)).toEqual({ far: 0, near: 0 });
    expect(getDashboardWeatherCloudOpacity(50)).toEqual({
      far: 0.12,
      near: 0.085,
    });
    expect(getDashboardWeatherCloudOpacity(100)).toEqual({
      far: 0.24,
      near: 0.17,
    });
    expect(getDashboardWeatherSunlightOpacity(null)).toBe(0.14);
    expect(getDashboardWeatherSunlightOpacity(0)).toBe(0.2);
    expect(getDashboardWeatherSunlightOpacity(100)).toBe(0.05);
  });

  it("oriente le vent depuis la direction fournie et reste neutre si elle manque", () => {
    const reported = getDashboardWeatherWindMotion(80, 0, 100);
    expect(reported.directionAngleDeg).toBe(90);
    expect(reported.driftX).toBe("0vw");
    expect(reported.driftY).toBe("4.33vh");

    const unknown = getDashboardWeatherWindMotion(null, null, null);
    expect(unknown.directionAngleDeg).toBeNull();
    expect(unknown.driftX).toBe("0vw");
    expect(unknown.driftY).toBe("0vh");
    expect(
      getDashboardWeatherWindMotion(999, 361, -1).directionAngleDeg
    ).toBeNull();
  });

  it("n’invente aucun phénomène quand les conditions et les mesures sont absentes", () => {
    expect(
      getDashboardWeatherAtmosphere({ condition: "Condition indisponible" })
    ).toEqual({ kind: "none", intensity: "steady" });
    expect(getDashboardWeatherAtmosphere({})).toEqual({
      kind: "none",
      intensity: "steady",
    });
  });

  it("ne modifie jamais l’objet météo source", () => {
    const source = Object.freeze({
      condition: "Pluie forte",
      precipitation: 12,
      windSpeed: 18,
    });

    expect(getDashboardWeatherAtmosphere(source)).toEqual({
      kind: "rain",
      intensity: "heavy",
    });
    expect(source).toEqual({
      condition: "Pluie forte",
      precipitation: 12,
      windSpeed: 18,
    });
  });

  it("donne la priorité à la condition officielle sur les mesures secondaires", () => {
    expect(
      getDashboardWeatherAtmosphere({
        condition: "Ensoleillé",
        precipitation: 4,
        windSpeed: 45,
        temperature: -3,
      }).kind
    ).toBe("sun");
  });
});
