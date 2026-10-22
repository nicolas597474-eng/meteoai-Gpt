# Comparaison OpenWeather en mode shadow

**Statut :** panneau d’interface retiré; seul le chemin serveur réservé à l’administration subsiste et il n’est appelé par aucun écran. Non utilisé par les prévisions officielles.

**Interface :** le bloc « Diagnostic manuel · mode shadow — OpenWeather ↔ prévision officielle » a été supprimé de la page Prévisions (`client/src/pages/WeatherDetails.tsx`), avec le bouton « Comparer OpenWeather », les paires horaires, la couverture exacte et la liste des champs non comparés. Plus aucune requête OpenWeather de comparaison n’est déclenchable depuis l’interface. Le routeur `weather.compareOpenWeatherShadow` reste défini côté serveur (`server/routers/weather.ts`) pour les appels administrateurs hors écran; le module de comparaison est inchangé. Le repli horaire OpenWeather, indépendant et documenté dans `docs/openweather-hourly-fallback.md`, n’est pas concerné.

**Endpoint :** `https://api.openweathermap.org/data/2.5/forecast` (`Forecast 5 jours / 3 heures`), déjà présent dans `server/realWeatherAPIs.ts`.

**Accès :** le [produit Forecast 5 jours / 3 heures](https://openweathermap.org/forecast5) est distinct de [One Call 3.0](https://openweathermap.org/api/one-call-3); la [grille tarifaire OpenWeather](https://openweathermap.org/price) référence le forecast 3-hourly 5-day dans l’offre gratuite. Le diagnostic réutilise uniquement la clé OpenWeather déjà configurée et cet endpoint; il n’ajoute aucun produit, clé ni abonnement payant. Les quotas du compte restent applicables. Aucun appel à OpenWeather n’a été effectué pendant le développement ou les tests.

## Contrat d’isolation

Le chemin de comparaison est réservé à l’administration et n’envoie une requête OpenWeather qu’à la demande explicite. Il reçoit la série horaire officielle déjà calculée et transmise par l’appelant; le routeur ne relance pas le collecteur officiel et ne relit ni n’écrit la base. La réponse du comparateur est uniquement renvoyée à l’appelant; elle n’est pas archivée.

OpenWeather est explicitement une **source de comparaison**, pas un modèle indépendant et pas un contributeur au vote. Aucun poids, classement, score, fallback, résultat officiel, archivage ou pipeline de prévision n’est modifié. Le diagnostic ne rend donc pas encore un champ OpenWeather manquant disponible en secours.

## Règles de comparaison

Les timestamps OpenWeather sont lus depuis `dt` en secondes Unix puis convertis en millisecondes UTC. Une valeur n’est appariée que si son `validAt` est strictement égal à celui d’une heure officielle; aucune interpolation, tolérance, agrégation temporelle ou remise sur une grille n’est appliquée. L’écart affiché est OpenWeather moins officiel; la direction utilise le plus court écart circulaire signé.

Les champs comparés sont la température, la vitesse et la direction du vent, l’humidité relative et la couverture nuageuse totale. La provenance OpenWeather, l’absence d’identifiant de run exposé par cet endpoint, le nombre de paires et les horaires non appariés sont présentés séparément. Les runs des deux côtés ne sont pas déclarés équivalents.

Les précipitations ne sont pas comparées : OpenWeather fournit `rain.3h`/`snow.3h` comme cumul sur trois heures, qui n’est pas redistribué sur les heures officielles. Les rafales ne sont pas comparées tant que leurs fenêtres d’agrégation ne sont pas vérifiées. Pression, codes/conditions météo, UV, point de rosée, visibilité et rayonnement restent également hors comparaison faute de correspondance de champ et d’unité vérifiée dans ce contrat. Toute couverture absente reste affichée comme telle.

La clé n’est jamais renvoyée au navigateur; le payload brut OpenWeather n’est ni affiché ni conservé. Les tests n’utilisent que des réponses synthétiques et des fonctions `fetch` simulées.
