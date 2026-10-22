import { describe, expect, it } from "vitest";
import { isRetriableWeatherError, shouldRetryWeatherQuery, weatherRetryDelay } from "./weatherQueryRecovery";

describe("reprise contrôlée des requêtes météo", () => {
  it("ne reprend que les erreurs transitoires et borne le nombre d’essais", () => {
    const timeout = { data: { code: "TIMEOUT" }, message: "La requête a expiré" };
    expect(isRetriableWeatherError(timeout)).toBe(true);
    expect(shouldRetryWeatherQuery(0, timeout)).toBe(true);
    expect(shouldRetryWeatherQuery(2, timeout)).toBe(false);
    expect(shouldRetryWeatherQuery(0, { data: { code: "BAD_REQUEST" }, message: "Paramètre invalide" })).toBe(false);
  });

  it("augmente le délai sans dépasser quatre secondes", () => {
    expect(weatherRetryDelay(0)).toBe(800);
    expect(weatherRetryDelay(2)).toBe(3_200);
    expect(weatherRetryDelay(6)).toBe(4_000);
  });
});
