import { describe, expect, it } from "vitest";

import { estimateDaylightChangeMinutes } from "./daylightTrend";

describe("estimateDaylightChangeMinutes", () => {
  it("indique une perte de minutes au cœur de l'automne à Paris", () => {
    const change = estimateDaylightChangeMinutes(48.85, new Date("2026-10-11T12:00:00Z"));
    expect(change).not.toBeNull();
    expect(change! < 0).toBe(true);
    expect(Math.abs(change!)).toBeGreaterThanOrEqual(1);
    expect(Math.abs(change!)).toBeLessThanOrEqual(5);
  });

  it("indique un gain de minutes au printemps à Paris", () => {
    const change = estimateDaylightChangeMinutes(48.85, new Date("2026-04-11T12:00:00Z"));
    expect(change).not.toBeNull();
    expect(change! > 0).toBe(true);
    expect(change!).toBeLessThanOrEqual(5);
  });

  it("inverse le signe dans l'hémisphère sud", () => {
    const change = estimateDaylightChangeMinutes(-33.9, new Date("2026-10-11T12:00:00Z"));
    expect(change).not.toBeNull();
    expect(change! > 0).toBe(true);
    expect(change!).toBeLessThanOrEqual(5);
  });

  it("reste quasi stable autour du solstice d'hiver", () => {
    const change = estimateDaylightChangeMinutes(48.85, new Date("2026-12-21T12:00:00Z"));
    expect(change).not.toBeNull();
    expect(Math.abs(change!)).toBeLessThanOrEqual(1);
  });

  it("renvoie 0 en nuit polaire continue", () => {
    const change = estimateDaylightChangeMinutes(80, new Date("2026-01-15T12:00:00Z"));
    expect(change).toBe(0);
  });

  it("renvoie 0 en soleil de minuit continu", () => {
    const change = estimateDaylightChangeMinutes(70, new Date("2026-07-15T12:00:00Z"));
    expect(change).toBe(0);
  });

  it("renvoie null pour une latitude invalide", () => {
    expect(estimateDaylightChangeMinutes(Number.NaN, new Date())).toBeNull();
    expect(estimateDaylightChangeMinutes(95, new Date())).toBeNull();
  });
});
