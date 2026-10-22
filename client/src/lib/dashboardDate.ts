/** Formate une date métier ISO sans dépendre du fuseau du navigateur. */
export function formatDashboardDate(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "—";

  const displayDate = new Date(`${isoDate}T12:00:00Z`);
  const words = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(displayDate).split(" ");

  return words.map((word) => word ? word[0].toUpperCase() + word.slice(1) : word).join(" ");
}

/** Format lisible de la pancarte principale : « Mardi 15 Août 2026 ». */
export function formatDashboardCompactDate(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "—";

  const displayDate = new Date(`${isoDate}T12:00:00Z`);
  const words = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(displayDate).split(" ");

  return words.map((word) => word ? word[0].toUpperCase() + word.slice(1) : word).join(" ");
}
