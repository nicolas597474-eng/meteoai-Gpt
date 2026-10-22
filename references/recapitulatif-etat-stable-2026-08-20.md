# MeteoAI — récapitulatif de l’état stable actuel

**Établi le 20 août 2026, heure de Paris.** Ce document décrit l’état constaté sans déclencher de collecte, sans écrire dans la base et sans modifier les règles de calcul.

## 1. Référence de code et santé technique

La référence Git actuellement chargée est **`bcd2c15`** : `Rollback to dbb32e68`. Le serveur de développement est démarré sur le port 3000. Le contrôle TypeScript explicite `pnpm exec tsc --noEmit --incremental false` termine sans erreur ; les contrôles internes du projet indiquent également une absence d’erreur de typage.

L’arbre de travail contient toutefois des modifications non publiées et des artefacts d’essai. Elles ne doivent pas être interprétées comme une version livrable : `Dashboard.tsx`, `scheduledHandlers.ts`, `ultraLocalService.ts`, un test du collecteur HTTP, le journal Drizzle et `todo.md` sont modifiés ; des fichiers d’audit, une migration `0027` non appliquée et un test Ultra-local supplémentaire sont non suivis. Aucun de ces fichiers n’a été intégré dans un checkpoint de production après le retour au jalon stable.

> **Règle de reprise.** Toute correction future doit repartir de `bcd2c15`, être appliquée dans un environnement de fichiers synchronisé, puis passer TypeScript et Vitest avant un nouveau checkpoint.

## 2. Données protégées et invariants

Les tableaux suivants sont les compteurs relevés en lecture seule. Ils constituent le point de contrôle à conserver pendant toute reprise.

| Jeu de données | Compteur actuel | Politique de protection |
|---|---:|---|
| Prévisions archivées | 1 887 | Ne pas supprimer, réécrire ni recalculer rétroactivement. |
| Observations de référence | 118 | Ne pas supprimer ni recalculer. |
| Scores de fiabilité | 1 626 | Préserver les scores historiques qualifiés ; corriger uniquement les nouveaux calculs. |
| Stations météo | 529 | Ne pas modifier lors des corrections de moteur. |
| Relevés de stations physiques | 41 117 | Les ajouts horodatés des collectes actives sont attendus ; aucune suppression ou modification rétroactive. |
| Lieux favoris | 2 | Ne pas modifier. |
| Intégration personnelle Netatmo | 1 | Ne pas modifier. |

Les collectes restent actives. La collecte quotidienne des prévisions est activée à **05h00 Paris** via `meteoai-collect-favorites-forecasts-v5`. La collecte horaire des snapshots physiques qualifiés est activée, ainsi que la collecte quotidienne des observations à **00h30 Paris**. Des lignes supplémentaires dans `station_observations` peuvent donc apparaître naturellement entre deux contrôles ; ce sont des ajouts physiques, non des altérations de l’historique.

## 3. Fonctionnalités stables disponibles

MeteoAI dispose d’un Dashboard, d’une page Prévisions détaillées, d’une page Fiabilité, d’une page Stations, de l’Historique et de l’AI Lab. La navigation par glissement, la sélection des favoris, les modes Officiel, Local et Ultra-local, les cartes de prévisions horaires et quotidiennes, ainsi que les aides contextuelles font partie du périmètre fonctionnel existant.

Les huit modèles principaux actifs restent **AROME, ARPEGE, ICON, ECMWF, GFS, GEM, UKMET et Open-Meteo**. Les stations physiques sont traitées séparément des prévisions officielles. Netatmo demeure la seule source de stations personnelles active. Les données horaires ne doivent jamais être fabriquées lorsqu’une source ne les fournit pas.

Les corrections publiées avant le retour au jalon restent documentées dans l’historique du projet : cache court des stations locales, conservation de l’affichage lors du basculement Local/Ultra-local, séparation visuelle entre aujourd’hui et demain dans le graphique 48 h, fermeture du bloc local vers le mode Officiel, et correction des clés visuelles du graphique horaire. Le code de référence à privilégier reste toutefois le jalon Git indiqué en section 1.

## 4. Calculs et règles métier à préserver

Le moteur de fiabilité repose sur des comparaisons prévision–observation, avec MAE, biais, RMSE et métriques de précipitation. Le score ne doit pas devenir favorable en l’absence de paire comparable. Les performances doivent être distinguées par paramètre, lieu et échéance. Les classifications météo doivent utiliser l’un des régimes spécifiques disponibles ou signaler explicitement des données insuffisantes ; le régime « Standard » ne doit pas être affiché.

Le mode Ultra-local est destiné à fusionner les stations par distance, fraîcheur et qualité. Toute amélioration future doit conserver le principe suivant : une variable ne peut être pondérée qu’avec la station qui fournit cette variable, et la confiance doit être explicite lorsque la couverture est insuffisante. Les prévisions officielles, locales et Ultra-locales doivent rester identifiables comme des contextes différents.

## 5. Validations récentes disponibles

Le TypeScript global passe dans l’environnement courant. Les validations ciblées suivantes ont également été observées : le test de calcul de fiabilité passe après purge du cache Vitest, le test du snapshot officiel passe, le test de cache HTTP passe et le test Ultra-local ciblé passe. La suite complète Vitest n’a pas été retenue comme preuve finale dans cette session, car certains fichiers de test et certains buffers éditeur ont présenté des divergences temporaires avec les fichiers effectivement chargés par Vitest.

Cette divergence est une contrainte de l’environnement de travail, non une divergence de données. Elle impose de ne pas publier les modifications de travail restantes avant une reprise sur une arborescence fraîche et synchronisée.

## 6. Éléments en attente — ne pas considérer comme livrés

| Élément | État | Décision de reprise |
|---|---|---|
| Diagnostics détaillés de fournisseurs (délai, succès, échec, dernière réussite) | À finaliser | Ajouter et tester dans `weatherFetch.ts` sur un arbre synchronisé. |
| Reprise unique de fournisseur après une seconde | À finaliser | Appliquer sans toucher aux données et vérifier par test de collecteur. |
| Message de repli quotidien daté lorsque les heures manquent | Travail local non publié | Vérifier le contrat du snapshot et l’interface avant publication. |
| Source, couverture et motif de repli harmonisés entre les pages | Travail local non publié | Introduire un contrat unique côté serveur puis afficher les métadonnées. |
| Bilan des nouveaux scores de collecte | Travail local non publié | Vérifier que seul le nombre de scores nouvellement écrits est annoncé. |
| Tests des scénarios Ultra-local par variable | À consolider | Créer les tests sur l’arborescence fraîche, puis modifier le moteur uniquement si le test démontre un défaut. |
| Migration Drizzle `0027` | Non appliquée | Ne pas appliquer sans revue explicite : aucune migration n’est nécessaire à la reprise immédiate. |

## 7. Procédure de reprise recommandée

La reprise sûre ne doit pas suspendre les collectes physiques. Elle doit seulement prendre un relevé de départ des tables protégées, puis vérifier que les changements proviennent uniquement d’ajouts horodatés dans `station_observations`. La séquence recommandée est : partir de `bcd2c15`, vérifier `git status`, supprimer uniquement les caches de build confirmés, modifier un seul module, lancer `pnpm exec tsc --noEmit --incremental false`, lancer le test ciblé puis la suite complète, relever à nouveau les invariants de données et créer un checkpoint seulement si tout est cohérent.

> **Interdictions de reprise :** ne jamais supprimer ou recalculer l’historique fiable ; ne jamais modifier automatiquement stations, favoris, intégrations, clés API ou configurations ; ne jamais afficher une valeur de confiance ou une donnée horaire inventée pour combler une absence de preuve.

## 8. Conclusion opérationnelle

L’application possède une base fonctionnelle et des données historiques préservées. Le serveur et TypeScript sont actuellement sains. La priorité n’est pas de réécrire les données existantes, mais de finaliser sur une arborescence synchronisée les garde-fous qui empêchent les futures données incomplètes d’être interprétées comme fiables, et qui rendent les indisponibilités de fournisseurs visibles plutôt que masquées.
