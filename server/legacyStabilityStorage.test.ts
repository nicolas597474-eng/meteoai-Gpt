import { describe, expect, it } from "vitest";
import type { ForecastRow } from "./statsEngine";
import { legacyStabilityLabelForStorage } from "./legacyStabilityStorage";

const agreeingForecasts: ForecastRow[] = [
  { tempMax: 25, tempMin: 15, precipitation: 2, windSpeed: 10 },
  { tempMax: 25, tempMin: 15, precipitation: 2, windSpeed: 10 },
  { tempMax: 25, tempMin: 15, precipitation: 2, windSpeed: 10 },
];

const divergentForecasts: ForecastRow[] = [
  { tempMax: 30, tempMin: 20, precipitation: 0, windSpeed: 5 },
  { tempMax: 20, tempMin: 10, precipitation: 15, windSpeed: 30 },
  { tempMax: 35, tempMin: 25, precipitation: 0, windSpeed: 10 },
];

describe("legacyStabilityLabelForStorage", () => {
  it("reproduit le label exact de l’ancienne formule pour la colonne de stockage obligatoire", () => {
    expect(legacyStabilityLabelForStorage(agreeingForecasts)).toBe("stable");
    expect(legacyStabilityLabelForStorage(divergentForecasts)).toBe("unstable");
    expect(typeof legacyStabilityLabelForStorage(divergentForecasts)).toBe("string");
  });

  it("préserve le comportement historique pour un échantillon vide ou insuffisant", () => {
    expect(legacyStabilityLabelForStorage([])).toBe("stable");
    expect(legacyStabilityLabelForStorage([agreeingForecasts[0]!])).toBe("stable");
  });
});
