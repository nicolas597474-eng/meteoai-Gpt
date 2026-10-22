import { describe, expect, it } from "vitest";
import { findNextConditionChange, getNextWeatherAlert } from "../client/src/lib/weatherCondition";

describe("findNextConditionChange", () => {
  it("retourne le premier créneau de condition différente", () => {
    const result = findNextConditionChange([
      { hour: "08:00", condition: "Ensoleillé" },
      { hour: "09:00", condition: "Ensoleillé" },
      { hour: "10:00", condition: "Partiellement nuageux" },
    ], "08:00");

    expect(result).toEqual({ hour: "10:00", condition: "Partiellement nuageux" });
  });

  it("retourne null si aucun changement n’est prévu", () => {
    expect(findNextConditionChange([
      { hour: "08:00", condition: "Ensoleillé" },
      { hour: "09:00", condition: "Ensoleillé" },
    ], "08:00")).toBeNull();
  });

  it("cherche le premier créneau futur lorsque l’heure courante manque", () => {
    const result = findNextConditionChange([
      { hour: "09:00", condition: "Nuageux" },
      { hour: "10:00", condition: "Pluie" },
    ], "08:00");

    expect(result?.hour).toBe("10:00");
  });
});

describe("getNextWeatherAlert", () => {
  it("priorise une alerte orage", () => {
    expect(getNextWeatherAlert({ hour: "14:00", condition: "Orage", windSpeed: 20 })).toMatchObject({
      kind: "thunderstorm",
      icon: "thunderstorm",
    });
  });

  it("détecte une alerte pluie", () => {
    expect(getNextWeatherAlert({ hour: "11:00", condition: "Averses", precipitation: 1.4 })).toMatchObject({
      kind: "rain",
      icon: "rainy",
    });
  });

  it("détecte une alerte vent fort à partir de la rafale", () => {
    expect(getNextWeatherAlert({ hour: "16:00", condition: "Nuageux", windGust: 62 })).toMatchObject({
      kind: "wind",
      icon: "windy",
    });
  });

  it("n’alerte pas pour un changement sans risque", () => {
    expect(getNextWeatherAlert({ hour: "10:00", condition: "Partiellement nuageux", windSpeed: 18 })).toBeNull();
  });
});
