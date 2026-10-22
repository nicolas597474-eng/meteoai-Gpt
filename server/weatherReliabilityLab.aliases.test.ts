import { describe, expect, it } from "vitest";
import { normalizeLaboratoryServiceName } from "./weatherReliabilityLab";

describe("normalizeLaboratoryServiceName", () => {
  it("raccorde Best Match au libellé Open-Meteo visible dans le laboratoire", () => {
    expect(normalizeLaboratoryServiceName("best_match")).toBe("Open-Meteo");
  });

  it("raccorde les scores candidats suffixés à leur nom de catalogue", () => {
    expect(normalizeLaboratoryServiceName("DMI HARMONIE-DINI · validation")).toBe("DMI HARMONIE-DINI");
    expect(normalizeLaboratoryServiceName("ICON-D2 · validation")).toBe("ICON-D2");
  });

  it("préserve les noms de modèles déjà normalisés", () => {
    expect(normalizeLaboratoryServiceName("AROME")).toBe("AROME");
  });
});
