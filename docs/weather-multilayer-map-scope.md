# Carte météo multi-couches — périmètre validé

## Objectif

La future carte de la page **Prévisions** doit donner une lecture spatiale de la météo autour du lieu actif. Elle complète les valeurs ponctuelles déjà présentes dans MeteoAI ; elle ne doit jamais transformer ces valeurs ponctuelles en surfaces colorées inventées.

La carte reposera sur le composant cartographique déjà employé dans l’application, avec une seule couche météorologique active à la fois. Les contours de stations contributrices et les données du mode Local restent des informations distinctes de la prévision de modèle : ils ne modifient ni la fusion officielle, ni les historiques.

## Périmètre fonctionnel de la première version

| Élément | Décision | Règle de fiabilité |
|---|---|---|
| Étendue | France métropolitaine, centrée initialement sur le lieu actif | Un état explicite est affiché hors couverture, sans tuile ni interpolation fictive. |
| Horizon | Créneau courant puis échéances jusqu’à **42 h** | La fenêtre correspond au service AROME WMS répertorié avec des pas de 0 à 42 h. [1] |
| Couches modèles | Température à 2 m, vent (vitesse et direction), humidité relative, nébulosité, pression au niveau de la mer | Chaque couche doit provenir d’une grille spatiale horodatée, jamais des seules valeurs ponctuelles du Dashboard. |
| Précipitations | Couche de prévision séparée ; radar observé indiqué comme **observation**, jamais comme prévision | Les données radar en temps réel sont ouvertes par Météo-France, mais leur disponibilité reste contrôlée à chaque requête. [2] |
| Contrôles | Sélecteur de variable, curseur d’échéance, légende graduée, horodatage, source, bouton plein écran | Une seule variable est visible à la fois afin de conserver une carte lisible et interprétable. |
| Contexte local | Marqueur du lieu actif et option de visualiser les stations contributrices | Seules les stations effectivement admises par le moteur Local ou Ultra-local sont montrées ; les stations exclues sont absentes de cette couche. |

## Source et architecture retenues

La source de référence sera le jeu de données de prévision numérique AROME de Météo-France, distribué via les canaux publics officiels. Le catalogue européen décrit un service WMS AROME couvrant la France à une résolution de 0,025 degré et les échéances 0 à 42 h. [1] Météo-France indique que ses données publiques sont réutilisables sans frais et que les données de modèles, d’observation et de radar disposent de modalités d’accès par API. [2] Le portail officiel renvoie vers ses canaux API et `meteo.data.gouv.fr`, ce qui permet de vérifier la documentation et l’état des ressources avant toute mise en production. [3]

> La carte ne sera activée qu’après vérification technique, au moment de l’intégration, de la disponibilité effective des tuiles ou grilles pour chaque variable et de leurs conditions d’accès. Si une couche est absente, lente ou hors périmètre, MeteoAI affichera son indisponibilité sans données de remplacement.

L’interface utilisera le fond de carte existant, une superposition météo rendue depuis une source spatiale officielle, et des contrôles React. Si l’accès au service nécessite une configuration ou un identifiant, cette opération fera l’objet d’une confirmation préalable : aucun secret, connecteur, historique ni tâche planifiée ne sera modifié dans le cadre du présent cadrage.

## Hors périmètre de la première version

La carte ne calculera pas elle-même des grilles à partir des huit modèles, ne stockera pas de tuiles en base, ne recalculera pas les historiques et n’affichera pas de radar comme une prévision. Les données hors France métropolitaine, les animations de particules et le cumul multi-couches simultané sont différés : ils dégraderaient la lisibilité ou exigeraient des sources supplémentaires à valider.

## Séquence d’implémentation proposée

La prochaine itération pourra créer un contrat serveur de lecture d’une couche AROME, puis une carte Prévisions avec sélecteur, légende, contrôle d’échéance, état d’indisponibilité et tests. Les couches seront ajoutées une à une, à commencer par température, précipitations et vent, avant humidité, nébulosité et pression. Chaque ajout devra être testé sur mobile et desktop avec sa source, son horodatage et ses bornes de couverture visibles.

## Références

[1] [data.europa.eu — Service WMS du modèle AROME 0,025° France](https://data.europa.eu/data/datasets/urn-x-wmo-md-fr-meteofrance-mf-nwp-highres-arome-0025-france-wms?locale=en)

[2] [Météo-France — Gratuité et réutilisation des données publiques](https://meteofrance.com/presse/au-1er-janvier-2024-toutes-les-donnees-publiques-de-meteo-france-disposeront-dune)

[3] [Météo-France — Portail Open Data](https://confluence-meteofrance.atlassian.net/wiki/spaces/OpenDataMeteoFrance/overview)
