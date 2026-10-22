import { describe, expect, it } from "vitest";
import { buildEveningEvidence } from "./historyEvidence";

const validSnapshot = (hour: number, stationId = "station-1") => ({
  date: "2026-08-20",
  hour,
  stationCount: 1,
  temperature: 18,
  windSpeed: 8,
  windGust: 14,
  precipitation: 0,
  stationsUsed: [{ stationId, name: "Station de test", source: "netatmo", distanceKm: 2.5 }],
});

describe("buildEveningEvidence", () => {
  it("ne qualifie une soirée que lorsque les 18 heures physiques sont réellement couvertes", () => {
    const evidence = buildEveningEvidence(Array.from({ length: 18 }, (_, hour) => validSnapshot(hour)), []);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ coverageHours: 18, requiredCoverageHours: 18, isQualified: true });
    expect(evidence[0]?.stations).toEqual([{ stationId: "station-1", name: "Station de test", source: "netatmo", distanceKm: 2.5 }]);
  });

  it("expose le motif réel d’exclusion quand la couverture horaire est insuffisante", () => {
    const evidence = buildEveningEvidence([validSnapshot(18), validSnapshot(19)], []);
    expect(evidence[0]).toMatchObject({ coverageHours: 2, isQualified: false });
    expect(evidence[0]?.exclusionReason).toBe("Couverture insuffisante : 2/18 heures physiques qualifiées");
  });

  it("signale l’absence de snapshot sans inventer de couverture ni de station", () => {
    const evidence = buildEveningEvidence([], [{ date: "2026-08-19", status: "partial" }]);
    expect(evidence[0]).toMatchObject({ snapshotHours: 0, coverageHours: 0, isQualified: false, stations: [], collectionStatus: "partial" });
    expect(evidence[0]?.exclusionReason).toBe("Aucun snapshot physique qualifié n’a été archivé pour cette journée.");
  });

  it("expose les traces horaires physiques futures sans modifier la qualification historique", () => {
    const evidence = buildEveningEvidence([], [], [{
      date: "2026-08-21",
      hour: 9,
      locationKey: "50.781,2.544",
      locationName: "Hondeghem",
      status: "failed",
      attempts: 2,
      stationCount: 0,
      reason: "Erreur de collecte après relance : timeout",
    }]);

    expect(evidence[0]).toMatchObject({
      date: "2026-08-21",
      snapshotHours: 0,
      coverageHours: 0,
      isQualified: false,
      collectionTraces: [{ status: "failed", attempts: 2, reason: "Erreur de collecte après relance : timeout" }],
    });
  });
});
