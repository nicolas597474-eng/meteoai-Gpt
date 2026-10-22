function timeToMinutes(value: string | null) {
  const match = value?.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Détermine si l’heure locale active se situe avant le lever ou après le coucher du Soleil. */
export function isNightAtLocalMinutes(sunrise: string | null, sunset: string | null, localMinutes: number) {
  const sunriseMinutes = timeToMinutes(sunrise);
  const sunsetMinutes = timeToMinutes(sunset);
  if (sunriseMinutes == null || sunsetMinutes == null || sunsetMinutes <= sunriseMinutes) return false;
  return localMinutes < sunriseMinutes || localMinutes >= sunsetMinutes;
}
