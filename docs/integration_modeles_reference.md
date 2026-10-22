# Architecture d’intégration des modèles de référence

## Décision

Les modèles ajoutés ne rejoignent pas le tableau `forecasts` ni la fusion officielle au départ. Ils sont archivés comme **modèles en validation** dans `forecast_runs` et `hourly_forecasts`, avec un statut explicite dans leurs métadonnées. Les huit sources expertes quotidiennes restent inchangées. Pour l’horaire, les sept identifiants distincts (AROME, ARPEGE, ICON, ECMWF, GFS, GEM et UKMET) alimentent seuls le moteur officiel; Best Match est archivé comme référence agrégée non officielle. Les favoris suivent le cycle de quatre heures décrit dans [la configuration de collecte](favorites-forecast-schedule.md).

| Modèle de la référence | Statut d’intégration | Identifiant vérifié | Raison |
|---|---|---|---|
| DMI HARMONIE-DINI | Collecte en validation | `dmi_seamless` | Série horaire non nulle à Hondeghem. |
| ICON-D2 | Collecte en validation | `dwd_icon_d2` | Série horaire non nulle à Hondeghem. |
| ECMWF ENS | Collecte en validation | `ecmwf_ifs025_ensemble` | Moyenne et membres disponibles via l’endpoint d’ensemble. |
| ECMWF AIFS v2 | Sonde de disponibilité | `ecmwf_aifs025` | Données nulles lors du contrôle ; aucune série ne sera inventée. |
| AIFS ENS v2 | Sonde de disponibilité | `ecmwf_aifs025_ensemble` | État séparé de la moyenne AIFS, sans supposer une disponibilité. |
| ICON global | Non ajouté séparément | `dwd_icon_seamless` | Sortie observée identique à ICON-D2 sur la fenêtre testée ; éviter un double comptage. |
| UKV / MOGREPS-UK | Non ajouté | — | Hors couverture opérationnelle vérifiée pour Hondeghem. |

## Séparation des données

La collecte active suit les règles suivantes :

1. Les sorties quotidiennes candidates sont insérées seulement dans `forecast_runs`, avec `rawData.validationStatus = "candidate"` ; elles ne passent donc pas dans `computeOfficialDailyForecast`.
2. Les sorties horaires candidates sont archivées dans `hourly_forecasts` sous un nom suffixé `· validation`. Elles restent hors du snapshot officiel `best_match` et des huit modèles experts.
3. La moyenne d’ensemble est une **mesure de dispersion**. Les membres ne deviennent pas des modèles individuels et ne sont jamais traités comme 50 votes.
4. Les scores issus d’observations physiques pourront être calculés et comparés. Un candidat ne peut être proposé à la fusion qu’après un historique mesuré, par variable et par horizon.

## Transparence utilisateur

AI Lab doit exposer les candidats dans une source séparée intitulée « Modèles en validation ». Ils ne peuvent pas être listés dans la fusion officielle, dans les pondérations appliquées, ni dans le compteur de modèles experts actifs. Une indisponibilité AIFS reste affichée comme telle, sans valeur de remplacement.

## Contrôle opérationnel planifié

À la rédaction initiale de cette note (14 août 2026), le job `meteoai-collect-favorites-forecasts-v4` avait été observé à `03:00 UTC` (05:00 Paris en heure d’été). Cette trace historique atteste l’archivage des sorties candidates et l’absence de remplissage AIFS/AIFS ENS; elle ne décrit pas la cadence actuelle. La cadence applicative actuelle et l’unique réglage Heartbeat restant sont documentés dans [la configuration de collecte](favorites-forecast-schedule.md). Aucun résultat n’a été simulé.

## Première collecte observée

La collecte du 14 août 2026 à 06:32 UTC a produit deux runs quotidiens pour DMI HARMONIE-DINI et deux pour ICON-D2, correspondant aux deux lieux favoris. Elle a aussi archivé 48 lignes horaires par modèle (24 heures × 2 lieux), avec le suffixe `· validation`. Aucune ligne de ces modèles n’apparaît dans `forecasts`, la table utilisée par la fusion officielle : l’exclusion a donc été vérifiée en base.

ECMWF AIFS, ECMWF ENS et AIFS ENS n’ont pas produit de série sur ce cycle. Cette indisponibilité reste une absence de fournisseur, explicitement conservée sans remplissage ni transfert de poids.
