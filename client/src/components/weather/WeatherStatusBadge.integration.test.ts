import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const readPage = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("harmonisation des badges météo", () => {
  it("réutilise les statuts visuels avec des notes de fiabilité distinctes d’un score 0–100", () => {
    const ranking = readPage("../../pages/Ranking.tsx");
    const dashboard = readPage("../../pages/Dashboard.tsx");
    const reliability = [
      readPage("../../pages/ReliabilityLaboratory.tsx"),
      readPage("./ReliabilityEvidenceSections.tsx"),
      readPage("./ReliabilityComparisonSections.tsx"),
    ].join("\n");
    const aiLab = readPage("../../pages/WeatherAILab.tsx");
    const report = readPage("../../pages/Report.tsx");

    expect(ranking).toContain("WeatherStatusBadge");
    expect(ranking).toContain("sans note 0–100");
    expect(dashboard).toContain("WeatherStatusBadge");
    expect(dashboard).toContain(
      "Observations actuelles et valeurs prévisionnelles"
    );
    expect(dashboard).toContain("Visibilité prévue");
    expect(dashboard).not.toContain(">Prévisions horaires");
    expect(reliability).toContain("Fiabilité MeteoAI");
    expect(reliability).toContain("Note globale MeteoAI");
    expect(reliability).toContain("Fiabilité MeteoAI");
    expect(reliability).not.toContain("normalizedScore");
    expect(aiLab).toContain("Hors fusion");
    expect(report).toContain(
      "Ces statistiques ne mesurent pas la fiabilité historique."
    );
  });
});
