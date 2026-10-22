# Collecte quotidienne des prévisions — 05h00 Paris

## Cycle actif

La tâche active `meteoai-collect-favorites-forecasts-v2` appelle `/api/scheduled/collect-favorites-forecasts` tous les jours à `03:00 UTC`, soit **05:00 heure de Paris pendant l’heure d’été**. Elle traite tous les lieux favoris, après déduplication des coordonnées, et archive les résultats par localisation.

| Donnée collectée | Périmètre | Stockage | Statut métier |
|---|---|---|---|
| Prévisions quotidiennes expertes | AROME, ARPEGE, ICON, ECMWF, GFS, GEM, UKMET, Open‑Meteo | `forecasts`, `forecast_runs` | Prévision de modèle. |
| Prévisions horaires par modèle | Même couverture attendue, 24 créneaux par modèle | `hourly_forecasts` | Prévision de modèle, adaptée aux graphiques et au scoring horaire. |
| Prévision fusionnée MeteoAI | Résultat des modèles disponibles et de leurs poids admissibles | `meteoai_forecast`, `location_forecasts` | Prévision officielle consolidée. |
| Stations physiques | Découverte, mesure disponible et snapshot local par lieu | `weather_stations`, `station_observations`, `ground_truth` | Observation ; distincte d’une prévision. |
| Capteurs candidats | Persistance avec statut candidat et exclusion de la température locale | `weather_stations`, `station_observations` | Observation en validation ; non intégrée comme station qualifiée. |
| Bilan de couverture | Comptage quotidien/horaire, modèles manquants, stations physiques, statut | `station_collection_snapshots` | Transparence de la collecte. |

## Contrôles observés

Le dernier cycle archivé a couvert les huit modèles quotidiens pour Hondeghem et Erquinghem‑Lys. La couverture horaire a été complète à Hondeghem ; à Erquinghem‑Lys, UKMET était absent sur ce cycle et le bilan a été marqué `partial`. Cette absence est conservée comme telle : aucune prévision n’est inventée pour la remplacer.

Les stations ne doivent pas être collectées comme des « modèles de station ». Le cycle de 05h00 peut enregistrer les observations disponibles au moment du passage, tandis que les snapshots physiques sont relevés chaque heure et que le score quotidien est calculé après la journée, à 00h30 Paris. Cette séparation garantit qu’une observation réelle ne soit jamais présentée comme une prévision.

## Point de calendrier

L’expression planifiée est en UTC. Elle correspond à 05h00 à Paris pendant l’heure d’été, mais à 04h00 pendant l’heure d’hiver. Aucun changement n’est appliqué dans ce document. Si l’objectif devient strictement « 05h00 Paris toute l’année », le plan devra ajouter une gestion explicite du changement d’heure, avec garde-fou idempotent pour éviter un double lancement.

## Décision de ce contrôle

Le cycle actif couvre déjà les modèles quotidiens et horaires configurés, par lieu favori, et enregistre la couverture obtenue plutôt que de masquer une indisponibilité fournisseur. Aucun changement de tâche ni de calcul n’est donc justifié par les éléments contrôlés. Une absence ponctuelle, telle que UKMET sur un cycle horaire, doit rester traçable et ne déclenche pas la création de données de remplacement.
