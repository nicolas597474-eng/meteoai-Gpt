import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CollectionObservabilitySections.tsx", import.meta.url), "utf8");

describe("sections Santé du dernier lot global et Couverture du lieu choisi", () => {
  it("interroge le rapport de collecte global et l’observabilité du lieu affiché", () => {
    expect(source).toContain("getForecastCollectionReport");
    expect(source).toContain("getDashboardObservability");
    expect(source).toContain("latestGlobalBatchStatus: latestForecastRunStatus");
    expect(source).toContain("latestGlobalBatchAt: latestForecastRun?.collectedAt ?? null");
    expect(source).not.toContain('partial: collectionHealthReport?.lastForecastSuccess?.status === "partial"');
    expect(source).toContain("regimeInputDiagnostics");
    expect(source).toContain('regimeInputCoverage.status === "unavailable"');
    expect(source).toContain('"diagnostic indisponible"');
  });

  it("affiche la couverture du lieu choisi avec les valeurs réellement retenues", () => {
    expect(source).toContain("Couverture du lieu choisi");
    expect(source).toContain("formatCollectionTimestamp");
    expect(source).toContain("formatDashboardNumber");
    expect(source).toContain("Entrées réellement retenues pour le régime");
    expect(source).toContain("Valeurs exactes retenues pour ce calcul");
  });

  it("qualifie chaque créneau horaire archivé sans le confondre avec un échec technique", () => {
    expect(source).toContain('status: "stored" | "no_station" | "failed" | "missing"');
    expect(source).toContain('label: "Créneau sans trace"');
    expect(source).toContain('label: "Archivé via reprise"');
    expect(source).not.toContain("missingSnapshotSlots");
  });

  it("conserve le libellé et le panneau de détail du dernier lot global", () => {
    expect(source).toContain("Santé du dernier lot global");
    expect(source).toContain("Détails&nbsp;→");
    expect(source).toContain("Santé des collectes");
    expect(source).toContain("collection-health-panel");
    expect(source).toContain("créneaux archivés");
    expect(source).toContain("countArchivedSnapshotSlots(hourlyCollectionHistory)");
    expect(source).toContain("archivedSnapshotSlots}/${hourlyCollectionHistory.length}");
    expect(source).toContain("technicalFailureStreak");
  });

  it("conserve le détail des lots globaux et l’historique des créneaux horaires", () => {
    expect(source).toContain("lastForecastRun");
    expect(source).toContain("recentForecastRuns");
    expect(source).toContain("Deux derniers lots globaux de prévisions");
    expect(source).toContain("dailyModelsCollected}/{run.dailyModelsExpected");
    expect(source).toContain("hourlyModelsCollected}/{run.hourlyModelsExpected");
    expect(source).toContain("nextForecastRun");
    expect(source).toContain("formatCollectionDuration");
    expect(source).toContain("Historique des 24 derniers créneaux horaires");
    expect(source).toContain("Une absence de station qualifiée n’est pas une erreur technique");
  });

  it("rafraîchit la trace horaire sans la confondre avec un échec technique", () => {
    expect(source).toContain("refetchInterval: 60_000");
    expect(source).toContain("refetchIntervalInBackground: false");
    expect(source).toContain("refetchOnWindowFocus: true");
    expect(source).toContain("latestCollectionTraceKeyRef");
    expect(source).toContain("collectionUpdateNotice");
    expect(source).toContain("Trace · {hourlyCollectionMoment(collectionUpdateNotice)}");
    expect(source).toContain("Trace horaire mise à jour");
    expect(source).toContain('latestHourlyCollection.status !== "missing"');
  });

  it("reste rattaché au lieu actif partagé avec le Dashboard et la page Prévisions", () => {
    expect(source).toContain("useOfficialForecast(activeLocation)");
    expect(source).toContain("getOfficialForecastCoordinates(activeLocation)");
    expect(source).toContain('aria-labelledby="collection-health-title"');
    expect(source).toContain('aria-label="Santé des collectes automatiques"');
  });
});
