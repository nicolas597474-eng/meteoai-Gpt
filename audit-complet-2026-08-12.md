# Audit complet non destructif de MeteoAI

**Date :** 12 août 2026  
**Périmètre :** architecture, persistance, calculs météo, intégrations, tâches planifiées, interface, exploitation, tests et dépendances.  
**Méthode :** revue statique, consultation en lecture seule des journaux, interrogation SQL de contrôle et analyse des dépendances. **Aucun correctif, changement de configuration, migration, suppression ni publication n’a été appliqué dans le cadre de cet audit.**

> Les constats sont séparés entre les défauts **confirmés par une preuve** et les limites de vérification. Les corrections ci-dessous sont des **propositions**, non des modifications appliquées.

## Résumé exécutif

La base fonctionnelle est solide sur les éléments récemment vérifiés : la compilation TypeScript est propre, les 108 tests automatisés réussissent (un scénario OAuth Netatmo réel est volontairement ignoré), et la contrainte d’unicité des prévisions par lieu, date et modèle est présente. Toutefois, l’audit identifie quatre sujets prioritaires avant une nouvelle évolution de production : la dette de sécurité des dépendances, la résilience inégale des appels météo, l’échec non géré de la carte Google Maps et une validation insuffisante des coordonnées dans plusieurs procédures publiques.

| Niveau | Constat | Impact principal | Décision proposée |
|---|---|---|---|
| Critique | Dépendance `fast-xml-parser` vulnérable dans l’arbre de production | Risque d’injection si du XML non fiable atteint un parseur et est réinjecté dans un contexte sensible | Mettre à jour de manière contrôlée, avec tests de non-régression |
| Élevé | Plusieurs dépendances de production à vulnérabilités élevées | Surface de sécurité accrue côté serveur et client | Planifier une mise à niveau groupée et testée |
| Élevé | Appels Open-Meteo sans délai borné dans plusieurs collecteurs | Blocage, lenteur ou disponibilité dégradée lors d’une panne réseau | Uniformiser délais, reprises et état de repli vérifiable |
| Élevé | Chargement Google Maps en échec sans état de secours ni reprise | Carte indisponible pour Fiabilité ; expérience silencieusement dégradée | Ajouter un état d’erreur visible et une relance contrôlée |
| Moyenne | Coordonnées optionnelles non bornées dans des procédures publiques | Requêtes invalides possibles vers des services externes et clés de lieu incohérentes | Centraliser un schéma latitude/longitude borné |
| Moyenne | Une tâche planifiée externe est active mais son dernier passage remonte au 27 juillet | Collecte attendue potentiellement non exécutée, statut opérationnel ambigu | Vérifier le mécanisme responsable et ses journaux, sans le modifier avant accord |

## 1. Sécurité des dépendances

L’analyse de l’arbre de dépendances de production remonte **1 vulnérabilité critique, 21 élevées, 49 modérées et 10 faibles**. Ces chiffres concernent l’arbre installé et doivent être traités par priorité d’exposition réelle, non par une mise à jour aveugle.

### 1.1 Dépendance critique confirmée

`fast-xml-parser` est dans une version affectée par **CVE-2026-25896** : l’avis décrit un contournement d’encodage d’entités XML par injection d’expression régulière et recommande `>= 5.3.5`. L’impact dépend de l’existence d’un flux XML non fiable et d’une réutilisation du résultat dans un contexte HTML, SQL ou autre contexte sensible ; ce chemin applicatif n’a pas été démontré dans le code MeteoAI et doit donc être vérifié avant qualification d’exploitabilité directe. La correction proposée est une mise à jour contrôlée de la chaîne AWS/parseur, suivie de tests de stockage et de collecte. [1]

### 1.2 Dépendances élevées confirmées

Le rapport identifie notamment `@trpc/server 11.6.0` (correctif recommandé à partir de `11.8.0`), `drizzle-orm` (correctif recommandé à partir de `0.45.2`), plusieurs chemins `axios`, `lodash` / `lodash-es`, `path-to-regexp` et `fast-xml-parser`. L’avis tRPC rapporté concerne l’adaptateur Next.js expérimental ; MeteoAI utilise Express, donc l’exposition directe de ce cas précis n’est pas établie. Il reste cependant nécessaire de traiter la version obsolète dans un lot de mise à niveau planifié. [1]

**Correction proposée :** inventorier les chemins réellement chargés en production, mettre à jour d’abord les dépendances à correctif non majeur, exécuter TypeScript, Vitest et les parcours manuels, puis traiter les mises à niveau majeures séparément. Ne pas employer un correctif automatique global : il risquerait de modifier les versions transitive et les comportements sans validation.

## 2. Résilience des données météo et collectes

### 2.1 Délais réseau incohérents — défaut confirmé

`collectExpertForecasts` protège chaque appel par un délai de 12 secondes. En revanche, `collectObservations`, les quatre appels séquentiels de `collect15DayForecast` et le premier appel de `collectHourlyForecast` utilisent `fetch` sans signal d’annulation. [2] Les journaux confirment des échecs réels vers `api.open-meteo.com`, dont un `ECONNRESET` sur la prévision étendue et un délai de connexion sur la prévision horaire. [3]

**Impact :** le Dashboard, les détails ou la collecte peuvent attendre un délai réseau dépendant de l’environnement plutôt qu’une durée bornée ; les collectes parallèles restent partiellement résistantes, mais les séquences sans limite peuvent dégrader la fenêtre de traitement.

**Correction proposée :** factoriser un client HTTP météo avec délai explicite, classification des erreurs transitoires, une reprise bornée avec délai progressif, et la conservation de la dernière donnée fraîche vérifiable lorsque toutes les tentatives échouent. Ce changement doit être mesuré par taux de succès, durée de collecte et fraîcheur de la donnée — pas seulement par impression de robustesse.

### 2.2 Provenance des sources publiques — point à clarifier

Le commentaire initial de `realWeatherAPIs.ts` affirme qu’un appelant doit gérer un repli vers une simulation, tandis que la fonction de génération publique actuellement consultée annonce ne retourner que des réponses réelles ou rien. [4] Cette divergence documentaire ne prouve pas une simulation active, mais elle crée un risque de mauvaise compréhension lors d’une maintenance future.

**Correction proposée :** aligner les commentaires et les tests de provenance sur le comportement actuel ; continuer à interdire l’étiquetage de données manquantes comme source publique réelle.

## 3. API, validation des entrées et calculs

### 3.1 Coordonnées publiques non bornées — défaut confirmé

Les favoris appliquent bien des bornes latitude/longitude (`-90..90`, `-180..180`). [5] Plusieurs procédures publiques météo, dont `getDashboard`, acceptent toutefois `z.number().optional()` sans bornes puis construisent une clé de lieu et lancent des appels externes. [6]

**Impact :** un appel invalide peut créer des clés de persistance incohérentes, provoquer des requêtes inutiles vers les fournisseurs ou compliquer le diagnostic des pannes. Le risque n’est pas une élévation de privilège démontrée, mais un défaut de robustesse et de contrôle d’entrée.

**Correction proposée :** définir un schéma partagé `coordinatesSchema` avec les mêmes bornes que les favoris et l’utiliser dans chaque procédure météo. Ajouter des tests d’acceptation des limites et de rejet des valeurs hors domaine.

### 3.2 Persistance des prévisions — contrôle favorable

La contrainte unique `forecasts_location_date_service_unique` protège maintenant `locationKey / date / serviceName`, et la couche d’écriture utilise une mise à jour sur collision. Les doublons historiques précédemment observés sont désormais éliminés au niveau de la persistance. [7] Ce point ne constitue pas une défaillance active, mais l’idempotence doit rester couverte lors de toute évolution du collecteur.

## 4. Interface et expérience utilisateur

### 4.1 Carte Google Maps indisponible sans repli — défaut confirmé

Le journal navigateur enregistre `Failed to load Google Maps script`. [8] Dans `Map.tsx`, le gestionnaire `onerror` écrit seulement une erreur ; la promesse de chargement ne se résout ni ne se rejette et l’interface ne fournit aucun état d’indisponibilité, aucune action de reprise ni alternative textuelle. [9]

**Impact :** sur la page Fiabilité, la carte peut rester indisponible sans explication alors que les données de stations restent présentes. Cela affecte la lisibilité, l’accessibilité et le diagnostic utilisateur.

**Correction proposée :** exposer des états `chargement / indisponible / prêt`, résoudre ou rejeter explicitement la promesse, fournir un bouton de relance, et conserver une liste de stations exploitable sans carte. Ajouter un test de chargement échoué simulé.

### 4.2 Avertissements de clés React dupliquées — constat historique à revalider

Le journal navigateur contient, à 13:26, des erreurs de clés identiques pour plusieurs modèles (`UKMET`, `Open-Meteo`, etc.). [8] La liste actuelle des modèles de l’Historique est construite avec un `Set`, et les doublons de persistance ont été corrigés depuis l’horodatage de ces erreurs. [10] L’erreur est donc confirmée dans l’historique des journaux, mais sa reproductibilité actuelle n’est pas encore démontrée dans une session connectée fraîche.

**Correction proposée :** après une purge ou rotation de journaux, vérifier le parcours Historique avec une session connectée et les données actuelles. Si l’avertissement persiste, identifier le composant exact via la pile de rendu et utiliser une clé composite stable fondée sur l’identité de série, pas seulement sur le nom affiché.

### 4.3 Validation mobile partielle

Les vues Fiabilité, Historique, AI Lab, Rapport et Comparaison ont été observées à 375 px. Les captures isolées de Dashboard et Prévisions détaillées ont cependant été limitées par l’absence de session authentifiée dans le contexte de vérification. Ce n’est pas un bug produit confirmé ; c’est une limite de validation qui requiert une session utilisateur réelle.

## 5. Tâches planifiées et exploitation

Une tâche intitulée **« Observatoire Météo (Matin) »** est active, programmée à 05:00 Europe/Paris, mais l’état consulté indique un dernier passage le **27 juillet 2026**. [11] Cette tâche ne correspond pas nécessairement au mécanisme de collecte serveur actuellement attendu : son état actif et son absence de passage récent créent donc une ambiguïté opérationnelle.

**Impact :** la collecte attendue peut être incomplète, se doubler avec une autre planification ou être facturée/exécutée par un mécanisme séparé. L’audit ne permet pas d’inférer les coûts et ne modifie aucune tâche.

**Correction proposée :** inventorier les tâches serveur et les tâches externes, désigner une seule source d’exécution par opération (prévisions, observations, stations), puis vérifier l’historique de chaque exécution et son résultat. Toute désactivation ou reprogrammation doit être approuvée explicitement.

## 6. Couverture de tests et qualification de production

Vitest est exécuté en environnement Node et inclut les tests serveur ainsi que les tests purs du client, mais ne configure pas de navigateur réel ni de parcours end-to-end. [12] La suite actuelle réussit, ce qui est un signal de non-régression utile, mais elle ne valide pas automatiquement l’authentification, la carte, le défilement mobile, les clics, les fournisseurs externes ou la redirection OAuth.

| Domaine | Couverture constatée | Limite | Test proposé |
|---|---|---|---|
| Fusion et persistance | Tests unitaires, contrat d’idempotence | Peu de test de collecteur complet contre fournisseurs simulés | Tests d’intégration avec serveur HTTP local et délais contrôlés |
| Interface | Tests purs ciblés | Pas de test navigateur | Parcours end-to-end connectés à 375 px et bureau |
| OAuth Netatmo | Tests de sécurité et scénario réel ignoré | Autorisation fournisseur non validée dans cet audit | Scénario manuel contrôlé après accord utilisateur |
| Cartographie | Erreur navigateur relevée | Pas de test d’échec du script | Test de repli et test de relance |
| Planification | État externe consulté | Cohérence des mécanismes non prouvée | Journal d’exécution consolidé par type de collecte |

## Priorités proposées pour accord

| Priorité | Correction proposée | Précondition de décision |
|---|---|---|
| P0 | Mettre à jour la chaîne de dépendances critique et élevées | Valider l’impact des changements majeurs et exécuter une recette complète |
| P0 | Uniformiser les délais et reprises des appels météo | Définir des objectifs de durée, fraîcheur et taux de succès mesurables |
| P1 | Corriger l’état d’échec et la reprise de Google Maps | Décider si la carte Google reste la solution souhaitée ou si une alternative est retenue |
| P1 | Borner les coordonnées dans toutes les procédures publiques | Valider le schéma partagé et les messages d’erreur attendus |
| P1 | Clarifier et consolider les planifications de collecte | Confirmer quelle planification doit être conservée et laquelle doit être suspendue |
| P2 | Ajouter des parcours end-to-end connectés | Choisir le niveau de couverture et le mécanisme de session de test |
| P2 | Revalider l’avertissement React de clés dupliquées | Le reproduire avec les données actuelles avant toute correction |

## Références

[1] [Rapport `pnpm audit` de l’arbre de production](../audit-pnpm.json)  
[2] [Collecteurs Open-Meteo — `server/weatherServices.ts`](server/weatherServices.ts)  
[3] [Journal serveur de développement](.manus-logs/devserver.log)  
[4] [Adaptateurs de sources publiques — `server/realWeatherAPIs.ts`](server/realWeatherAPIs.ts)  
[5] [Validation des favoris — `server/routers/favorites.ts`](server/routers/favorites.ts)  
[6] [Procédures météo publiques — `server/routers/weather.ts`](server/routers/weather.ts)  
[7] [Migration d’unicité des prévisions](drizzle/0017_panoramic_old_lace.sql)  
[8] [Journal console navigateur](.manus-logs/browserConsole.log)  
[9] [Composant de carte](client/src/components/Map.tsx)  
[10] [Page Historique](client/src/pages/History.tsx)  
[11] [État des tâches planifiées, consulté le 12 août 2026](../audit_schedule_status)  
[12] [Configuration Vitest](vitest.config.ts)
