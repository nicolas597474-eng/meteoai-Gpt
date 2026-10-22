import { describe, expect, it } from "vitest";
import { getValidationModelSource } from "./validationModelSource";

describe("getValidationModelSource", () => {
  it("isole les modèles candidats de la liste de fusion", () => {
    const source = getValidationModelSource([
      { type: "API météo", models: ["AROME"] },
      { type: "Collecte d'observation", models: ["DMI HARMONIE-DINI", "ICON-D2"] },
    ]);
    expect(source?.models).toEqual(["DMI HARMONIE-DINI", "ICON-D2"]);
  });

  it("retourne null sans source candidate", () => {
    expect(getValidationModelSource([{ type: "API météo", models: ["AROME"] }])).toBeNull();
  });
});
