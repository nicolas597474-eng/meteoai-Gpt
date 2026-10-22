# Audit Scientifique MeteoAI — Résultats et Plan d'Optimisation

## 1. État actuel des algorithmes

### 1.1 calculateGroundTruth (stationService.ts)
**Méthode** : Moyenne pondérée linéaire simple
- Distance : 50% (1 / (dist + 0.5))
- Qualité : 30% (reliabilityScore / 100)
- Fraîcheur : 20% (exp(-age/60))
- Pas de correction d'altitude
- Pas de détection de microclimats
- Filtre : données < 180 min, reliabilityScore >= 40

**Problèmes identifiés** :
- Exposant IDW = 1 (trop faible, sous-pondère les stations proches)
- Pas de correction d'altitude (biais systématique si stations en altitude)
- Pas de vérification de cohérence inter-stations
- Pondération fixe indépendante du contexte météo

### 1.2 calculateUltraLocal (ultraLocalService.ts)
**Méthode** : Bandes de rayon avec pondération IDW intra-bande
- Mode standard : 3 bandes (40%/30%/20% + modèle 10%)
- Mode local : 3 bandes (55%/25%/10% + modèle 10%)
- Mode ultra-local : 3 bandes (65%/30%/3% + modèle 2%)
- Correction d'altitude : -0.65°C/100m, exclusion si Δalt > 200m
- Détection microclimats : urbain (+0.5°C), vallée (-0.8°C), maritime (-0.3°C)
- Vérification qualité : fraîcheur < 30/60min, cohérence ±5/6°C, reliabilityScore >= 45

**Problèmes identifiés** :
- IDW intra-bande utilise exposant p=2 (correct) mais bandes fixes (non adaptatif)
- Microclimats détectés par heuristiques simples (densité stations, altitude relative)
- Pas d'apprentissage des performances historiques par station
- Pondération modèle fixe (2-10%) indépendante des performances

### 1.3 statsEngine.ts — Scoring des modèles
**Méthode** : Score multi-dimensionnel avec régimes météo
- 5 régimes : rainy, summer, storm, cold_winter, standard
- Dimensions : température (MAE, RMSE, biais), précipitations (POD, FAR, CSI), vent, conditions
- Pondérations contextuelles par régime (ex: storm → vent 40%, précip 30%)

**Problèmes identifiés** :
- Seulement 5 régimes (manque : brouillard, neige, gel, canicule, vent modéré)
- Pas de scoring par échéance (0-6h, 6-24h, 1-3j, 4-7j, 8-15j)
- generateMeteoAIForecast utilise pondération proportionnelle au score global (pas par paramètre)
- Pas d'apprentissage adaptatif des pondérations par lieu

### 1.4 rankStations (stationService.ts)
**Méthode** : Score composite 40/30/20/10
- 40% distance (1/(dist+0.1))
- 30% fiabilité historique
- 20% disponibilité
- 10% fréquence mise à jour

**Problèmes identifiés** :
- Pondérations fixes non adaptatives
- Pas de pénalité pour anomalies répétées
- Pas de bonus pour performances historiques mesurées

## 2. Améliorations prioritaires (par impact/effort)

### Priorité 1 — IDW adaptatif dans calculateGroundTruth
**Problème** : exposant p=1 sous-pondère les stations proches
**Solution** : p=2 (standard IDW) + normalisation correcte
**Validation** : comparer MAE sur données historiques

### Priorité 2 — Scoring par échéance dans statsEngine
**Problème** : un seul score global mélange toutes les échéances
**Solution** : calculer MAE/RMSE séparément pour 0-6h, 6-24h, 1-3j, 4-7j, 8-15j
**Validation** : vérifier que le classement change selon l'échéance

### Priorité 3 — Pondération adaptative par performance historique
**Problème** : pondérations fixes dans generateMeteoAIForecast
**Solution** : utiliser les scores par paramètre (tempScore, precipScore, windScore) pour pondérer séparément chaque variable
**Validation** : comparer RMSE de la fusion avant/après

### Priorité 4 — Régimes météo étendus (8 → 12)
**Problème** : seulement 5 régimes
**Solution** : ajouter fog, snow/ice, heat_wave, light_wind, moderate_rain, thunderstorm
**Validation** : vérifier que les pondérations contextuelles améliorent le score

### Priorité 5 — Détection anomalies stations (valeurs figées, sauts)
**Problème** : pas de détection de valeurs figées ou de sauts brutaux
**Solution** : comparer avec observation précédente, détecter Δ > 5°C en < 10min
**Validation** : réduction du taux de faux positifs dans la fusion

## 3. Données disponibles pour validation

- Table `forecasts` : prévisions historiques par service et date
- Table `observations` : observations réelles par date et lieu
- Table `reliability_scores` : scores MAE/RMSE calculés
- Table `ground_truth` : vérité terrain calculée
- Table `location_forecasts` : prévisions par lieu favori
- Table `hourly_forecasts` : prévisions horaires multi-modèles (nouvelle)

## 4. Plan d'implémentation

1. Créer `server/fusionEngine.ts` — moteur de fusion unifié avec IDW p=2 adaptatif
2. Étendre `server/statsEngine.ts` — scoring par échéance + 7 nouveaux régimes
3. Créer `server/validationEngine.ts` — évaluation A/B sur données historiques
4. Mettre à jour `server/ultraLocalService.ts` — intégrer pondération adaptative par performance
5. Mettre à jour `server/stationService.ts` — IDW p=2 + détection anomalies
6. Créer page rapport de précision dans l'interface
