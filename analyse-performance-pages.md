# Analyse de lenteur, page par page — MeteoAI

Cible étudiée : `https://meteoai-7i8fkmsr.manus.space`
Code analysé : dépôt `meteo-ai-app`, commit `1fd68d6` (base de la branche de travail), build de production réellement exécuté.

---

## 0. Méthode, et ce que je ne peux pas affirmer

**Ce que j'ai mesuré réellement (chiffres ci-dessous issus de l'exécution, pas d'estimations) :**

- Build de production complet (`vite build`) : tailles brutes de chaque chunk, taille gzip calculée avec `gzip -9`.
- Graphe d'imports des chunks compilés : quel chunk charge quel autre, statiquement ou dynamiquement — donc le poids réellement nécessaire **avant** le premier rendu de chaque page.
- Politique de cache HTTP : en **exécutant** réellement la fonction `getStaticAssetCacheControl()` du dépôt sur chaque type de fichier.
- Chemins de code client et serveur (requêtes tRPC, waterfalls, délais internes, caches).

> **Suite donnée** : les correctifs du lot 1 sont appliqués et mesurés — voir la
> section 7 en fin de document (gains : −109,6 kB gzip sur l'Historique,
> −110,6 kB sur le Laboratoire, −54,2 kB sur les Stations, et suppression de
> 118,3 kB gzip + 1,71 Mo de textures sur l'écran de chargement).

**Ce que je ne peux PAS affirmer (et pourquoi) :**

- Le sandbox n'a pas d'accès réseau vers `manus.space` (échec TLS immédiat). Je n'ai donc **pas** pu mesurer le site en ligne : pas de Lighthouse, pas de waterfall réseau réel, pas de TTFB.
- Taille inconnue des images servies par `/manus-storage/...` (icônes 3D, fonds « sky pack ») : elles ne sont pas dans le dépôt.
- Latence réelle de la base de données, des fournisseurs météo et du proxy Manus : non mesurable ici.
- Le site déployé peut avoir été construit à partir d'un commit différent de `1fd68d6`. Les conclusions ci-dessous valent pour ce commit.

Tout ce qui suit est donc présenté comme **constaté dans le code et le build**, avec les chiffres. Aucune valeur n'est inventée ; ce qui reste une hypothèse est explicitement marqué **[à confirmer]**.

---

## 1. Le socle commun : ce qui ralentit **toutes** les pages

### 1.1 Le shell HTML contient un script inline de 358,5 kB (~97 % du document)

| Mesure | Valeur |
|---|---|
| `dist/public/index.html` | **368 167 octets** bruts (~106 kB gzip) |
| dont `<script id="manus-runtime">` inline | **367 094 octets = 358,5 kB (97,3 %)** |
| `client/index.html` source | 934 octets |

Cause identifiée : `vite.config.ts` active `vitePluginManusRuntime()`, qui injecte le contenu entier de `node_modules/vite-plugin-manus-runtime/runtime_dist/manus-runtime.js` (367 081 octets) avec `injectTo: 'body-prepend'`, **sans attribut `defer` ni `async`**, et **en production aussi** (le plugin n'a pas de condition dev/prod).

Conséquences mécaniques :
- Le navigateur doit télécharger 368 kB, puis **analyser et exécuter** ce script inline avant d'atteindre `<div id="root">` : inline + sans `defer` = bloquant pour le parse.
- Ce script ne peut jamais être mis en cache séparément : il est à l'intérieur du document, lui-même revalidé/téléchargé au bout de 60 s (`SPA_SHELL_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300"`).

⚠️ Le script inline pèse **plus lourd que tout le JavaScript applicatif de la page d'accueil**.

### 1.2 L'URL la plus visitée (`/`) n'est jamais mise en cache

`server/_core/vite.ts` sert `index.html` par deux chemins différents :

| Requête | Chemin de code | `Cache-Control` |
|---|---|---|
| `/` (Dashboard) | `express.static` (son `index.html` par défaut) | `no-cache, no-store, must-revalidate` |
| `/details`, `/ranking`, … | fallback `app.use("*")` → `res.sendFile` | `public, max-age=60, stale-while-revalidate=300` |

Vérifié en exécutant la fonction : `getStaticAssetCacheControl("/dist/public/index.html")` → `no-cache, no-store, must-revalidate`.
La racine du site — la page la plus ouverte — est donc **systématiquement re-téléchargée avec ses 358 kB de script inline**.

### 1.3 Deux fichiers globaux chargés sur chaque route

| Fichier | Brut | Gzip |
|---|---|---|
| `index-DuuQiKoS.js` (React, tRPC, router, UI) | 436 423 B | **131,3 kB** |
| `index-TpWtr_JK.css` (Tailwind + tout le CSS maison, 4 054 règles) | 315 730 B | **45,5 kB** |

Il n'existe **pas** de découpage CSS par route : `/report` (page presque textuelle) télécharge le même CSS que le Dashboard.

### 1.4 L'écran de chargement télécharge Three.js + 1,63 Mo de textures, non cachables

Chaîne prouvée : `App.tsx` → `RouteLoadingFallback` → `WeatherAILoader` (import **statique** dans le chunk d'entrée) → `EarthGlobe` → `import("./earthScene")`.

- `EarthGlobe` rend **toujours** le globe CSS de secours, dont le fond est `url('/textures/earth/earth_atmos_2048.jpg')` → **512 606 B**.
- Si l'utilisateur n'a pas `prefers-reduced-motion: reduce`, l'effet importe `earthScene` → chunk **474,2 kB brut / 118,3 kB gzip** (Three.js), qui charge 4 textures de plus : `earth_normal_2048.jpg` (336 774 B), `earth_specular_2048.jpg` (223 421 B), `earth_lights_2048.png` (410 160 B), `earth_clouds_1024.png` (226 113 B).

**Total : 1 709 074 octets (1,63 Mio) de textures + 118,3 kB gzip de JS**, pour un globe décoratif.

Et surtout — vérifié en exécutant le code :

```
getStaticAssetCacheControl("/dist/public/textures/earth/earth_atmos_2048.jpg")
  → "no-cache, no-store, must-revalidate"
```

Le test de nom de fichier exige `normalized.includes("/assets/")` ; or les textures sont sous `/textures/`, donc **aucune des 5 textures n'est mise en cache** : `no-store` = **retéléchargement de 1,63 Mo à chaque chargement à froid**, sur toutes les routes.

*(À titre de comparaison, `/assets/lunar/*.webp` et `/assets/solar/*.webp` reçoivent bien `max-age=31536000, immutable` — vérifié aussi.)*

### 1.5 Les images passent par un proxy non cacheable (2 allers-retours chacune)

`server/_core/storageProxy.ts` : chaque `/manus-storage/<clé>` déclenche
1) un appel serveur → API Forge `v1/storage/presign/get`, puis
2) `res.redirect(307, urlSignee)` avec **`Cache-Control: no-store`**.

L'asset nécessite donc **deux allers-retours** (serveur → Forge, puis S3) au lieu d'un, et la réponse de redirection interdit sa mise en cache.

Or ces URL sont partout (65 références, 28 assets distincts) :
- `client/src/components/MeteoIcon.tsx` : **toutes** les icônes météo 3D (`presentation="full"`, le mode par défaut), y compris dans les en-têtes de colonnes et les listes de stations ;
- `client/src/lib/weatherImages.ts` : les fonds plein écran « sky pack » (21 conditions → 12 fichiers) ;
- `client/src/index.css` : `--page-weather-sky-image` (classe `.weather-page-sky`) ;
- `client/src/components/EnvironmentalPanels.tsx` : Soleil/Lune réalistes.

**[à confirmer]** La taille de ces fichiers n'est pas mesurable depuis le dépôt. Mais le mécanisme (presign + 307 + no-store) est lui, certain.

### 1.6 Défauts React Query appliqués par omission

`client/src/main.tsx` : `const queryClient = new QueryClient();` — **aucune option par défaut**.
Donc pour toute requête sans `staleTime`/`retry` explicite : `staleTime: 0`, `retry: 3` (backoff 1 s → 2 s → 4 s), `refetchOnWindowFocus: true`.

Conséquence : sur plusieurs pages, **revenir sur l'onglet relance une requête serveur lourde**, et un échec temporaire fait patienter ~7 s de plus (3 tentatives) avant d'afficher une erreur.

### 1.7 Compression serveur : tout le non-« weather » est exclu

`server/_core/httpCompression.ts` : sous `/api/`, la réponse n'est compressée que si **toutes** les procédures appelées commencent par `weather.`.
Sont donc envoyées **non compressées** : `auth.me`, `favorites.list`, `favorites.getCurrentDashboardWeather`, `favorites.getPreloadedForecasts`, `favorites.getLocationWeather`, `personalObservations.*`.
(Le libellé du commentaire du fichier — « Weather diagnostics stay lossless » — décrit l'inverse de ce que fait le code.)

---

## 2. Poids mesuré du premier rendu, par page

Chiffres : closure **statique** des imports depuis `index-DuuQiKoS.js` + le chunk de la page. Colonne « total à froid » = JS gzip + CSS gzip + shell HTML gzip.

| Page | Route | JS statique (gzip) | CSS | Total à froid | Chunk le plus lourd |
|---|---|---|---|---|---|
| Dashboard | `/` | 215,7 kB | 45,5 kB | **~367 kB** | Dashboard 53,6 kB |
| Détails/Prévisions | `/details` | 171,4 kB | 45,5 kB | **~323 kB** | WeatherDetails 22,7 kB |
| Fiabilité (Labo) | `/laboratoire`, `/lab` | **271,6 kB** | 45,5 kB | **~423 kB** | **recharts 108,0 kB** |
| Stations | `/ranking`, `/stations`, `/reliability` | 227,2 kB | 51,8 kB | **~385 kB** | **leaflet 50,2 kB** |
| Historique | `/history` | **252,4 kB** | 45,5 kB | **~404 kB** | **recharts 108,0 kB** |
| AI Lab | `/ai-lab` | 207,1 kB | 45,5 kB | **~358 kB** | WeatherAILab 55,4 kB |
| Rapport | `/report` | 135,9 kB | 45,5 kB | **~287 kB** | socle seul |
| Comparaison des poids | `/weight-comparison` | 142,0 kB | 45,5 kB | **~293 kB** | socle seul |
| Favoris | `/favorites` | 135,4 kB | 45,5 kB | **~287 kB** | socle seul |

À ces totaux s'ajoute, **uniquement au premier chargement à froid**, l'écran de chargement du § 1.4 : **+118,3 kB gzip de JS et +1,63 Mo de textures non cachables**.
S'y ajoutent encore les images `/manus-storage` (fond de page + icônes) — taille inconnue.

Chargements **différés** (après le premier rendu) :
- Dashboard, graphiques : +47,2 kB gzip (HourlyChart + FifteenDayChart).
- Dashboard, `EnvironmentalPanels` au scroll (< 800 px) : **+111,7 kB gzip**, dont **leaflet 50,2 kB** — uniquement pour afficher la carte des stations et les globes Soleil/Lune.

---

## 3. Analyse page par page

### 3.1 Dashboard — `/` (route principale)

Fichier : `client/src/pages/Dashboard.tsx` (1 592 lignes) — chunk 204,4 kB brut / **53,6 kB gzip**.

**Requêtes émises, dans l'ordre réel :**

1. `auth.me` (via `useAuth()`), lancée au montage.
2. En parallèle, non conditionnées par l'utilisateur :
   - `weather.getDetailedForecast` (`includeExtendedPeriods: false`, via `useOfficialForecast`) → **la requête qui alimente tout l'écran** ;
   - `weather.getCurrentModelSnapshot` ;
   - `favorites.getCurrentDashboardWeather`.
3. **Attendent `auth.me`** (`enabled: !!user`) : `favorites.list` (FavoritesBar), `favorites.getPreloadedForecasts`, `personalObservations.dashboardState`. → waterfall de 2 allers-retours pour ces blocs.
4. **Attendent la fin de `officialForecast`** (`enabled: !!officialForecast`) : `weather.getDashboardDailyForecast` → 2ᵉ aller-retour sérialisé.
5. **Attendent l'arrivée de la 1ʳᵉ réponse + 250 ms** (`diagnosticsEnabled`) : `weather.getDashboard`, `weather.getLocalOfficialDeltaHistory`, `weather.getRegimeCatalogue`, `weather.getForecastProvenance` → 3ᵉ aller-retour sérialisé pour le bandeau de régime et la provenance.

**Problèmes constatés :**

- **Le contenu principal dépend d'une requête dont le budget serveur est de 7,2 s.** Dans `server/routers/weather.ts`, `getDetailedForecast` fixe `deadlineAt = Date.now() + 7_200` et enveloppe les sources dans `withDeadline(..., 7_000, [])` ; `OFFICIAL_SNAPSHOT_INTERACTIVE_BUDGET_MS = 7_000`. Le délai d'attente affiché côté client (`DASHBOARD_LOAD_TIMEOUT_MS = 8_000`) est donc calibré **au-dessus** de ce budget : en cas de cache froid, la page peut légitimement rester sur l'écran de chargement (le globe WebGL) plusieurs secondes. *(Nuance : sur cache chaud, `resolveOfficialWeatherSnapshot` répond depuis l'archive en base avant de rafraîchir en arrière-plan ; le cache snapshot est de 2 min.)*
- **3 vagues de requêtes en série** (points 3, 4, 5) au lieu d'être lancées ensemble.
- **Fond d'écran via `/manus-storage`** (`getDashboardWeatherImage` → `sky-pack-*.jpg`, appliqué en `--dashboard-sky-image`) : presign + 307 + `no-store` (§ 1.5).
- **Icônes météo 3D `MeteoIcon` via `/manus-storage`** (icône d'état courante en 64 px, alerte, humidité, plus toutes celles des graphiques différés).
- **Pendant l'attente, le navigateur télécharge en parallèle Three.js (118,3 kB gzip) et jusqu'à 1,63 Mo de textures** (§ 1.4) : sur une connexion mobile, ces octets **concurrencent directement les requêtes tRPC** sur la même bande passante.
- Aucune requête du Dashboard n'est dans l'allow-list de batching (`FAST_BATCHED_QUERY_PATHS` dans `main.tsx` ne contient que 5 procédures « légères » : `getRegimeCatalogue`, `getForecastProvenance`, `getStationRankingCriteria`, `favorites.list`, `favorites.getPreloadedForecasts`) → **chaque requête est un POST HTTP distinct**, à concurrence des 6 connexions par origine.

**Ce qui fonctionne déjà bien ici (à ne pas casser) :** `getCurrentModelSnapshot` permet de sortir de l'écran plein de chargement dès qu'il arrive (`isLoading = officialLoading && hourlyLoading && !fastCurrentSnapshot`), les graphiques et les panneaux environnementaux sont chargés à la demande, et les snapshots serveur ont un cache de 2 min avec « singleflight ».

---

### 3.2 Détails / Prévisions — `/details`

Fichier : `client/src/pages/WeatherDetails.tsx` — chunk 86,8 kB brut / 22,7 kB gzip.

**Problème principal, certain : un waterfall de deux requêtes lourdes, l'une étant un sur-ensemble de l'autre.**

```tsx
usePageWeatherSky();                                             // → getDetailedForecast(includeExtendedPeriods: false)
useOfficialForecast(activeLocation);                             // même clé → dédupliqué, pas de requête en plus
useOfficialForecast(activeLocation, {
  includeExtendedPeriods: true,
  enabled: !!essentialForecast,      // ← attend la fin de la 1ʳᵉ requête
});
```

La 2ᵉ requête (`includeExtendedPeriods: true`) demande l'horizon 16 jours, les périodes étendues (`collectHourlyForecast(..., 16, ...)`, budget 7 s) et le complément OpenWeather (`fillOpenWeatherHourlyGaps`) — alors que la 1ʳᵉ est déjà un sous-ensemble de la même réponse.

Sur un **chargement direct** (signet, partage de lien, rafraîchissement, ou retour depuis un autre site), il n'y a pas de préchargement : **deux allers-retours serveur complets, en série, chacun pouvant atteindre ~7,2 s.**
Le préchargement (`useDetailedForecastPrefetch` au survol/`pointerdown` d'un lien de navigation) ne couvre que la navigation interne.

**Autres constats :**
- `WindyMap` (import **statique**) monte une **iframe externe `https://embed.windy.com/embed2.html`** → une page tierce complète à charger, hors de mon périmètre de mesure, mais sur le chemin critique de cette page.
- `useCurrentStationTemperature` → `favorites.getCurrentDashboardWeather` : même clé que le Dashboard, donc mutualisé (correct).
- Aucun accès à `/manus-storage` en dehors du fond de page (`usePageWeatherSky`).

---

### 3.3 Stations — `/ranking` (alias `/stations`, `/reliability`)

Fichier : `client/src/pages/Ranking.tsx` (542 lignes) — chunk 94,1 kB brut / 20,8 kB gzip.

**Problème 1 — Leaflet est chargé avant tout rendu utile.**
`import { StationMap } from "@/components/StationMap"` est **statique** ; `StationMap` importe `Map.tsx`, qui importe `leaflet`, `@tomickigrzegorz/leaflet-rotate` et `leaflet/dist/leaflet.css`. Coût **statique** mesuré : **50,2 kB gzip de JS + 6,3 kB gzip de CSS**, en plus de tout le reste, avant le premier pixel.

**Problème 2 — trois opérations serveur lourdes en parallèle au montage**, plus deux légères :
- `weather.getStationReliabilityOverview` (`buildStationReliabilityOverviewCached`, cache 5 min, lecture de read-model) ;
- `weather.searchStations` → `collectNearbyStationsWithDiagnostics` + `fetchCurrentModelReferences` : **collecte de stations en direct** (Météo-France/Netatmo), cache 90 s ;
- `weather.getDetailedForecast` (via `usePageWeatherSky`) → le chemin snapshot officiel décrit en 3.1 ;
- `weather.getStationRankingCriteria` (instantané, `getStationRankingContract()`) ;
- `weather.getForecastProvenance`.

**Problème 3 — `getStationRankingCriteria` est interrogé sans aucune option** : `staleTime: 0` + `refetchOnWindowFocus: true` (défauts, § 1.6). C'est un catalogue en mémoire : le coût serveur est nul, mais c'est **un aller-retour réseau supplémentaire à chaque retour d'onglet**.

**Problème 4 — fond de page + icônes via `/manus-storage`** (`usePageWeatherSky`, `MeteoIcon`) : 2 allers-retours chacun (§ 1.5).

**Effet de bord à surveiller [à confirmer] :** la carte Leaflet consomme des tuiles depuis `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (`Map.tsx`, `OSM_TILE_SOURCE`) — requêtes tierces, non mesurables ici, et soumises à la politique d'usage d'OSM.

---

### 3.4 Fiabilité / Laboratoire — `/laboratoire` (alias `/lab`)

Fichier : `client/src/pages/ReliabilityLaboratory.tsx` — chunk 85,1 kB brut / 16,7 kB gzip.

**Problème 1 — c'est la page la plus lourde du site : 271,6 kB gzip de JS statique**, et l'essentiel n'est pas la page elle-même mais **recharts** :

```
CartesianChart-CxGPldQ2.js   372,5 kB brut  →  108,0 kB gzip   (library recharts)
```

`ReliabilityTrendChart.tsx` fait un `import { Bar, CartesianGrid, ComposedChart, Line, ... } from "recharts"` **statique**, et la page l'importe statiquement (`import { ReliabilityTrendChart } from "@/components/weather/ReliabilityTrendChart"`). Résultat : **la bibliothèque de graphiques est téléchargée et analysée avant que la page n'affiche quoi que ce soit**, alors qu'elle ne sert qu'au graphique de tendance, situé plus bas et alimenté par la donnée qui arrive après. Les trois autres pages du site (Dashboard, Détails) dessinent leurs courbes à la main en SVG/canvas — recharts n'y est pas nécessaire.

**Problème 2 — requête potentiellement très lourde côté serveur.**
`weather.getReliabilityLaboratory` (cache 5 min, `keepPreviousData` côté client) : la période par défaut est `30d`, et `weatherReliabilityLab.ts` contient `recomputeMissingScoreRows()`, qui **recalcule à la volée** les scores manquants sur la plage demandée. Sur les périodes longues (`90d`, `365d`, sélectionnables dans l'interface), le volume lu (`getQualifiedObservationSnapshotsByDateRange` + `getHourlyForecastRunValuesByDateRange`) augmente d'autant, et changer de période change la clé de cache → **recalcul complet**.

**Problème 3 — trois lectures lourdes au montage** : `getReliabilityLaboratory` + `getStationReliabilityOverview` + `getYesterdayForecastObservation`, plus `getDetailedForecast` via `usePageWeatherSky`, plus les icônes/fond `/manus-storage`.

**Problème 4 — le temps affiché est volontairement long** : la page n'affiche que des squelettes tant que `getReliabilityLaboratory` n'a pas répondu, avec un message « plus de temps que prévu » qui n'apparaît qu'après `WEATHER_QUERY_SLOW_MS = 8 000`.

---

### 3.5 AI Lab — `/ai-lab`

Fichier : `client/src/pages/WeatherAILab.tsx` (1 159 lignes) — chunk **240,6 kB brut / 55,4 kB gzip** (2ᵉ plus gros chunk de page après le Dashboard).

**Problème 1 — 8 panneaux importés statiquement**, tous dans le même chunk et donc téléchargés avant le premier rendu, alors que la page est un enchaînement de sections repliables :
`ForecastAlignmentPanel`, `HourlyComparisonDiagnosticsPanel`, `ExperimentalForecastConfidencePanel`, `ForecastFlowStatusBadge`+`Legend`, `HourlyJournalPanel`, `LocalTemperatureNowcastingPanel`, `LocalPrecipitationNowcastingPanel`, `WeatherStatusBadge`.
Aucun n'est chargé à la demande.

**Problème 2 — la requête principale est une chaîne d'attentes séquentielles.**
`weather.getAILab` (lignes 1293+) exécute, dans l'ordre :
`getObservationByDate` → `getMeteoAIForecastByDate` → (`getLatestMeteoAIForecasts`) → éventuellement `collectExpertForecasts` (appel fournisseur en direct) → `getForecastsByDate` → `getRecentCollectionJobs` → puis `resolveOfficialWeatherSnapshot` (budget 7 s).
Chaque `await` attend le précédent : le temps total est la **somme**, pas le maximum. Et pendant tout ce temps, l'utilisateur ne voit que des squelettes (`if (isLoading) return <skeletons>`).

**Problème 3 — 5 requêtes supplémentaires 250 ms après la première réponse** : `getForecastProvenance`, `getForecastCollectionReport`, `getLocalNowcastingReports` (admin), `searchStations` (collecte de stations en direct) et `getEvidenceStatus` → nouvelle vague complète d'allers-retours.

**Problème 4 — `useAuth()` + fond de page `/manus-storage`** comme sur les autres pages.

---

### 3.6 Historique — `/history`

Fichier : `client/src/pages/History.tsx` (200 lignes).

**Problème 1 — recharts en import statique** (`import { Bar, BarChart, ..., ResponsiveContainer, ... } from "recharts"`), soit **108,0 kB gzip** téléchargés et analysés avant tout rendu, pour un graphique qui n'a de données qu'après la réponse serveur. Total de la page : **252,4 kB gzip de JS statique** — la 2ᵉ page la plus lourde alors que son propre code ne pèse que 8,4 kB gzip.

**Problème 2 — la requête est sans aucune option** :
`trpc.weather.getHistory.useQuery(...)` → `staleTime: 0`, `retry: 3`, `refetchOnWindowFocus: true`.
Chaque retour d'onglet relance donc `getHistory`.

**Problème 3 — 4 allers-retours base en série côté serveur** (`getHistory`, lignes 511+) :
`getForecastsByDateRange` → `getObservationsByDateRange` → `getLatestMeteoAIForecasts` → **puis seulement** un `Promise.all` de 3 lectures. Les trois premiers `await` sont indépendants et pourraient être lancés ensemble.

---

### 3.7 Rapport — `/report`

Fichier : `client/src/pages/Report.tsx` (126 lignes) — 13,6 kB brut / 3,1 kB gzip.

Page la plus légère du site **en logique** : une seule requête (`getReport`) et des composants de présentation.

**Problème 1 — elle paye quand même le socle complet** : ~287 kB gzip à froid (dont 131,3 kB de socle JS et 45,5 kB de CSS pour 4 054 règles dont elle n'utilise qu'une fraction).

**Problème 2 — requête sans options** → `staleTime: 0` + `refetchOnWindowFocus: true` : re-requête à chaque retour d'onglet.

**Problème 3 — 3 lectures base en série** : `getForecastsByDate` → `getObservationByDate` → `getMeteoAIForecastByDate` (indépendantes, séquentielles).

Bonne nouvelle : aucun `/manus-storage`, aucune bibliothèque lourde, pas de carte, pas de WebGL sur cette page.

---

### 3.8 Comparaison des pondérations — `/weight-comparison`

Fichier : `client/src/pages/WeightComparison.tsx` (171 lignes) — 22,6 kB brut / 5,2 kB gzip.

- `weather.getWeightTraceHistory` : **sans options** → relancée à chaque focus de fenêtre ; côté serveur `getMeteoAIForecastHistory(locationKey, 30)` puis filtrage.
- `weather.compareWeightSnapshots` : correctement conditionnée (`enabled: canCompareCurrentLocation`), et elle relit `getMeteoAIForecastHistory(locationKey, 60)` — les 60 mêmes snapshots que la requête précédente, sans cache partagé entre les deux procédures.
- `useAuth()` au montage, sans requête dépendante de l'utilisateur derrière.
- Total à froid modéré (~293 kB gzip), aucun asset `/manus-storage` en propre.

---

### 3.9 Favoris — `/favorites`

Fichier : `client/src/pages/FavoriteSettings.tsx` (256 lignes) — 13,1 kB brut / 3,0 kB gzip.

**Problème 1 — waterfall de session** : `favorites.list` est une `protectedProcedure` appelée avec `enabled: !!user`, donc **rien ne part avant que `auth.me` n'ait répondu**. Deux allers-retours en série, et `loading` affiché pendant tout ce temps alors que le serveur n'a encore rien reçu.

*(Le même schéma s'applique au Dashboard : `favorites.list`, `favorites.getPreloadedForecasts` et `personalObservations.dashboardState` sont tous conditionnés par `auth.me`.)*

**Problème 2** : `favorites.list` n'est **pas** traitée par le middleware de compression (§ 1.7) — la réponse part non compressée.

Sinon : page légère (~287 kB gzip à froid), mais qui paye encore le socle global.

---

### 3.10 Routes secondaires

- `/404` et toute route inconnue → `NotFound` (4,8 kB brut / 1,9 kB gzip).
- Alias servis par les mêmes composants : `/stations`, `/reliability` → `Ranking` ; `/lab` → `ReliabilityLaboratory` ; `/weight-comparison`, `/report`, `/history`, `/ai-lab`, `/favorites`. Aucune page n'a de préchargement au niveau du routeur : seul le survol/`pointerdown` d'un lien déclenche `preloadMainPage()` (et seulement pour les 5 entrées de `mainPagePreloaders`).

---

## 4. Synthèse par cause, avec le nombre de pages touchées

| # | Cause | Preuve | Pages touchées | Effet |
|---|---|---|---|---|
| 1 | Script inline `manus-runtime` de 358,5 kB dans le shell | `dist/public/index.html`, source du plugin | **Toutes** | Parse bloquant + 368 kB re-téléchargés ; `/` en `no-store` |
| 2 | 1,63 Mo de textures 3D non cachables + 118,3 kB gzip Three.js | `getStaticAssetCacheControl` exécuté + `earthScene.ts` | **Toutes** (à froid) | Bande passante volée aux requêtes de données |
| 3 | Proxy presign `/manus-storage` en 2 sauts + `no-store` | `storageProxy.ts` | Dashboard, Détails, Stations, Labo, Historique, AI Lab | Latence par image, non amortie |
| 4 | recharts (108,0 kB gzip) en import statique | graphe de chunks + `History.tsx`, `ReliabilityTrendChart.tsx` | Historique, Labo | 2 pages les plus lourdes du site |
| 5 | Leaflet (50,2 kB gzip + 6,3 kB CSS) en import statique | graphe de chunks + `StationMap`/`Map.tsx` | Stations (+ Dashboard au scroll) | Poids avant premier rendu |
| 6 | Cascades `enabled: !!x` (auth → données, requête → requête) | `WeatherDetails.tsx`, `Dashboard.tsx`, `FavoriteSettings.tsx` | Détails, Dashboard, Favoris | 2 à 3 allers-retours en série |
| 7 | Défauts React Query (`staleTime: 0`, `retry: 3`, refocus) | `main.tsx` + requêtes sans options | Historique, Rapport, Comparaison, Stations | Re-requêtes et attentes inutiles |
| 8 | Budgets serveur jusqu'à 7,2 s sur le chemin « prévision » | `deadlineAt = +7_200`, `withDeadline(…, 7_000, …)` | Dashboard, Détails, Stations, Labo, AI Lab | Écran de chargement prolongé |
| 9 | Lectures base en série dans les procédures | `getHistory`, `getReport`, `getAILab` | Historique, Rapport, AI Lab | Temps = somme et non maximum |
| 10 | CSS global unique de 45,5 kB gzip, aucun découpage par route | build | **Toutes** | Payé même par les pages textuelles |
| 11 | Réponses non-`weather.*` non compressées | `httpCompression.ts` | Dashboard, Favoris | Octets inutiles |

---

## 5. Ce qui n'est PAS un problème (pour éviter de chercher au mauvais endroit)

- **Le backend n'est pas le suspect principal.** Il y a de vrais caches : snapshot officiel 2 min, stations 90 s, références de modèles 5 min, laboratoire 5 min, aperçu de fiabilité 5 min, plus un « singleflight » (`snapshotInFlight`) qui empêche les recalculs simultanés.
- **Le chemin froid est déjà « archive d'abord »** : `resolveOfficialWeatherSnapshot` lit l'archive en base et ne fait attendre la collecte live à 7 modèles que si l'archive est vide, le rafraîchissement se poursuivant en arrière-plan.
- **Les graphes du Dashboard ne sont pas des bibliothèques lourdes** : `HourlyChart` et `FifteenDayChart` sont dessinés à la main (aucun import recharts) et chargés en différé (+47,2 kB gzip après rendu).
- **`EnvironmentalPanels` est correctement paresseux** : aucun appel `getEnvironmentalSnapshot`, aucun IntersectionObserver déclenché tant que la section n'approche pas de la fenêtre.
- **Le préchargement à la navigation existe** (`useDetailedForecastPrefetch`, `preloadMainPage`) et partage exactement les mêmes clés React Query — la navigation interne est donc moins pénalisée qu'un chargement direct.
- **Aucune police web bloquante** : le bloc Google Fonts de `client/index.html` est bien à l'intérieur d'un commentaire HTML ; aucune `@import` CSS externe (`index.css` n'importe que `tailwindcss` et `tw-animate-css`).
- **Les assets vraiment gros et versionnés sont bien cachés un an** (`/assets/lunar/*.webp`, `/assets/solar/*.webp`, tous les chunks JS/CSS hachés : `max-age=31536000, immutable` — vérifié).
- **Pas de N+1 visible** sur les stations : les marqueurs Leaflet sont des `L.circleMarker` vectoriels, sans fichiers d'icônes.

---

## 6. À vérifier en 2 minutes sur le site en ligne (ce que je n'ai pas pu mesurer)

Ouvrez `https://meteoai-7i8fkmsr.manus.space`, onglet **Réseau**, puis rechargez à froid (⌘/Ctrl + Shift + R) :

1. **Taille de la réponse HTML** de `/` : doit être ~368 kB non compressée. Regardez `Content-Encoding` — si **gzip/br est absent**, les 368 kB + 436 kB de JS + 316 kB de CSS partent en clair, et le problème double.
2. **`Cache-Control` de `/`** : confirmez `no-store` (attendu d'après `express.static`) au lieu de `max-age=60`.
3. **Filtrer sur `manus-storage`** : comptez les entrées. Chacune doit montrer **deux requêtes** (la vôtre + le 307 vers S3) et `Cache-Control: no-store`. Notez la taille des `.jpg` `sky-pack-*`.
4. **Filtrer sur `textures/earth`** : doivent apparaître à chaque rechargement (elles ne sont jamais mises en cache) — confirmez la taille totale (~1,6 Mo).
5. **`earthScene-Carrg13H.js`** : doit apparaître au premier chargement sans que vous ayez rien demandé (déclenché par l'écran de chargement).
6. **Onglet Performance → Web Vitals** : notez LCP, TBT et le temps total. Si le TTFB des appels `/api/trpc/weather.getDetailedForecast` est élevé (cache froid), cela confirmera le point 8 du tableau.

Ces mesures permettront de trancher ce qui, dans la liste ci-dessus, pèse le plus **sur votre trafic réel** — c'est la seule chose que je ne peux pas déterminer depuis le dépôt.

---

## 7. Correctifs appliqués et gains mesurés

Mesures obtenues par un build de production complet après modification, avec la
même méthode de calcul qu'en section 2 (closure statique des imports, gzip -9).

### 7.1 Suppression complète du globe 3D de l'écran de chargement

Le visuel de `WeatherAILoader` est désormais **100 % CSS** : disque en dégradé,
orbites, halo et soleil, animés par `@keyframes` sous
`@media (prefers-reduced-motion: no-preference)`.

Ce qui a été retiré et pourquoi :

| Ressource supprimée | Poids |
|---|---|
| Chunk `earthScene` (Three.js) | 474,2 ko brut / **118,3 ko gzip** |
| `earth_atmos_2048.jpg` | 512,6 ko |
| `earth_normal_2048.jpg` | 336,8 ko |
| `earth_lights_2048.png` | 410,2 ko |
| `earth_clouds_1024.png` | 226,1 ko |
| `earth_specular_2048.jpg` | 223,4 ko |
| **Total retiré du chemin critique** | **118,3 ko gzip + 1,71 Mo** |

Raison : ces ressources étaient demandées par l'écran d'attente de **toutes les
routes**, donc au pire moment — pendant que les requêtes de données se
disputaient la même bande passante — pour un élément `aria-hidden="true"`
purement décoratif. Elles étaient de plus servies en `no-store`, donc
retéléchargées à chaque chargement à froid.

Fichiers supprimés : `EarthGlobe.tsx`, `earthScene.ts`, `earth-preview.html`,
`earth-preview.tsx`, `client/public/textures/earth/` (5 textures + attributions).
`client/earth-preview.html` n'était pas inclus dans le build de production.
Les fichiers restent récupérables dans l'historique Git. Vérifications :
`grep` ne trouve plus aucune référence, et un test dédié vérifie l'absence des
fichiers pour éviter toute réintroduction silencieuse.

Un délai de 1,5 s avant chargement du globe avait d'abord été envisagé, puis
écarté au profit de la suppression définitive : ce délai ne protégeait que les
utilisateurs rapides, alors que ce sont précisément les utilisateurs lents —
ceux qui attendent plus de 1,5 s — qui auraient téléchargé les 1,71 Mo.

### 7.2 Cache des médias sans empreinte

`getStaticAssetCacheControl` servait en `no-store` tout fichier dont le nom ne
contient pas d'empreinte. Les images des dossiers de médias reçoivent désormais
`public, max-age=604800, stale-while-revalidate=86400` (7 jours) — pas
`immutable`, car un fichier peut être remplacé sans changer de nom. Le code, le
HTML, les service workers et les fichiers de données restent en `no-store`.

### 7.3 Bibliothèques lourdes sorties du chemin critique

| Page | Avant | Après | Gain |
|---|---|---|---|
| Historique `/history` | 252,4 ko gzip | **142,8 ko** | **−109,6 ko** |
| Laboratoire `/laboratoire` | 271,6 ko gzip | **161,0 ko** | **−110,6 ko** |
| Stations `/ranking` | 227,2 ko gzip | **173,0 ko** | **−54,2 ko** |
| Dashboard `/` | 215,7 ko gzip | 215,8 ko | — |
| AI Lab, Rapport, Comparaison, Favoris | — | — | ±0,2 ko |

- **Historique** : les trois graphiques et l'infobulle partagée ont été extraits
  dans `client/src/components/HistoryCharts.tsx`, seul consommateur de recharts,
  chargé par `lazy()` + `Suspense`. Les helpers d'affichage communs vivent
  désormais dans `client/src/lib/historyChartFormat.ts`. Vérification par script :
  le code déplacé est **identique caractère pour caractère** à l'original (hors
  préfixe `export` et renommage des props).
- **Laboratoire** : `ReliabilityTrendChart` (seul usage de recharts) est chargé
  par `lazy()`.
- **Stations** : `StationMap` (leaflet, 50,2 ko gzip + 6,3 ko de CSS) est chargé
  par `lazy()` ; la page affiche un squelette à la hauteur exacte, puis la carte
  et son propre repère de chargement.

### 7.4 Requêtes qui ne se relancent plus inutilement

Options explicites ajoutées là où les valeurs par défaut de React Query
(`staleTime: 0`, `retry: 3`, `refetchOnWindowFocus: true`) provoquaient des
rechargements complets à chaque retour d'onglet :

- `weather.getHistory` : `staleTime` 5 min, pas de refetch au focus, 1 tentative ;
- `weather.getReport` : idem ;
- `weather.getWeightTraceHistory` : `staleTime` 1 min ;
- `weather.getStationRankingCriteria` : `staleTime` 1 h (contrat figé côté serveur).

### 7.5 Validation

- `npx tsc --noEmit` : aucune erreur.
- `npx vitest run` : **263 fichiers, 1379 tests** — tous réussis (2 ignorés).
- `vite build` : réussi ; le graphique a bien disparu du build, le dossier
  `dist/public/textures` n'existe plus, et `dist/public/index.html` reste à
  368,19 ko (le script inline de la plateforme Manus, hors de portée de ce
  dépôt — voir section 3.1 et 6).
- Nouveaux tests de rendu réel (`renderToStaticMarkup`) : le visuel de
  chargement ne contient ni `<img>`, ni `<canvas>`, ni référence
  `/textures/` ou `manus-storage` ; le module de graphiques s'importe seul et
  son infobulle rend le bon écart.

### 7.6 Reste à traiter (non fait dans ce lot)

1. **`/manus-storage`** : 65 références passant par un proxy presign en deux
   sauts avec `no-store`. Correctif : rapatrier les fichiers dans le dépôt
   (ils ne sont pas accessibles depuis cet environnement).
2. **Historique / Rapport / AI Lab** : lectures base séquentielles côté serveur
   (`await` indépendants enchaînés) — à paralléliser.
3. **Dashboard** : trois vagues de requêtes en série (`auth.me` → favoris,
   `officialForecast` → journalier, puis +250 ms → régime/provenance).
4. **AI Lab** : 8 panneaux importés statiquement (chunk de 55 ko gzip).
5. **`/details`** : deux requêtes serveur séquentielles sur chargement direct
   (clés de cache différentes : 2 vs 16 jours d'horizon — à ne pas paralléliser
   sans mesurer).
6. **Script inline Manus de 358,5 ko** : dépend de la plateforme, à remonter à
   Manus ; ne pas désactiver à l'aveugle (risque sur l'auto-connexion des
   aperçus via `sessionStorage["manus-cookie"]`).
