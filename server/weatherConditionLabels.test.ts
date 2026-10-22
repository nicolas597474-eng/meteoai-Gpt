import { describe, expect, it } from "vitest";
import { conditionFromWeatherValues, conditionFromWmoWeatherCode } from "./weatherConditionLabels";

describe("conditionFromWeatherValues", () => {
  it("utilise les mêmes seuils de nébulosité que le régime étendu", () => {
    expect(conditionFromWeatherValues(0, 0)).toBe("Ensoleillé");
    expect(conditionFromWeatherValues(0, 36)).toBe("Peu nuageux");
    expect(conditionFromWeatherValues(0, 60)).toBe("Partiellement nuageux");
    expect(conditionFromWeatherValues(0, 90)).toBe("Ciel couvert");
  });

  it("conserve la priorité aux précipitations", () => {
    expect(conditionFromWeatherValues(2, 36)).toBe("Averses");
  });

  it("ne transforme pas des variables absentes ou invalides en ciel ensoleillé", () => {
    expect(conditionFromWeatherValues(null, null)).toBe("Conditions indisponibles");
    expect(conditionFromWeatherValues(0, null)).toBe("Nébulosité indisponible");
    expect(conditionFromWeatherValues(Number.NaN, Number.POSITIVE_INFINITY)).toBe("Conditions indisponibles");
    expect(conditionFromWmoWeatherCode(null, null, null)).toBe("Conditions indisponibles");
  });

  it("privilégie le code WMO de la source lorsqu’il décrit le temps présent", () => {
    expect(conditionFromWmoWeatherCode(0, 0, 100)).toBe("Ensoleillé");
    expect(conditionFromWmoWeatherCode(2, 0, 100)).toBe("Partiellement nuageux");
    expect(conditionFromWmoWeatherCode(3, 0, 20)).toBe("Ciel couvert");
    expect(conditionFromWmoWeatherCode(63, 0, 0)).toBe("Pluie");
  });
});
