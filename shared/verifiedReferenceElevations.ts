/** Relief public vérifié, distinct de toute mesure météo.
 * Réponse officielle HTTP 200 du 17 octobre 2026 : {"elevation":[44]}.
 * Référence : https://open-meteo.com/en/docs/elevation-api
 * Copernicus DEM 2021 GLO-90, résolution 90 m. Aucun zéro de secours. */
export const VERIFIED_REFERENCE_ELEVATIONS=[{
 lat:50.7567,lon:2.5204,value:44,
 source:'Open-Meteo / Copernicus DEM GLO-90',
 retrievedAt:'2026-10-17T15:03:06.703Z',
 url:'https://api.open-meteo.com/v1/elevation?latitude=50.7567&longitude=2.5204',
}];
