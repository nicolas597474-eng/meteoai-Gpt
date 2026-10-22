# Audit complet de MeteoAI

**Date :** 21 août 2026  
**Périmètre :** moteur de prévision, scoring de fiabilité, données historiques, collectes automatisées, fournisseurs, interfaces web et parcours mobile.  
**Méthode :** lecture seule sur la base, inspection du code et des journaux, compilation TypeScript, tests Vitest et contrôles visuels responsive.  
**Principe respecté :** aucune donnée météo historique, station, intégration, secret ou planification n’a été modifié pendant cet audit.

## Conclusion exécutive

MeteoAI présente un **socle fonctionnel solide** : les contrôles de compilation et de tests sont au vert, les invariants historiques restent stables, la collecte quotidienne des huit modèles a fonctionné pour les deux favoris et le moteur ne transforme pas une absence de preuve en score inventé. Les constats principaux portent sur la **résilience opérationnelle** plutôt que sur une corruption du moteur de calcul.

L’application ne présente pas de risque P0 de perte ou de réécriture de l’historique. En revanche, quatre sujets P1 doivent être traités avant de considérer le fonctionnement pleinement robuste : un cache HTTP susceptible de fournir une réponse déjà consommée aux prévisions horaires, des chargements Google Maps intermittents, des pages pouvant rester sur un squelette de chargement dans certains contextes, et une observabilité insuffisante des collectes physiques différées.

## Base de validation

| Contrôle | Résultat | Lecture d’audit |
|---|---:|---|
| Compilation TypeScript | 0 erreur | Le contrat TypeScript actuel est cohérent. |
| Suite Vitest | 354 réussites, 2 ignorés, 94 fichiers | La couverture automatisée reste large, notamment sur les services de calcul, cartes et pages récemment modifiées. |
| Prévisions archivées | 1 907 | Invariant intact. |
| Émissions de prévision | 192 | Invariant intact. |
| Observations de référence | 118 | Invariant intact. |
| Scores de fiabilité | 1 626 | Invariant intact. |
| Stations / relevés | 529 / 41 117 | Invariants intacts. |
| Snapshots qualifiés / favoris | 271 / 2 | Invariants intacts. |

> Aucun contrôle réalisé pendant l’audit n’a inséré, supprimé, recalculé ou migré de donnée. Les chiffres ci-dessus décrivent l’état constaté, non une cible de production.

## Calculs, scoring et intégrité des preuves

Le mécanisme de fiabilité isole les preuves physiques qualifiées des scores hérités. Les scores normalisés ne sont produits que lorsque les composantes requises sont réellement disponibles ; les valeurs manquantes restent absentes plutôt que compensées par une estimation. La température expose séparément MAE, RMSE et biais : la MAE décrit l’ampleur moyenne de l’écart, alors que le biais conserve le sens « trop chaud » ou « trop froid ». [1] [2]

Les données réellement qualifiées demeurent encore peu abondantes. Sur la fenêtre visible du Laboratoire, certains modèles sont comparés sur deux mesures seulement. La page affiche cette taille d’échantillon, ce qui est correct, mais l’utilisateur pourrait interpréter trop fortement un classement provisoire. Ce n’est **pas** une erreur de calcul ; c’est une limite de maturité statistique qui doit rester explicitement visible.

| Constat | Priorité | Risque | Recommandation non appliquée |
|---|---|---|---|
| Classements fondés sur peu de mesures dans certaines vues | P1 — qualité de décision | Surinterprétation d’un meilleur modèle provisoire | Renforcer visuellement l’état « échantillon limité » sous un seuil choisi et documenté. |
| Couverture physique inégale selon les jours et les lieux | P1 — qualité de preuve | Mise à jour moins fréquente des poids réellement observés | Exposer la fraîcheur, le nombre de jours et le nombre d’heures qualifiées près des classements. |
| Modèle de validation visible à côté de fournisseurs modèles | P2 — clarté | Confusion possible entre modèle numérique et ligne de référence | Libeller sans ambiguïté les entrées dérivées ou de validation. |

## Collectes et tâches planifiées

La collecte quotidienne active a exécuté avec succès le 21 août, à l’horaire de 05 h Paris. Elle a traité les deux favoris, avec les huit modèles attendus pour les prévisions quotidiennes et horaires, sans modèle manquant. Les relevés physiques sont volontairement reportés vers une tâche horaire indépendante afin de ne pas faire dépasser la durée de la collecte de 05 h. [3]

La dernière exécution horaire détaillée consultée a enregistré des snapshots pour les deux lieux avec respectivement 133 et 229 stations physiques, ce qui confirme que le pipeline produit bien des observations locales lorsque les sources sont disponibles. Toutefois, les enregistrements agrégés de disponibilité ne sont pas aussi récents que les journaux de snapshots horaires. Il s’agit d’un **écart d’observabilité**, pas d’une preuve que les données ont disparu.

| Constat | Priorité | Preuve | Recommandation non appliquée |
|---|---|---|---|
| Traçabilité agrégée des stations moins fraîche que les snapshots horaires | P1 — observabilité | Les snapshots quotidiens vus en base s’arrêtent avant les derniers journaux horaires consultés | Écrire un bilan borné par lieu et par cycle horaire, avec succès, absence qualifiée ou erreur. |
| Une erreur sur un favori peut interrompre le collecteur horaire séquentiel | P1 — résilience | Le collecteur horaire ne protège pas chaque favori par un bloc de récupération indépendant | Isoler chaque lieu, conserver les résultats partiels et signaler les erreurs par lieu. |
| Collecte horaire séquentielle | P2 — montée en charge | Deux favoris restent compatibles avec les durées observées ; le risque croît avec le nombre de lieux | Ajouter une concurrence bornée, après mesure du budget fournisseur et sans augmenter les appels. |

## Fournisseurs et résilience HTTP

Les journaux courants montrent 26 erreurs de collecte horaire, dont des délais ECMWF et Open-Meteo, ainsi que des réponses cache dont le corps est déjà consommé. La trace de cette dernière erreur désigne le retour d’une réponse mise en cache puis clonée dans `weatherFetch.ts`. La conséquence est localisée mais réelle : une requête horaire peut échouer même si le fournisseur initial avait déjà répondu. [4]

La cache de réponses HTTP est donc le sujet technique le plus concret de l’audit. La correction recommandée consiste à mémoriser un corps immuable — texte ou octets avec statut et en-têtes nécessaires — plutôt qu’un objet `Response` susceptible d’être consommé. Cette correction doit être accompagnée de tests de lectures concurrentes et de réponse réutilisée, sans toucher aux historiques.

| Constat | Priorité | Impact utilisateur | Recommandation non appliquée |
|---|---|---|---|
| Cache HTTP : `Response.clone` sur un corps déjà consommé | **P1 — défaut confirmé** | Certaines prévisions horaires peuvent être indisponibles ponctuellement | Remplacer le cache d’objets `Response` par un cache de contenu immuable et tester les hits successifs. |
| Délais fournisseurs ECMWF/Open-Meteo | P1 — dépendance externe | Prévisions 15 jours ou horaires parfois incomplètes | Garder le repli explicite déjà en place, instrumenter l’indisponibilité par fournisseur et ne jamais combler la donnée. |
| Échecs intermittents Google Maps | P1 — fonctionnalité cartographique | Cartes Stations et Éclipse parfois indisponibles | Chargement asynchrone, stratégie de nouvelle tentative limitée et état de secours lisible. |
| Avertissement Google Maps non asynchrone | P2 — performance | Chargement moins efficace, sans corruption de données | Ajouter le mode de chargement recommandé par Google après validation de compatibilité. |

## Interfaces et parcours mobile

Le Dashboard, Stations et Fiabilité se sont affichés dans l’aperçu desktop. Fiabilité expose correctement les valeurs, dates, taille d’échantillon et les explications contextuelles. Le design mobile demeure cohérent avec la navigation basse, les surfaces sombres et les contrôles de carte récents.

En revanche, les captures non authentifiées de Prévisions et AI Lab peuvent rester sur un squelette de chargement. Le code de Prévisions retourne un squelette pour `isLoading` sans sortie de repli dédiée à une attente durable ; AI Lab suit le même schéma. [5] Cet état doit être contrôlé dans une session réelle afin de distinguer une requête longue de l’absence de lieu actif, puis muni d’un état explicite de délai ou d’erreur. Il s’agit d’un sujet de résilience UX, non d’une indication que les prévisions sont inventées.

| Constat | Priorité | Impact utilisateur | Recommandation non appliquée |
|---|---|---|---|
| Squelette de chargement durable possible sur Prévisions et AI Lab | P1 — parcours | Absence d’explication et impression de page bloquée | Ajouter un état après délai : cause, réessai, retour Dashboard et conservation du lieu. |
| Google Maps indisponible par intermittence | P1 — parcours cartographique | Carte vide ou erreur de chargement | Afficher une carte de secours descriptive avec action de réessai. |
| Densité importante du Laboratoire | P2 — lisibilité | Lecture plus difficile sur petit écran | Ajouter une synthèse de fiabilité avant les cartes détaillées et conserver les détails repliables. |

## Priorités de correction recommandées

| Ordre | Intervention | Données historiques affectées ? | Confirmation nécessaire avant action ? |
|---:|---|---|---|
| 1 | Corriger le cache HTTP consommable des prévisions horaires et ajouter les tests concurrents | Non | Non : changement isolé de code futur. |
| 2 | Ajouter des états d’erreur / délai / réessai à Prévisions et AI Lab | Non | Non : interface seulement. |
| 3 | Rendre Google Maps asynchrone, avec repli et nouvelle tentative contrôlée | Non | Non pour le code ; oui si une clé, une restriction ou une intégration devait changer. |
| 4 | Isoler chaque favori dans la collecte horaire et enrichir ses traces d’exécution | Non | Oui, avant toute modification de tâche planifiée ou de configuration. |
| 5 | Renforcer l’indication de faible taille d’échantillon dans les classements | Non | Non : interface et seuils d’affichage, sans recalcul du passé. |

## État final de l’audit

MeteoAI est **utilisable et cohérente dans ses calculs contrôlés**, mais elle n’est pas encore au niveau de robustesse opérationnelle maximal attendu pour une publication où les cartes, les prévisions horaires et les scores doivent rester disponibles malgré les aléas réseau. La priorité n’est pas de recalculer le passé : il faut fiabiliser les flux futurs, les erreurs de transport et les états de repli, tout en conservant les données qualifiées existantes.

## Références internes

[1] [Configuration des métriques de fiabilité](../server/weatherReliabilityConfig.ts)

[2] [Moteur statistique : MAE, RMSE et biais](../server/statsEngine.ts)

[3] [Gestionnaires de collectes planifiées](../server/scheduledHandlers.ts)

[4] [Cache et diagnostic des fournisseurs météo](../server/weatherFetch.ts)

[5] [Page Prévisions : état de chargement](../client/src/pages/WeatherDetails.tsx)
