import { describe, expect, it } from "vitest";
import { findNextConditionChange } from "./weatherCondition";

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

  it("utilise le validAt exact quand l’heure locale 02:00 est répétée", () => {
    const hours = [
      { hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z"), condition: "Ensoleillé" },
      { hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z"), condition: "Pluie" },
      { hour: "03:00", validAt: Date.parse("2026-10-25T02:00:00.000Z"), condition: "Pluie" },
      { hour: "04:00", validAt: Date.parse("2026-10-25T03:00:00.000Z"), condition: "Nuageux" },
    ];

    expect(findNextConditionChange(hours, "02:00", hours[1].validAt)).toBe(hours[3]);
  });
});
