# Audit Complet — MeteoAI
**Date de l'audit :** 31 juillet 2026  
**Auditeur :** Manus AI  
**Version auditée :** checkpoint `347ab2c0`  
**Stack :** React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM + MySQL/TiDB

---

## Table des matières

1. [Fonctionnalités existantes](#1-fonctionnalités-existantes)
2. [Paramètres météo utilisés](#2-paramètres-météo-utilisés)
3. [Algorithmes](#3-algorithmes)
4. [Intelligence Artificielle](#4-intelligence-artificielle)
5. [Classement des modèles météo](#5-classement-des-modèles-météo)
6. [Détection des régimes météo](#6-détection-des-régimes-météo)
7. [Données météo collectées](#7-données-météo-collectées)
8. [Interface utilisateur](#8-interface-utilisateur)
9. [Architecture technique](#9-architecture-technique)
10. [Ce qu'il manque](#10-ce-quil-manque)
11. [Roadmap](#11-roadmap)
12. [Rapport final](#12-rapport-final)

---

## 1. Fonctionnalités existantes

### 1.1 Dashboard météo principal

**État : ✅ Terminée**

Le Dashboard est l'écran central de l'application. Il affiche la température actuelle (issue de l'heure la plus proche du moment présent dans les données horaires), les températures max/min du jour, la température ressentie, l'indice UV, une rose des vents avec direction et vitesse, les précipitations, les rafales, l'humidité, la couverture nuageuse et l'indice de fiabilité. Un badge de régime météo dominant est affiché avec les pondérations actives (température, précipitations, vent, conditions). Le sélecteur de mode (Standard / Local / Ultra-local) permet de basculer le moteur de calcul de température. En mode Local ou Ultra-local, un bloc de transparence détaillé affiche la décomposition par bandes de distance, les stations utilisées avec leur poids et leur température, l'ajustement microclimatique et une explication textuelle.

**Fichiers :** `client/src/pages/Dashboard.tsx`, `server/routers/weather.ts`, `server/routers/favorites.ts`  
**Dépendances :** tRPC, Open-Meteo API, `ultraLocalService.ts`, `stationService.ts`  
**Points forts :** Richesse des informations, transparence algorithmique, adaptation au lieu sélectionné.  
**Limites :** Le résumé textuel IA (3 phrases matin/après-midi/nuit) est absent du Dashboard — il n'est généré que dans les fiches de lieux favoris. L'indice de confiance affiché est en réalité l'indice de stabilité (`stabilityIndex`), pas un vrai score de confiance multi-sources.

---

### 1.2 Barre de lieux favoris

**État : ✅ Terminée**

La `FavoritesBar` permet à l'utilisateur connecté de gérer jusqu'à 5 lieux favoris. Chaque lieu est représenté par une pilule affichant la température actuelle, la condition météo et le score de confiance (issus du cron 05h00). La sélection d'un favori met à jour toutes les prévisions du Dashboard, du graphique horaire, du graphique 16 jours, de la page Classement et de la page Historique via le `LocationContext`.

**Fichiers :** `client/src/components/FavoritesBar.tsx`, `server/routers/favorites.ts`, `drizzle/schema.ts` (table `favorite_locations`, `location_forecasts`)  
**Points forts :** Données pré-chargées à 05h00 pour un affichage instantané. Synchronisation globale via contexte React.  
**Limites :** Maximum 5 lieux par utilisateur. Pas de partage de lieu entre utilisateurs.

---

### 1.3 Graphique horaire (HourlyChart)

**État : ✅ Terminée (enrichie)**

Le `HourlyChart` affiche 24 heures de prévisions avec une courbe de température (Canvas/SVG natif), des barres de précipitations, des indicateurs de vent et une ligne de température ressentie. Un clic sur une colonne ouvre un overlay détaillé affichant : heure, température, ressenti, précipitations, vent, rafales, humidité, couverture nuageuse, direction du vent, indice UV, code météo WMO, et les nouveaux champs enrichis (rafales `windGust`, écart entre modèles `tempSpread`, probabilité de pluie `precipProb`, nombre de modèles `modelCount`).

**Fichiers :** `client/src/components/HourlyChart.tsx`, `server/routers/weather.ts` (procédure `getHourlyForecast`), `server/weatherServices.ts` (`collectHourlyForecast`)  
**Points forts :** Overlay riche, données temps réel, indicateur de confiance calculé.  
**Limites :** La probabilité de pluie n'est pas affichée directement sur les barres (uniquement dans l'overlay au clic). Les données multi-modèles horaires stockées en base (`hourly_forecasts`) ne sont pas encore fusionnées dans cet affichage — seul le modèle `best_match` est utilisé.

---

### 1.4 Graphique 16 jours (FifteenDayChart)

**État : ✅ Terminée**

Le `FifteenDayChart` affiche les prévisions journalières avec un toggle **7j / 15j / 16j ✦**. Pour chaque jour : icône météo, températures max/min, précipitations, vent, humidité, couverture nuageuse, indice UV, stabilité, direction du vent, lever/coucher du soleil. Le mode 16j n'apparaît que si les données sont disponibles.

**Fichiers :** `client/src/components/FifteenDayChart.tsx`, `server/routers/weather.ts` (procédure `get15DayForecast`), `server/weatherServices.ts` (`collect15DayForecast`)  
**Points forts :** Données enrichies (UV, lever/coucher soleil, direction vent), toggle de fenêtre temporelle.  
**Limites :** Pas de comparaison inter-modèles sur ce graphique. Pas d'indicateur de confiance par jour.

---

### 1.5 Page Classement (Ranking)

**État : ✅ Terminée (refonte complète)**

La page Classement affiche le système multi-régimes simultanés avec illustration SVG dynamique selon le régime dominant, les régimes actifs avec leurs pourcentages d'influence, les pondérations blended (6 paramètres : température, précipitations, vent, conditions, humidité, pression), l'indice de confiance global (0-100), la grille des 12 régimes possibles, les facteurs clés du moment, et le classement des modèles avec score global, tendance et meilleur modèle.

**Fichiers :** `client/src/pages/Ranking.tsx`, `server/routers/weather.ts` (procédure `getRanking`), `server/fusionEngine.ts` (`detectMultiRegime`, `EXTENDED_REGIME_INFO`)  
**Points forts :** Visualisation multi-régimes unique, transparence des pondérations, 12 régimes vs 5 dans la version précédente.  
**Limites :** Le classement des modèles publics (Météo-France, AccuWeather, etc.) repose sur des données simulées pour 8 des 10 services publics. Les scores affichés pour ces services ne reflètent pas leur vraie performance.

---

### 1.6 Page Historique

**État : ✅ Terminée (partielle)**

La page Historique permet de visualiser les observations réelles vs les prévisions MeteoAI sur 7, 14 ou 30 jours. Elle affiche un graphique de comparaison des températures, un graphique de l'indice de stabilité, et un tableau détaillé avec les valeurs observées et prévues.

**Fichiers :** `client/src/pages/History.tsx`, `server/routers/weather.ts` (procédure `getHistory`)  
**Limites :** Pas d'affichage des régimes actifs par jour passé. Pas de comparaison par modèle individuel. Pas de graphique de précipitations ou de vent dans l'historique.

---

### 1.7 Page Stations météo

**État : ✅ Terminée**

La page Stations liste les stations météo découvertes dans le rayon configuré, avec leur distance, altitude, source, score de fiabilité, fréquence de mise à jour, disponibilité des données et statut (active/exclue). Un résumé de la vérité terrain (ground truth) calculée est affiché.

**Fichiers :** `client/src/pages/Stations.tsx`, `server/routers/stations.ts`, `server/stationService.ts`  
**Points forts :** Transparence complète sur les sources de données locales.  
**Limites :** Les sources de stations sont partiellement simulées (stations personnelles Netatmo/WUnderground sont des points Open-Meteo décalés, pas de vraies stations personnelles).

---

### 1.8 Page AI Lab (Laboratoire IA)

**État : ✅ Terminée**

La page AI Lab est la page de transparence la plus complète. Elle affiche les badges de confiance/stabilité/transparence, le texte d'analyse IA, le régime météo avec liste expansible des 12 régimes, les barres de divergence inter-modèles, le tableau des données brutes par modèle, la décomposition des formules de pondération, les étapes de replay animées du calcul MeteoAI, le graphique de performance historique, l'inventaire des sources, et la section stations intégrée (ultra-local aware).

**Fichiers :** `client/src/pages/WeatherAILab.tsx`, `server/routers/weather.ts` (procédure `getAILab`)  
**Points forts :** Niveau de transparence algorithmique exceptionnel, pédagogie sur le fonctionnement de l'IA.  
**Limites :** Le graphique de performance historique ne s'affiche que si des données historiques existent en base.

---

### 1.9 Collecte automatique (Crons Heartbeat)

**État : ✅ Terminée**

Trois crons Heartbeat sont configurés :
- **05h00 Paris** : `collectFavoritesForecastsHandler` — collecte les prévisions pour tous les lieux favoris de tous les utilisateurs, génère la synthèse MeteoAI, stocke les prévisions horaires pour 8 modèles.
- **07h30 Paris** : `collectForecastsHandler` — collecte les prévisions pour Hondeghem (lieu par défaut legacy), génère la synthèse MeteoAI et l'explication LLM.
- **00h30 Paris** : `collectObservationsHandler` — collecte les observations de la veille pour tous les lieux favoris, calcule les scores de fiabilité multi-dimensionnels.

**Fichiers :** `server/scheduledHandlers.ts`, `server/_core/heartbeat.ts`  
**Points forts :** Architecture robuste, déduplication des lieux, gestion des erreurs par lieu.  
**Limites :** Le cron 07h30 est redondant avec le cron 05h00 pour les utilisateurs ayant Hondeghem en favori. Pas de cron de vérification de santé des données.

---

### 1.10 Authentification OAuth

**État : ✅ Terminée**

Authentification Manus OAuth complète. Les procédures protégées utilisent `protectedProcedure` avec `ctx.user`. Les favoris, paramètres de lieu et préférences sont liés à l'utilisateur.

**Fichiers :** `server/_core/oauth.ts`, `server/_core/context.ts`, `client/src/_core/hooks/useAuth.ts`

---

### 1.11 Moteur Ultra-local

**État : ✅ Terminée**

Trois modes de calcul de température : Standard (rayon 20 km, 30% modèles), Local (bandes 0-5/5-10/10-20 km, 10% modèles), Ultra-local (bandes < 2/2-5/5-10/10-20 km, 2% modèles). Vérifications qualité : fraîcheur, cohérence avec voisins, correction d'altitude, score de fiabilité historique. Détection de microclimats : îlot de chaleur urbain, vallée froide, effet côtier, altitude, rural/forêt.

**Fichiers :** `server/ultraLocalService.ts`, `server/stationService.ts`

---

### 1.12 Moteur de fusion adaptatif (FusionEngine)

**État : ✅ Terminée (partiellement intégrée)**

Le `FusionEngine` implémente la fusion IDW p=2 avec pondération adaptative par MAE historique, détection d'anomalies (Z-score > 2.5, sauts brutaux, valeurs figées), correction d'altitude, scoring par échéance (0-6h, 6-24h, 1-3j, 4-7j, 8-15j), validation statistique (test t apparié, p < 0.05, n ≥ 10), et la fonction `generateAdaptiveForecast` (fusion par paramètre avec poids 1/MAE).

**Fichiers :** `server/fusionEngine.ts`  
**Limites :** La fusion IDW (`computeFusion`) n'est pas encore appelée dans les crons de production — seule `generateAdaptiveForecast` est utilisée. `computeLeadTimeScores` et `isSignificantImprovement` sont implémentés mais pas encore branchés sur l'interface.

---

## 2. Paramètres météo utilisés

| Paramètre | Collecté | Stocké en DB | Affiché | Utilisé dans scoring | Notes |
|-----------|----------|--------------|---------|---------------------|-------|
| Température max | ✅ | ✅ | ✅ | ✅ | MAE, RMSE, biais |
| Température min | ✅ | ✅ | ✅ | ✅ | MAE, RMSE, biais |
| Température actuelle | ✅ (horaire) | ✅ | ✅ | ❌ | Calculée depuis horaire |
| Température ressentie | ✅ (horaire) | ✅ | ✅ | ❌ | Affichée, non scorée |
| Précipitations (mm) | ✅ | ✅ | ✅ | ✅ | POD, FAR, CSI, MAE quantité |
| Probabilité de pluie | ✅ (calculée) | ❌ | ✅ (overlay) | ❌ | Calculée depuis best_match vs AROME |
| Vent moyen (km/h) | ✅ | ✅ | ✅ | ✅ | MAE vent moyen |
| Rafales (km/h) | ✅ | ✅ | ✅ | ✅ | MAE rafales |
| Direction du vent (°) | ✅ (horaire) | ✅ | ✅ (rose) | ❌ | Non scorée |
| Humidité (%) | ✅ | ✅ | ✅ | ❌ | Affiché, pondération régime |
| Couverture nuageuse (%) | ✅ | ✅ | ✅ | ✅ | Concordance catégorielle |
| Pression atmosphérique (hPa) | ✅ (stations) | ✅ | ✅ | ❌ | Pondération régime uniquement |
| Indice UV | ✅ (horaire) | ✅ | ✅ | ❌ | Affiché uniquement |
| Point de rosée | ❌ | ❌ | ❌ | ❌ | Non collecté |
| Visibilité | ✅ (stations) | ✅ | ❌ | ❌ | Utilisé pour détection brouillard |
| Qualité de l'air | ❌ | ❌ | ❌ | ❌ | Non intégré |
| Lever/coucher soleil | ✅ (calculé) | ❌ | ✅ (15j) | ❌ | Calculé depuis Open-Meteo |
| Code météo WMO | ✅ (horaire) | ✅ | ✅ (overlay) | ❌ | Affiché dans overlay horaire |
| Altitude station | ✅ | ✅ | ✅ | ✅ | Correction -0.65°C/100m |
| Score fiabilité station | ✅ | ✅ | ✅ | ✅ | Pondération ultra-local |

**Paramètres non encore exploités :** point de rosée, qualité de l'air (PM2.5, O₃, NO₂), neige au sol, épaisseur de neige, indice de confort thermique WBGT, probabilité de gel.

---

## 3. Algorithmes

### 3.1 Calcul du score de fiabilité multi-dimensionnel (`calculateReliabilityScore`)

**Rôle :** Évaluer la précision d'un modèle météo sur une période historique en comparant ses prévisions aux observations réelles.

**Fonctionnement :** Le calcul est décomposé en 4 dimensions indépendantes avant toute agrégation :

**Dimension Température** : MAE sur tempMax et tempMin combinés, RMSE, biais moyen, erreur maximale. Le score est converti via une décroissance exponentielle `score = 100 × exp(-3 × MAE / 10)`, où 10°C est l'erreur maximale attendue.

**Dimension Précipitations** : Détection binaire pluie/non-pluie avec seuil 1 mm. Calcul du POD (Probability of Detection = hits / (hits + misses)), FAR (False Alarm Rate = fausses alarmes / (hits + fausses alarmes)), CSI (Critical Success Index = hits / (hits + misses + fausses alarmes)). Score composite = 50% score de détection (CSI × 100) + 50% score de quantité (MAE sur les jours pluvieux uniquement).

**Dimension Vent** : MAE vent moyen (70%) + MAE rafales (30% si disponible). Erreur maximale attendue : 25 km/h pour le vent moyen, 35 km/h pour les rafales.

**Dimension Conditions** : Concordance catégorielle sur 3 catégories (clair / partiellement nuageux / couvert+pluie) + MAE couverture nuageuse. Score = 60% concordance + 40% précision nuageuse.

**Agrégation finale :** `score = temp × w_temp + precip × w_precip + wind × w_wind + cond × w_cond` où les pondérations `w_*` dépendent du régime météo détecté (voir section 6).

**Avantages :** Mesure indépendante par dimension, pas de compensation entre paramètres, contextualisation par régime.  
**Limites :** Pas de scoring par échéance (0-6h, 6-24h, etc.) dans la version actuelle — `computeLeadTimeScores` existe mais n'est pas branché. Le RMSE précipitations et vent ne sont pas stockés en base (colonnes `rmsePrecip`, `rmseWind` toujours à 0).

---

### 3.2 Moteur Ultra-local (`calculateUltraLocal`)

**Rôle :** Calculer la température la plus précise possible en combinant des stations météo locales selon leur proximité, qualité et altitude.

**Fonctionnement :** Les stations sont d'abord filtrées par vérifications qualité (fraîcheur, cohérence avec voisins ±5°C, altitude, score historique ≥ 45). Les stations valides sont réparties en bandes concentriques (< 2 km : 65%, 2-5 km : 20%, 5-10 km : 10%, 10-20 km : 3%, modèles : 2% en ultra-local). À l'intérieur de chaque bande, la pondération est `w = (1/distance²) × qualityScore × freshnessScore × performanceScore`. Les pondérations de bandes sont redistribuées si une bande est vide. Une correction d'altitude de -0.65°C/100m est appliquée. Les microclimats (urbain +0.5-1.5°C, vallée -0.5-1.5°C, côtier ±0.5°C, altitude -0.65°C/100m, forêt -0.3°C) sont détectés heuristiquement et appliqués. L'indice de confiance est calculé à partir du nombre de stations, de leur accord (écart-type) et de leur score de qualité moyen.

**Avantages :** Transparence complète (bandes, stations, microclimats), trois niveaux de précision, correction d'altitude.  
**Limites :** Les microclimats sont détectés heuristiquement (pas d'apprentissage automatique). Les stations "personnelles" (Netatmo, WUnderground) sont simulées par des points Open-Meteo décalés.

---

### 3.3 Fusion adaptative par paramètre (`generateAdaptiveForecast`)

**Rôle :** Synthétiser les prévisions de 8 modèles experts en une prévision unique, en pondérant chaque modèle différemment selon sa performance historique pour chaque paramètre.

**Fonctionnement :** Pour chaque paramètre (tempMax, tempMin, précipitations, vent), un vecteur de poids est calculé : `w_i = 1 / MAE_i` si le MAE historique est disponible, sinon `w_i = score_global_i / 100`. Les poids sont normalisés pour sommer à 1. La prévision finale est une moyenne pondérée : `valeur = Σ(w_i × valeur_i) / Σ(w_i)`. Cette méthode ne s'active que si au moins 3 jours d'historique avec MAE mesuré sont disponibles — sinon, la méthode legacy (pondération par score global) est utilisée.

**Avantages :** Pondération indépendante par paramètre, activation conditionnelle sécurisée, fallback robuste.  
**Limites :** Pas de pondération par échéance (un modèle excellent à J+1 mais mauvais à J+7 reçoit le même poids). Pas de détection de biais systématique ni de correction automatique.

---

### 3.4 Détection d'anomalies (`detectAnomalies`)

**Rôle :** Identifier et pénaliser les stations ou modèles présentant des valeurs aberrantes avant la fusion.

**Fonctionnement :** Trois types d'anomalies sont détectés : (1) **Valeur figée** — même température que la lecture précédente depuis > 60 min (pénalité 0.3) ; (2) **Saut brutal** — variation > 5°C en < 10 min (pénalité 0.2) ; (3) **Outlier statistique** — Z-score > 2.5σ par rapport à la médiane des sources (pénalité 0.4). Les pénalités sont multiplicatives.

**Limites :** La détection de valeurs figées nécessite un historique des lectures précédentes (`previousReadings`), qui n'est pas encore persisté entre les appels.

---

### 3.5 Indice de stabilité (`calculateStabilityIndex`)

**Rôle :** Mesurer la cohérence entre les prévisions des différents modèles pour un jour donné.

**Fonctionnement :** `stabilité_temp = max(0, 100 - écart_type_temp × 20)` ; `stabilité_precip = max(0, 100 - écart_type_precip × 10)` ; `index = stabilité_temp × 0.6 + stabilité_precip × 0.4`. Un index ≥ 60 est "stable", < 60 est "instable".

**Limites :** Cet indice mesure l'accord entre modèles, pas la précision réelle. Il est actuellement utilisé comme `confidenceScore` dans la base de données, ce qui est une approximation.

---

### 3.6 Vérité terrain (`calculateGroundTruth`)

**Rôle :** Calculer une observation de référence pondérée à partir de plusieurs stations locales, utilisée pour évaluer les prévisions.

**Fonctionnement :** Pondération = 50% distance (IDW p=1) + 30% score qualité + 20% fraîcheur. Indice de confiance basé sur le nombre de stations (≥ 3 = 100%) et leur accord (écart-type < 1°C = 100%).

---

### 3.7 Validation statistique (`isSignificantImprovement`)

**Rôle :** Valider qu'une nouvelle méthode est statistiquement meilleure avant de la déployer.

**Fonctionnement :** Test t apparié (Welch). Conditions : n ≥ 10 observations, p < 0.05, amélioration > 0. Approximation de la p-valeur par la distribution normale (Abramowitz & Stegun).

**Statut :** Implémenté mais non encore branché sur l'interface ou les crons.

---

## 4. Intelligence Artificielle

### Ce que fait actuellement l'IA

**Génération de texte (LLM)** : Un LLM (modèle Manus built-in) génère une explication textuelle de la prévision du jour en 2-3 phrases, mentionnant la température, les précipitations, le vent, l'indice de stabilité et le nombre de modèles consultés. Cette explication est générée lors du cron 05h00 (par lieu favori) et 07h30 (Hondeghem). Elle est affichée dans l'AI Lab et dans les fiches de lieux.

**Détection de régimes météo** : L'algorithme `detectMultiRegime` calcule des scores pour 12 régimes simultanément, les normalise en pourcentages d'influence, et produit un indice de confiance basé sur la dominance du régime principal. Ce n'est pas du machine learning — c'est un système de règles heuristiques.

**Pondération adaptative** : La fonction `generateAdaptiveForecast` adapte automatiquement les poids des modèles selon leur MAE historique mesuré. C'est une forme d'apprentissage supervisé simple (pas de réseau de neurones).

**Détection de microclimats** : Règles heuristiques basées sur les caractéristiques géographiques (altitude, distance à la mer, environnement urbain/rural/forêt).

### Ce que l'IA ne fait pas encore

- Pas de prévision probabiliste (intervalles de confiance par paramètre).
- Pas de détection automatique de phénomènes extrêmes (orages, neige, canicule) avec alerte.
- Pas d'apprentissage saisonnier (les performances estivales et hivernales sont mélangées).
- Pas de correction de biais automatique (si AROME surestime systématiquement la température de +1°C, ce biais n'est pas corrigé).
- Pas de scoring par échéance dans la fusion (un modèle excellent à J+1 mais mauvais à J+7 reçoit le même poids).
- Le résumé textuel du Dashboard (matin/après-midi/nuit) n'est pas implémenté.
- Pas de détection d'anomalies météo persistante (la détection de valeurs figées nécessite un historique entre appels).

### Possibilités d'amélioration IA

La correction de biais automatique (soustraction du biais moyen historique par modèle et par paramètre) représente le gain de précision le plus immédiat. Le scoring par échéance permettrait de mieux pondérer les modèles selon l'horizon de prévision. L'apprentissage saisonnier (scores séparés été/hiver/printemps/automne) améliorerait la pertinence des pondérations. À plus long terme, un modèle d'ensemble probabiliste (quantile regression ou conformal prediction) fournirait des intervalles de confiance par paramètre.

---

## 5. Classement des modèles météo

### Modèles suivis

**8 modèles experts (données réelles via Open-Meteo) :** AROME (Météo-France HD), ARPEGE (Météo-France Europe), ICON (DWD Allemagne), ECMWF IFS 0.25°, GFS (NOAA), GEM (Environnement Canada), UKMET (Met Office), Open-Meteo best_match.

**10 services publics :** Météo-France (API réelle si clé disponible), OpenWeatherMap (API réelle si clé disponible), Meteoblue, AccuWeather, Apple Weather, Weather.com, Ventusky, Weatherbit, World Weather Online, La Chaîne Météo. **Note importante :** 8 de ces 10 services sont simulés par des variations aléatoires (±1°C, ±3mm précip, ±3km/h vent) autour d'Open-Meteo best_match. Leurs scores ne reflètent pas leur vraie performance.

### Calcul du score

Le score est calculé par `calculateReliabilityScore` (voir section 3.1). Le classement cumulatif est une moyenne des scores journaliers pondérée par le nombre de jours (`daysTracked`). La procédure `getRanking` retourne : nom du service, score moyen, MAE température/précipitations/vent, biais, jours suivis, et les données multi-régimes.

### Affichage

La page Classement affiche le meilleur modèle (médaille 🥇), le score global /100, la tendance (+/-), et les régimes actifs avec leurs pondérations blended.

---

## 6. Détection des régimes météo

### Système actuel : double couche

**Couche 1 — Scoring (statsEngine.ts) :** 5 régimes simples (`rainy`, `summer`, `storm`, `cold_winter`, `standard`) avec pondérations fixes. Utilisé pour calculer le `weightedScore` dans `reliability_scores`.

**Couche 2 — Affichage (fusionEngine.ts) :** 12 régimes étendus (`stable`, `summer_heat`, `cold_winter`, `frost`, `rainy`, `heavy_rain`, `thunderstorm`, `fog`, `snow`, `windy`, `storm`, `standard`) avec détection multi-régimes simultanés et pondérations blended sur 6 paramètres. Utilisé pour l'affichage dans Ranking et Dashboard.

### Paramètres utilisés

Température (°C), précipitations (mm), vent (km/h), humidité (%), visibilité (m), couverture nuageuse (%).

### Pondérations par régime (6 paramètres)

| Régime | Temp | Précip | Vent | Cond | Humid | Pression |
|--------|------|--------|------|------|-------|----------|
| Temps stable | 35% | 10% | 10% | 25% | 10% | 10% |
| Canicule | 45% | 10% | 15% | 15% | 10% | 5% |
| Hiver froid | 45% | 20% | 20% | 10% | 3% | 2% |
| Gel | 50% | 15% | 15% | 10% | 5% | 5% |
| Pluie modérée | 20% | 40% | 15% | 15% | 5% | 5% |
| Pluie forte | 15% | 45% | 20% | 10% | 5% | 5% |
| Orage | 10% | 35% | 35% | 10% | 5% | 5% |
| Brouillard | 20% | 10% | 5% | 20% | 35% | 10% |
| Neige/Verglas | 40% | 30% | 15% | 10% | 3% | 2% |
| Vent fort | 15% | 15% | 45% | 15% | 5% | 5% |
| Tempête | 10% | 25% | 45% | 10% | 5% | 5% |
| Standard | 30% | 25% | 20% | 15% | 5% | 5% |

### Indice de confiance multi-régimes

`confiance = min(100, influence_primaire + (influence_primaire - influence_secondaire) × 0.5)`

### Limites

Les seuils de détection sont fixes (ex. : tempête si vent > 60 km/h). Pas d'apprentissage des seuils selon l'historique local. La couche 1 (scoring) et la couche 2 (affichage) sont désynchronisées — le scoring utilise encore les 5 régimes simples.

---

## 7. Données météo collectées

### Sources et fréquences

| Source | Type | Fréquence | Paramètres | Statut |
|--------|------|-----------|------------|--------|
| Open-Meteo (8 modèles) | Prévisions journalières | 05h00 + 07h30 | Tmax, Tmin, précip, vent, rafales, humidité, nuages | ✅ Réel |
| Open-Meteo best_match | Prévisions horaires (24h) | 05h00 | Temp, ressenti, précip, vent, rafales, direction, humidité, nuages, UV, code WMO | ✅ Réel |
| Open-Meteo (8 modèles) | Prévisions horaires (24h) | 05h00 | Idem | ✅ Réel |
| Open-Meteo historique | Observations journalières | 00h30 | Tmax, Tmin, précip, vent, rafales, humidité, nuages | ✅ Réel |
| OpenWeatherMap | Prévisions publiques | 05h00 | Tmax, Tmin, précip, vent, rafales, humidité, nuages | ✅ Réel (si clé API) |
| Météo-France API | Prévisions publiques | 05h00 | Tmax, Tmin, précip, vent, rafales, humidité, nuages | ✅ Réel (si clé API) |
| 8 autres services publics | Prévisions publiques | 05h00 | Tmax, Tmin, précip, vent | ⚠️ Simulé |
| OpenDataSoft SYNOP | Stations officielles | Temps réel | Temp, humidité, pression, vent, précip | ✅ Réel |
| Open-Meteo (stations simulées) | Stations "personnelles" | Temps réel | Temp, humidité, pression, vent | ⚠️ Simulé |

### Tables de base de données

| Table | Contenu | Rétention |
|-------|---------|-----------|
| `forecasts` | Prévisions journalières par service et lieu | Permanente |
| `observations` | Observations journalières par lieu | Permanente |
| `reliability_scores` | Scores de fiabilité calculés | Permanente |
| `meteoai_forecast` | Synthèse MeteoAI journalière | Permanente |
| `location_forecasts` | Prévisions pré-chargées par favori | Mise à jour quotidienne |
| `hourly_forecasts` | Prévisions horaires par modèle | Mise à jour quotidienne |
| `weather_stations` | Catalogue des stations découvertes | Permanente |
| `station_observations` | Lectures temps réel des stations | Permanente |
| `ground_truth` | Vérité terrain calculée | Permanente |
| `favorite_locations` | Lieux favoris utilisateurs | Permanente |
| `collection_jobs` | Journal des collectes | Permanente |

---

## 8. Interface utilisateur

### Dashboard (écran principal)

L'écran est complet et fonctionnel. La hiérarchie visuelle est claire : hero avec température actuelle en grand, badge de régime, stats secondaires, sélecteur de mode, bloc ultra-local (conditionnel), graphique horaire, graphique 16 jours. Le thème sombre est cohérent. **Améliorations possibles :** résumé textuel IA matin/après-midi/nuit absent ; indicateur de confiance affiché = stabilité (pas confiance réelle) ; pas d'alerte météo visible.

### Classement (Ranking)

Refonte récente. L'illustration SVG dynamique par régime est originale. La grille des 12 régimes possibles est pédagogique. **Améliorations possibles :** le classement des services publics simulés devrait être clairement marqué "données simulées" pour ne pas induire en erreur.

### Historique

Fonctionnel mais limité. Uniquement MeteoAI vs observations. **Améliorations possibles :** comparaison par modèle individuel, graphique de précipitations, affichage des régimes passés.

### Stations

Complet et transparent. **Améliorations possibles :** carte géographique des stations, filtres par source/distance.

### AI Lab

Le plus riche en informations. Excellente pédagogie. **Améliorations possibles :** le graphique de performance historique nécessite des données en base pour s'afficher.

### Navigation

5 onglets en bas (Dashboard, Classement, Historique, Stations, AI Lab). Navigation claire et cohérente.

---

## 9. Architecture technique

### Frontend

React 19 avec Vite, Tailwind CSS 4, tRPC client, Wouter (routing), Recharts (graphiques historique), Canvas/SVG natifs (graphiques météo), shadcn/ui (composants UI), Lucide React (icônes). Thème sombre par défaut. Responsive mobile-first.

### Backend

Express 4 avec tRPC 11. Procédures organisées par domaine : `weather.*`, `favorites.*`, `stations.*`, `auth.*`. Middleware OAuth Manus. Heartbeat SDK pour les crons.

### Base de données

MySQL/TiDB via Drizzle ORM. 11 tables. Pas de cache Redis — les données pré-chargées (`location_forecasts`, `hourly_forecasts`) servent de cache applicatif.

### Services externes

- **Open-Meteo** (gratuit, sans clé) : source principale pour les 8 modèles experts, les prévisions horaires, les observations historiques et les stations de référence.
- **OpenDataSoft** (gratuit) : données SYNOP Météo-France pour les stations officielles.
- **OpenWeatherMap** (clé API configurée) : prévisions publiques réelles.
- **Météo-France API** (clé API configurée) : prévisions publiques réelles.
- **Manus LLM** (built-in) : génération des explications textuelles.

### Crons (Heartbeat)

3 tâches planifiées : 05h00, 07h30, 00h30 Paris. Authentification par token cron. Journalisation dans `collection_jobs`.

### Déploiement

Autoscale (serverless Cloud Run). Auto-publish à chaque checkpoint. Pas de cache CDN configuré.

---

## 10. Ce qu'il manque

### 🔴 Indispensable

**Résumé textuel IA sur le Dashboard** (matin/après-midi/nuit) : défini dans les préférences utilisateur mais non implémenté sur la page principale. Impact direct sur l'expérience utilisateur.

**Marquage "données simulées"** pour les 8 services publics simulés : afficher des scores pour AccuWeather, Meteoblue, etc. sans préciser qu'ils sont simulés est trompeur.

**Correction de biais automatique** : si AROME surestime systématiquement la température, ce biais devrait être soustrait automatiquement. Gain de précision immédiat et mesurable.

**Synchronisation couche scoring / couche affichage des régimes** : le scoring utilise 5 régimes, l'affichage en utilise 12. Les pondérations appliquées au calcul des scores ne correspondent pas aux pondérations affichées.

**Probabilité de pluie visible sur le graphique horaire** : actuellement uniquement dans l'overlay au clic. Devrait être visible directement sur les barres de précipitations.

### 🟠 Recommandé

**Scoring par échéance** (0-6h, 6-24h, 1-3j, 4-7j, 8-15j) : `computeLeadTimeScores` est implémenté mais non branché. Permettrait de mieux pondérer les modèles selon l'horizon.

**Page rapport de précision** : afficher les MAE/RMSE/biais par modèle et par paramètre en temps réel, avec évolution historique. Transparence maximale.

**Apprentissage saisonnier** : séparer les scores été/hiver/printemps/automne. Un modèle excellent en été peut être médiocre en hiver.

**Vraies stations Netatmo/WUnderground** : les stations "personnelles" sont actuellement simulées. L'intégration d'une vraie API Netatmo ou Weather Underground apporterait des données réelles hyper-locales.

**Alertes météo** : notification push quand un phénomène exceptionnel est détecté (orage, canicule, gel, tempête). L'infrastructure de notification Manus est disponible.

**Carte géographique des stations** : visualisation des stations sur une carte avec leur statut et leurs données.

**Indice de confiance réel** : distinguer l'indice de stabilité (accord entre modèles) de l'indice de confiance (précision historique attendue). Actuellement les deux sont confondus.

### 🟢 Optionnel

**Qualité de l'air** (PM2.5, O₃, NO₂) via OpenAQ ou WAQI API.

**Point de rosée** : calculable depuis température et humidité, utile pour la détection de brouillard.

**Kriging** (interpolation géostatistique) à la place de l'IDW pour les microclimats complexes.

**Prévisions probabilistes** : intervalles de confiance par paramètre (quantile regression).

**Export des données** : CSV ou JSON des prévisions et observations pour usage externe.

**Comparaison multi-lieux** : afficher les prévisions de plusieurs lieux favoris côte à côte.

**Widget embarquable** : iframe ou API publique pour intégrer MeteoAI dans d'autres sites.

---

## 11. Roadmap

### Phase 0 — Déjà terminé ✅

| Fonctionnalité | Difficulté | Gain |
|----------------|------------|------|
| Dashboard complet (temp, vent, précip, UV, rose des vents) | — | — |
| Graphique horaire 24h avec overlay détaillé | — | — |
| Graphique 16 jours avec toggle 7j/15j/16j | — | — |
| 8 modèles experts via Open-Meteo | — | — |
| Scoring multi-dimensionnel (MAE, RMSE, biais, POD, FAR, CSI) | — | — |
| Moteur ultra-local (3 modes, bandes concentriques, microclimats) | — | — |
| Détection multi-régimes (12 régimes, pondérations blended) | — | — |
| Fusion adaptative par paramètre (1/MAE weighting) | — | — |
| Crons automatiques (05h00, 07h30, 00h30) | — | — |
| Lieux favoris avec données pré-chargées | — | — |
| AI Lab avec transparence algorithmique complète | — | — |

### Phase 1 — Court terme (1-2 semaines) 🟠

| Fonctionnalité | Difficulté | Gain précision | Gain UX |
|----------------|------------|----------------|---------|
| Résumé textuel IA sur Dashboard (matin/après-midi/nuit) | Faible | — | Élevé |
| Marquage "simulé" pour services publics | Très faible | — | Élevé (honnêteté) |
| Probabilité de pluie visible sur barres horaires | Faible | — | Moyen |
| Synchronisation régimes scoring/affichage | Moyenne | Moyen | Faible |
| Correction de biais automatique | Moyenne | Élevé (+0.3-0.8°C MAE) | Faible |

### Phase 2 — Moyen terme (1-2 mois) 🟠

| Fonctionnalité | Difficulté | Gain précision | Gain UX |
|----------------|------------|----------------|---------|
| Scoring par échéance (0-6h à 8-15j) | Moyenne | Élevé | Moyen |
| Page rapport de précision (MAE/RMSE temps réel) | Moyenne | — | Élevé |
| Apprentissage saisonnier | Élevée | Moyen (+0.2-0.4°C MAE) | Faible |
| Alertes météo push | Moyenne | — | Élevé |
| Indicateur de confiance réel (vs stabilité) | Moyenne | — | Moyen |

### Phase 3 — Long terme (3-6 mois) 🟢

| Fonctionnalité | Difficulté | Gain précision | Gain UX |
|----------------|------------|----------------|---------|
| Vraies stations Netatmo/WUnderground | Élevée | Élevé (données réelles) | Moyen |
| Carte géographique des stations | Moyenne | — | Élevé |
| Qualité de l'air | Moyenne | — | Moyen |
| Prévisions probabilistes (intervalles de confiance) | Très élevée | — | Moyen |
| Kriging à la place de l'IDW | Élevée | Faible-Moyen | Faible |

---

## 12. Rapport final

### Tableau de bord d'avancement

| Module | Avancement | État |
|--------|-----------|------|
| Collecte de données (8 modèles experts) | 100% | ✅ Terminé |
| Collecte de données (services publics) | 20% | ⚠️ 8/10 simulés |
| Collecte de données (stations locales) | 60% | ⚠️ Stations personnelles simulées |
| Scoring multi-dimensionnel (MAE/RMSE/biais) | 85% | ⚠️ RMSE précip/vent non stockés |
| Scoring par échéance | 20% | 🔴 Implémenté, non branché |
| Détection de régimes météo | 90% | ⚠️ Désynchronisation scoring/affichage |
| Fusion adaptative (generateAdaptiveForecast) | 80% | ⚠️ Pas de correction de biais |
| Fusion IDW (computeFusion) | 40% | 🔴 Implémentée, non utilisée en prod |
| Moteur ultra-local | 85% | ⚠️ Microclimats heuristiques |
| Dashboard (interface) | 90% | ⚠️ Résumé IA absent |
| Graphique horaire | 85% | ⚠️ Précip prob non visible directement |
| Graphique 16 jours | 95% | ✅ Quasi-terminé |
| Page Classement | 85% | ⚠️ Services simulés non marqués |
| Page Historique | 60% | 🔴 Comparaison par modèle absente |
| Page Stations | 75% | ⚠️ Pas de carte, stations simulées |
| AI Lab | 85% | ⚠️ Graphique historique conditionnel |
| Crons automatiques | 95% | ✅ Quasi-terminé |
| Lieux favoris | 90% | ✅ Quasi-terminé |
| Authentification | 100% | ✅ Terminé |

**Avancement global estimé : 76%**

---

### Fonctionnalités terminées (résumé)

Dashboard complet, graphiques horaire et 16 jours, 8 modèles experts réels, scoring 4 dimensions, moteur ultra-local 3 modes, détection multi-régimes 12 régimes, fusion adaptative par paramètre, 3 crons automatiques, lieux favoris avec données pré-chargées, AI Lab transparent, authentification OAuth.

### Fonctionnalités manquantes (résumé)

Résumé textuel IA sur Dashboard, marquage services simulés, correction de biais, synchronisation régimes, scoring par échéance branché, probabilité de pluie visible, comparaison historique par modèle, vraies stations personnelles, alertes météo, carte des stations.

### Bugs détectés

1. **`confidenceScore` = `stabilityIndex`** dans les tables `meteoai_forecast` et `location_forecasts` — les deux colonnes reçoivent la même valeur (`stability.index`), ce qui est incorrect sémantiquement.
2. **`rmsePrecip` et `rmseWind` toujours à 0** dans `reliability_scores` — les colonnes existent mais ne sont jamais renseignées (le code retourne 0 hardcodé).
3. **Détection de valeurs figées sans historique** — `detectAnomalies` nécessite `previousReadings` qui n'est jamais fourni dans les appels actuels, rendant cette détection inactive.
4. **Cron 07h30 redondant** — pour les utilisateurs ayant Hondeghem en favori, les données sont collectées deux fois (05h00 et 07h30).

### Incohérences détectées

1. **Double système de régimes** — le scoring utilise 5 régimes (`statsEngine.ts`) et l'affichage en utilise 12 (`fusionEngine.ts`). Les pondérations appliquées au calcul des scores ne correspondent pas à celles affichées.
2. **Stations personnelles simulées** — l'interface affiche des sources "Netatmo", "Weather Underground", "CWOP" qui sont en réalité des points Open-Meteo décalés de quelques kilomètres.
3. **Scores des services publics simulés** — AccuWeather, Meteoblue, etc. ont des scores calculés à partir de données aléatoires, pas de leurs vraies prévisions.

### Optimisations possibles

1. Activer `computeFusion` (IDW p=2 avec anomaly detection) pour le calcul de la vérité terrain au lieu du `calculateGroundTruth` actuel (IDW p=1 sans anomaly detection).
2. Brancher `computeLeadTimeScores` dans les crons d'observation pour alimenter le scoring par échéance.
3. Implémenter la correction de biais automatique : `prévision_corrigée = prévision - biais_historique_moyen`.
4. Unifier les 5 régimes du scoring et les 12 régimes de l'affichage en un seul système à 12 régimes.
5. Persister `previousReadings` entre les appels pour activer la détection de valeurs figées.

### Améliorations recommandées (par ordre de priorité)

1. Résumé textuel IA sur le Dashboard (impact UX immédiat, faible effort).
2. Correction de biais automatique (gain de précision mesurable, effort moyen).
3. Marquage transparent des données simulées (honnêteté, très faible effort).
4. Scoring par échéance branché sur l'interface (différenciation produit, effort moyen).
5. Page rapport de précision avec MAE/RMSE en temps réel (transparence, effort moyen).

---

*Rapport généré le 31 juillet 2026 — Aucun fichier du projet n'a été modifié lors de cet audit.*
