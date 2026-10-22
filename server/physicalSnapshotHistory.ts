import { getParisDate, getParisHour, getParisMinute } from "./weatherTime";

export type PhysicalSnapshotTraceStatus = "stored" | "no_station" | "failed";

export type PhysicalSnapshotTrace = {
  status: PhysicalSnapshotTraceStatus;
  date: string;
  hour: number;
  attempts: number;
  stationCount: number;
  reason?: string | null;
};

export type PhysicalSnapshotHistoryEntry = PhysicalSnapshotTrace | (Omit<PhysicalSnapshotTrace, "status"> & {
  status: "missing";
});

/**
 * La reprise planifiée à :45 UTC a eu le temps de s’exécuter à partir de cette
 * minute. Avant ce seuil, l’heure en cours n’est jamais déclarée manquante.
 */
export const SNAPSHOT_RECOVERY_READY_MINUTE = 45;

function parisNoon(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/**
 * Produit les 24 derniers créneaux horaires terminés en Europe/Paris. Les
 * créneaux absents sont ajoutés uniquement comme diagnostic en lecture, sans
 * créer de donnée ni modifier les archives existantes.
 */
export function buildRecentPhysicalSnapshotSlots(
  traces: readonly PhysicalSnapshotTrace[],
  now = new Date(),
): PhysicalSnapshotHistoryEntry[] {
  const currentDate = getParisDate(now);
  const currentHour = getParisHour(now);
  const currentMinute = getParisMinute(now);
  const latestElapsedHour = currentMinute >= SNAPSHOT_RECOVERY_READY_MINUTE
    ? currentHour
    : currentHour - 1;
  const known = new Map(traces.map((trace) => [`${trace.date}-${trace.hour}`, trace]));
  const noon = parisNoon(currentDate);

  return Array.from({ length: 24 }, (_, offset) => {
    const rawHour = latestElapsedHour - offset;
    const dayOffset = Math.floor(rawHour / 24);
    const hour = ((rawHour % 24) + 24) % 24;
    const date = getParisDate(new Date(noon.getTime() + dayOffset * 86_400_000));
    const existing = known.get(`${date}-${hour}`);
    if (existing) return existing;
    return {
      status: "missing" as const,
      date,
      hour,
      attempts: 0,
      stationCount: 0,
      reason: "Aucune trace archivée après le passage principal et la reprise automatique.",
    };
  });
}
