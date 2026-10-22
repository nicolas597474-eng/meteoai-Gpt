import { describe, expect, it } from "vitest";
import {
  LOCAL_TEMPERATURE_NOWCAST_MAX_CORRECTION_C,
  calculateLocalTemperatureNowcast,
} from "../shared/localTemperatureNowcastingShadow";

const observedAt = Date.UTC(2026, 9, 3, 8, 0, 0);

function input(overrides: Partial<Parameters<typeof calculateLocalTemperatureNowcast>[0]> = {}) {
  return {
    baselineTemperature: 18.2,
    observedTemperature: 16.9,
    observationReferenceAt: observedAt,
    forecastAvailableAt: observedAt - 60 * 60 * 1_000,
    validTime: observedAt,
    evaluatedAt: observedAt + 20 * 60 * 1_000,
    stationCount: 3,
    confidenceScore: 85,
    ...overrides,
  };
}

describe("calculateLocalTemperatureNowcast", () => {
  it("applique le résidu qualifié à l’heure observée puis le fait décroître", () => {
    const now = calculateLocalTemperatureNowcast(input());
    const plusThreeHours = calculateLocalTemperatureNowcast(input({ validTime: observedAt + 3 * 60 * 60 * 1_000 }));
    const plusSixHours = calculateLocalTemperatureNowcast(input({ validTime: observedAt + 6 * 60 * 60 * 1_000 }));

    expect(now.status).toBe("READY");
    expect(now.rawResidual).toBe(-1.3);
    expect(now.appliedCorrection).toBe(-1.3);
    expect(now.correctedTemperature).toBe(16.9);
    expect(plusThreeHours.correctionFactor).toBe(0.35);
    expect(plusThreeHours.appliedCorrection).toBe(-0.46);
    expect(plusSixHours.status).toBe("BASELINE_ONLY");
    expect(plusSixHours.appliedCorrection).toBe(0);
    expect(plusSixHours.correctedTemperature).toBe(18.2);
  });

  it("bloque une prévision qui serait devenue disponible après l’observation", () => {
    const result = calculateLocalTemperatureNowcast(input({ forecastAvailableAt: observedAt + 1 }));
    expect(result.status).toBe("LEAKAGE_BLOCKED");
    expect(result.correctedTemperature).toBeNull();
    expect(result.reasons).toContain("PREVISION_DISPONIBLE_APRES_OBSERVATION");
  });

  it("refuse une observation trop ancienne et ne fabrique pas de valeur corrigée", () => {
    const result = calculateLocalTemperatureNowcast(input({ evaluatedAt: observedAt + 91 * 60 * 1_000 }));
    expect(result.status).toBe("STALE_OBSERVATION");
    expect(result.correctedTemperature).toBeNull();
  });

  it("borne les corrections exceptionnelles à ±3 °C", () => {
    const result = calculateLocalTemperatureNowcast(input({ observedTemperature: 28 }));
    expect(result.status).toBe("READY");
    expect(result.boundedResidual).toBe(LOCAL_TEMPERATURE_NOWCAST_MAX_CORRECTION_C);
    expect(result.correctionClamped).toBe(true);
    expect(result.correctedTemperature).toBe(21.2);
  });
});
