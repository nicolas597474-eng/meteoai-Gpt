import { useProvenanceDisplay } from "@/contexts/ProvenanceDisplayContext";

function formatCalculationTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

export function OfficialForecastCalculationTimes({
  hourlyComputedAt,
  computedAt,
  className = "",
}: {
  hourlyComputedAt?: string | null;
  computedAt?: string | null;
  className?: string;
}) {
  const { showProvenance } = useProvenanceDisplay();
  const hourlyTime = formatCalculationTime(hourlyComputedAt);
  const snapshotTime = formatCalculationTime(computedAt);

  // Réglage « Paramètres Application » de l’AI Lab : les horodatages de calcul
  // sont une indication de provenance et peuvent être masqués.
  if (!showProvenance) return null;

  return (
    <p aria-label="Horodatages des prévisions officielles" className={`text-[10px] leading-relaxed text-slate-400 ${className}`}>
      <span className="text-sky-200">Calcul horaire :</span> {hourlyTime ?? "indisponible"}
      <span className="mx-1.5 text-slate-600">·</span>
      <span className="text-slate-300">Snapshot courant / quotidien :</span> {snapshotTime ?? "indisponible"}
      <span className="ml-1">(Europe/Paris)</span>
    </p>
  );
}
