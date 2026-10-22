import { describe, expect, it } from "vitest";
import { getModelCountCoverageLabel, getModelCountCoverageLevel } from "../shared/modelCoverageConfidence";

describe("model count coverage labels", () => {
  it.each([
    { count: 0, level: "NONE", label: "aucun modèle contributeur" },
    { count: 1, level: "SINGLE_MODEL", label: "prévision d’un modèle unique" },
    { count: 2, level: "LIMITED", label: "effectif limité" },
    { count: 3, level: "MODERATE", label: "effectif intermédiaire" },
    { count: 4, level: "MODERATE", label: "effectif intermédiaire" },
    { count: 5, level: "BROAD", label: "effectif étendu" },
    { count: 7, level: "BROAD", label: "effectif étendu" },
  ])("maps $count actual contributors to $level", ({ count, level, label }) => {
    const actualLevel = getModelCountCoverageLevel(count);
    expect(actualLevel).toBe(level);
    expect(getModelCountCoverageLabel(actualLevel)).toBe(label);
  });
});
