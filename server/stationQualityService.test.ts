import { describe, expect, it } from "vitest";
import { deriveStationQualityProfile } from "./stationQualityService";

const hour = 60 * 60 * 1000;

describe("deriveStationQualityProfile", () => {
  it("conserve une station en observation tant que les preuves sont insuffisantes", () => {
    const profile = deriveStationQualityProfile({ stationId: "netatmo-a", nowMs: 10 * hour, observations: [{ observedAt: 9 * hour, temperature: 18 }] });
    expect(profile.status).toBe("en_observation");
    expect(profile.continuityScore).toBeNull();
  });

  it("qualifie un historique continu sans modifier de poids", () => {
    const observations = Array.from({ length: 8 }, (_, index) => ({ observedAt: index * hour, temperature: 18 + index * 0.1 }));
    const profile = deriveStationQualityProfile({ stationId: "netatmo-a", nowMs: 8 * hour, observations });
    expect(profile).toMatchObject({ status: "qualifiee", continuityScore: 1, completenessScore: 1, stabilityScore: 1 });
  });

  it("dégrade un historique qui présente une discontinuité majeure", () => {
    const observations = [0, 4, 8, 12, 16, 20].map((at) => ({ observedAt: at * hour, temperature: 18 }));
    const profile = deriveStationQualityProfile({ stationId: "netatmo-a", nowMs: 21 * hour, observations });
    expect(profile.status).toBe("degradee");
    expect(profile.continuityScore).toBeLessThan(0.5);
  });
});
