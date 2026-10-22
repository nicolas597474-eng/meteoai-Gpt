# Audit des modèles de la capture — 26 août 2026

## Constat dans MeteoAI

La collecte principale de MeteoAI archive actuellement huit sources de prévision : **AROME**, **ARPEGE**, **ICON-EU**, **ECMWF IFS**, **GFS**, **GEM**, **UKMET** et **Open-Meteo Best Match**. Cette liste est définie dans `server/weatherServices.ts` et la collecte horaire utilise les identifiants Open-Meteo explicites correspondants.

Les noms visibles dans la capture se répartissent ainsi :

| Nom de la capture | État dans MeteoAI | Précision |
| --- | --- | --- |
| AROME | Intégré | Collecte principale sous `meteofrance_arome_france_hd`. |
| ICON / ICON-EU | Intégré | Collecte principale sous `dwd_icon_eu`. |
| ECMWF | Intégré | Collecte principale sous `ecmwf_ifs025`. |
| GFS | Intégré | Collecte principale sous `gfs_seamless`. |
| GEM | Intégré | Collecte principale sous `gem_seamless`. |
| ALADIN | Non intégré | Aucun identifiant CHMI ALADIN n’est inclus dans la collecte ou l’archivage de référence. |
| HARMONIE-EU | Non intégré | Le candidat proche `DMI HARMONIE-DINI` est seulement déclaré dans la liste de validation ; aucun appel effectif de son identifiant n’est présent dans les collecteurs actuels. |
| ICON-DE | Non intégré | Le candidat `ICON-D2` est seulement déclaré dans la liste de validation ; aucun appel effectif de son identifiant n’est présent dans les collecteurs actuels. La collecte principale utilise ICON-EU. |

Le libellé **« Automatique »** de la capture est un mode de sélection de l’application source, pas un modèle numérique distinct à intégrer.

## Raisons vérifiables

Les modèles ALADIN, HARMONIE et ICON-D2 ne sont pas exclus parce qu’ils seraient fictifs ou nécessairement payants. Ils ne sont simplement pas appelés par les collecteurs actuels. Avant leur passage en production, MeteoAI doit les collecter séparément, contrôler la couverture géographique et la fraîcheur, archiver les données avec une provenance explicite, puis obtenir assez d’observations physiques pour les évaluer sans fabriquer de score.

Les documentations Open-Meteo confirment que les modèles sont régionaux et de portées différentes : CHMI ALADIN couvre la République tchèque et l’Europe centrale pendant trois jours ; KNMI HARMONIE-AROME propose une maille européenne et une maille Pays-Bas/Belgique sur 2,5 jours ; ICON-D2 couvre une zone plus restreinte d’Europe centrale, alors que ICON-EU couvre l’Europe. Ces différences demandent une vérification réelle au lieu actif avant toute intégration au classement officiel.

## Sources

- Code applicatif : `server/weatherServices.ts`, lignes 13–39 et 640–676.
- https://open-meteo.com/en/docs/chmi-api
- https://open-meteo.com/en/docs/knmi-api
- https://open-meteo.com/en/docs/dwd-api
- https://open-meteo.com/en/docs/dmi-api
- https://open-meteo.com/en/docs/ensemble-api
