import type { CurrentStateFieldLike } from "@/lib/dashboardPresentation";

export type CurrentStationTemperature = {
  value: number;
  provenanceLabel: string;
};

/**
 * Température actuelle mesurée par les stations physiques locales (Netatmo).
 *
 * Retourne null lorsque le champ consolidé n'est pas une mesure de stations
 * physiques (repli snapshot modèle, prévision ou champ indisponible) : aucune
 * valeur de modèle ne remplace alors la prévision officielle affichée.
 */
export function getCurrentStationTemperature(
  field: CurrentStateFieldLike | null | undefined,
  provenanceLabel: string | null,
): CurrentStationTemperature | null {
  if (field?.provenance?.kind !== "physical_stations") return null;
  if (typeof field.value !== "number" || !Number.isFinite(field.value)) return null;
  return {
    value: field.value,
    provenanceLabel: provenanceLabel?.trim() || field.provenance.label,
  };
}

/**
 * Remplace, sans mutation, la température de l'heure active par la mesure des
 * stations physiques. Les autres échéances restent des prévisions inchangées ;
 * sans mesure disponible, le tableau d'origine est renvoyé tel quel.
 */
export function withCurrentStationTemperature<T extends { temp?: number | null }>(
  hours: T[],
  activeHourIndex: number,
  stationTemperature: CurrentStationTemperature | null,
): T[] {
  if (!stationTemperature) return hours;
  if (activeHourIndex < 0 || activeHourIndex >= hours.length) return hours;
  return hours.map((hour, index) =>
    index === activeHourIndex ? { ...hour, temp: stationTemperature.value } : hour,
  );
}
