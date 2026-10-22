# Corrections issues de l’audit — 12 août 2026

Les corrections ci-dessous ont été appliquées après autorisation explicite. Elles ont été validées par TypeScript, Vitest, une compilation de production et un audit de dépendances.

| Domaine | Correction appliquée | Validation obtenue |
|---|---|---|
| Dépendances | Mise à niveau ciblée de tRPC, Drizzle, AWS SDK, Axios, Express, Nanoid et Recharts. Les chaînes `streamdown` / Mermaid et `react-markdown` ont été retirées afin d’éliminer leurs alertes transitoires ; les messages IA sont rendus en texte sûr, sans interprétation de balisage distant. | `pnpm audit --prod` : 0 critique, 0 élevée, 0 modérée, 0 faible. |
| Coordonnées | Ajout de schémas géographiques finis et bornés : latitude `[-90, 90]`, longitude `[-180, 180]`. Les procédures météo publiques concernées ne peuvent plus accepter de valeurs hors domaine. | Tests dédiés de bornes et compilation TypeScript. |
| Réseau météo | Ajout d’un client commun avec délai borné, reprise unique pour les réponses transitoires (`408`, `429`, `5xx`) et délai progressif. Les collectes Open-Meteo, OpenWeatherMap et Météo-France utilisent ce mécanisme. | Test de classification des statuts transitoires et suite complète. |
| Carte des stations | Le chargement Google Maps rejette maintenant explicitement l’échec, affiche un message accessible, conserve la liste de stations comme solution de repli et propose une relance. | Test du message de repli et compilation. |
| Planification | La tâche externe ancienne « Observatoire Météo (Matin) » a été mise en pause. Les collectes serveur actives restent la prévision quotidienne v2 à 05:00 Paris et les observations à 00:30 Paris. | Consultation des tâches Heartbeat et de la planification externe après mise à jour. |
| Navigation | Ajout de l’alias `/reliability` vers Fiabilité pour éviter la page 404 constatée sur mobile. | Capture mobile : la route affiche désormais l’état de chargement Fiabilité, sans page introuvable. |

## Résultats finaux

La suite compte **28 fichiers de test réussis**, soit **112 tests réussis** et **1 test ignoré**. Le test ignoré correspond au parcours OAuth Netatmo réel qui reste impossible à exécuter sans autorisation de compte. La compilation TypeScript et la construction de production réussissent.

> La construction de production signale encore une taille de bundle JavaScript supérieure à 500 kB après minification. C’est une recommandation de performance, non une erreur de compilation ni une vulnérabilité. Une optimisation par chargement différé des graphiques pourra être traitée dans une évolution dédiée et mesurée.
