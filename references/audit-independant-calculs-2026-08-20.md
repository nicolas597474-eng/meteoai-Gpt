# Audit indépendant — calculs et coordination MeteoAI

**Date :** 20 août 2026  
**Périmètre :** moteur de fiabilité, régimes, fusions officielles et Ultra-locales, persistance, collectes planifiées, snapshots Dashboard et journaux d’exécution.  
**Méthode :** lecture de code, contrôle des requêtes de persistance en lecture seule, inspection des journaux et vérification du rendu. Aucune donnée historique, station, intégration, clé API, configuration ou donnée utilisateur n’a été modifiée pendant l’audit.

## Conclusion exécutive

Le système possède de bons garde-fous structurels : les scores qualifiés sont explicitement rattachés à des observations physiques, les écritures d’observations et de scores utilisent des upserts, et le contrôle direct de la base ne détecte actuellement **aucun doublon métier** sur les prévisions ni les scores. En revanche, plusieurs mécanismes peuvent encore donner une impression de précision non justifiée ou produire une réponse incomplète : valeurs météo par défaut en cas de données absentes, replis de confiance non mesurés, ordre de régimes incohérent dans le froid, et dégradation du Dashboard lorsque des fournisseurs expirent.

> **Résultat principal :** les données persistées vérifiées ne doivent pas être supprimées ou recalculées rétroactivement. Les corrections recommandées concernent le moteur, les nouveaux calculs, l’affichage de couverture et la résilience des requêtes futures.

## État des preuves persistées

| Contrôle en lecture seule | Résultat | Interprétation |
|---|---:|---|
| Groupes dupliqués de prévisions (`locationKey`, date, service) | 0 | Aucun doublon métier détecté au moment du contrôle. |
| Groupes dupliqués de scores (`locationKey`, date, service, preuve) | 0 | Les clés et upserts actuels empêchent les doublons visibles. |
| Scores fondés sur preuve physique | 65 | Un corpus réel existe, mais il reste limité pour la segmentation fine. |
| Observations physiques qualifiées | 9 | La base de comparaison est réelle mais encore courte. |
| Scores pondérés `null` | 0 | Les anciennes lignes ne rendent pas visible la couverture par dimension. |

## Anomalies prouvées et priorisées

| Priorité | Élément | Preuve | Conséquence concrète | Correction recommandée |
|---|---|---|---|---|
| **P0** | Régime calculé avec données absentes | `detectExtendedRegime` et `detectMultiRegime` remplacent les absences par 15 °C, 0 mm, 50 % de nuages, etc. | Un régime, une pondération et une confiance peuvent être affichés sans mesure réelle. | Retourner « données insuffisantes » dès que les entrées minimales du régime manquent ; ne jamais appliquer les poids correspondants. |
| **P0** | Neige et vague de froid rendues inatteignables dans certains cas | L’ordre actuel classe d’abord la pluie verglaçante puis le gel avant la neige et la vague de froid. | Sous 0 °C avec précipitations, la neige peut être masquée par « pluie verglaçante » ; une vague de froid peut être interceptée par un simple gel. | Réordonner les conditions selon les critères physiques explicites, puis ajouter des tests de frontière à -5 °C, 0 °C et 2 °C. |
| **P0** | Repli de fiabilité non mesurée | La fusion officielle convertit un MAE absent en fiabilité 50 ; la collecte emploie aussi 50 ou 60 dans certains replis. | Une source sans historique peut peser autant qu’une source mesurée, ou augmenter la confiance opérationnelle. | Conserver le poids neutre uniquement comme mécanisme technique interne, afficher « non mesuré » et plafonner la confiance tant que la couverture qualifiée manque. |
| **P0** | Bilan de collecte erroné | `totalScores` est initialisé mais jamais incrémenté dans la collecte d’observations. | Le bilan peut annoncer 0 score alors que des scores ont été insérés. | Incrémenter le compteur après chaque insertion réussie et distinguer succès, absence de couverture et erreur fournisseur. |
| **P1** | Confiance Ultra-locale incomplète | Les confiances par variable utilisent couverture et nombre de stations, sans qualité, fraîcheur ni dispersion de la variable. | Une variable disponible mais ancienne ou contradictoire peut recevoir une confiance élevée. | Calculer une confiance propre à chaque variable avec qualité, fraîcheur, écart inter-stations et couverture. |
| **P1** | Variables non thermiques pondérées avec le poids thermique | Humidité, pression, vent, rafales et pluie réutilisent le poids de contribution de température. | La qualité spécifique d’une variable n’est pas distinguée de la qualité thermique de la station. | Construire un poids station-variable lorsque les métadonnées disponibles le permettent ; sinon afficher la limite de méthode. |
| **P1** | Repli Dashboard sans données horaires | Le snapshot persistant ne restitue qu’une journée synthétique, sans heure ni modèle appliqué. | Les pages horaires peuvent rester vides lorsque les fournisseurs expirent, malgré un repli quotidien disponible. | Afficher explicitement « dernière fusion quotidienne » avec date de fraîcheur et ne pas rendre une zone horaire comme si elle était actualisée. |
| **P1** | Provenance résumée partiellement | `weights` est construit à partir des sources de température ; la trace détaillée contient bien pluie et vent, mais toutes les pages ne l’utilisent pas nécessairement. | La provenance peut être incomplète selon l’écran consulté. | Utiliser `trace.parameterSources` comme source unique de provenance et afficher le périmètre de chaque paramètre. |
| **P1** | Fournisseurs régulièrement expirés | Les journaux montrent des timeouts horaires et 15 jours pour ECMWF, GFS, ICON et Open-Meteo ; des erreurs `Response.clone: Body has already been consumed` sont aussi enregistrées. | Le Dashboard peut rester sur un squelette ou fournir une couverture réduite. | Timeout borné par source, cache de dernier succès, métriques de disponibilité et correction du cycle de lecture de réponse HTTP. |
| **P1** | Cohérence de build non stabilisée | Le service de diagnostics rapporte périodiquement quatre erreurs nullables dans `statsEngine.ts`, malgré des signaux de compilation contradictoires dans l’environnement restauré. | Toute modification future risque d’être validée sur un graphe de modules différent de celui exécuté. | Stabiliser l’environnement de build et exiger un `tsc --noEmit` frais avant chaque publication. |

## Éléments conformes ou positifs

Les observations quotidiennes ne poursuivent le scoring que lorsqu’une observation physique est qualifiée et qu’une prévision horaire alignée existe. Cette règle est appropriée : elle évite de produire un score à partir d’une simple synthèse. Les observations quotidiennes mettent humidité et nébulosité à `null` lorsqu’elles ne sont pas étayées, ce qui est préférable à une valeur inventée.

Les lectures de classement filtrent les scores sur la preuve physique et exigent un minimum de comparaisons et de jours distincts. Les upserts des observations et des scores, associés au contrôle direct des doublons, constituent un socle fiable pour les collectes futures.

Le snapshot officiel possède un délai borné et un repli persistant explicite. Le mécanisme est utile ; son amélioration nécessaire consiste à rendre sa fraîcheur et son périmètre visibles, pas à inventer des heures ou des modèles dans le repli.

## Coordination des méthodes

La coordination est **partielle mais non homogène**. La fusion officielle utilise un MAE spécifique au paramètre lorsque celui-ci existe. Le mode Ultra-local utilise une méthode par bandes, intégrant distance, score historique et fraîcheur, puis calcule un ajustement microclimatique. Ces deux approches sont pertinentes dans leurs contextes respectifs, mais elles n’emploient pas encore une représentation commune de couverture, d’incertitude et de provenance.

La priorité doit être de normaliser ce contrat d’explication : pour chaque valeur affichée, exposer les sources utilisées, les sources exclues, la quantité de preuve physique, la fraîcheur, le paramètre concerné et la raison d’un éventuel repli. Cette normalisation améliorera la lisibilité sans modifier une seule donnée historique.

## Plan de correction recommandé

| Ordre | Action | Risque sur l’historique | Condition de validation |
|---:|---|---|---|
| 1 | Corriger le régime sous données manquantes et l’ordre froid/neige/verglas/vague de froid. | Aucun : moteur et tests uniquement. | Tests de frontière et absence de régime avec entrées insuffisantes. |
| 2 | Retirer les replis 50/60 de toute confiance présentée à l’utilisateur. | Aucun : calcul futur et affichage uniquement. | Historique inchangé ; confiance plafonnée ou indisponible sans preuve. |
| 3 | Corriger `totalScores` et enrichir le bilan de collecte. | Aucun : métadonnée de tâche uniquement. | Exécution de tâche contrôlée avec nombre de scores réellement insérés. |
| 4 | Afficher provenance, couverture et fraîcheur de façon uniforme. | Aucun : contrat et interface uniquement. | Même trace paramétrique entre Dashboard, Prévisions et AI Lab. |
| 5 | Rendre le repli Dashboard explicite et traiter les timeouts/réponses consommées. | Aucun : cache et réseau uniquement. | Test de fournisseur indisponible, absence de données inventées et rendu hors squelette. |
| 6 | Affiner la confiance Ultra-locale par variable. | Aucun : nouveau calcul seulement. | Tests de fraîcheur, qualité, dispersion et couverture pour chaque variable. |

## Décision recommandée

Il est justifié de corriger les éléments P0 puis P1 listés ci-dessus. Il n’est pas justifié de modifier l’historique déjà fiable, de recalculer rétroactivement les scores existants, d’ajouter une segmentation saisonnière avec seulement 9 observations qualifiées, ni de faire passer une donnée manquante pour une valeur neutre.

La segmentation par saison, régime, seuil et horizon reste une amélioration scientifique utile, mais doit attendre une couverture suffisante. Avant ce seuil, l’interface doit afficher une absence de preuve plutôt qu’un score contextuel.
