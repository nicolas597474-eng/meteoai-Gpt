import { describe, expect, it } from "vitest";
import { getCenteredHourScrollLeft, getHourCenterX, getHourScrollLeft, getNearestCenteredHourIndex, getNearestHourIndex } from "./hourlyScrollSync";

describe("synchronisation horaire courbe et cartes", () => {
  it("résout la même heure depuis un défilement de courbe ou de cartes", () => {
    expect(getNearestHourIndex(204, 68, 24)).toBe(3);
    expect(getNearestHourIndex(558, 186, 24)).toBe(3);
  });

  it("cale chaque vue sur la position exacte de l’heure sélectionnée", () => {
    expect(getHourScrollLeft(12, 68, 24)).toBe(816);
    expect(getHourScrollLeft(12, 186, 24)).toBe(2232);
  });

  it("place le point de la courbe au centre de la carte correspondante", () => {
    expect(getHourCenterX(0, 186, 174, 24)).toBe(87);
    expect(getHourCenterX(7, 186, 174, 24)).toBe(1389);
  });

  it("calle le créneau choisi au centre sans dépasser les extrémités", () => {
    expect(getCenteredHourScrollLeft(0, 186, 174, 24, 360)).toBe(0);
    expect(getCenteredHourScrollLeft(3, 186, 174, 24, 360)).toBe(465);
    expect(getNearestCenteredHourIndex(465, 360, 186, 174, 24)).toBe(3);
  });

  it("respecte les limites de la première et dernière heure", () => {
    expect(getNearestHourIndex(-20, 68, 5)).toBe(0);
    expect(getNearestHourIndex(9999, 68, 5)).toBe(4);
  });
});
