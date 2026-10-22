# Incident de collecte de 05h00 — 14 août 2026

## Cause confirmée

La tâche `meteoai-collect-favorites-forecasts-v2` a été exécutée à `03:11:17 UTC` et a reçu un statut HTTP `403`. Son journal renvoie explicitement `permission error for cron cookie`. Le handler de collecte, les sources météo et les données archivées ne sont donc pas la cause immédiate de l’échec : l’autorisation attachée à ce job précis était refusée avant l’exécution de la collecte.

Une tâche horaire distincte de snapshots physiques a répondu HTTP `200` le même jour avec sa propre autorisation cron. Le défaut était donc limité à la tâche quotidienne de prévisions, et non à l’authentification des handlers planifiés dans leur ensemble.

## Correction appliquée

La tâche refusée a été désactivée. Son remplacement actif, `meteoai-collect-favorites-forecasts-v3`, conserve exactement le même endpoint, le même cycle quotidien (`03:00 UTC`, soit 05:00 Paris en heure d’été) et le même périmètre de lieux favoris, avec une autorisation cron fraîche.

Une relance ponctuelle a ensuite validé le nouveau chemin d’autorisation. Elle a terminé avec HTTP `200` à `04:55:06 UTC`, puis a été supprimée afin de ne laisser aucune tâche de récupération persistante.

## Résultat vérifié

| Élément | Hondeghem | Erquinghem-Lys |
|---|---:|---:|
| Modèles quotidiens collectés | 8 sur 8 | 8 sur 8 |
| Modèles horaires collectés | 8 sur 8 | 5 sur 8 |
| Modèles horaires explicitement absents | Aucun | ECMWF, GEM, UKMET |
| Snapshot de fusion AI Lab | Restauré à 04:54:53 UTC, 8 modèles appliqués | Données quotidiennes restaurées ; couverture horaire marquée partielle |

Les modèles horaires absents à Erquinghem-Lys restent signalés comme absents. Aucune donnée, pondération ou trace n’a été fabriquée pour compléter cette couverture partielle.

## Suivi

La prochaine exécution permanente est celle du job `v3` à 03:00 UTC. La réussite de la relance ponctuelle prouve que l’autorisation fraîche peut appeler le handler et recréer les snapshots ; la prochaine exécution régulière permettra de confirmer le cycle quotidien complet.
