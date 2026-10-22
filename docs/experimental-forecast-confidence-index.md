# Indice expérimental de confiance — AI Lab

## Objet et périmètre

Ce diagnostic est un **indice descriptif expérimental et non calibré**, jamais une probabilité. Il porte uniquement sur la **température du prochain point horaire officiel** : le premier `validAt` futur ou égal à l’heure de calcul du snapshot. Les valeurs des modèles sont comparées uniquement à ce même instant UTC.

L’indice n’est pas calculé à l’échelle journalière. Les émissions des flux journaliers ne sont pas toutes archivées avec une heure de lancement attestée; le calcul de dispersion journalière existant laisse donc ces accords indisponibles. Il serait trompeur de construire un score journalier ou de rapprocher des valeurs dont les échéances ne sont pas prouvées comparables.

Les données proviennent exclusivement des lectures déjà disponibles dans AI Lab : trace horaire `getAILab` et stations physiques actives de `searchStations` pour les mêmes coordonnées. Le diagnostic ne crée ni endpoint, ni collecte, ni migration, ni nouvel appel météo.

## Poids fixes

| Facteur                  | Poids | Preuve et règle expérimentale                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accord inter-sources     |  20 % | Étendue des températures de modèles distincts (`modelId`) au même `validAt`. Échelle linéaire : étendue 0 °C → 100; 8 °C ou plus → 0. Au moins deux `modelId` distincts sont requis. Les IDs distincts ne prouvent pas une indépendance statistique entre fournisseurs : le flux multi-modèle peut relever d’un même fournisseur.                                                                                              |
| Qualité des observations |  20 % | Moyenne non pondérée des `reliabilityScore` déjà attribués aux stations physiques actives ayant une température finie. C’est un **prior de qualité de source**, pas une exactitude historique individuelle.                                                                                                                                                                                                                    |
| Performance historique   |  20 % | MAE locale de température uniquement si tous les modèles disponibles ont une preuve qualifiée `CALIBRATED` et utilisent une base comparable : même tranche locale, ou même lead exact. Le pire MAE est pris (approche conservatrice, non pondérée par la fusion); échelle linéaire : 0 °C → 100; 5 °C ou plus → 0. Une preuve absente, un modèle non calibré ou des leads/tranches différents rendent le facteur indisponible. |
| Fraîcheur et couverture  |  15 % | Moyenne à parts égales de la couverture `modèles disponibles / modèles attendus` et d’une fraîcheur basée sur le plus ancien `availableAt` exposé (100 à 0 min, plancher à 0 à partir de 180 min). Il faut un `availableAt` valide pour chaque modèle compté; sinon le facteur reste indisponible.                                                                                                                             |
| Cohérence spatiale       |  10 % | Étendue de température des stations physiques actives, dans le rayon de 20 km déjà demandé par l’AI Lab. Les horodatages propres au champ `measurementTimes.temperature` doivent exister, être frais (≤180 min) et être espacés d’au plus 60 min. `updatedAt` ne remplace jamais l’heure de mesure. Même échelle expérimentale 0–8 °C que pour l’accord des modèles.                                                           |
| Horizon                  |  10 % | Délai entre le snapshot horaire et le `validAt` visé, avec décroissance linéaire de 100 à 0 sur 15 jours. Cette échelle est descriptive, pas une fréquence d’erreur observée.                                                                                                                                                                                                                                                  |
| Taille d’échantillon     |   5 % | Minimum des jours indépendants évalués parmi les mêmes preuves historiques comparables. Score proportionnel jusqu’à 30 jours; les comparaisons horaires ne sont pas assimilées à des jours indépendants.                                                                                                                                                                                                                       |

Tous les sous-scores sont bornés entre 0 et 100. Les valeurs expérimentales et seuils ci-dessus sont visibles dans les détails du panneau; ils ne constituent pas une calibration statistique validée.

## Pénalité extrême additionnelle

La pénalité est séparée des sept facteurs et ne redistribue aucun poids. Le test exige les quatre champs finis température, précipitations horaires, vent et code WMO. Chaque famille détectée retire 10 points, cumul plafonné à 30 : vent >60 km/h; orage (vent >35 km/h avec précipitations >5 mm ou codes WMO 95/96/99); précipitations >5 mm sur l’heure; température <−5 °C; chaleur sèche >33 °C avec précipitations <0,5 mm; pluie verglaçante WMO 66/67. Les seuils reprennent les seuils de régime existants lorsque disponibles; le retrait de points demeure expérimental et ne change pas le régime officiel.

## Règle d’affichage

- Le poids total reste exactement **100 %**, dans l’ordre et aux coefficients demandés.
- Un facteur sans preuve a `score: null`; son poids demeure indisponible et n’est jamais redistribué.
- L’indice global n’est affiché comme nombre que si les sept facteurs **et** la vérification de pénalité sont calculables. Sinon, l’UI affiche « —/100 », la part fixe calculable (`x/100`) et la raison de chaque manque; elle n’extrapole pas de score partiel.
- Si l’ensemble est calculable : `arrondi(clamp(Σ(poids × sous-score) / 100 − pénalité, 0, 100))`.
- La part calculable porte sur les sept poids; l’état de la pénalité est présenté séparément (ainsi une couverture des facteurs de 100 % ne masque pas une pénalité extrême invérifiable).

## Isolation fonctionnelle

L’implémentation est un calcul pur côté présentation et un nouveau panneau AI Lab. Elle ne modifie pas les valeurs prédites, la sélection des modèles, les poids officiels de fusion, les scores historiques, les seuils de calibration existants, les APIs, le schéma de base, les migrations, l’archivage, les collectes ou le déploiement. Les composants utilisent les poids des facteurs proposés pour le seul indice expérimental; ils ne lisent pas les poids finaux de fusion.
