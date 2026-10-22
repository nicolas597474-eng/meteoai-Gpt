/**
 * realWeatherAPIs.ts
 * Utilitaires de lecture des codes météo des APIs publiques.
 *
 * Périmètre volontairement réduit : les adaptateurs de « prévisions publiques »
 * (OpenWeatherMap et Météo-France) ont été retirés du cycle de production — voir
 * `server/publicForecastRemoval.test.ts` et `WEATHER_SERVICES.public = []`.
 *
 * Ils entretenaient de plus une confusion d’authentification : `fetchMeteoFrance()`
 * échangeait `METEOFRANCE_API_KEY` contre un jeton OAuth2 sur
 * `portail-api.meteofrance.fr/token`, puis envoyait ce jeton à
 * `rpcache-aa.meteofrance.com/internet2018client/2.0/forecast`, qui est l’API privée du
 * site et de l’appli mobile Météo-France. Les deux services ne partagent pas d’autorité
 * d’authentification : l’appel était refusé (401) puis absorbé en silence par un repli
 * Open-Meteo, ce qui laissait croire à une clé invalide.
 *
 * AROME ne dépend plus de l’API Météo-France authentifiée : la comparaison shadow
 * `server/aromeHondeghemShadow.ts` récupère AROME uniquement via Open-Meteo, sans clé.
 * Le WCS/GeoTIFF historique y reste conservé mais désactivé par défaut derrière
 * `AROME_WCS_ENABLED=true`; lui seul utilise l’identifiant normalisé par
 * `server/meteoFranceCredentials.ts`.
 */

/** Convertit un code WMO en description française alignée sur les régimes. */
export function wmoToConditionFr(code: number): string {
  if (code === 0) return "Ensoleillé";
  if (code === 1) return "Peu nuageux";
  if (code === 2) return "Partiellement nuageux";
  if (code === 3) return "Ciel couvert";
  if (code <= 49) return "Brouillard";
  if (code <= 59) return "Bruine";
  if (code <= 69) return "Pluie";
  if (code <= 79) return "Neige";
  if (code <= 84) return "Averses";
  if (code <= 94) return "Orages";
  return "Orage violent";
}
