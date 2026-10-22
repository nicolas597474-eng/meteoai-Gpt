// Estimation de la durée du jour (formule solaire standard) pour suivre
// l'évolution jour après jour de la durée d'ensoleillement.
const SOLAR_HORIZON_DEG = -0.83; // Réfraction + demi-disque solaire.

function solarDeclinationRad(dayOfYear: number): number {
  const gamma = (2 * Math.PI * (dayOfYear - 1)) / 365;
  return (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  );
}

function daylightDurationSeconds(date: Date, latitudeDeg: number): number | null {
  if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) > 90) return null;
  const dayOfYear = Math.floor(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(date.getUTCFullYear(), 0, 0)) /
      86_400_000
  );
  const declinationRad = solarDeclinationRad(dayOfYear);
  const latitudeRad = (latitudeDeg * Math.PI) / 180;
  const horizonRad = (SOLAR_HORIZON_DEG * Math.PI) / 180;
  const cosHourAngle =
    (Math.sin(horizonRad) - Math.sin(latitudeRad) * Math.sin(declinationRad)) /
    (Math.cos(latitudeRad) * Math.cos(declinationRad));
  if (cosHourAngle >= 1) return 0; // Nuit polaire.
  if (cosHourAngle <= -1) return 86_400; // Soleil de minuit.
  return (2 * Math.acos(cosHourAngle) * 86_400) / (2 * Math.PI);
}

/** Variation de la durée du jour, en minutes arrondies, entre la veille et le jour donné. */
export function estimateDaylightChangeMinutes(
  latitudeDeg: number,
  date: Date
): number | null {
  const secondsToday = daylightDurationSeconds(date, latitudeDeg);
  const secondsYesterday = daylightDurationSeconds(
    new Date(date.getTime() - 86_400_000),
    latitudeDeg
  );
  if (secondsToday == null || secondsYesterday == null) return null;
  return Math.round((secondsToday - secondsYesterday) / 60);
}
