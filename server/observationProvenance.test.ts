import { describe, expect, it } from "vitest";
import { isOperationalObservation } from "./observationProvenance";

describe("isOperationalObservation", () => {
  it("autorise uniquement une observation physique explicitement qualifiée", () => {
    expect(isOperationalObservation({ provenanceType: "physical_observation", isQualified: 1 })).toBe(true);
  });

  it("exclut les références de modèles et l’historique non qualifié du scoring", () => {
    expect(isOperationalObservation({ provenanceType: "model_reference", isQualified: 0 })).toBe(false);
    expect(isOperationalObservation({ provenanceType: "legacy_unqualified", isQualified: 0 })).toBe(false);
    expect(isOperationalObservation({ provenanceType: "physical_observation", isQualified: 0 })).toBe(false);
  });
});
