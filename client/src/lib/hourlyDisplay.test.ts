import { describe, expect, it } from "vitest";
import { formatHourlyDisplay } from "./hourlyDisplay";

describe("formatHourlyDisplay", () => {
  it("affiche la date et distingue les deux 02:00 du retour DST par leur offset", () => {
    const hours = [
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T00:00:00.000Z") },
      { date: "2026-10-25", hour: "02:00", validAt: Date.parse("2026-10-25T01:00:00.000Z") },
    ];

    const first = formatHourlyDisplay(hours[0], hours);
    const second = formatHourlyDisplay(hours[1], hours);

    expect(first.dateLabel).toContain("25");
    expect(first.dateLabel.toLowerCase()).toContain("oct");
    expect(first.hourLabel).toBe("02:00");
    expect(first.offsetLabel).toBe("Europe/Paris UTC+02:00");
    expect(second.offsetLabel).toBe("Europe/Paris UTC+01:00");
    expect(first.offsetLabel).not.toBe(second.offsetLabel);
  });

  it("n’invente pas de fuseau lorsque les instants ne sont pas enregistrés", () => {
    const hours = [
      { date: "2026-10-25", hour: "02:00" },
      { date: "2026-10-25", hour: "02:00" },
    ];

    expect(formatHourlyDisplay(hours[0], hours).offsetLabel).toBeNull();
  });
});
