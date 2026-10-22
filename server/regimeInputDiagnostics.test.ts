import { describe, expect, it } from "vitest";
import { OFFICIAL_REGIME_INPUTS, summarizeRegimeInputCoverage } from "../shared/regimeInputDiagnostics";

describe("summarizeRegimeInputCoverage", () => {
  it("compte exactement les six entrées et distingue disponible, absente, invalide et périmée", () => {
    const inputs = OFFICIAL_REGIME_INPUTS.map(({ key }) => ({
      key,
      status: key === "temperature" || key === "precipitation"
        ? "available" as const
        : key === "windSpeed"
          ? "invalid" as const
          : key === "humidity"
            ? "stale" as const
            : "missing" as const,
    }));

    expect(summarizeRegimeInputCoverage(inputs)).toEqual({
      total: 6,
      available: 2,
      missing: 2,
      invalid: 1,
      stale: 1,
      status: "partial",
    });
  });

  it("ne présente pas une couverture absente comme complète ou vérifiée", () => {
    expect(summarizeRegimeInputCoverage(null)).toMatchObject({ total: 6, status: "unavailable" });
    expect(summarizeRegimeInputCoverage([])).toMatchObject({ total: 6, missing: 6, status: "none" });
  });
});
