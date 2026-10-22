import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = [
  readFileSync(new URL("./ReliabilityLaboratory.tsx", import.meta.url), "utf8"),
  readFileSync(
    new URL(
      "../components/weather/ReliabilityEvidenceSections.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFileSync(
    new URL(
      "../components/weather/ReliabilityComparisonSections.tsx",
      import.meta.url
    ),
    "utf8"
  ),
]
  .join("\n")
  .replace(/\s+/g, " ");

describe("ReliabilityLaboratory — preuves brutes", () => {
  it("sélectionne une fenêtre et un horizon exacts sans repli vers une autre échéance", () => {
    expect(source).toContain('useState<PeriodId>("7d")');
    expect(source).toContain('useState<HorizonId>("6-24h")');
    expect(source).toContain(
      "Aucune échéance voisine ni période extérieure n’est utilisée en repli."
    );
  });

  it("sépare les métriques historiques par modèle, variable et horizon exact", () => {
    expect(source).toContain("Fiabilité historique, vérifiée sur observations");
    expect(source).toContain(
      "MAE, RMSE, biais, effectifs, dates et évolution par modèle × variable × horizon exact"
    );
    expect(source).toContain(
      "Le biais signé est descriptif et n’est jamais appliqué aux prévisions officielles futures."
    );
    expect(source).toContain(
      "Fiabilité historique · modèle × variable × horizon"
    );
    expect(source).toContain("row.modelId");
    expect(source).toContain("row.variableLabel");
    expect(source).toContain("row.horizonId");
    expect(source).not.toContain("normalizedScore");
    expect(source).not.toContain("averageScore");
    expect(source).not.toContain("Meilleur modèle");
    expect(source).not.toContain("/100");
  });

  it("montre des statuts explicites et ne transforme pas les valeurs indisponibles en zéro", () => {
    expect(source).toContain("Seuil d’évidence atteint");
    expect(source).toContain("Données insuffisantes");
    expect(source).toContain("Horizon non archivé séparément");
    expect(source).toContain("Historique indisponible");
    expect(source).toContain("Brut non validé · hors preuves");
    expect(source).toContain(
      "Une cellule « — » signifie non disponible, pas zéro."
    );
    expect(source).toContain("Aucune métrique n’est estimée");
    expect(source).toContain("ligne(s) brute(s) non validée(s)");
    expect(source).toContain("row.rawMetrics");
    expect(source).toContain("Plage des MAE brutes");
  });

  it("distingue un horizon non archivé d’une absence de qualification", () => {
    expect(source).toContain("Note globale ·");
    expect(source).toContain("Note horaire");
    expect(source).toContain("Note quotidienne");
    expect(source).toContain("Aucune note n’est inventée");
    expect(source).toContain(
      "Horizon non archivé séparément : les taux de couverture sont indisponibles"
    );
  });

  it("conserve la porte d’évidence, les effectifs distincts et les dates des scores", () => {
    expect(source).toContain("minimumComparisons");
    expect(source).toContain("minimumComparableDays");
    expect(source).toContain("comparisonCount");
    expect(source).toContain("evaluatedDays");
    expect(source).toContain("firstScoreDate");
    expect(source).toContain("latestScoreDate");
    expect(source).toContain("latestComputedAt");
    expect(source).toContain("Fenêtre");
  });

  it("exclut Best Match et distingue la dispersion de l’erreur face aux observations", () => {
    expect(source).toContain(
      "Best Match/agrégateurs, modèles candidats et autres horizons ne sont jamais utilisés comme substituts."
    );
    expect(source).toContain(
      "L’accord inter-modèles décrit une dispersion de prévisions et n’est pas une mesure de fiabilité."
    );
    expect(source).toContain("L’accord inter-modèles");
  });

  it("ne contient plus le bloc stations et capteurs autour du lieu", () => {
    expect(source).not.toContain("Stations et capteurs autour du lieu");
    expect(source).not.toContain("StationQualificationSection");
    expect(source).not.toContain("searchStations");
    expect(source).not.toContain("getCitizenQualificationEvidence");
  });
});

