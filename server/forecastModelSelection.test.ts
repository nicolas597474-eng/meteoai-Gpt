import { describe, expect, it } from "vitest";
import { selectEligibleModelsForHorizon } from "./forecastModelSelection";
import { calculateRobustFallbackMultipliers, normalizeModelWeightsWithCap } from "./fusionPerformance";

const validTime = Date.parse("2026-10-10T12:00:00.000Z");
const referenceAt = Date.parse("2026-10-10T06:00:00.000Z");
const bucketFor = (minutes: number) => minutes <= 6 * 60 ? "0-6h" : minutes <= 24 * 60 ? "6-24h" : "1-3d";

function candidate(modelName: string, value: unknown, availableAt: number | null, overrides: Record<string, unknown> = {}) {
  return {
    modelName,
    modelId: `${modelName.toLowerCase()}_id`,
    sourceName: "open-meteo",
    runId: `${modelName}-run`,
    availableAt,
    validTime,
    value,
    metadata: {},
    ...overrides,
  };
}

describe("selectEligibleModelsForHorizon", () => {
  it("garde seulement le run exact, reçu avant la fusion, avec une valeur finie", () => {
    const selected = selectEligibleModelsForHorizon([
      candidate("ECMWF", 12, referenceAt - 30 * 60_000),
      candidate("ECMWF", 99, referenceAt + 60_000),
      candidate("AROME", null, referenceAt - 60 * 60_000),
      candidate("GFS", 8, referenceAt - 60 * 60_000, { validTime: validTime + 60_000 }),
    ], {
      expectedModelNames: ["ECMWF", "AROME", "GFS", "UKMET"],
      variable: "temperature",
      validTime,
      referenceAt,
      horizonBucketForMinutes: bucketFor,
    });

    expect(selected.eligible.map(({ modelName, value }) => [modelName, value])).toEqual([["ECMWF", 12]]);
    expect(selected.eligible[0]).toMatchObject({ horizonMinutes: 390, horizonBucket: "6-24h", availableAt: referenceAt - 30 * 60_000 });
    expect(selected.diagnostics.find(({ modelName }) => modelName === "AROME")?.reason).toContain("valeur finie");
    expect(selected.diagnostics.find(({ modelName }) => modelName === "GFS")?.reason).toContain("validTime");
    expect(selected.diagnostics.find(({ modelName }) => modelName === "UKMET")).toMatchObject({
      reason: expect.stringContaining("Aucun run"),
      validTime,
      availableAt: null,
    });
  });

  it("ne remplace jamais un availableAt manquant par requestStartedAt", () => {
    const selected = selectEligibleModelsForHorizon([
      candidate("ARPEGE", 10, null, { requestStartedAt: referenceAt - 60 * 60_000 }),
    ], {
      expectedModelNames: ["ARPEGE"],
      variable: "temperature",
      validTime,
      referenceAt,
      horizonBucketForMinutes: bucketFor,
    });
    expect(selected.eligible).toEqual([]);
    expect(selected.diagnostics[0].reason).toContain("aucun horodatage de requête");
  });

  it("calcule le lead horaire depuis providerRunAt, jamais depuis l’heure de réception", () => {
    const providerRunAt = validTime - 8 * 60 * 60_000;
    const availableAt = referenceAt - 30 * 60_000;
    const selected = selectEligibleModelsForHorizon([
      candidate("ECMWF", 12, availableAt, { providerRunAt }),
    ], {
      expectedModelNames: ["ECMWF"],
      variable: "temperature",
      validTime,
      referenceAt,
      leadTimeBasis: "provider_run_at",
      horizonBucketForMinutes: bucketFor,
    });

    expect(selected.eligible[0]).toMatchObject({
      availableAt,
      providerRunAt,
      horizonMinutes: 480,
      horizonBucket: "6-24h",
    });
  });

  it("laisse le lead horaire inconnu quand providerRunAt n’est pas attesté", () => {
    const selected = selectEligibleModelsForHorizon([
      candidate("ECMWF", 12, referenceAt - 30 * 60_000),
      candidate("AROME", 10, referenceAt - 30 * 60_000, { providerRunAt: referenceAt }),
    ], {
      expectedModelNames: ["ECMWF", "AROME"],
      variable: "temperature",
      validTime,
      referenceAt,
      leadTimeBasis: "provider_run_at",
      allowUnknownLead: true,
      horizonBucketForMinutes: bucketFor,
    });

    expect(selected.eligible).toHaveLength(2);
    expect(selected.eligible.every((item) => item.horizonMinutes === null && item.horizonBucket === null)).toBe(true);
    expect(selected.diagnostics.every((item) => item.eligible && item.horizonMinutes === null && item.horizonBucket === null)).toBe(true);
  });

  it("permet une échéance positive hors des tranches historisées sans emprunter une autre tranche", () => {
    const selected = selectEligibleModelsForHorizon([
      candidate("ECMWF", 14, validTime - 16 * 24 * 60 * 60_000),
    ], {
      expectedModelNames: ["ECMWF"],
      variable: "temperature_max",
      validTime,
      referenceAt,
      horizonBucketForMinutes: () => null,
      allowUnscoredHorizons: true,
    });
    expect(selected.eligible).toHaveLength(1);
    expect(selected.eligible[0].horizonBucket).toBeNull();
  });
});

describe("dynamic model weights", () => {
  it("never blocks a single/two-model set solely because of the nominal 35% cap", () => {
    const one = normalizeModelWeightsWithCap([{ modelId: "A", rawWeight: 1 }]);
    const two = normalizeModelWeightsWithCap([
      { modelId: "A", rawWeight: 1 },
      { modelId: "B", rawWeight: 1 },
    ]);
    expect(one?.get("A")).toBe(1);
    expect(two?.get("A")).toBeCloseTo(0.5, 12);
    expect(two?.get("B")).toBeCloseTo(0.5, 12);
  });

  it("bounds an uncalibrated outlier without assigning zero weight", () => {
    const weights = calculateRobustFallbackMultipliers([
      { modelId: "A", value: 10 },
      { modelId: "B", value: 10 },
      { modelId: "C", value: 11 },
      { modelId: "D", value: 90 },
    ]);
    expect(weights.get("D")).toBeGreaterThanOrEqual(0.25);
    expect(weights.get("D")).toBeLessThan(weights.get("A")!);
  });
});
