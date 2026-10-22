import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// La page s'appuie depuis l'optimisation sur un module de graphiques chargé en
// différé : les assertions portent donc sur l'ensemble des fichiers qui la
// composent, pas seulement sur le composant de page.
const source = [
  readFileSync(new URL("./History.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../components/HistoryCharts.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../lib/historyChartFormat.ts", import.meta.url), "utf8"),
].join("\n");

describe("History", () => {
  it("isole la comparaison sur un modèle sélectionné afin d’éviter les graphiques surchargés", () => {
    expect(source).toContain("Modèle comparé");
    expect(source).toContain("comparisonModel");
    expect(source).toContain("CompactTemperatureChart");
    expect(source).toContain("Courbes comparatives : observation, MeteoAI");
  });

  it("propose une lecture jour par jour sans dépendre du survol du graphique", () => {
    expect(source).toContain("Lecture jour par jour");
    expect(source).toContain("DailyComparison");
    expect(source).toContain("Écart");
    expect(source).toContain("showAllDays");
    expect(source).toContain("Afficher les");
    expect(source).toContain("Référence archivée");
    expect(source).toContain("Comparaison en attente");
  });

  it("n’affiche pas un écart MeteoAI nul lorsque la prévision est absente", () => {
    expect(source).toContain("getMeteoAIComparisonLabel");
    expect(source).not.toContain("Math.abs(meteoAIErr ?? 0)");
  });

  it("conserve l’état d’historique en constitution sans réintroduire des scores par échéance", () => {
    expect(source).toContain("Aucune archive pour cette période");
    expect(source).not.toContain("Scores encore insuffisants");
    expect(source).not.toContain("Données par échéance insuffisantes");
    expect(source).not.toContain("normalizedScore");
  });

  it("affiche les preuves réellement collectées chaque soir sans inventer de couverture", () => {
    expect(source).toContain("EveningEvidence");
    expect(source).toContain("Preuves collectées chaque soir");
    expect(source).toContain("Couverture réelle");
    expect(source).toContain("Stations contributrices");
    expect(source).toContain("Motif d’exclusion");
    expect(source).toContain("Score non mis à jour");
    expect(source).toContain("data?.eveningEvidence ?? []");
    expect(source).toContain("isEveningEvidenceOpen");
    expect(source).toContain('aria-controls="evening-evidence-content"');
    expect(source).toContain('id="evening-evidence-content"');
    expect(source).toContain("ChevronDown");
    expect(source).toContain("ChevronUp");
  });

  it("explique les collectes horaires physiques futures avec statuts, tentatives et motifs", () => {
    expect(source).toContain("Statut de collecte horaire");
    expect(source).toContain("collectionTraces");
    expect(source).toContain("tentative");
    expect(source).toContain("Le détail par lieu, heure, tentative et motif sera disponible pour les collectes futures");
    expect(source).toContain("Aucune station qualifiée");
    expect(source).toContain("Échec après relance");
  });

  it("fournit des infobulles interactives contextualisées pour chaque graphique", () => {
    expect(source).toContain("HistoryChartTooltip");
    expect(source).toContain('role="tooltip"');
    expect(source).toContain("Écart MeteoAI / observation");
    expect(source).toContain("Fermer le détail d’observation");
    expect(source).toContain("dismissedLabel");
    expect(source).toContain('style={{ pointerEvents: "auto" }}');
    expect(source).toContain("onPointerDown={dismissTooltip}");
    expect(source).toContain('touchAction: "manipulation"');
    expect(source).toContain("activeDot");
    expect(source).toContain("cursor={{ stroke");
  });

  it("rend les températures et la pluie en courbes sans relier les valeurs absentes", () => {
    expect(source).toContain("Courbes comparatives");
    expect(source).not.toContain("BarChart");
    expect(source).not.toContain("<Bar ");
    expect(source).toContain("connectNulls={false}");
    expect(source).toContain('domain={["dataMin - 2", "dataMax + 2"]}');
  });

  it("donne une clé de lecture explicite et des couleurs distinctes aux courbes", () => {
    expect(source).toContain("CurveLegend");
    expect(source).toContain("Clé de lecture des courbes");
    expect(source).toContain("référence archivée");
    expect(source).toContain("modèle comparé");
    expect(source).toContain('stroke="#34d399"');
    expect(source).toContain('stroke="#38bdf8"');
  });
});
