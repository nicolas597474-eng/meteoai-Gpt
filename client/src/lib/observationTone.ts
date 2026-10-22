/**
 * Code couleur du panneau « Observations actuelles ».
 *
 * Chaque grandeur météorologique reçoit une teinte adaptée à son intensité :
 * la valeur (et son icône) se colorent pour une lecture immédiate, sans avoir
 * besoin d'interpréter les chiffres. Exemples : ressenti doux = vert,
 * précipitations 0,0 mm = bleu, UV faible = vert, vent fort = orange/rouge.
 */

export type ObservationTone = {
  /** Identifiant stable du niveau, utile aux tests. */
  level: string;
  /** Classe Tailwind appliquée à la valeur et à l'icône. */
  value: string;
};

const NEUTRAL: ObservationTone = { level: "indisponible", value: "text-white" };

/** Teinte commune et stable des valeurs de vent et de rafales dans les cartes météo. */
export const WIND_VALUE_COLOR = "text-emerald-300";

function tone(level: string, value: string): ObservationTone {
  return { level, value };
}

function readNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Ressenti (°C) : froid violet → gel bleu clair → doux vert → chaud jaune/orange → canicule rouge. */
export function getApparentTempTone(celsius: number | null | undefined): ObservationTone {
  const value = readNumber(celsius);
  if (value == null) return NEUTRAL;
  if (value <= -10) return tone("froidExtreme", "text-purple-300");
  if (value <= 0) return tone("gel", "text-sky-300");
  if (value <= 10) return tone("frais", "text-cyan-300");
  if (value <= 20) return tone("agreable", "text-emerald-300");
  if (value <= 27) return tone("tresAgreable", "text-lime-300");
  if (value <= 32) return tone("chaud", "text-amber-300");
  if (value <= 37) return tone("tresChaud", "text-orange-400");
  return tone("canicule", "text-red-400");
}

/** Couverture nuageuse (%) : ciel dégagé bleu → gris de plus en plus dense quand le ciel se couvre. */
export function getCloudCoverTone(percent: number | null | undefined): ObservationTone {
  const value = readNumber(percent);
  if (value == null) return NEUTRAL;
  if (value <= 10) return tone("degage", "text-sky-300");
  if (value <= 30) return tone("peuNuageux", "text-cyan-300");
  if (value <= 60) return tone("partiellementNuageux", "text-slate-200");
  if (value <= 90) return tone("nuageux", "text-slate-400");
  return tone("couvert", "text-slate-500");
}

/** Vent moyen (km/h) : léger vert → modéré jaune → fort orange → violent rouge/rosé. */
export function getWindSpeedTone(kmh: number | null | undefined): ObservationTone {
  const value = readNumber(kmh);
  if (value == null) return NEUTRAL;
  if (value <= 15) return tone("tresLegere", "text-emerald-300");
  if (value <= 30) return tone("legere", "text-lime-300");
  if (value <= 45) return tone("moderee", "text-amber-300");
  if (value <= 60) return tone("forte", "text-orange-400");
  if (value <= 75) return tone("tresForte", "text-red-400");
  return tone("violente", "text-rose-400");
}

/** Rafales (km/h) : mêmes familles que le vent moyen, seuils décalés vers le haut. */
export function getWindGustTone(kmh: number | null | undefined): ObservationTone {
  const value = readNumber(kmh);
  if (value == null) return NEUTRAL;
  if (value <= 30) return tone("calme", "text-emerald-300");
  if (value <= 50) return tone("moderee", "text-lime-300");
  if (value <= 70) return tone("forte", "text-amber-300");
  if (value <= 90) return tone("tresForte", "text-orange-400");
  if (value <= 110) return tone("severe", "text-red-400");
  return tone("destructrice", "text-rose-400");
}

/** Pression de surface (hPa) : très basse rosé (temps perturbé) → normale vert → anticyclone bleu. */
export function getPressureTone(hpa: number | null | undefined): ObservationTone {
  const value = readNumber(hpa);
  if (value == null) return NEUTRAL;
  if (value < 1000) return tone("tresBasse", "text-rose-300");
  if (value <= 1010) return tone("basse", "text-orange-300");
  if (value <= 1020) return tone("normale", "text-emerald-300");
  if (value <= 1030) return tone("haute", "text-sky-300");
  return tone("tresHaute", "text-cyan-200");
}

/** Humidité (%) : sec ambre → confortable vert → humide cyan → saturé bleu. */
export function getHumidityTone(percent: number | null | undefined): ObservationTone {
  const value = readNumber(percent);
  if (value == null) return NEUTRAL;
  if (value < 30) return tone("tresSec", "text-amber-300");
  if (value <= 45) return tone("sec", "text-lime-300");
  if (value <= 60) return tone("confortable", "text-emerald-300");
  if (value <= 75) return tone("humide", "text-cyan-300");
  if (value <= 90) return tone("tresHumide", "text-sky-300");
  return tone("sature", "text-blue-300");
}

/** Précipitations (mm) : 0,0 mm en bleu, puis la teinte s'approfondit avec l'intensité de la pluie. */
export function getPrecipitationTone(mm: number | null | undefined): ObservationTone {
  const value = readNumber(mm);
  if (value == null) return NEUTRAL;
  if (value < 0.1) return tone("aucune", "text-blue-300");
  if (value <= 1) return tone("tresFaible", "text-cyan-300");
  if (value <= 4) return tone("faible", "text-indigo-300");
  if (value <= 8) return tone("moderee", "text-violet-300");
  if (value <= 15) return tone("forte", "text-rose-300");
  return tone("tresForte", "text-red-400");
}

/** Visibilité (km) : brouillard rosé → brume orange → bonne verte → excellente bleu clair. */
export function getVisibilityTone(km: number | null | undefined): ObservationTone {
  const value = readNumber(km);
  if (value == null) return NEUTRAL;
  if (value < 1) return tone("brouillardDense", "text-rose-300");
  if (value <= 4) return tone("brume", "text-orange-300");
  if (value <= 10) return tone("reduite", "text-amber-200");
  if (value <= 20) return tone("bonne", "text-emerald-300");
  return tone("excellente", "text-sky-300");
}


/** Indice UV (échelle OMS) : faible vert → modéré jaune → élevé orange → très élevé rouge → extrême violet. */
export function getUvTone(uv: number | null | undefined): ObservationTone {
  const value = readNumber(uv);
  if (value == null) return NEUTRAL;
  if (value <= 2) return tone("faible", "text-green-400");
  if (value <= 5) return tone("modere", "text-yellow-400");
  if (value <= 7) return tone("eleve", "text-orange-400");
  if (value <= 10) return tone("tresEleve", "text-red-400");
  return tone("extreme", "text-purple-400");
}
