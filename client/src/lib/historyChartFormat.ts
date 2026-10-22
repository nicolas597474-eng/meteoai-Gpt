/**
 * Helpers d'affichage partagés par la page Historique et ses graphiques.
 * Ils vivaient dans History.tsx ; ils sont isolés ici pour que le module des
 * graphiques (chargé en différé) et la page utilisent une seule source de
 * vérité pour les couleurs de modèles et les formats.
 */
export const MODEL_COLORS: Record<string, string> = {
  AROME: "#fb923c", ARPEGE: "#a78bfa", ECMWF: "#60a5fa", GFS: "#34d399",
  ICON: "#fb7185", UKMET: "#22d3ee", GEM: "#fbbf24", MeteoAI: "#38bdf8",
};

export function modelColor(name: string) {
  return MODEL_COLORS[name] ?? `hsl(${(name.charCodeAt(0) * 37) % 360} 74% 62%)`;
}

export function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(date);
}

export function number(value: unknown, suffix = "", digits = 1) {
  return value == null || Number.isNaN(Number(value)) ? "—" : `${Number(value).toFixed(digits)}${suffix}`;
}
