# Analyse — « Quotidien : preuves calibrées exactes pour 0/7 » (AI Lab, 13/10/2026)

Objet : expliquer précisément le « 0 » affiché sur la ligne **Quotidien** du bandeau de relance
manuelle de l'AI Lab (`/laboratoire`), captures du 13/10/2026 07:36 et 07:54 :

> « Quotidien : partiel, 7/7 modèles officiels · 13/10/2026 07:53:58 · Fusion quotidienne par
> disponibilité réelle : valeurs disponibles pour 7/7 variables ; **preuves calibrées exactes pour 0/7**. […] »

---

## 1. Ce que mesure exactement ce « 0 » (et ce qu'il ne mesure pas)

- **Ce n'est pas un nombre de modèles.** Le nombre de modèles quotidiens est bien `7/7`
  (`manualRefreshGranularity`, `client/src/pages/WeatherAILab.tsx:53-56`, alimenté par
  `granularityResult(officialDailyForecasts.length, …)`, `server/manualFusion.ts:194`).
- C'est `calibratedCount` : le nombre de **variables** (sur 7) dont le statut de calibration vaut
  `CALIBRATED` (`server/officialForecast.ts:465`), repris tel quel dans le `methodNote`
  (`server/officialForecast.ts:481`) qui est affiché comme `error` du bandeau
  (`server/manualFusion.ts:195-199`).
- `CALIBRATED` pour une variable exige que **tous** les modèles sélectionnés aient une preuve
  historique qualifiée : `traceCalibrationStatus` ne renvoie `CALIBRATED` que si
  `qualifiedCount === selectedCount` (`server/officialForecast.ts:141-146`). Un seul modèle sans
  preuve suffit à rétrograder la variable en `PARTIALLY_CALIBRATED`, qui **n'est pas comptée**
  dans `calibratedCount`.
- Conséquence : « 0/7 » signifie « aucune des 7 variables n'a ses 7 modèles simultanément
  pourvus d'une preuve exacte qualifiée ». Avec 7/7 valeurs disponibles et aucune preuve du tout,
  on obtient exactement ceaffichage.

### Pourquoi l'état « partiel » alors que 7/7
`server/manualFusion.ts:195-199` : après succès de collecte et persistance, si
`meteoAI.coreCalibrationComplete === false` (les 4 variables cœur `temperature_max`,
`temperature_min`, `precipitation_sum`, `wind_speed_max` toutes `CALIBRATED`,
`server/officialForecast.ts:459-461`), le statut est **forcé à `partial`** et `methodNote` devient
le message d'erreur du bandeau. Le « partiel » quotidien est donc un partiel **de calibration**,
pas de collecte.

### Plafond structurel : 5/7, jamais 7/7
- `isHistoricalMetric = key !== "humidity" && key !== "cloud_cover"`
  (`server/officialForecast.ts:290`) : pour l'humidité et la nébulosité, `matchingEvidence` est
  toujours `null` → jamais `CALIBRATED`.
- Cela est cohérent avec la source d'observations : l'observation quotidienne physique est stockée
  avec `humidity: null, cloudCover: null` (`server/scheduledHandlers.ts:1558-1559`) et
  `buildQualifiedDailyObservation` ne produit aucun agrégat humidité/nébulosie
  (`server/physicalObservationAggregation.ts:33-68`). Le motif affiché le confirme :
  « Aucune série d'observations physiques quotidienne ne qualifie cette variable […] »
  (`server/officialForecast.ts:148-150`).
- **Le dénominateur « /7 » du `methodNote` est donc inatteignable par construction** : le maximum
  théorique est 5/7. C'est un défaut d'affichage, pas un défaut moteur.

---

## 2. Chaîne causale complète de la calibration quotidienne

1. **Relance manuelle** → `refreshDailyForecast` (`server/manualFusion.ts:100-203`).
2. **Chargement des preuves** : `getDailyFusionPerformanceEvidence(locationKey, targetDate, availableAt[])`
   (`server/db.ts:1991-2033`) :
   - buckets cibles = buckets des `availableAt` des runs reçus, via `getDailyForecastHorizon`
     (`server/dailyForecastVerification.ts:192-204`). Pour J0 collecté à ~07:53 Paris,
     validTime = 00:00 Paris J+1 → lead ≈ 16 h → bucket **« 6-24h »** ;
   - lecture de `daily_forecast_observation_comparisons` filtrée : `locationKey`,
     `validDate ∈ [J-120, J[`, `horizonBucket ∈ buckets`, `evidenceType='physical_observation'`,
     `observationIsQualified=1`, `forecastAvailableAt < observationWindowStartAt` ;
   - si la table est absente/non migrée → `{ available: false, evidence: [] }`
     (`server/db.ts:1815-1836`, `2029-2032`).
3. **Agrégation** : `aggregateDailyForecastPerformance` (`server/dailyForecastPerformance.ts:114-172`),
   qui rejette en plus chaque ligne non conforme à `isComparableDailyForecastObservationPair`
   (`server/dailyForecastVerification.ts:172-190` : `stationEvidence` non vide, sources
   **physiques**, mesures du jour local, fenêtres min/max exactes). Groupes par
   `locationKey × serviceName × modelId × variable × horizonBucket`, jours indépendants = `validDate`.
4. **Appariement live** : pour chaque modèle sélectionné, preuve exacte
   `serviceName + modelId + locationKey + variable + horizonBucket`
   (`server/officialForecast.ts:293-299`), puis test
   `getEvidenceIneligibilityReason` (`server/fusionPerformance.ts:40-64`) :
   - `sampleSize ≥ 30` **et** `evaluatedDays ≥ 30` **et** `comparisonCount ≥ 30`
     (`MIN_DAILY_FUSION_DAYS = 30`, `fusionPerformance.ts:31`) ;
   - `sampleSize === evaluatedDays` ; `mae/rmse/standardError` finis et ≥ 0 ;
   - `latestScoreDate` valide et **≤ 7 jours** (`MAX_DAILY_FUSION_SCORE_AGE_DAYS = 7`,
     `fusionPerformance.ts:32`).
5. **Statut** : `traceCalibrationStatus` (`officialForecast.ts:141-146`) → `CALIBRATED` seulement si
   tous les modèles sélectionnés sont qualifiés (`officialForecast.ts:300-306`).
6. **Compteurs** : `coreCalibrationComplete` (`:460`), `calibratedCount` (`:465`), `methodNote` (`:481`).
7. **Bandeau** : `manualFusion.ts:195-199` → `status="partial"`, `error=methodNote`.

### D'où viennent les lignes de comparaison (la racine matérielle)
Job quotidien planifié (`server/scheduledHandlers.ts:~1540-1575`) :
- `getQualifiedObservationSnapshotsForDate(locKey, yesterday)` puis `buildQualifiedDailyObservation` :
  qualification exigée = **≥ 18 heures locales** de snapshots avec **≥ 1 station physique** chacun
  (`MINIMUM_COVERAGE_HOURS = 18`, `MINIMUM_STATIONS_PER_SNAPSHOT = 1`,
  `server/physicalObservationAggregation.ts:29-37`). Sinon : `continue` → **aucune comparaison écrite** ;
- `buildDailyForecastObservationComparisons` → `upsertDailyForecastObservationComparisons`
  (écrit aussi le journal de révisions ; sans table migrée, rien n'est écrit,
  `server/db.ts:1844-1891`).
- Une ligne de comparaison n'existe que si la prévision était disponible **avant** le début de la
  fenêtre d'observation (`forecastAvailableAt < observationWindowStartAt`).

Donc : **pas de station physique qualifiée au lieu ⇒ pas de comparaison ⇒ pas de preuve ⇒ 0/7.**

---

## 3. Les quatre causes possibles d'un 0/7, et comment les discriminer

| # | Cause | Signature observable |
|---|-------|----------------------|
| A | **Aucune comparaison physique pour ce lieu** (pas de station physique rattachée/qualifiée, couverture < 18 h/j, ou job quotidien non exécuté) | `evidence = []` ; AI Lab carte « Stations physiques · horaire » = « Passage réussi, mais aucune station qualifiée » / « Aucun passage vérifiable » ; log job : `Couverture insuffisante : n/18 heures physiques qualifiées — score opérationnel non mis à jour` ; Prévisions → détail du jour : « preuves historiques qualifiées : 0 » pour les 5 variables |
| B | **Historique < 30 jours indépendants** par modèle × variable × bucket (déploiement récent, bucket « 6-24h » récent) | Preuves présentes mais inéligibles : motif générique « Aucune preuve qualifiée exacte modèle × lieu × variable × horizon pour X » ; la trace jointe (`parameterSources[].sampleSize`, `latestScoreDate`) montre `sampleSize < 30` |
| C | **Score trop ancien** : job quotidien cassé ou observations non qualifiées depuis > 7 j | `latestScoreDate` > J-7 dans la trace / en base ; motif « preuve trop ancienne » côté `getEvidenceIneligibilityReason` |
| D | **Table non migrée / DB indisponible** | `evidenceStoreAvailable = false` dans la trace ; motif par modèle « Archive historique indisponible; la valeur reste disponible avec un poids robuste non calibré. » ; log `[MeteoAI] L'archive quotidienne … n'est pas migré…` |

Requête SQL de discrimination (base de production) :

```sql
SELECT variable, horizonBucket, serviceName,
       COUNT(DISTINCT validDate) AS jours_independants,
       MAX(validDate)            AS dernier_jour
FROM   daily_forecast_observation_comparisons
WHERE  locationKey = '<locationKey du favori>'
  AND  evidenceType = 'physical_observation'
  AND  observationIsQualified = 1
GROUP  BY variable, horizonBucket, serviceName
ORDER  BY variable, horizonBucket, serviceName;
```

Attendu pour une calibration J0 : lignes sur les 5 variables historiques, bucket `6-24h`,
`jours_independants ≥ 30` **pour chacun des 7 modèles**, et `dernier_jour ≥ J-7`.
Toute ligne manquante par modèle suffit à empêcher `CALIBRATED` sur la variable correspondante.

### Cause la plus probable sur cette instance
Les deux relances (07:13 et 07:53) donnent 0/7 de façon stable, avec par ailleurs 7/7 valeurs
disponibles : le maillon cassé est **en amont des preuves**, pas de la collecte modèles.
Sur un environnement de type preview/déploiement récent ou un lieu sans station physique
rattachée, la cause **A** est certaine ; sur une instance ancienne avec stations, vérifier **B/C**
avec la requête ci-dessus (le bucket exact « 6-24h » pour J0 n'accumule qu'≈ 1 jour/jour :
30 jours réels minimum). La cause **D** se distingue immédiatement par le motif
« Archive historique indisponible » et par `evidenceStoreAvailable` dans la trace.

---

## 4. Points secondaires visibles sur les captures (pour lever toute confusion)

1. **« Horaire : partiel, 6/7 modèles officiels »** : un des 7 modèles officiels n'a pas de run
   admissible à l'échéance horaire demandée (`granularityResult`, `manualFusion.ts:53-60` côté
   horaire ; motifs par modèle dans les cartes de flux AI Lab). Indépendant du 0/7 quotidien.
2. **Snapshot ↔ horaire « Non comparable » à 07:54 (07:45 vs 08:00)** :
   `client/src/lib/forecastAlignment.ts:177-196` — le point horaire **affiché** est le plus proche
   du snapshot, mais le statut `comparable` exige `validAt === snapshotTimestamp` **exact**.
   L'instantané open-meteo avance par pas de 15 min (07:45) alors que la série horaire est au pas
   horaire : dès que les minutes ≥ 30, le point le plus proche est H+1 → instants distincts →
   « Non comparable ». À 07:36, l'instantané était pile 07:00 → « Comparables · échéance alignée ».
   Garde-fou sémantique volontaire, pas une erreur de données.
3. **Snapshot ↔ quotidien** : toujours `non_comparable` par construction (« Une température
   instantanée de snapshot n'a pas la même sémantique que les Tmin/Tmax d'une journée »,
   `forecastAlignment.ts:204-210`).
4. **Aucune valeur n'est perdue** : `allowRobustUncalibratedModels: true`
   (`officialForecast.ts:251`) — sans preuve, la fusion reste calculée avec pondération robuste
   non calibrée ; le 0/7 n'implique ni valeur manquante ni biais appliqué.

---

## 5. Corrections recommandées (affichage/traçabilité, sans toucher la méthodologie)

1. **Dénominateur honnête** — **APPLIQUÉ le 13/10/2026** : dans `methodNote`
   (`server/officialForecast.ts`), `calibratedCount` est désormais calculé sur les seules variables
   calibrables et le libellé affiche « preuves calibrées exactes pour X/5 variables calibrables
   (humidité et nébulosité non calibrables: aucune série d'observations physiques quotidienne) ».
   Test de régression ajouté dans `server/officialForecast.test.ts` ; `vitest` 23/23 et
   `tsc --noEmit` OK. Les archives déjà écrites conservent l'ancien libellé (immuables, sans backfill).
2. **Remonter le motif d'inéligibilité réel** : `calibrationReasons` (`officialForecast.ts:351-359`)
   affiche un motif générique ; y injecter le retour de `getEvidenceIneligibilityReason`
   (« moins de 30 jours indépendants », « preuve trop ancienne », …) et l'effectif courant
   (`sampleSize/30`, `latestScoreDate`) : la cause devient lisible directement dans
   Prévisions → détail du jour (`ForecastByDaySection.tsx:325`) sans accès DB.
3. **Ne pas assouplir** `MIN_DAILY_FUSION_DAYS`/`MAX_DAILY_FUSION_SCORE_AGE_DAYS` sans décision
   méthodologique tracée : ce sont eux qui garantissent qu'une « preuve calibrée » signifie
   quelque chose.
4. Si l'objectif est d'obtenir réellement des preuves sur ce lieu : rattacher ≥ 1 station physique
   fiable (≥ 18 h/j de mesures), laisser tourner le job quotidien, et attendre ≥ 30 jours
   indépendants par bucket exact — ou afficher la progression plutôt qu'un 0/7 sec.

---

## 6. Références exactes

| Élément | Fichier:lignes |
|---|---|
| Bandeau AI Lab (ligne Quotidien) | `client/src/pages/WeatherAILab.tsx:53-56` |
| Forçage `partial` + `error=methodNote` | `server/manualFusion.ts:194-199` |
| `methodNote` et `calibratedCount` | `server/officialForecast.ts:460-481` |
| `traceCalibrationStatus` (CALIBRATED ⇔ tous qualifiés) | `server/officialForecast.ts:141-146` |
| Exclusion humidité/nébulosité | `server/officialForecast.ts:148-150, 290-306` |
| Seuils 30 j / 7 j | `server/fusionPerformance.ts:31-32, 40-64` |
| Lecture des preuves | `server/db.ts:1991-2033` (+ table non migrée : `1815-1836`) |
| Agrégation des preuves | `server/dailyForecastPerformance.ts:114-172` |
| Paire comparable (stations physiques, fenêtres) | `server/dailyForecastVerification.ts:172-190` |
| Buckets d'horizon | `server/dailyForecastVerification.ts:192-204` |
| Qualification observation (≥ 18 h, ≥ 1 station) | `server/physicalObservationAggregation.ts:29-37` |
| Écriture des comparaisons (job quotidien) | `server/scheduledHandlers.ts:1540-1575` |
| Snapshot ↔ horaire (égalité d'instant exigée) | `client/src/lib/forecastAlignment.ts:177-196` |
| Lecture UI des effectifs par variable | `client/src/components/weather/ForecastByDaySection.tsx:320-330` |
