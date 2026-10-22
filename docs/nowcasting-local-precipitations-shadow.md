# Nowcasting local de précipitations — mode shadow

**Version :** `local-precipitation-nowcasting-shadow-v1`  
**Périmètre :** AI Lab administrateur uniquement  
**État de production :** verrouillé (`productionReadsEnabled = 0`, `appliedToProduction = 0`)

## Objectif

Le module confronte un **snapshot physique qualifié** de précipitations à une médiane des sept modèles déterministes déjà archivés. Il produit uniquement un signal d’**occurrence locale de pluie** pour les horizons `0 h`, `+1 h` et `+2 h`.

> Il ne modifie jamais un montant de précipitations exprimé en millimètres. Les pluviomètres disponibles ne publient pas tous un intervalle d’accumulation comparable ; calculer un delta de mm ou traiter des durées différentes comme équivalentes serait trompeur.

## Données et algorithme du candidat

1. Lire le snapshot physique qualifié : date, heure Paris, station(s), confiance et précipitation observée.
2. Lire uniquement les archives horaires de modèles disponibles **au plus tard** à l’heure de référence de ce snapshot.
3. Exclure Best Match et calculer la médiane des valeurs de précipitation disponibles parmi les sept modèles déterministes.
4. Déterminer l’occurrence humide avec le seuil déjà défini de `0,1 mm`.
5. Si le snapshot de référence est humide alors que la médiane est sèche, produire un signal candidat à `0 h`, avec une persistance réduite à `50 %` à `+1 h` et nulle à `+2 h`.
6. Ne jamais supprimer une pluie modélisée au motif qu’une station est sèche : l’observation reste spatialement limitée.

`observedWet` du candidat est **la pluie du snapshot de référence**. Ce champ n’est jamais utilisé comme label des horizons futurs. L’horizon `0 h` reste exclu de toute mesure de performance.

## Archive des émissions et évaluation future

Deux tables shadow additives séparent désormais les faits d’émission des résultats de vérification :

- `shadow_local_precipitation_forecast_emissions` conserve une émission par lieu, référence et échéance, avec la clé du snapshot de référence, son snapshot sérialisé, l’heure réelle d’émission/disponibilité du candidat, l’échéance, l’horizon, la prédiction baseline, la prédiction composée avec le signal local, les modèles/runs effectivement disponibles et leurs heures de disponibilité. La clé unique empêche de remplacer une émission déjà archivée ; l’ancienne table de candidats reste un état diagnostique réévaluable.
- `shadow_local_precipitation_forecast_outcomes` conserve séparément l’état d’appariement, l’identifiant du snapshot futur, ses heures de référence/collecte, les identifiants et horodatages des relevés source, la précipitation observée et le motif d’indisponibilité. L’évaluateur ne s’exécute qu’au passage normal d’un snapshot physique déjà prévu ; il ne lance ni collecte ni tâche planifiée.

Un label n’est utilisable que si le snapshot futur est qualifié, correspond exactement au lieu et à l’échéance, si ses mesures sources sont prouvées postérieures à l’émission et à l’horizon, et si les fenêtres d’accumulation de la prévision et de chaque relevé physique contributeur sont établies comme identiques. La relation au snapshot/source peut être conservée à des fins d’audit même si l’émission est tardive, mais ce n’est alors pas une paire scorée. En l’absence d’une preuve requise, l’issue reste `PENDING_FUTURE` ou porte un statut `UNAVAILABLE_*`; aucun label sec/pluie n’est dérivé du snapshot de référence.

**Limite actuelle vérifiée dans le schéma source :** `qualified_observation_snapshots` conserve une synthèse et une heure de collecte, tandis que `station_observations` conserve `observedAt`, `collectedAt` et `precipitation`, mais aucune durée ni fenêtre de cumul par relevé. Les valeurs horaires des archives de prévision n’enregistrent pas non plus de fenêtre d’accumulation normalisée. Les émissions et les associations source peuvent donc être auditées, mais les labels de performance restent actuellement indisponibles : aucune paire ne doit entrer dans les matrices tant qu’une fenêtre comparable n’est pas démontrée. Il n’est ajouté ni durée supposée, ni mesure, ni collecte artificielle.

## Présentation AI Lab

Le panneau administrateur présente séparément `+1 h` et `+2 h` : émissions, prévisions échues comparables, snapshots futurs liés à l’échéance, paires utilisables et dénominateur de couverture, puis hits, misses, fausses alertes et rejets corrects pour la baseline et le candidat local. Le dénominateur de couverture exclut les échéances pas encore arrivées et les émissions sans prédictions baseline/candidat comparables. POD, FAR et CSI sont affichés pour baseline et candidat uniquement si des labels réels appariés existent ; chaque fréquence montre son numérateur et son dénominateur et reste explicitement descriptive. Aucun score global, note de fiabilité, calibration ou probabilité n’est produit.

Les observations horaires ne sont pas regroupées en épisodes indépendants. Le panneau les nomme donc **paires horaires** et indique que les répétitions ne sont pas dédupliquées. À `+2 h`, le facteur de continuation actuel est nul : le candidat local n’ajoute rien à la baseline et le panneau le signale explicitement.

Tant qu’il n’existe pas de paire future qualifiée avec une fenêtre d’accumulation comparable, AI Lab affiche **« Données insuffisantes / skill non mesuré »**. Les compteurs de statuts des candidats demeurent des états de génération, pas des mesures de performance.

## Pare-feux et isolation

| Règle | Effet |
|---|---|
| Archive de prévision disponible après le snapshot de référence | `LEAKAGE_BLOCKED` pour le candidat |
| Heure de disponibilité absente ou non finie | archive exclue |
| Observation de référence de plus de 90 minutes au calcul du candidat | `STALE_OBSERVATION` |
| Mesure future non prouvée après émission et échéance | issue `UNAVAILABLE_OBSERVATION_TIME_NOT_PROVEN` |
| Fenêtre d’accumulation absente ou incomparable | issue `UNAVAILABLE_ACCUMULATION_WINDOW_UNKNOWN`, exclue des matrices |
| Absence de snapshot futur qualifié à l’échéance | issue `UNAVAILABLE_NO_QUALIFIED_FUTURE_SNAPSHOT` |
| Horizon au-delà de +2 h ou horizon 0 pour les scores | exclu des comparaisons |
| Best Match | exclu systématiquement |
| Ajustement de montant en mm | interdit |
| Lecture par les prévisions officielles / application en production | verrouillées à `0` |

## État de l’extension

La migration correspondante ne crée que les deux nouvelles tables shadow et leurs index. Elle ne modifie ni les tables existantes, ni les valeurs météo officielles, ni la collecte des stations. **La migration n’a pas été appliquée à la base.** Le rollback de schéma consiste à supprimer d’abord `shadow_local_precipitation_forecast_outcomes`, puis `shadow_local_precipitation_forecast_emissions`; les candidats historiques de la table existante ne sont pas touchés.
