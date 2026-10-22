/**
 * Catégorisation française unique du ciel. Les seuils sont identiques au moteur
 * de régimes : >80 couvert, >50 partiellement nuageux, >20 peu nuageux.
 */
function finiteValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function cloudCoverLabel(cloudCover: number | null | undefined): string {
  const cloudValue = finiteValue(cloudCover);
  if (cloudValue == null) return "Nébulosité indisponible";
  if (cloudValue > 80) return "Ciel couvert";
  if (cloudValue > 50) return "Partiellement nuageux";
  if (cloudValue > 20) return "Peu nuageux";
  return "Ensoleillé";
}

export function conditionFromWeatherValues(precipitation: number | null | undefined, cloudCover: number | null | undefined): string {
  const precipitationValue = finiteValue(precipitation);
  if (precipitationValue != null && precipitationValue > 5) return "Pluie forte";
  if (precipitationValue != null && precipitationValue > 1) return "Averses";
  if (precipitationValue != null && precipitationValue > 0.2) return "Pluie légère";

  const cloudCoverValue = finiteValue(cloudCover);
  if (cloudCoverValue == null) {
    return precipitationValue == null ? "Conditions indisponibles" : "Nébulosité indisponible";
  }
  return cloudCoverLabel(cloudCoverValue);
}

/** Traduit le code météo WMO de la source en condition française affichable. */
export function conditionFromWmoWeatherCode(
  weatherCode: number | null | undefined,
  precipitation: number | null | undefined,
  cloudCover: number | null | undefined,
): string {
  if (weatherCode === null || weatherCode === undefined || !Number.isFinite(weatherCode)) {
    return conditionFromWeatherValues(precipitation, cloudCover);
  }
  if (weatherCode === 0) return "Ensoleillé";
  if (weatherCode === 1) return "Peu nuageux";
  if (weatherCode === 2) return "Partiellement nuageux";
  if (weatherCode === 3) return "Ciel couvert";
  if (weatherCode <= 49) return "Brouillard";
  if (weatherCode <= 59) return "Bruine";
  if (weatherCode <= 69) return "Pluie";
  if (weatherCode <= 79) return "Neige";
  if (weatherCode <= 84) return "Averses";
  if (weatherCode <= 94) return "Orages";
  return "Orage violent";
}
