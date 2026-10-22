import { describe, expect, it } from "vitest";
import { getStationDisplayStatus, getStationQualificationBadge } from "./stationCandidateStatus";

describe("statut d'affichage des sources de stations", () => {
  it("classe une station active selon son genre, physique ou référence de modèle", () => {
    expect(getStationDisplayStatus({ isActive: true, sourceKind: "physical" })).toBe("physical");
    expect(getStationDisplayStatus({ isActive: true, sourceKind: "reference" })).toBe("reference");
    // Sans genre connu, une station active n'est jamais présentée comme un relevé physique.
    expect(getStationDisplayStatus({ isActive: true })).toBe("reference");
  });

  it("compte toute station inactive comme exclue, sans inventer d'autre statut", () => {
    expect(getStationDisplayStatus({ isActive: false, sourceKind: "physical" })).toBe("excluded");
    expect(getStationDisplayStatus({ isActive: false, sourceKind: "reference" })).toBe("excluded");
  });

  it("étiquette chaque station avec son badge de statut réel, sans confusion de réseau", () => {
    expect(getStationQualificationBadge({ isActive: true, source: "meteofrance", sourceKind: "physical" })).toEqual({ kind: "official", label: "Station officielle" });
    expect(getStationQualificationBadge({ isActive: true, source: "netatmo", sourceKind: "physical" })).toEqual({ kind: "netatmo", label: "Station Netatmo" });
    expect(getStationQualificationBadge({ isActive: true, source: "openmeteo", sourceKind: "reference" })).toEqual({ kind: "reference", label: "Référence de modèle" });
  });

  it("reprend le motif d'exclusion persisté tel quel, sans le réécrire ni l'inventer", () => {
    expect(getStationQualificationBadge({
      isActive: false,
      source: "meteofrance",
      sourceKind: "physical",
      exclusionReason: "Priorité technique de source trop basse (35/100)",
    })).toEqual({
      kind: "excluded",
      label: "Exclu",
      detail: "Priorité technique de source trop basse (35/100)",
    });
    expect(getStationQualificationBadge({ isActive: false, sourceKind: "physical" }).detail).toBeUndefined();
  });
});
