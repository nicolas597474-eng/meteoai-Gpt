import { describe, expect, it } from "vitest";
import { HOURLY_SNAPSHOT_MAX_ATTEMPTS, HOURLY_SNAPSHOT_RETRY_DELAY_MS, shouldRetryHourlyFavorite } from "./scheduledHandlers";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("relance bornée des favoris de collecte horaire", () => {
  it("autorise jusqu’à quatre relances puis conserve l'échec explicite", () => {
    expect(HOURLY_SNAPSHOT_MAX_ATTEMPTS).toBe(5);
    expect(HOURLY_SNAPSHOT_RETRY_DELAY_MS).toBe(1_200);
    expect(shouldRetryHourlyFavorite(0)).toBe(true);
    expect(shouldRetryHourlyFavorite(3)).toBe(true);
    expect(shouldRetryHourlyFavorite(4)).toBe(false);
  });

  it("le gestionnaire de collecte horaire notifie le propriétaire au seuil d’échecs techniques consécutifs", () => {
    const source = readFileSync(resolve(__dirname, "scheduledHandlers.ts"), "utf8");
    expect(source).toContain("allLocationsFailed");
    expect(source).toContain("notifyOwner");
    expect(source).toContain("TECHNICAL_FAILURE_ALERT_THRESHOLD");
    expect(source).toContain("Échecs techniques horaires répétés");
    expect(source).toContain("Les créneaux « aucune station qualifiée » ne déclenchent pas cette alerte");
  });
});
