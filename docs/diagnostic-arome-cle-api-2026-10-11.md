# Diagnostic AROME — « est-ce la bonne clé API ? »

Date : 2026-10-11 · branche `arena/ee0b52f7-meteo-ai-app` · HEAD `bb54b14`

## 0. Symptôme observé le 2026-10-11 (14:25 Paris) et cause réelle

Sortie du panneau admin après un clic sur « Comparer les runs » :

- `Aucun nom direction/DD reconnu dans ce run` — run inspecté `2026-10-11T09:00:00Z` ;
- `Requête impossible — Open-Meteo Single Runs n’a pas fourni le run AROME 2026-10-11T09:00 (HTTP 400)`.

**Ce que cela prouve : la clé n’est pas en cause.** Le catalogue WCS AROME a été lu avec succès et le run du jour a été identifié : l’échange OAuth2 et l’abonnement AROME fonctionnent. Le message « Aucun nom direction/DD » n’est pas non plus une erreur : c’est la limite déjà documentée de la vérification DD(10 m), qui refuse de deviner un identifiant de couverture.

**La cause réelle est l’appel Open-Meteo Single Runs**, construit par `buildSingleRunsUrl()` (`server/aromeHondeghemShadow.ts:278`) :

```
https://single-runs-api.open-meteo.com/v1/forecast
  ?latitude=…&longitude=…&run=2026-10-11T09:00&models=meteofrance_arome_france_hd
  &hourly=temperature_2m,precipitation,wind_speed_10m
  &start_hour=…&end_hour=…          ← paramètres refusés (HTTP 400)
  &timezone=UTC&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm
```

`start_hour`/`end_hour` sont les deux seuls paramètres atypiques de la requête, et les seuls qui diffèrent du client Single Runs **déjà en production dans ce dépôt** (`server/providerRunHorizon.ts:112-121`), lequel n’utilise que `run`, `models`, `hourly`, `forecast_days`, `timezone`, `timeformat`. La documentation Single Runs indique par ailleurs que l’endpoint accepte les paramètres de la Forecast API avec `run` en plus ; la fenêtre temporelle y est exprimée en jours (`forecast_days`), pas en bornes horaires.

Correctif appliqué (§5, point 7) : `forecast_days` à la place de `start_hour`/`end_hour` (les échéances sont déjà filtrées sur `[run, run + 24 h[`), et remontée du motif d’erreur Open-Meteo (`{"error":true,"reason":"…"}`) dans le message affiché, de façon à distinguer un run inexistant, un cycle non encore publié et un paramètre refusé.

## 0 bis. L’alignement du run : ce qui bloquait encore « Relancer la comparaison »

Le correctif du §0 supprimait les paramètres refusés par l’endpoint, mais un clic pouvait encore
s’arrêter sur `Open-Meteo Single Runs n’a pas fourni le run AROME 2026-10-11T09:00 (HTTP 400)`.
La cause n’est plus un paramètre : c’est un décalage de calendrier entre les deux sources.

| Source | Cycle disponible ce jour-là | Preuve |
|--------|-----------------------------|--------|
| Catalogue WCS AROME (`GetCapabilities`) | `2026-10-11T09:00:00Z` — le plus récent annoncé | panneau admin, 2026-10-11 |
| Open-Meteo Single Runs | `2026-10-11T06:00:00Z` — dernier run ingéré | `https://api.open-meteo.com/data/meteofrance_arome_france_hd/static/meta.json` → `last_run_initialisation_time = 1791698400` (06:00 UTC), `last_run_availability_time = 1791717455` (≈ 11:17 UTC), `update_interval_seconds = 10800` |

Météo-France initialise AROME toutes les 3 heures (00, 03, 06 … 21 UTC) et publie les champs sur
le WCS **avant** qu’Open-Meteo ne les ait ingérés : à 12 h 30 UTC, le catalogue proposait déjà le
cycle 09:00 alors que l’archive Single Runs n’allait que jusqu’au 06:00. Demander un run absent de
l’archive renvoie exactement le `400` observé — la clé, elle, n’est toujours pas en cause.

**Alignement appliqué** (`server/aromeHondeghemShadow.ts`) :

1. **Choix du cycle aligné** : le dernier run publié par Open-Meteo est lu dans
   `.../data/meteofrance_arome_france_hd/static/meta.json` (`singleRunMetadataUrl()`, déjà utilisé
   par `providerRunHorizon.ts`) ; le catalogue WCS est relu **en entier** (`rankCatalogueRuns()`,
   tous ses runs du plus récent au plus ancien) et seuls les cycles publiés par les deux sources
   restent candidats.
2. **Sonde bornée, run par run** : si les métadonnées sont illisibles, ou si le cycle retenu est
   encore refusé, la comparaison essaie **au maximum 3** runs, du plus récent au plus ancien. Un
   `400` « run not available » autorise le cycle suivant ; toute autre réponse (401/403, quota,
   erreur serveur) arrête la comparaison au lieu de la contourner.
3. **Aucune substitution croisée** : les deux sources portent toujours le **même** run ; c’est le
   choix du cycle qui est aligné, jamais une comparaison entre deux runs différents. Le message
   final explicite l’écart retenu (« Run comparé 2026-10-11T06:00 UTC … le catalogue annonçait déjà
   2026-10-11T09:00 UTC, qu’Open-Meteo n’avait pas encore publié »).
4. **Messages d’échec distincts** : ils listent les runs essayés et ceux écartés d’emblée, ce qui
   sépare « cycle pas encore publié par Open-Meteo » d’un problème d’identifiant, d’abonnement,
   de réseau ou de quota.

Une fois ce correctif déployé, un clic sur « Relancer la comparaison » doit produire le tableau
AROME WCS ↔ Open-Meteo sur les échéances du cycle commun (jusqu’à 24), avec les écarts.

Note de traçabilité : le commit `b4a0bf2` cité dans la passation (« commit d’alignement du run »)
**n’existe dans aucune référence du dépôt** (`git ls-remote`, `GET /repos/…/commits/b4a0bf2` → 422,
recherche de commits `alignement` / `arome` → aucune correspondance) : il n’a jamais été poussé.
La présente section et son correctif reconstruisent cet alignement à partir du diagnostic §0 et
des métadonnées de production.

## 1. Cartographie : il existe trois « AROME » distincts dans le code

| # | Chemin | Où | Source des données | Clé utilisée |
|---|--------|----|--------------------|--------------|
| 1 | **AROME de production** (fusion horaire/journalière, AI Lab, classement, historique) | `server/weatherServices.ts:47` (`meteofrance_arome_france_hd`), requêtes `?models=` en `:145` (daily) et `:1196` (hourly) | **Open-Meteo** `https://api.open-meteo.com/v1/forecast` | **aucune clé** |
| 2 | **Comparaison shadow AROME WCS** (panneau admin, page Météo détaillée) | `server/aromeHondeghemShadow.ts`, routes `server/routers/weather.ts:679-682` | **Portail Météo-France** `public-api.meteofrance.fr/public/arome/1.0/wcs/MF-NWP-HIGHRES-AROME-001-FRANCE-WCS` | `METEOFRANCE_API_KEY` |
| 3 | `fetchMeteoFrance()` — « prévisions officielles MF » | `server/realWeatherAPIs.ts:143-179` (+ `scripts/test-real-apis.mjs:93+`) | `rpcache-aa.meteofrance.com/internet2018client/2.0/forecast` | `METEOFRANCE_API_KEY` (**mauvais service**) |

### Conséquence directe

**Si AROME manque dans les prévisions affichées (fusion, AI Lab, tableau des modèles), ce n'est pas un problème de clé** : le chemin 1 n'en utilise aucune. La cause est alors l'horizon du modèle — AROME France HD ne couvre que **2 jours** (`server/forecastVariableCoverage.ts:70`, `server/providerRunCapabilities.ts:34`) alors que la collecte demande 16 jours (`weatherServices.ts:145`). AROME est donc normalement absent de J+2 à J+15.

**La clé ne peut être en cause que sur le panneau admin « AROME officiel ↔ Open-Meteo »** (chemin 2) et sur le chemin 3.

## 2. Défaut confirmé : le chemin 3 envoie la clé au mauvais service

`server/realWeatherAPIs.ts` :

1. `getMFBearerToken()` (`:113`) échange `METEOFRANCE_API_KEY` contre un jeton OAuth2 sur `https://portail-api.meteofrance.fr/token` — en-tête `Authorization: Basic <APPLICATION_ID>` (`:122`).
2. Ce jeton **portail-api** est ensuite envoyé à `https://rpcache-aa.meteofrance.com/internet2018client/2.0/forecast` (`:156-165`).

Or `rpcache-aa.meteofrance.com/internet2018client/2.0/*` est l'API **privée du site et de l'appli mobile** Météo-France : elle exige le jeton de l'application (JWT type `__Wj7dVSTjV9…__`, ou `?token=`), pas un jeton OAuth2 du portail. Les deux services ne partagent pas d'autorité d'authentification.

→ **401 garanti**, absorbé silencieusement par `console.warn("[MF] Forecast HTTP 401")` + `return null`, puis repli automatique sur Open-Meteo. C'est exactement un « problème de clé »… mais par construction, pas par mauvaise valeur.

Statut actuel : ce chemin est **mort en production** (les services publics ont été retirés, `WEATHER_SERVICES.public = []`, `server/publicForecastRemoval.test.ts`). Il survit dans `realWeatherAPIs.ts` et dans `scripts/test-real-apis.mjs`. Il faut soit le corriger (endpoint portail officiel), soit le supprimer — mais il ne peut en aucun cas expliquer un dysfonctionnement visible dans l'application.

## 3. Le chemin 2 (shadow AROME) : la clé est techniquement correcte, mais trois pièges la font échouer

L'échange est conforme à la documentation Météo-France :

```
POST https://portail-api.meteofrance.fr/token
Authorization: Basic <APPLICATION_ID>         # base64(client_id:client_secret)
grant_type=client_credentials
→ Authorization: Bearer <access_token> sur le WCS AROME
```

Pièges :

1. **`METEOFRANCE_API_KEY` doit contenir l'`APPLICATION_ID` base64**, tel qu'affiché dans la commande curl du portail (*Mes API › Générer un token*). Un `client_id:client_secret` en clair, un `access_token` (JWT) ou le jeton `__…__` du site mobile produisent tous un 401. Le code ne valide **rien** : il se contente de `if (!oauthApplicationId?.trim())` (`aromeHondeghemShadow.ts:489`).
2. **L'`APPLICATION_ID` est propre à chaque abonnement.** Un identifiant généré pour une autre API du portail (ARPEGE, vigilance, stations…) est refusé, ou donne un jeton valide qui se fait rejeter en 401/403 sur le WCS AROME.
3. **Le compte doit être abonné au paquet AROME haute résolution** (`MF-NWP-HIGHRES-AROME-001-FRANCE-WCS`). Sans abonnement : jeton obtenu, puis 403/401 sur `GetCapabilities`.

Le nom de la variable entretient l'ambiguïté : `.env.example:74` annonce « MeteoFrance API Key — `your_meteofrance_api_key` », ce qui invite à coller autre chose que l'`APPLICATION_ID`.

Autres limites du shadow, indépendantes de la clé (et normales) :

- le dernier run du catalogue est parfois encore incomplet → `GetCoverage` renvoie 403 sur les échéances lointaines, d'où un statut « comparaison partielle » ;
- `MAX_HOURS = 24` et appariement strict des échéances avec Open-Meteo Single Runs : sans intersection, « request-impossible » sans substitution de run.

## 4. Comment savoir dans quel cas vous êtes

Le panneau admin affiche un statut explicite (`client/src/pages/WeatherDetails.tsx:160-163`) :

| Statut affiché | Interprétation |
|----------------|----------------|
| **Clé AROME manquante** (`missing-key`) | `METEOFRANCE_API_KEY` vide/absente côté serveur |
| **Authentification AROME refusée** (`authentication-error`) | 401/403 sur `/token` **ou** sur le WCS ⇒ clé invalide **ou** abonnement AROME absent |
| **Requête impossible** (`request-impossible`) | réseau, catalogue illisible, ou aucune échéance commune aux deux sources |
| **Comparaison partielle** (`partial`) | clé et abonnement OK ; run incomplet ou variable manquante |

Pour trancher entre « clé invalide » et « abonnement absent », lancer :

```bash
node scripts/check-arome-key.mjs            # diagnostic en 4 étapes
node scripts/check-arome-key.mjs --coverage # + un GetCoverage GeoTIFF réel
```

Le script n'affiche jamais la clé ni le jeton (empreintes masquées uniquement) et indique, étape par étape, où ça casse : forme de la valeur → échange OAuth2 → `GetCapabilities` → `DescribeCoverage` → `GetCoverage`. Un 401 à l'étape 1 = clé ; un 401/403 à l'étape 2 avec jeton obtenu = abonnement.

## 5. Correctifs appliqués sur cette branche

1. **Normalisation de `METEOFRANCE_API_KEY`** — nouveau module `server/meteoFranceCredentials.ts` :
   - absent/vide → statut `missing-key` (inchangé) ;
   - JWT ou jeton `__…__` du site mobile → nouveau statut **`invalid-key`**, cause explicite, **aucune requête envoyée** ;
   - paire `client_id:client_secret` en clair → encodée automatiquement en base64 pour l'en-tête `Basic` ;
   - base64 → transmis tel quel ; forme inconnue → transmise telle quelle (comportement historique préservé).
2. **Messages d'authentification précisés** : un 401 sur `/token` indique désormais qu'un `APPLICATION_ID` généré pour une autre API du portail est refusé.
3. **Interface** (`client/src/pages/WeatherDetails.tsx`) : nouveau libellé « Clé AROME inutilisable » (et « Identifiant OAuth inutilisable » pour la vérification DD) ; les deux panneaux admin affichent la cause exacte.
4. **Suppression du chemin 3** : `server/realWeatherAPIs.ts` ne conserve plus que `wmoToConditionFr` ; les adaptateurs morts qui envoyaient un jeton portail-api à l'API privée `rpcache-aa` sont retirés, et `scripts/test-real-apis.mjs` renvoie vers le nouveau diagnostic au lieu de reproduire l'appel fautif.
5. **Documentation** : `.env.example` décrit la valeur attendue (`APPLICATION_ID` base64, abonnement AROME, identifiant propre à chaque API).
6. **Script de diagnostic** `scripts/check-arome-key.mjs` (voir §4).
7. **Correction de l’appel Open-Meteo Single Runs** (`aromeHondeghemShadow.ts`) : `start_hour`/`end_hour` remplacés par `forecast_days`, et motif d’erreur Open-Meteo remonté dans le message. C’est le correctif du blocage observé le 2026-10-11 (§0).
8. **Alignement du run** (`aromeHondeghemShadow.ts`) : le cycle comparé est le plus récent publié à la fois par le catalogue WCS et par Open-Meteo Single Runs (lecture du `meta.json` du modèle, sonde bornée à 3 runs, aucune substitution croisée). C’est le correctif du décalage de calendrier décrit au §0 bis.

Non modifié volontairement : le flux AROME de production (Open-Meteo, sans clé). AROME reste absent au-delà de J+1 — horizon documenté de 2 jours du modèle, pas un défaut.

## 6. Validation

- `npx vitest run` : **243 fichiers / 1273 tests verts (2 ignorés)**, dont 7 tests d'identifiant et 8 tests shadow (`invalid-key`, encodage de la paire, `forecast_days` sans `start_hour`/`end_hour`, remontée du motif Open-Meteo, alignement sur le `meta.json`, sonde d'un run plus ancien, conservation du run le plus récent quand les deux sources le publient, refus d'essayer un autre run hors `400`).
- `npx tsc --noEmit` : aucune erreur.
