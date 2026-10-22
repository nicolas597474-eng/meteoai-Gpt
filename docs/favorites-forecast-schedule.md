# Collecte automatique des prévisions favorites

Le callback existant est `POST /api/scheduled/collect-favorites-forecasts`, enregistré dans `server/_core/index.ts`. L’application sélectionne désormais par défaut une cadence de quatre heures en `Europe/Paris`, et son handler ignore les appels qui ne correspondent pas à un créneau autorisé. Le dépôt ne possède toutefois pas la tâche Heartbeat de l’hébergement : une PR ne peut pas modifier à elle seule la cadence réellement appelée.

Le dépôt contient aussi un ancien callback quotidien `POST /api/scheduled/collect-forecasts` (commenté à 07:30 dans le code). Il reste inchangé et indépendant; il collecte la position historique Hondeghem, et ses jobs sans clé de créneau ne sont pas présentés comme des lots favoris dans le Dashboard.

## Cadence cible

Les six collectes quotidiennes visées sont à **01:00, 05:00, 09:00, 13:00, 17:00 et 21:00 Europe/Paris**. 05:00 est conservé. Le handler collecte uniquement si l’heure locale est l’un de ces six créneaux; les autres appels de garde répondent sans appeler Open-Meteo.

Le Heartbeat accepte une expression UTC fixe à six champs, alors que Paris alterne UTC+01:00 et UTC+02:00. Pour couvrir les deux saisons avec une seule tâche, sans perdre 05:00, la configuration à appliquer à la tâche existante est :

```text
0 0 0,3,4,7,8,11,12,15,16,19,20,23 * * *
```

Cette expression déclenche jusqu’à douze vérifications HTTP par jour, mais **seules six** correspondent à un horaire de collecte parisien selon la saison. Elle ne déclenche pas douze collectes météo et n’interroge pas Open-Meteo à chaque heure. Par exemple, 03:00 UTC correspond à 05:00 à Paris en été; 04:00 UTC correspond à 05:00 en hiver.

## Activation coordonnée requise

Le code active **01:00, 05:00, 09:00, 13:00, 17:00 et 21:00 Europe/Paris** par défaut. La variable runtime `METEOAI_FAVORITES_FORECAST_CADENCE=4h` rend ce choix explicite; `daily-05` est le seul retour volontaire au mode historique. Après déploiement, l’unique réglage hors dépôt restant est de modifier **la tâche Heartbeat existante** (ne pas créer une deuxième tâche) pour appeler `POST /api/scheduled/collect-favorites-forecasts` avec l’expression UTC ci-dessus. Si le runtime contient actuellement `daily-05`, il faut aussi le remplacer par `4h` ou retirer la surcharge.

Avant la modification, vérifier dans le gestionnaire de tâches que cette route est bien la tâche existante et conserver son UID. Après modification, contrôler son historique : les appels de garde hors des six horaires parisiens doivent être ignorés; les six horaires locaux doivent produire des lots avec début, fin et compteurs. **Tant que cette tâche externe n’a pas été mise à jour et que l’application n’est pas redéployée, aucune collecte automatique toutes les quatre heures n’est garantie**; le code seul ne lance pas un planificateur. La cadence conserve 05:00 toute l’année et l’expression UTC couvre les changements d’heure.

## Idempotence, concurrence et historique

Un lease persistant global sérialise deux lots programmés qui se chevaucheraient. Un lease par lieu est partagé avec la relance manuelle de l’AI Lab afin d’éviter les remplacements simultanés des séries quotidiennes et horaires. Les leases expirent après cinq minutes, sont réclamés par compare-and-set et sont supprimés à la libération; ils ne forment pas une archive croissante.

Un créneau Paris possède une clé stable par date et heure, avec une contrainte unique dans `collection_jobs`. Un appel dupliqué après succès est ignoré; un lot échoué ou resté bloqué peut être repris. Le rapport détaillé garde, par tentative, lieu et modèle, l’état fournisseur, les heures et valeurs reçues, les codes d’erreur sans contenu sensible, ainsi que les écritures d’archive et de vue courante confirmées après succès SQL. Les sept modèles nommés restent séparés de Best Match, qui est archivé uniquement comme référence dérivée et ne compte jamais dans la couverture officielle horaire. Les deux derniers jobs exposés au Dashboard conservent aussi leurs horodatages et compteurs agrégés.

Les lignes `hourly_forecast_run_values` conservent les valeurs horaires immuables par modèle, variable, échéance UTC, heure de réception et début de requête; elles alimentent l’évaluation horaire sans fabriquer d’identité de run amont. Les scores comparés aux relevés physiques restent antérieurs à la prévision évaluée et le moteur officiel n’est publié qu’après qualification de l’historique. Les lignes `forecast_runs` restent l’archive immuable des émissions quotidiennes. La cadence limite les nouveaux lots de prévisions favoris à six par jour et la clé par créneau empêche une tempête de doublons, mais les archives croissent naturellement avec chaque collecte réelle (y compris le callback legacy indépendant). Aucune politique de suppression/rétention n’est ajoutée ici, car supprimer ces lignes réduirait les données de validation à long terme.

Current Weather et ses snapshots officiels ne sont pas modifiés par ce callback; seules les prévisions quotidiennes et horaires sont rafraîchies.
