import { describe, expect, it } from "vitest";
import {
  findActiveHourlyForecastIndex,
  keepCurrentAndFutureHourlyForecasts,
} from "../shared/hourlyForecastTime";

describe("hourlyForecastTime", () => {
  it("garde le créneau actif et les échéances futures, mais retire l’intervalle terminé", () => {
    const hours = [
      { validAt: Date.parse("2026-08-12T11:00:00.000Z") },
      { validAt: Date.parse("2026-08-12T12:00:00.000Z") },
      { validAt: Date.parse("2026-08-12T13:00:00.000Z") },
    ];
    const now = Date.parse("2026-08-12T12:30:00.000Z");

    expect(findActiveHourlyForecastIndex(hours, now)).toBe(1);
    expect(keepCurrentAndFutureHourlyForecasts(hours, now)).toEqual(
      hours.slice(1)
    );
    expect(
      findActiveHourlyForecastIndex(
        hours,
        Date.parse("2026-08-12T13:00:00.000Z")
      )
    ).toBe(2);
  });

  it("distingue les deux échéances locales 02:00 par leur instant UTC au retour d’heure", () => {
    const hours = [
      { validAt: Date.parse("2026-10-25T00:00:00.000Z"), hour: "02:00" },
      { validAt: Date.parse("2026-10-25T01:00:00.000Z"), hour: "02:00" },
      { validAt: Date.parse("2026-10-25T02:00:00.000Z"), hour: "03:00" },
    ];

    expect(
      findActiveHourlyForecastIndex(
        hours,
        Date.parse("2026-10-25T00:30:00.000Z")
      )
    ).toBe(0);
    expect(
      findActiveHourlyForecastIndex(
        hours,
        Date.parse("2026-10-25T01:00:00.000Z")
      )
    ).toBe(1);
    expect(
      keepCurrentAndFutureHourlyForecasts(
        hours,
        Date.parse("2026-10-25T01:00:00.000Z")
      )
    ).toEqual(hours.slice(1));
  });
});
