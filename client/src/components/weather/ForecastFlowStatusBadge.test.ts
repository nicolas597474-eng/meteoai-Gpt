import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ForecastFlowStatusBadge", () => {
  it("explique les quatre états opérationnels et leur seuil de fraîcheur", () => {
    const source = readFileSync(new URL("./ForecastFlowStatusBadge.tsx", import.meta.url), "utf8");
    for (const status of ["SUCCESS", "PARTIAL", "FAILED", "STALE"]) expect(source).toContain(status);
    expect(source).toContain("30 heures");
    expect(source).toContain("Légende des statuts opérationnels");
  });
});
