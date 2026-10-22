# Plan de migration — Reconstruction fidèle de MeteoAI

## Règle de passage

Chaque lot est validé avant le suivant. Un lot visuel n’a pas le droit de modifier les requêtes tRPC, les réponses serveur, les paramètres des graphiques, les règles de sélection de modèles, les stations ni les informations de provenance. Si une comparaison révèle un écart visuel notable, le lot est corrigé avant toute extraction supplémentaire.

## Lots de migration

| Ordre | Lot | Périmètre | Garanties de non-régression |
|---:|---|---|---|
| 0 | Référence | Captures et tests actuels aux largeurs 390, 768 et 1280 px | Baseline visuelle et fonctionnelle, sans changement de code métier. |
| 1 | Tokens et primitives | Variables sémantiques existantes, surfaces, titres, métriques et états | Les valeurs de couleur/rayon existantes sont réemployées ; aucun thème global ne change. |
| 2 | Shell | Cadre de page, navigation haute/basse, chargement différé, erreurs globales | Routes, liens, breakpoints et zones tactiles strictement inchangés. |
| 3 | Dashboard | Sections météo officielles, favoris, régime, local/ultra-local et encadrements | Données officielles, observations et graphiques Canvas restent dans leurs composants actuels. |
| 4 | Prévisions | Détails, `HourlyChart`, `FifteenDayChart` et légendes | Les algorithmes Canvas, coordonnées, unités, sélections et glissements restent inchangés. |
| 5 | Fiabilité et historique | Ranking, cartes de stations, score, Historique et séries | Les filtres, preuves, statuts, périodes et provenance ne changent pas. |
| 6 | Analyses | AI Lab, Rapport et comparaison de poids | Les explications restent raccordées aux mêmes snapshots et traces. |
| 7 | Préférences et finitions | Favoris, dialogues, retours au début, états vide et erreur | Mutations, sauvegardes et navigation restent identiques. |
| 8 | Vérification finale | Parcours, données, performances et comparaison visuelle | TypeScript, Vitest, build et contrôles responsive validés avant publication. |

## Protocoles de comparaison

Pour chaque page, la migration compare la structure de titre, les marges, le rayon de carte, la couleur de surface, le contraste des textes, l’ordre de lecture, les icônes, les états actifs, les chargements, les erreurs et l’absence de données. Les graphiques sont contrôlés séparément : courbes, points, barres, axes, unités, échelles, couleurs et interactions de clic/glissement doivent rester identiques.

Les contrôles de données sont réalisés pour un même lieu et un même instant. La température officielle, la condition, le régime, la confiance, l’observation locale, la provenance Netatmo et les données de prévision doivent correspondre aux contrats actuels. Une différence de valeur sans changement de contrat est bloquante.

## Critère de fin

La reconstruction est terminée seulement lorsque les composants extraits ne changent aucun parcours ni aucune valeur, que les huit routes métier sont vérifiées sur les trois formats d’écran, que tous les états de données sont couverts et que les tests automatisés et le build sont réussis.
