export type CollectionHealthStatus = "up_to_date" | "partial" | "late" | "technical_error";

export type CollectionHealth = {
  status: CollectionHealthStatus;
  label: "À jour" | "Partiel" | "En retard" | "Erreur technique";
  detail: string;
  tone: string;
  dot: string;
};

export type CollectionHealthInput = {
  lastRunStatus?: "completed" | "failed" | "partial" | null;
  lastSuccessAt?: string | Date | null;
  /** Must describe the same latest global batch as lastRunStatus, not a local snapshot. */
  partial?: boolean;
  now?: Date;
  staleAfterMs?: number;
};

const HEALTHY_TONE = "border-emerald-300/35 bg-emerald-400/15 text-emerald-50";
const PARTIAL_TONE = "border-amber-300/35 bg-amber-400/15 text-amber-50";
const LATE_TONE = "border-orange-300/35 bg-orange-400/15 text-orange-50";
const ERROR_TONE = "border-red-300/35 bg-red-400/15 text-red-50";

function formatFreshnessAge(ageMs: number): string {
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes === 0) return "à l’instant";
  if (ageMinutes < 60) return `il y a ${ageMinutes} min`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 48) return `il y a ${ageHours} h`;
  return `il y a ${Math.floor(ageHours / 24)} j`;
}

export function countArchivedSnapshotSlots(history: readonly { status: string }[] | null | undefined): number {
  return history?.filter((slot) => slot.status === "stored").length ?? 0;
}

export function getCollectionHealth({
  lastRunStatus,
  lastSuccessAt,
  partial = false,
  now = new Date(),
  staleAfterMs = 26 * 60 * 60 * 1000,
}: CollectionHealthInput): CollectionHealth {
  if (lastRunStatus === "failed") {
    return { status: "technical_error", label: "Erreur technique", detail: "La dernière collecte de prévisions a échoué", tone: ERROR_TONE, dot: "bg-red-300" };
  }

  if (partial || lastRunStatus === "partial") {
    return { status: "partial", label: "Partiel", detail: "Le dernier lot de prévisions est partiel", tone: PARTIAL_TONE, dot: "bg-amber-300" };
  }

  if (!lastSuccessAt) {
    return { status: "late", label: "En retard", detail: "Aucun succès de prévisions horodaté n’est disponible", tone: LATE_TONE, dot: "bg-orange-300" };
  }

  const successTimestamp = new Date(lastSuccessAt).getTime();
  if (!Number.isFinite(successTimestamp)) {
    return { status: "late", label: "En retard", detail: "L’horodatage du succès de prévisions est invalide", tone: LATE_TONE, dot: "bg-orange-300" };
  }

  const ageMs = now.getTime() - successTimestamp;
  if (ageMs < 0) {
    return { status: "late", label: "En retard", detail: "L’horodatage du succès de prévisions est futur ; sa fraîcheur n’est pas vérifiable", tone: LATE_TONE, dot: "bg-orange-300" };
  }
  if (ageMs > staleAfterMs) {
    return { status: "late", label: "En retard", detail: `Dernier succès de prévisions ${formatFreshnessAge(ageMs)}`, tone: LATE_TONE, dot: "bg-orange-300" };
  }

  return { status: "up_to_date", label: "À jour", detail: `Succès de prévisions récent · ${formatFreshnessAge(ageMs)}`, tone: HEALTHY_TONE, dot: "bg-emerald-300" };
}

export function formatCollectionDuration(durationMs: number | null | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return "Non mesurée";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1_000;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}
