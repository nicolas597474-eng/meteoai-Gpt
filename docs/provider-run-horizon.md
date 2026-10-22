# Captures Single Runs et horizons de run fournisseur

## Portée

Ce sidecar prépare une calibration prospective à partir des runs exacts des modèles. Il n’écrit jamais dans les tables de projection utilisées par les prévisions visibles et ne modifie ni les sept IDs Forecast, ni la fusion, ni les scores horaires existants par disponibilité. Il est appelé séparément par le job planifié des lieux favoris; une défaillance de ce sidecar n’invalide pas la collecte Forecast habituelle. Il vérifie d’abord que les tables provider-run sont disponibles; si la migration manque, il n’émet aucune requête Single Runs.

Aucune collecte ni requête Single Runs sur un favori réel n’a été exécutée pour préparer cette PR. Les nouveaux tests sont synthétiques et sans appel réseau.

## Sélection sûre du run

Le champ `run` de [l’API Single Runs](https://open-meteo.com/en/docs/single-runs-api) désigne l’heure d’initialisation UTC du modèle, pas l’heure de publication. Les cycles sont sélectionnés depuis le [Metadata API et les mises à jour de modèles](https://open-meteo.com/en/docs/model-updates), en lisant `last_run_initialisation_time`, `last_run_availability_time` et `update_interval_seconds` sur l’URL officielle `https://api.open-meteo.com/data/<modelId>/static/meta.json`.

Un run n’est demandé que si :

1. l’ID du modèle est mappé sans ambiguïté à son fichier de métadonnées officiel;
2. les deux horodatages sont cohérents, l’initialisation n’est pas après la disponibilité, et le paramètre de run peut être représenté exactement à la minute UTC;
3. les métadonnées sont récentes (au plus deux intervalles de mise à jour);
4. la disponibilité publique déclarée est passée depuis au moins 10 minutes, conformément au conseil Open-Meteo sur le délai de réplication.

Aucun horaire nominal de cycle n’est utilisé pour fabriquer un run. Un run non sélectionnable, périmé, trop récent ou non mappé garde `providerRunAt = null` et n’a pas de lead de run attribué. Aucun ID alternatif n’est essayé en repli.

### Compatibilité de métadonnées retenue

Les quatre correspondances déjà utilisées restent inchangées : AROME (`meteofrance_arome_france_hd`), ARPEGE (`meteofrance_arpege_europe`), ICON (`dwd_icon_eu`) et ECMWF (`ecmwf_ifs025`). La documentation Open-Meteo confirme aussi l’ID exact `ukmo_seamless`; il est ajouté tel quel, sans le remplacer par un modèle sous-jacent. L’[API Single Runs](https://open-meteo.com/en/docs/single-runs-api) accepte les paramètres Forecast inchangés, dont `models`, avec le paramètre `run` obligatoire. La [documentation des métadonnées et mises à jour](https://open-meteo.com/en/docs/model-updates) distingue initialisation, disponibilité et résolution temporelle.

Les sélecteurs documentés pour GFS et GEM sont `ncep_gfs_seamless` et `cmc_gem_seamless`, respectivement. Ils ne sont pas identiques aux IDs utilisés par l’application (`gfs_seamless` et `gem_seamless`); aucune équivalence n’est établie ici, donc aucune requête de capture n’est activée pour ces alias. UKMO est différent : l’ID documenté est exactement `ukmo_seamless`, mais son produit combine UKMO Global et UKV selon le lieu; aucune correspondance vers `ukmo_global` ou `ukmo_ukv` n’est supposée.

### Capacités documentées par modèle

| Modèle et ID employé par l’application | ID Open-Meteo documenté | Run individuel et horizon documentés | Variables horaires visées par le sidecar |
| --- | --- | --- | --- |
| [AROME](https://open-meteo.com/en/docs/meteofrance-api) · `meteofrance_arome_france_hd` | Identique | Oui, Single Runs · AROME France HD jusqu’à 2 jours | Les six variables de calibration ci-dessous; AROME HD n’a pas de niveaux de pression. |
| [ARPEGE](https://open-meteo.com/en/docs/meteofrance-api) · `meteofrance_arpege_europe` | Identique | Oui, Single Runs · jusqu’à 4 jours | Les six variables de calibration ci-dessous; certaines (dont surface pressure) sont dérivées. |
| [ICON](https://open-meteo.com/en/docs/dwd-api) · `dwd_icon_eu` | Identique | Oui, Single Runs · ICON Europe jusqu’à 5 jours; sorties natives horaires puis 3 h après 78 h | Les six variables de calibration ci-dessous. |
| [ECMWF](https://open-meteo.com/en/docs/ecmwf-api) · `ecmwf_ifs025` | Identique | Oui, Single Runs · IFS Open-Data 0,25° jusqu’à 15 jours; sorties 3 h puis 6 h après 144 h | Les six variables de calibration ci-dessous; humidité relative et pression de surface peuvent être dérivées. |
| [GFS](https://open-meteo.com/en/docs/gfs-api) · `gfs_seamless` | `ncep_gfs_seamless` | Single Runs documenté pour l’ID Open-Meteo; GFS global jusqu’à 16 jours. L’alias applicatif reste non mappé. | Les six champs sont documentés pour l’ID Open-Meteo cité, pas attribués à l’alias applicatif. |
| [GEM](https://open-meteo.com/en/docs/gem-api) · `gem_seamless` | `cmc_gem_seamless` | Single Runs documenté pour l’ID Open-Meteo; GEM Global jusqu’à 10 jours, RDPS 3,5 jours, HRDPS 2 jours selon la région. L’alias applicatif reste non mappé. | Les six champs sont documentés pour l’ID Open-Meteo cité, pas attribués à l’alias applicatif. |
| [UKMET](https://open-meteo.com/en/docs/ukmo-api) · `ukmo_seamless` | Identique | Oui, Single Runs · UKMO Global 7 jours et UKV 2 jours selon le lieu; rayonnement limité à 2 jours | Les six variables de calibration ci-dessous pour le produit documenté. |

Les six champs de calibration de l’archive séparée sont `temperature_2m`, `precipitation`, `wind_speed_10m`, `wind_gusts_10m`, `relative_humidity_2m` et `surface_pressure`. Les pages de chaque modèle indiquent lesquels sont natifs ou dérivés; « documenté » ne garantit pas une valeur non nulle à chaque lieu, échéance ou run. Seule une capture établit la présence effective d’une valeur. Les horizons cités décrivent Open-Meteo et n’agrandissent pas la collecte Single Runs de **2 jours**, ni les horizons ou écrans opérationnels existants.


## Manifeste et valeurs archivés

Chaque capture conserve dans la même ligne le nom/ID exacts, l’URL de métadonnées, son horodatage public et son code HTTP, l’URL Single Runs exacte avec le paramètre `run`, et le code HTTP. Pour une réponse JSON exploitable, son payload d’audit est limité aux heures et aux séries des six variables dont `validTime > availableAt`; les autres champs de réponse sont conservés, mais aucune heure ou valeur passée n’est archivée dans ce payload. Les valeurs horaires normalisées sont liées par `captureRunId`; une réponse qui ne contient aucune échéance future est également identifiable avec un payload horaire vide, sans inventer de valeurs.

Les nouvelles valeurs distinguent explicitement :

- `providerRunAt` : initialisation exacte UTC réellement envoyée dans `run`;
- `requestStartedAt` : début de la requête par MeteoAI;
- `availableAt` : réception complète de la réponse par l’application;
- `validTime` : échéance UTC de chaque valeur;
- `forecastLeadTimeMilliseconds = validTime - providerRunAt`;
- `collectionLatencyMilliseconds = availableAt - providerRunAt`.

La requête est limitée à **2 jours** et six variables horaires de calibration (température, précipitations, vent moyen, rafales, humidité et pression). Les validTime déjà échus au moment `availableAt` ne sont pas archivés. Cette limite de 48 h vise la fenêtre horaire actuellement collectée par l’application; elle ne prétend pas couvrir l’intégralité de l’horizon documentaire maximal de chaque modèle.

## Évaluation et anti-fuite

Seules les observations horaires physiques déjà qualifiées servent de référence. Une paire exige le même lieu, le même `validTime` exact et une valeur prévisionnelle finie. Le contrôle temporel demeure strict : `availableAt < observationAt`; l’heure de run ne remplace jamais la preuve que l’application détenait la prévision. Le délai minimal entre `last_run_availability_time` et `requestStartedAt` est aussi revérifié dans le scoreur.

Les scores et comparaisons sont stockés dans de nouvelles tables séparées, avec `leadBasis = "provider_run"` et un lead exact non arrondi. Les relectures identiques d’un même cycle ne gonflent pas l’échantillon; si des valeurs capturées pour le même cycle divergent, le groupe ambigu est écarté. Les anciens scores par buckets fondés sur `availableAt` restent inchangés et ne sont pas mélangés aux nouveaux scores.

## AI Lab

La fiche de chaque modèle affiche séparément le statut Single Runs, le run fournisseur UTC, la disponibilité officielle, `requestStartedAt`, `availableAt`, la latence de collecte et la plage des leads exacts archivés. Pour un modèle non mappé ou une migration absente, le statut indique explicitement que le lead est inconnu. L’URL contenant les coordonnées et le JSON complet ne sont pas exposés par le rapport client.

## Migration

`drizzle/0053_provider_run_horizon.sql` crée de façon strictement additive quatre tables pour les manifestes de capture, les valeurs, les comparaisons et les scores provider-run. Elle ne modifie ni ne réécrit les données antérieures. La migration est incluse dans cette PR mais **n’a été appliquée dans aucun environnement**; aucun `pnpm db:push` ni backfill n’est à exécuter pour la préparation de cette PR.
