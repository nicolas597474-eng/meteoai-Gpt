import { describe, expect, it } from "vitest";
import {
  FORECAST_HEARTBEAT_CRON_UTC,
  FORECAST_HEARTBEAT_UTC_HOURS,
  getNextParisForecastRun,
  getParisDate,
  getParisDateDaysAgo,
  getParisHourlyTimestamps,
  getParisForecastSlot,
  getParisHour,
  PARIS_FORECAST_RUN_HOURS,
} from "./weatherTime";

function utcHour(instant: string): number {
  return new Date(instant).getUTCHours();
}

describe("weatherTime — conventions Europe/Paris", () => {
  it("conserve la date métier parisienne au passage de minuit UTC", () => {
    const instant = new Date("2026-01-01T23:30:00.000Z");
    expect(getParisDate(instant)).toBe("2026-01-02");
    expect(getParisHour(instant)).toBe(0);
  });

  it("respecte l'heure d'été française", () => {
    const instant = new Date("2026-07-01T22:15:00.000Z");
    expect(getParisDate(instant)).toBe("2026-07-02");
    expect(getParisHour(instant)).toBe(0);
  });

  it("soustrait des jours civils parisiens, et non des blocs de 24 heures autour du DST", () => {
    expect(getParisDateDaysAgo(1, new Date("2026-03-29T22:30:00.000Z"))).toBe("2026-03-29");
    expect(getParisDateDaysAgo(1, new Date("2026-10-25T22:30:00.000Z"))).toBe("2026-10-24");
  });

  it("construit la grille UTC exacte des journées locales courtes, normales et longues", () => {
    const spring = getParisHourlyTimestamps("2026-03-29");
    const ordinary = getParisHourlyTimestamps("2026-03-28");
    const fall = getParisHourlyTimestamps("2026-10-25");

    expect(spring).toHaveLength(23);
    expect(spring.every((instant) => getParisDate(new Date(instant)) === "2026-03-29")).toBe(true);
    expect(spring.map((instant) => getParisHour(new Date(instant)))).not.toContain(2);
    expect(ordinary).toHaveLength(24);
    expect(ordinary.every((instant) => getParisDate(new Date(instant)) === "2026-03-28")).toBe(true);
    expect(fall).toHaveLength(25);
    expect(fall.filter((instant) => getParisHour(new Date(instant)) === 2)).toHaveLength(2);
    expect(new Set(fall).size).toBe(25);
    expect(getParisHourlyTimestamps("2026-02-30")).toEqual([]);
  });

  it("définit les six heures parisiennes et l'expression UTC de garde", () => {
    expect(PARIS_FORECAST_RUN_HOURS).toEqual([1, 5, 9, 13, 17, 21]);
    expect(FORECAST_HEARTBEAT_UTC_HOURS).toEqual([0, 3, 4, 7, 8, 11, 12, 15, 16, 19, 20, 23]);
    expect(FORECAST_HEARTBEAT_CRON_UTC).toBe("0 0 0,3,4,7,8,11,12,15,16,19,20,23 * * *");
  });

  it("mappe les six créneaux correctement en hiver et en été", () => {
    const winterSlots = [
      ["2026-01-15T00:00:00.000Z", "2026-01-15:01"],
      ["2026-01-15T04:00:00.000Z", "2026-01-15:05"],
      ["2026-01-15T08:00:00.000Z", "2026-01-15:09"],
      ["2026-01-15T12:00:00.000Z", "2026-01-15:13"],
      ["2026-01-15T16:00:00.000Z", "2026-01-15:17"],
      ["2026-01-15T20:00:00.000Z", "2026-01-15:21"],
    ] as const;
    const summerSlots = [
      ["2026-06-14T23:00:00.000Z", "2026-06-15:01"],
      ["2026-06-15T03:00:00.000Z", "2026-06-15:05"],
      ["2026-06-15T07:00:00.000Z", "2026-06-15:09"],
      ["2026-06-15T11:00:00.000Z", "2026-06-15:13"],
      ["2026-06-15T15:00:00.000Z", "2026-06-15:17"],
      ["2026-06-15T19:00:00.000Z", "2026-06-15:21"],
    ] as const;

    for (const [instant, expectedKey] of [...winterSlots, ...summerSlots]) {
      const slot = getParisForecastSlot(new Date(instant));
      expect(slot?.key).toBe(`favorites-forecast:${expectedKey}`);
      expect(FORECAST_HEARTBEAT_UTC_HOURS).toContain(utcHour(instant));
    }
  });

  it("garde exactement 05:00 autour du passage à l'heure d'été et d'hiver", () => {
    expect(getParisForecastSlot(new Date("2026-03-29T00:00:00.000Z"))?.key)
      .toBe("favorites-forecast:2026-03-29:01");
    expect(getParisForecastSlot(new Date("2026-03-29T03:00:00.000Z"))?.key)
      .toBe("favorites-forecast:2026-03-29:05");
    expect(getParisForecastSlot(new Date("2026-10-24T23:00:00.000Z"))?.key)
      .toBe("favorites-forecast:2026-10-25:01");
    expect(getParisForecastSlot(new Date("2026-10-25T04:00:00.000Z"))?.key)
      .toBe("favorites-forecast:2026-10-25:05");
  });

  it("ignore les déclencheurs UTC de garde qui ne correspondent pas à un créneau parisien", () => {
    expect(getParisForecastSlot(new Date("2026-06-15T04:00:00.000Z"))).toBeNull();
    expect(getParisForecastSlot(new Date("2026-01-15T03:00:00.000Z"))).toBeNull();
  });

  it("calcule le prochain passage correctement des deux côtés des changements d'heure", () => {
    expect(getNextParisForecastRun(new Date("2026-03-29T00:30:00.000Z")).toISOString())
      .toBe("2026-03-29T03:00:00.000Z");
    expect(getNextParisForecastRun(new Date("2026-03-28T21:30:00.000Z")).toISOString())
      .toBe("2026-03-29T00:00:00.000Z");
    expect(getNextParisForecastRun(new Date("2026-10-25T01:30:00.000Z")).toISOString())
      .toBe("2026-10-25T04:00:00.000Z");
    expect(getNextParisForecastRun(new Date("2026-06-15T03:00:00.000Z")).toISOString())
      .toBe("2026-06-15T07:00:00.000Z");
  });
});
