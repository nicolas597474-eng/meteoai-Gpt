# Audit MeteoAI — notes de preuve

> Audit non destructif lancé le 21 août 2026. Aucune donnée, intégration, configuration ou règle de calcul n’est modifiée par ce document.

## Socle contrôlé

La compilation TypeScript s’exécute sans erreur et la suite Vitest compte **94 fichiers de test réussis**, soit **354 tests passants et 2 ignorés**. Les compteurs de données restent cohérents avec le dernier jalon : 1 907 prévisions courantes, 192 émissions archivées, 118 observations, 1 626 scores, 529 stations, 41 117 relevés de station, 271 snapshots qualifiés et 2 favoris.

## Premiers constats techniques

Les scores fondés sur observations physiques sont récents et limités : 65 lignes sur 4 jours, pour 10 modèles dont 2 sont explicitement des modèles de validation. Les scores hérités non qualifiés restent séparés des preuves physiques dans les requêtes de classement. Le code central exige les six composantes mesurées avant de produire un score normalisé, ce qui évite de compléter artificiellement un score absent.

La collecte quotidienne de prévisions active a répondu avec succès le 21 août à 05 h Paris, pour les 2 favoris et les 8 modèles attendus. Le collecteur horaire de stations a également produit des snapshots physiques, mais ses dernières traces doivent être surveillées : plusieurs exécutions réussies historiques enregistrent « aucune station physique qualifiée », et les journaux d’interface contiennent des chargements Google Maps intermittents ainsi que des avertissements de chargement non asynchrone.

## Vérification visuelle mobile

La page Fiabilité se charge et expose les tendances, les scores et les explications. Dans l’aperçu non authentifié, Dashboard, Prévisions, Stations et AI Lab restent sur leurs squelettes de chargement ; ce résultat doit être distingué d’un échec fonctionnel avéré, car le parcours dépend du lieu favori/session. Il constitue néanmoins un point de test de résilience à reproduire avec un état de session réel ou une gestion d’état vide/erreur explicitement vérifiée.

Le contrôle bureau confirme ce contraste : Dashboard et Stations se chargent avec un lieu Hondeghem, tandis que Prévisions et AI Lab restent visuellement en chargement dans l’aperçu. La page Fiabilité est fonctionnelle mais affiche un « meilleur modèle » et des valeurs agrégées sur seulement deux mesures dans la vue 7 jours : l’interface signale la période, mais ce point doit être rapproché des seuils de classement avant d’être présenté comme un résultat consolidé.
