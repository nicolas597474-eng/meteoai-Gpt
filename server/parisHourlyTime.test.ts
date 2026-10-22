import { describe, expect, it } from "vitest";
import { getParisDateAndHour, parisLocalHourToUniqueEpochMs } from "./parisHourlyTime";

describe("parisHourlyTime", () => {
  it("retourne null pour l’heure inexistante au passage à l’heure d’été", () => {
    expect(parisLocalHourToUniqueEpochMs("2026-03-29", 2)).toBeNull();
  });

  it("retourne null pour l’heure répétée au passage à l’heure d’hiver", () => {
    expect(parisLocalHourToUniqueEpochMs("2026-10-25", 2)).toBeNull();
  });

  it("convertit les heures non ambiguës en un instant exact", () => {
    const epoch = parisLocalHourToUniqueEpochMs("2026-10-25", 3);
    expect(epoch).not.toBeNull();
    expect(new Date(epoch!).toISOString()).toBe("2026-10-25T02:00:00.000Z");
  });

  it("distingue les deux échéances 02:00 fournies sous forme Unix à l’automne", () => {
    expect(getParisDateAndHour(Date.parse("2026-10-25T00:00:00.000Z"))).toEqual({ date: "2026-10-25", hour: 2, minute: 0 });
    expect(getParisDateAndHour(Date.parse("2026-10-25T01:00:00.000Z"))).toEqual({ date: "2026-10-25", hour: 2, minute: 0 });
    expect(Date.parse("2026-10-25T00:00:00.000Z")).not.toBe(Date.parse("2026-10-25T01:00:00.000Z"));
  });
});
