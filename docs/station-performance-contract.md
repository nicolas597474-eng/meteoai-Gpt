# Contrat de comparaison météo des stations

## Priorité du réseau, profil opérationnel et performance individuelle

Les valeurs fixes de source restent des **priorités techniques de réseau** dans les mappers actifs : Météo-France `92`, METAR `90` et Netatmo `65`. Elles continuent d’alimenter les heuristiques de classement et de pondération existantes; elles ne mesurent ni une probabilité, ni un pourcentage de précision, ni la performance d’une station particulière. Le champ `reliabilityScore` est conservé pour compatibilité et l’interface le décrit comme une « priorité technique ».

La disponibilité par défaut et la cadence nominale sont également des métadonnées de source. Le contrat d’explication est construit depuis les valeurs des mappers via `getStationSourcePriorityDefaults`, plutôt que depuis une seconde liste susceptible de diverger. Il décrit la présélection physique à 180 minutes; les limites distinctes des modes de fusion (par exemple celles du mode Local) restent inchangées.

Le profil existant — complétude, continuité et stabilité des relevés — est une mesure opérationnelle de présence et de régularité. Ses seuils de statut à 6 et 72 observations restent des seuils de maturité du profil; ils ne constituent pas une preuve de performance météorologique. L’interface sépare ce profil des comparaisons d’erreur météo.

## Comparaison inter-réseaux

Pour les variables autres que les précipitations, le service expose uniquement des **erreurs d’accord inter-réseaux** par variable, en unités physiques natives; il ne construit pas de score météo individuel composite. Le calcul est un read-model à la demande sur les observations physiques archivées existantes (`station_observations`), dans une fenêtre glissante de 30 jours.

Pour chaque variable, le service groupe les relevés par heure UTC à partir de l’horodatage absolu propre à ce champ (`measurementTimes[field]`), retient la candidate la plus récente dans l’heure, puis n’admet que des références du même bucket mesurées au même instant ou avant la candidate. La fenêtre glissante est bornée par l’instant `asOf` de la requête; une date absente, mal formée ou future exclut seulement le couple champ×station concerné. Le timestamp global `observedAt`, `updatedAt` et `collectedAt` ne servent jamais de remplacement. Les anciennes lignes, qui ne contiennent pas ces timestamps par variable, restent nulles et ne contribuent pas à ces profils; aucun backfill ni réécriture des valeurs historiques n’est effectué.

Le service calcule ensuite une médiane par réseau physique, exclut entièrement le réseau de la station évaluée, puis compare la station à la médiane des réseaux de référence. Le site exact de la cible et les réseaux co-localisés ne sont pas comptés comme des références distinctes. Deux réseaux physiques distincts par comparaison sont une exigence structurelle de la comparaison inter-réseaux, **pas une affirmation d’indépendance statistique**. L’indépendance amont des fournisseurs n’est pas vérifiée; des dépendances de données et des effets de représentativité locale peuvent subsister.

Les sorties distinctes sont MAE poolée, MAE moyenne par jour, RMSE, biais et désaccord moyen entre références. La direction du vent utilise une différence angulaire circulaire. Les nombres de comparaisons, de jours distincts, de références et de sites homologues restent visibles; si les éléments ou le prior nécessaires manquent, `estimate` vaut `null` et l’interface indique « non mesurée ».

**Précipitations :** cette version ne publie ni mesure d’occurrence, ni erreur de quantité, ni score. Aucun minimum défendable d’événements pluvieux n’a été documenté; inventer un nombre de jours pourrait donner une autorité injustifiée à un échantillon événementiel. Le service conserve seulement le nombre brut de jours avec événement, renvoie `estimate: null` et `precipitation_method_not_defined`, quelle que soit cette fréquence. La mesure restera ainsi désactivée jusqu’à ce qu’une règle d’échantillonnage et d’incertitude soit explicitement justifiée et testée.

## Garde-fous de calcul et publication

Les **gates de calcul** ne sont pas un seuil qui autorise un score : aucun score composite individuel ou seuil de publication correspondant n’existe dans ce contrat (`publicationThreshold: null`). Aucune probabilité calibrée n’est produite.

| Gate | Valeur | Motif et interprétation |
|---|---:|---|
| Comparaisons horaires | 30 | Reprise du minimum de couverture `PUBLIC_RANKING_EVIDENCE_THRESHOLDS` existant pour les classements de modèles; utilisée ici comme gate de couverture exploratoire, non validée comme seuil de confiance des stations. |
| Jours UTC distincts | 7 | Même gate de couverture existante; un jour correspond à un bloc d’échantillonnage pour les calculs. Cela ne prouve ni l’indépendance des jours, ni une précision météo. |
| Réseaux de référence distincts par comparaison | 2 | Minimum structurel pour une comparaison inter-réseaux après exclusion du réseau cible; il ne certifie pas l’indépendance amont. |
| Sites homologues du réseau pour le prior | 2 | Minimum mathématique pour calculer une variance d’échantillon inter-sites (`n − 1`); avec si peu de sites, l’intervalle est très incertain et peut empêcher toute estimation. |

Les 30/7 ne sont pas des intervalles de confiance, des tests de significativité, ni une autorisation de score. Les intervalles et les effectifs sont montrés séparément, et les gates ne sont jamais décrits comme preuve de qualité. Les seuils 6/72 du profil opérationnel ne sont pas utilisés dans ce calcul.

## Prior empirique, shrinkage et incertitude

Le calcul ne lit jamais `reliabilityScore`, `dataAvailability` ni le profil opérationnel. Pour la station cible, soit `y` la moyenne à poids égal des MAE journalières; soit `μₛ` la moyenne des MAE journalières de sites distincts du même réseau, chacun comparé à des réseaux différents, avec la cible exclue; `τ²` est la variance d’échantillon de ces valeurs de sites. Les valeurs de production fixes `92/90/65` ne servent pas de prior statistique.

Le shrinkage utilisé est un estimateur empirique de type normal-normal :

```text
s² = Var(MAE_journalière_cible) / D
   + Var(désaccord_référence_journalier) / Dᵣ
   + moyenne(désaccord_référence)² / Dᵣ
w = τ² / (τ² + s²)
MAE_shrinkée = w × y + (1 − w) × μₛ
Var(MAE_shrinkée) ≈ w² × s² + (1 − w)² × τ² / M
```

`D` est le nombre de jours distincts de la cible, `Dᵣ` le nombre de jours avec désaccord de références et `M` le nombre de sites du prior. Le poids `w` résulte de la variance observée; ce n’est ni un coefficient météo choisi à la main, ni un score de qualité. Si la variance entre sites du prior est nulle ou indéfinissable, le résultat individuel reste non mesuré.

L’intervalle affiché pour la MAE shrinkée est une **approximation nominale bilatérale à 95 %** : `alpha = 0,05`, quantile `t` de Student, degrés de liberté `min(D − 1, M − 1)`, avec plancher de MAE à zéro; au-delà de 30 degrés de liberté, le code utilise la limite normale `1,96`. Le calcul traite les jours comme blocs et suppose une approximation normale des moyennes; ces hypothèses ne sont pas validées par calibration historique de couverture. L’intervalle n’est donc pas une probabilité que la station soit correcte, ne constitue pas une calibration et n’est pas transformé en score ou pourcentage de précision. La dispersion entre réseaux de référence est exposée séparément.

## Isolation de la production et de la Phase 7

Le calcul reste un read-model sans écriture de résultat ni nouvelle dépendance. La migration additive `0054` ajoute seulement le JSON nullable `measurementTimes` à `station_observations`; les writers archivent les timestamps exacts portés par `StationContribution`, sans valeur de remplacement. Cette migration n’effectue ni backfill ni réécriture historique et doit être appliquée séparément avant d’activer le code qui la lit ou l’écrit. Le calcul ne modifie aucun nombre, filtre, tri, sélection, poids de production, synthèse locale, estimation ou prévision. Le score fixe de source reste utilisé exactement comme auparavant; la nouvelle comparaison n’est branchée sur aucun moteur de production.

`getStationReliabilityOverview` lit 30 jours pour ce read-model, mais renvoie toujours à l’interface les relevés et comparaisons de la période sélectionnée (24 h ou 7 jours). La Phase 7 décrite dans `phase7-local-performance-design.md` porte sur la comparaison de **prévisions de modèles** à des observations; elle ne constitue pas une vérité de station. Cette PR ne remplit pas sa table ni n’utilise un score de modèle comme référence.

Le classement `rankStations` calcule un score de **points de classement compris entre 0 et 1**, jamais une probabilité ni un pourcentage de précision : `0.40 × distanceScore + 0.30 × qualityScore + 0.20 × availabilityScore + 0.10 × freshnessScore`. Chaque composante est bornée dans `[0, 1]` avant l’application de ses parts. Les valeurs 40/30/20/10 sont des poids du score, pas des qualités observées.

La proximité décroît linéairement selon `max(0, 1 − distanceKm / 20)` : elle vaut 1 à 0 km, 0,975 à 0,5 km, 0,95 à 1 km, 0,75 à 5 km, 0,5 à 10 km et 0 à 20 km ou au-delà. Les distances négatives, inconnues ou non finies ne reçoivent aucun point de proximité; ce cutoff ne supprime pas une station et ne modifie pas les rayons variables de collecte (10/20/30/50 km).

`qualityScore` normalise `reliabilityScore` sur 0–100, mais cette valeur reste un **prior technique fixe de réseau/source**, pas l’historique ni l’exactitude mesurée de la station. `availabilityScore` reprend la disponibilité estimée de source, bornée à 0–1. `freshnessScore` décroît linéairement de 1 à 0 sur le cutoff de fraîcheur existant de 180 minutes à partir de `updatedAt`; si l’horodatage est absent ou invalide, la fraîcheur est inconnue et n’apporte aucun point, sans être présentée comme une observation fraîche. Les filtres d’activité et d’exclusion existants, dont la désactivation au-delà de 180 minutes ou sous la priorité source 40/100, restent inchangés. Aucune performance historique individuelle n’entre dans ce premier correctif.

Le Ground Truth conserve les parts actives de fusion 50/30/20 pour distance, prior fixe de qualité source et fraîcheur; chaque composante est normalisée puis le poids final renormalisé. Ces modifications ne changent ni Ground Truth, ni Ultra-local, ni les poids météo.
