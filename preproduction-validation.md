# Validation de préproduction — 12 août 2026

## Compilation et tests

La compilation TypeScript et la suite Vitest complète sont réussies : 24 fichiers de test, 107 tests réussis et 1 test Netatmo réel ignoré en attente d’autorisation OAuth.

## Cohérence des collectes persistées

Le contrôle SQL a identifié plusieurs lignes pour un même couple `lieu / date / modèle`. La couche de lecture sélectionne déjà la plus récente, ce qui évite les répétitions dans les écrans, mais l’écriture n’est pas encore idempotente. Une correction dédiée est requise avant de qualifier entièrement la persistance de préproduction.

## Correction d’idempotence

La correction a été appliquée et validée : les doublons historiques ont été supprimés en conservant la dernière collecte, une contrainte unique protège désormais le couple `locationKey / date / serviceName`, et les insertions répètent une mise à jour plutôt qu’une nouvelle ligne. Le contrôle SQL final retourne **0 groupe dupliqué**. La suite post-correction réussit avec 25 fichiers de test, 108 tests réussis et 1 test Netatmo réel ignoré.

## Rendu mobile

Le contrôle à 375 px a confirmé la lisibilité de Fiabilité, Historique, AI Lab, Rapport et Comparaison des pondérations. La légende dense de l’Historique a été remplacée par des pastilles horizontales défilantes, qui conservent l’ensemble des modèles sans écraser la zone de tracé. Les captures isolées de Dashboard et Prévisions détaillées restent à l’état de chargement faute de session utilisateur partagée ; elles doivent être confirmées dans une session connectée.

## Recette avec session réelle

Le 12 août 2026, l’utilisateur a confirmé depuis son téléphone que Dashboard, Fiabilité, Historique, AI Lab, Rapport, Prévisions détaillées et Comparaison fonctionnent correctement avec ses données réelles. Cette recette valide les parcours authentifiés, les rendus mobiles et les états de données réels.

La seule limite connue reste la collecte de stations Netatmo : elle nécessite l’autorisation OAuth explicite de l’utilisateur et ne peut pas être validée sans ce consentement.
