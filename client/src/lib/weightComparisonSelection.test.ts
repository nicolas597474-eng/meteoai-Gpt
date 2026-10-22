import { describe, expect, it } from "vitest";
import { resolveWeightComparisonSelection } from "./weightComparisonSelection";

describe("resolveWeightComparisonSelection", () => {
  it("écarte les sélections de l’ancien lieu et choisit les snapshots du nouvel historique", () => {
    const selection = resolveWeightComparisonSelection(
      [{ id: 31 }, { id: 30 }],
      4,
      5,
    );

    expect(selection).toEqual({ beforeId: 30, afterId: 31, canCompare: true });
  });

  it("déclare la comparaison indisponible si le nouvel historique n’a pas deux snapshots", () => {
    expect(resolveWeightComparisonSelection([{ id: 7 }], 4, 5)).toEqual({
      beforeId: null,
      afterId: 7,
      canCompare: false,
    });
    expect(resolveWeightComparisonSelection([], 4, 5)).toEqual({
      beforeId: null,
      afterId: null,
      canCompare: false,
    });
  });

  it("conserve une sélection valide dans le lieu courant sans comparer un snapshot à lui-même", () => {
    expect(resolveWeightComparisonSelection([{ id: 9 }, { id: 8 }], 8, 9)).toEqual({
      beforeId: 8,
      afterId: 9,
      canCompare: true,
    });
  });
});
