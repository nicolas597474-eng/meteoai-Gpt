# Audit initial — Reconstruction fidèle de MeteoAI

## Périmètre et règle de préservation

Cet audit est réalisé sur la version restaurée de MeteoAI. Il ne modifie aucun contrat tRPC, aucune source de données, aucune pondération, aucune station Netatmo, aucun graphique ou aucune route. L’objectif de la reconstruction est de réduire les duplications et de centraliser le système visuel **sans changer le rendu final** : fond bleu-noir, accent bleu, surfaces sombres arrondies, pictogrammes météo MeteoAI et graphiques déjà en place.

> Une prévision officielle, une observation physique et une analyse de fiabilité sont trois types de données différents. Une future centralisation doit conserver cette séparation dans les composants comme dans les libellés.

## Inventaire des routes métier

| Route | Écran | Contrat principal | Éléments visuels et interactions à préserver |
|---|---|---|---|
| `/` | Dashboard | `favorites.getLocationWeather`, `weather.getDashboard`, `weather.getDetailedForecast` | Carte météo principale, favoris, régime, modes local/ultra-local, graphiques horaires et quinze jours. |
| `/ranking`, `/reliability`, `/stations` | Fiabilité | `weather.getStationReliabilityOverview`, `weather.searchStations`, `weather.getEvidenceStatus` | Cartes de stations, carte géographique, filtres de période/rayon/statut, transparence de la provenance. |
| `/history` | Historique | `weather.getHistory` | Onglets de variables et séries multi-modèles/observations. |
| `/details` | Prévisions détaillées | `weather.getDetailedForecast` | Défilement horaire, graphiques par variable, prévisions journalières et indicateurs de confiance. |
| `/ai-lab` | AI Lab | `weather.getAILab` | Traces de modèles, scores, régimes et explications de fusion. |
| `/report` | Rapport | `weather.getReport` | Rapport daté et état explicite lorsqu’aucune collecte n’est disponible. |
| `/weight-comparison` | Comparaison | `weather.getWeightTraceHistory`, `weather.compareWeightSnapshots` | Sélecteurs de snapshots, variations par paramètre et listes de modèles. |
| `/favorites` | Lieux favoris | `favorites.list`, `favorites.update`, `favorites.delete`, `favorites.setDefault` | Liste mobile de lieux, sélection par défaut et réglages par localisation. |

## Éléments réutilisables existants

| Domaine | Composants déjà centralisés | Règle de reconstruction |
|---|---|---|
| Icônes météo | `MeteoIcon`, helpers de mapping de condition et de régime | Ne pas remplacer le catalogue par des icônes système. |
| Graphiques de prévision | `HourlyChart`, `FifteenDayChart` | Ne pas modifier les coordonnées Canvas, les interactions de glissement, les unités, les échelles ou les valeurs. |
| Données locales | `LocalOfficialDeltaChart`, `StationMap`, `AlertBadge` | Conserver l’explication de provenance, le statut et la distinction observation/prévision. |
| Navigation et confort | `BackToTopButton`, `FavoritesBar`, routes différées | Préserver les parcours, les liens et les dimensions tactiles. |
| Surface partagée | Tokens Tailwind sémantiques dans `index.css` | Centraliser les ajouts seulement si l’équivalence de couleur et de contraste est mesurée. |

## Système visuel actuellement observable

Le thème est sombre, construit sur une base bleu-noir. Les tokens globaux définissent le fond, les textes, les cartes, les bordures, l’accent primaire bleu, les couleurs de graphiques et un rayon de base. La navigation desktop est haute et collante à partir de `sm`; la navigation mobile est basse et fixe. Les pages métier emploient des conteneurs à largeur limitée et des cartes sombres avec contours subtils.

Les captures mobiles confirment que les pages Historique, Rapport, Comparaison des pondérations et Favoris possèdent déjà des signatures de densité différentes. Ces différences sont fonctionnelles : Historique réserve de grands cadres aux séries ; Rapport privilégie un état vide explicite ; Comparaison est très dense par modèle et par paramètre ; Favoris est une liste de cartes compactes. Une reconstruction ne doit pas les uniformiser dans un même gabarit générique.

## Sources de vérité et invariants techniques

| Information affichée | Source à conserver | Invariant de reconstruction |
|---|---|---|
| Température et prévision officielles | Snapshot officiel via `getDetailedForecast` et Dashboard | Une même localisation et un même instant doivent conserver le même snapshot officiel. |
| Régime actif | Contrat `officialRegime` / catalogue descriptif | Le catalogue est descriptif et ne doit pas altérer le régime détecté. |
| Observation locale | Stations admissibles et réponse locale | Ne jamais présenter un repli multi-modèles comme une station. |
| Fiabilité | Scores et preuves de stations par localisation | Conserver l’éligibilité, la fraîcheur et les limites de preuve. |
| Historique et rapport | Données collectées, dates métier Paris | Les états sans collecte restent explicites ; aucune donnée n’est inventée. |
| Prévisions horaires et journalières | Composants Canvas et données officielles | Ne pas modifier le calcul des échelles, les points, les barres ni les interactions de sélection. |

## États à préserver

Les pages data-bound affichent des squelettes pendant la résolution des requêtes. Le Rapport expose une absence de données avec une explication liée à la collecte, ce qui est à préserver. Les pages de prévision ont des états de chargement, d’erreur et de données indisponibles à conserver. Lors de la vérification mobile, plusieurs pages ont présenté leur état de chargement dans une session sans authentification ; cela ne constitue pas une donnée météorologique et ne doit pas être remplacé par des valeurs fictives.

## Risques de régression identifiés

La priorité est d’éviter toute réécriture globale des cartes et de la navigation qui effacerait les différences utiles entre écrans. Les graphiques ont des conventions précises et ne doivent pas être transformés en composants de graphique génériques. Les imports de bibliothèques d’icônes servent principalement à la navigation et aux indicateurs d’interface, tandis que les conditions météo utilisent le catalogue MeteoAI : cette frontière doit être explicitement maintenue.

La comparaison des pondérations est volontairement dense sur mobile ; tout ajustement devra d’abord mesurer la lisibilité, la hauteur, la taille tactile et l’absence de perte de donnée. Les états asynchrones devront rester individualisés par module pour ne pas bloquer un écran entier lorsqu’une source est lente.

## Architecture cible, à valider avant développement

La cible doit conserver les pages et les contrats actuels. Elle extrait seulement des primitives visuelles neutres — cadre de page, section, surface sombre, titre de section, métrique, badge, état de chargement et état vide — dont les classes reproduisent exactement les couleurs et proportions existantes. Chaque page conservera ses propres structures et composants métier. Les composants météo, les graphiques Canvas, les cartes de station et les contrats tRPC resteront les propriétaires exclusifs de leurs données et de leurs interactions.

La migration proposée commence par documenter les tokens réellement utilisés, puis par isoler une primitive à la fois et comparer les rendus mobile/tablette/bureau. Aucun calcul, aucune source et aucune route ne sera déplacé pendant une retouche de style. Toute différence visuelle importante déclenche un retour immédiat au rendu de référence avant de poursuivre.
