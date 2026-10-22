import { describe, expect, it } from "vitest";
import { OFFICIAL_REGIME_INPUTS } from "@shared/regimeInputDiagnostics";
import { getDashboardObservability } from "./dashboardObservability";

const now = new Date("2026-08-28T12:00:00.000Z");
const selectedLocationInputs = OFFICIAL_REGIME_INPUTS.map(({ key }) => ({
  key,
  label: key,
  unit: "",
  value: key === "visibilityKm" ? null : 1,
  status: key === "visibilityKm" ? "missing" as const : "available" as const,
  source: "official_snapshot" as const,
  sourceLabel: "Fusion quotidienne multi-modèles",
  sourceUpdatedAt: "2026-08-28T10:00:00.000Z",
  validAt: null,
  sourceAgeMinutes: 120,
}));

function observe(overrides: Parameters<typeof getDashboardObservability>[0] = {}) {
  return getDashboardObservability({
    selectedLocationLabel: "Hondeghem",
    selectedLocationRegimeInputs: selectedLocationInputs,
    latestGlobalBatchStatus: "completed",
    latestGlobalBatchAt: "2026-08-28T10:00:00.000Z",
    now,
    ...overrides,
  });
}

describe("getDashboardObservability", () => {
  it("maintient séparés le diagnostic du lieu sélectionné et l’état du lot planifié global", () => {
    const initial = observe();
    expect(initial.selectedLocationLabel).toBe("Hondeghem");
    expect(initial.selectedLocationCoverage).toMatchObject({ total: 6, available: 5, missing: 1, status: "partial" });
    expect(initial.latestGlobalBatchHealth.status).toBe("up_to_date");

    const onlyLocalCoverageChanged = observe({
      selectedLocationRegimeInputs: selectedLocationInputs.map((input) => ({ ...input, status: "missing" as const, value: null })),
    });
    expect(onlyLocalCoverageChanged.selectedLocationCoverage.status).toBe("none");
    expect(onlyLocalCoverageChanged.latestGlobalBatchHealth).toEqual(initial.latestGlobalBatchHealth);

    const onlyGlobalBatchChanged = observe({ latestGlobalBatchStatus: "failed", latestGlobalBatchAt: null });
    expect(onlyGlobalBatchChanged.latestGlobalBatchHealth.status).toBe("technical_error");
    expect(onlyGlobalBatchChanged.selectedLocationCoverage).toEqual(initial.selectedLocationCoverage);
  });
});
