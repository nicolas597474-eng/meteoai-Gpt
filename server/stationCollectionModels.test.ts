import { describe, expect, it } from "vitest";
import { getCollectedModelNames, getMissingModelNames } from "./stationCollectionModels";

describe("getCollectedModelNames", () => {
  const expected = ["AROME", "ARPEGE", "ICON"];

  it("retourne les modèles réellement collectés", () => {
    expect(getCollectedModelNames(expected, ["ARPEGE"])).toEqual(["AROME", "ICON"]);
  });

  it("traite une liste d’absences inconnue comme aucune absence déclarée", () => {
    expect(getCollectedModelNames(expected, null)).toEqual(expected);
  });

  it("écarte les valeurs non textuelles d’une liste JSON", () => {
    expect(getMissingModelNames(["ICON", 5, null])).toEqual(["ICON"]);
  });
});
