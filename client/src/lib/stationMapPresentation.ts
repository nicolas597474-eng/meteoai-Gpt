import { getStationQualificationBadge } from "./stationCandidateStatus";

export type StationMarker = {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  ageMinutes: number | null;
  source?: string | null;
  reliabilityScore?: number | null;
  archivedReadingCount?: number | null;
  exclusionReason?: string | null;
  isActive?: boolean;
  isUsed?: boolean;
  sourceKind?: "physical" | "reference";
  latest?: {
    temperature?: number | null;
    humidity?: number | null;
    windSpeed?: number | null;
    windGust?: number | null;
    precipitation?: number | null;
  } | null;
};

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] ?? character));
}

export function stationMetric(value: number | null | undefined, unit: string, decimals = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(decimals)}${unit}` : "—";
}

export function stationFreshness(ageMinutes: number | null) {
  if (typeof ageMinutes !== 'number' || !Number.isFinite(ageMinutes) || ageMinutes < 0) return { label: "Horodatage indisponible", color: "#94a3b8" };
  if (ageMinutes < 2) return { label: "À l’instant", color: "#34d399" };
  if (ageMinutes <= 15) return { label: `Il y a ${ageMinutes} min`, color: "#34d399" };
  if (ageMinutes <= 90) return { label: `Il y a ${ageMinutes} min`, color: "#fbbf24" };
  return { label: `Il y a ${Math.floor(ageMinutes / 60)} h`, color: "#fb7185" };
}

export function stationMarkerColor(station: StationMarker) {
  const age = station.ageMinutes;
  return station.isUsed === true && station.isActive !== false && typeof age === 'number' && Number.isFinite(age) && age >= 0 ? '#34d399' : '#fbbf24';
}

export function stationTooltipHtml(station: StationMarker) {
  return `${escapeHtml(station.name)} · ${stationMetric(station.distanceKm, ' km')}`;
}

export function stationPopupWidth(mapWidth: number) {
  return Number.isFinite(mapWidth) ? Math.max(120, Math.min(280, mapWidth - 56)) : 160;
}

export function stationPopupHeight(mapHeight: number) {
  return Number.isFinite(mapHeight) ? Math.max(80, Math.min(560, mapHeight - 72)) : 200;
}

export function stationArchiveSummary(count: unknown) {
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
    ? `${count} relevé(s) vérifié(s) dans les archives consultées`
    : 'Historique non disponible pour cette consultation';
}

export function stationInfoHtml(station: StationMarker) {
  const latest = station.latest;
  const freshness = stationFreshness(station.ageMinutes);
  const sourcePriority = typeof station.reliabilityScore === 'number' && Number.isFinite(station.reliabilityScore) && station.reliabilityScore >= 0 && station.reliabilityScore <= 100 ? `${Math.round(station.reliabilityScore)}/100` : "—";
  // Badge de statut repris du helper partagé : la carte, le classement et les
  // badges affichent la même définition du statut d'une station.
  const qualification = getStationQualificationBadge({
    isActive: station.isActive === true,
    source: station.source,
    sourceKind: station.sourceKind,
    exclusionReason: station.exclusionReason,
  });
  const rows = [
    ["Température", stationMetric(latest?.temperature, " °C")],
    ["Humidité", stationMetric(latest?.humidity, " %", 0)],
    ["Vent", stationMetric(latest?.windSpeed, " km/h")],
    ["Rafales", stationMetric(latest?.windGust, " km/h")],
    ["Pluie", stationMetric(latest?.precipitation, " mm")],
  ];
  return `<div style="box-sizing:border-box;min-width:0;max-width:280px;overflow-wrap:anywhere;padding:12px;border:1px solid #38bdf8;border-radius:12px;background:#071018;color:#f8fafc;font-family:system-ui,sans-serif;line-height:1.35"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px"><strong style="min-width:0;font-size:15px;line-height:1.2;color:#ffffff">${escapeHtml(station.name)}</strong><span style="flex:none;border:1px solid #34d399;border-radius:999px;padding:3px 6px;color:#a7f3d0;font-size:10px;font-weight:700">${escapeHtml(sourcePriority)}</span></div><p style="margin:6px 0 4px;color:#cbd5e1;font-size:11px;font-weight:500">${escapeHtml(station.source ?? "Station physique")} · ${stationMetric(station.distanceKm, " km")}</p><p style="margin:0 0 10px"><span style="border:1px solid #38bdf8;border-radius:999px;padding:2px 6px;color:#bae6fd;font-size:10px;font-weight:700">${escapeHtml(qualification.label)}</span></p><p style="margin:0 0 8px;color:#cbd5e1;font-size:11px">${stationMarkerColor(station) === "#34d399" ? "Utilisée dans la synthèse locale" : "Non utilisée dans la synthèse locale"}${station.exclusionReason ? ` · ${escapeHtml(station.exclusionReason)}` : ""}</p><div style="margin:0 0 10px;border-left:2px solid ${freshness.color};padding-left:7px;color:${freshness.color};font-size:11px;font-weight:700">Dernier relevé : ${escapeHtml(freshness.label)}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">${rows.map(([label, value]) => `<div style="background:#111c2e;border:1px solid #334155;border-radius:8px;padding:7px"><span style="display:block;margin-bottom:2px;color:#bae6fd;font-size:10px;font-weight:600">${label}</span><span style="color:#ffffff;font-size:13px;font-weight:700">${escapeHtml(value)}</span></div>`).join("")}</div><div style="margin-top:10px;border-top:1px solid #334155;padding-top:8px;color:#cbd5e1;font-size:11px"><strong style="color:#a7f3d0">Priorité technique de réseau/source : ${escapeHtml(sourcePriority)}</strong> · utilisée par le classement, pas une performance météo individuelle mesurée · ${escapeHtml(stationArchiveSummary(station.archivedReadingCount))}</div></div>`;
}

