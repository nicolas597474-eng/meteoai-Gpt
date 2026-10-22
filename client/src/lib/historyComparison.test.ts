import { describe, expect, it } from "vitest";
import { getMeteoAIComparisonLabel } from "./historyComparison";

describe("getMeteoAIComparisonLabel", () => {
  it("ne transforme pas une prévision absente en écart nul", () => {
    expect(getMeteoAIComparisonLabel(18, null)).toBe("Comparaison indisponible");
    expect(getMeteoAIComparisonLabel(18, undefined)).toBe("Comparaison indisponible");
  });

  it("signale l’absence d’observation plutôt que de calculer un écart", () => {
    expect(getMeteoAIComparisonLabel(null, 18)).toBe("Observation indisponible");
  });

  it("conserve les zéros comme valeurs présentes", () => {
    expect(getMeteoAIComparisonLabel(0, 0)).toBe("Écart MeteoAI 0.0°C");
    expect(getMeteoAIComparisonLabel(0, 2)).toBe("Écart MeteoAI 2.0°C");
  });
});
