# Audit transversal des pages — 12 août 2026

| Page | Statut de l’audit | Constat vérifiable | Décision |
|---|---|---|---|
| Dashboard | Déjà alignée | Utilise le régime opérationnel partagé et la trace officielle. | Aucune correction. |
| Fiabilité | Déjà alignée | Centralise les stations physiques, références et bilan de collecte. | Aucune correction. |
| AI Lab | Corrigée | Les scores et sources statiques ont été remplacés par la trace de fusion persistée. | Aucune correction supplémentaire. |
| Historique | Conforme | Exploite l’historique par lieu et les scores par échéance. | Aucune correction de données. |
| Prévisions détaillées | Corrigée | La confiance horaire arbitraire, l’analyse locale non vérifiable et le stockage local isolé ont été retirés. | Utilise désormais le lieu actif et le contrat officiel. |
| Rapport | Corrigé | Le lieu actif est envoyé au contrat ; aucune source absente n’est attribuée à Open-Meteo. | Affiche le lieu actif et « Non documentée » si la provenance manque. |
| Comparaison des pondérations | Corrigée | Le lieu actif est utilisé ; une confiance absente n’est plus transformée en 0 %. | Affiche « indisponible » lorsqu’aucune confiance n’est persistée. |
| Stations | Retirée | `/stations` redirige vers Fiabilité ; le composant autonome et ses anciens critères ont été supprimés. | La page Fiabilité reste la source unique des stations. |
| Favoris | Conforme | Gère uniquement la configuration des lieux et du rayon ; aucun score ou modèle obsolète n’est présenté. | Aucune correction. |

La vérification mobile du Rapport après déduplication montre huit modèles experts uniques au lieu des répétitions issues de collectes successives.
