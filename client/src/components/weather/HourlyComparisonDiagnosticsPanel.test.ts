import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("HourlyComparisonDiagnosticsPanel", () => {
  it("affiche les compteurs du snapshot et le SHA de build via une requête de lecture seule", () => {
    const source = readFileSync(
      new URL("./HourlyComparisonDiagnosticsPanel.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("getHourlyComparisonDiagnostics.useQuery");
    expect(source).toContain("Entonnoir des comparaisons par variable");
    expect(source).toContain("FUNNEL_STAGES");
    expect(source).toContain("firstRejectionCounts");
    expect(source).toContain("cycleDate");
    expect(source).toContain("__BUILD_COMMIT_SHA__");
    expect(source).toContain("Aucun diagnostic de comparaison horaire");
    expect(source).not.toContain("useMutation");
    expect(source).not.toContain("collectExpertForecasts");
  });
});
