const COLLECTION_TIME_ZONE = "Europe/Paris";

export function formatCollectionTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Horodatage indisponible";

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Horodatage indisponible";

  const dateLabel = date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: COLLECTION_TIME_ZONE,
  });
  const timeLabel = date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: COLLECTION_TIME_ZONE,
  });

  return `${dateLabel} à ${timeLabel} (${COLLECTION_TIME_ZONE})`;
}

export { COLLECTION_TIME_ZONE };

/*
 * Les dates persistées par MeteoAI sont UTC. Le fuseau est donc toujours
 * fourni explicitement afin que l’affichage ne dépende pas du téléphone.
 */
