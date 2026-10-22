import { describe, expect, it } from "vitest";
import {
  calculateLocalPrecipitationNowcast,
} from "../shared/localPrecipitationNowcastingShadow";

const observedAt = Date.UTC(2026, 9, 1, 10, 0, 0);

function input(overrides: Partial<Parameters<typeof calculateLocalPrecipitationNowcast>[0]> = {}) {
  return {
    baselinePrecipitation: 0,
    observedPrecipitation: 0.4,
    observationReferenceAt: observedAt,
    forecastAvailableAt: observedAt - 60 * 60 * 1_000,
    validTime: observedAt,
    evaluatedAt: observedAt + 20 * 60 * 1_000,
    stationCount: 3,
    confidenceScore: 85,
    ...overrides,
  };
}

describe("calculateLocalPrecipitationNowcast", () => {
  it("produit un signal humide local à présent puis le limite strictement à deux heures", () => {
    const now = calculateLocalPrecipitationNowcast(input());
    const plusOneHour = calculateLocalPrecipitationNowcast(input({ validTime: observedAt + 60 * 60 * 1_000 }));
    const plusTwoHours = calculateLocalPrecipitationNowcast(input({ validTime: observedAt + 2 * 60 * 60 * 1_000 }));

    expect(now.status).toBe("WET_SIGNAL");
    expect(now.localWetSignal).toBe(true);
    expect(now.continuationFactor).toBe(1);
    expect(plusOneHour.status).toBe("WET_SIGNAL");
    expect(plusOneHour.continuationFactor).toBe(0.5);
    expect(plusTwoHours.status).toBe("BASELINE_DRY");
    expect(plusTwoHours.localWetSignal).toBe(false);
    expect(plusTwoHours.reasons).toContain("SIGNAL_LOCAL_EXPIRE_A_2H");
  });

  it("ne modifie jamais le montant de pluie : une station sèche ne retire pas la pluie modélisée", () => {
    const result = calculateLocalPrecipitationNowcast(input({
      baselinePrecipitation: 2.1,
      observedPrecipitation: 0,
    }));
    expect(result.status).toBe("BASELINE_WET");
    expect(result.localWetSignal).toBe(false);
    expect(result.baselinePrecipitation).toBe(2.1);
    expect(result.reasons).toContain("OBSERVATION_SECHE_NE_SUPPRIME_PAS_LA_PLUIE_MODELISEE");
  });

  it("bloque les données futures et les observations trop anciennes", () => {
    const leaked = calculateLocalPrecipitationNowcast(input({ forecastAvailableAt: observedAt + 1 }));
    const stale = calculateLocalPrecipitationNowcast(input({ evaluatedAt: observedAt + 91 * 60 * 1_000 }));
    expect(leaked.status).toBe("LEAKAGE_BLOCKED");
    expect(leaked.localWetSignal).toBe(false);
    expect(stale.status).toBe("STALE_OBSERVATION");
    expect(stale.localWetSignal).toBe(false);
  });

  it("refuse une mesure sans archive ou sans observation physique qualifiée", () => {
    const missingBaseline = calculateLocalPrecipitationNowcast(input({ baselinePrecipitation: null }));
    const missingObservation = calculateLocalPrecipitationNowcast(input({ observedPrecipitation: null }));
    expect(missingBaseline.status).toBe("UNAVAILABLE");
    expect(missingBaseline.reasons).toContain("PREVISION_HORAIRE_PRECIPITATION_INDISPONIBLE");
    expect(missingObservation.status).toBe("UNAVAILABLE");
    expect(missingObservation.reasons).toContain("OBSERVATION_PHYSIQUE_PRECIPITATION_NON_QUALIFIEE");
  });
});
