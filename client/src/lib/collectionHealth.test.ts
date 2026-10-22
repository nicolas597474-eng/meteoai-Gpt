import { describe, expect, it } from "vitest";
import { countArchivedSnapshotSlots, formatCollectionDuration, getCollectionHealth } from "./collectionHealth";

describe("getCollectionHealth", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");

  it("signale une collecte à jour", () => {
    const health = getCollectionHealth({
      lastRunStatus: "completed",
      lastSuccessAt: "2026-08-28T10:00:00.000Z",
      now,
    });
    expect(health.label).toBe("À jour");
    expect(health.status).toBe("up_to_date");
    expect(health.detail).toBe("Succès de prévisions récent · il y a 2 h");
  });

  it("signale une collecte partielle", () => {
    const health = getCollectionHealth({
      lastRunStatus: "completed",
      lastSuccessAt: "2026-08-28T10:00:00.000Z",
      partial: true,
      now,
    });
    expect(health.label).toBe("Partiel");
    expect(health.status).toBe("partial");
  });

  it("signale une collecte en retard", () => {
    const health = getCollectionHealth({
      lastRunStatus: "completed",
      lastSuccessAt: "2026-08-27T08:00:00.000Z",
      now,
    });
    expect(health.label).toBe("En retard");
    expect(health.status).toBe("late");
  });

  it("signale une erreur technique avant les autres états", () => {
    const health = getCollectionHealth({
      lastRunStatus: "failed",
      lastSuccessAt: "2026-08-28T10:00:00.000Z",
      now,
    });
    expect(health.label).toBe("Erreur technique");
    expect(health.status).toBe("technical_error");
  });
});

describe("formatCollectionDuration", () => {
  it("formate les millisecondes et les secondes", () => {
    expect(formatCollectionDuration(420)).toBe("420 ms");
    expect(formatCollectionDuration(12_400)).toBe("12 s");
    expect(formatCollectionDuration(72_000)).toBe("1 min 12 s");
    expect(formatCollectionDuration(null)).toBe("Non mesurée");
  });
});

describe("countArchivedSnapshotSlots", () => {
  it("ne compte que les créneaux dont les données sont effectivement archivées", () => {
    expect(countArchivedSnapshotSlots([
      { status: "stored" },
      { status: "no_station" },
      { status: "failed" },
      { status: "missing" },
      { status: "stored" },
    ])).toBe(2);
    expect(countArchivedSnapshotSlots(undefined)).toBe(0);
  });
});
