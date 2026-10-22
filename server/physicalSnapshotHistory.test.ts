import { describe, expect, it } from "vitest";
import { buildRecentPhysicalSnapshotSlots } from "./physicalSnapshotHistory";

describe("buildRecentPhysicalSnapshotSlots", () => {
  it("rend explicitement une heure écoulée sans trace sans écrire d’archive", () => {
    const history = buildRecentPhysicalSnapshotSlots([
      { date: "2026-08-27", hour: 19, status: "stored", attempts: 1, stationCount: 146 },
    ], new Date("2026-08-27T18:30:00Z"));

    expect(history.slice(0, 3)).toEqual([
      { date: "2026-08-27", hour: 19, status: "stored", attempts: 1, stationCount: 146 },
      expect.objectContaining({ date: "2026-08-27", hour: 18, status: "missing", attempts: 0 }),
      expect.objectContaining({ date: "2026-08-27", hour: 17, status: "missing", attempts: 0 }),
    ]);
  });

  it("inclut l’heure en cours seulement après la fenêtre de reprise à :45", () => {
    const history = buildRecentPhysicalSnapshotSlots([
      { date: "2026-08-27", hour: 20, status: "stored", attempts: 1, stationCount: 148 },
    ], new Date("2026-08-27T18:46:00Z"));

    expect(history[0]).toMatchObject({ date: "2026-08-27", hour: 20, status: "stored" });
  });
});
