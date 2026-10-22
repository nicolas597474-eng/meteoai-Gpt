# Audit de cohérence des prévisions affichées — MeteoAI

**Date :** 2 octobre 2026  
**Périmètre :** Dashboard, prévision horaire, prévision 15 jours, fusion quotidienne MeteoAI et vue ultra-locale.  
**Décision appliquée dans ce document :** audit et plan uniquement — **aucune modification du moteur de production, des poids, des scores ou des archives.**

## Conclusion

> **Une incohérence réelle subsiste : la prévision quotidienne à 15 jours ne provient pas du même moteur ni du même ensemble de modèles que la prévision officielle horaire et la fusion quotidienne MeteoAI.**

Le risque est visible pour l’utilisateur : un même jour peut présenter une température maximale, une pluie ou un vent différents selon l’écran consulté, sans explication suffisamment explicite.

La correction recommandée est d’introduire un **moteur de prévision officiel unique**, fondé sur les **sept modèles déterministes nommés** : AROME, ARPEGE, ICON, ECMWF, GFS, GEM et UKMET. Open-Meteo Best Match doit demeurer une **référence dérivée**, visible et traçable, mais non comptée comme un modèle indépendant et non intégrée à la fusion officielle.

## État réellement observé

| Surface | Source actuelle | Modèles / logique | Constat |
|---|---|---|---|
| Température courante et graphique horaire | `computeOfficialHourlyForecast` | 7 modèles déterministes archivés ; pondération par variable, horizon et historique qualifié ; Best Match exclu | Conforme à la règle cible sur les sources, mais logique indépendante de la fusion quotidienne. |
| Prévision 15 jours | `collect15DayForecast` | Moyenne arithmétique directe de **ECMWF, GFS, ICON et Open-Meteo Best Match** | Incohérence confirmée : ni les sept modèles ni la pondération MeteoAI. |
| Fusion quotidienne MeteoAI persistée | `computeOfficialDailyForecast` | 7 modèles déterministes **+ Open-Meteo Best Match** ; pondération par MAE / scores historiques | Incohérence confirmée : Best Match est encore un contributeur de fusion. |
| Dashboard | Snapshot officiel partagé pour l’horaire et les jours ; fusion quotidienne persistée utilisée notamment comme repli et pour certains indicateurs | Mélange de la série horaire officielle, de la série 15 jours et de la fusion quotidienne | Le Dashboard peut juxtaposer des sorties de moteurs différents. |
| Ultra-local | Stations physiques, observation locale et référence modèle | Les stations servent à observer, comparer et contextualiser | À conserver séparé : une observation réelle ne doit pas réécrire une prévision. |

## Preuves vérifiées

- Le code de l’horaire officiel limite explicitement les modèles aux sept modèles nommés et fixe `bestMatchIncluded: false`.
- La fonction `collect15DayForecast` interroge explicitement ECMWF, GFS, ICON et Open-Meteo Best Match, puis applique une moyenne simple.
- La dernière fusion quotidienne persistée comporte **8 sources**. La trace de température contient AROME, ARPEGE, ICON, ECMWF, GFS, GEM, UKMET et Open-Meteo.
- Les archives quotidiennes du 2 octobre 2026 contiennent bien les huit flux correspondants, ce qui permet de construire une fusion officielle à sept modèles sans inventer de données.

## Architecture cible recommandée

```text
                    METEOAI ENGINE OFFICIEL
                               |
             +-----------------+-----------------+
             |                                   |
      Série horaire officielle            Série quotidienne officielle
             |                                   |
      7 modèles déterministes             7 modèles déterministes
             |                                   |
      pondération historique               pondération historique
      par variable + horizon               par variable + horizon
             |                                   |
             +-------------+---------------------+
                           |
               même registre de sources,
            mêmes exclusions et même provenance
                           |
                  Prévisions affichées

Open-Meteo Best Match --> référence dérivée / comparaison seulement
Stations physiques   --> observations réelles / validation seulement
Ultra-local          --> contextualisation locale, jamais réécriture silencieuse
```

## Règles fonctionnelles à conserver

1. **Sept modèles, pas huit.** Les sept modèles déterministes sont les seules sources de la fusion officielle.
2. **Best Match reste visible, mais dérivé.** Il peut être affiché comme repère de comparaison avec son libellé « agrégateur dérivé — non intégré à la fusion officielle ».
3. **Aucune donnée fabriquée.** Si un modèle ne couvre pas une échéance ou une variable, il est absent pour ce point ; il n’est ni remplacé ni extrapolé.
4. **Pondération cohérente, pas nécessairement identique numériquement.** Les poids doivent suivre la même méthode : preuves historiques qualifiées, par variable et par horizon. Les valeurs de poids peuvent différer entre 3 h et J+10 car l’échéance et les preuves disponibles diffèrent.
5. **Pas de fuite temporelle.** Une pondération d’un point prévu ne doit utiliser que des observations et scores disponibles avant l’émission concernée.
6. **Les stations valident, elles ne fusionnent pas la prévision officielle.** Elles restent la vérité terrain, utile à la comparaison et à la couche ultra-locale clairement étiquetée.
7. **Transparence de couverture.** Chaque jour et chaque heure doivent exposer les modèles effectivement disponibles, les exclusions et la raison d’une pondération indisponible.

## Plan de migration proposé

### Étape A — Préparation shadow, sans impact utilisateur

- Construire une série quotidienne shadow depuis les archives du même cycle que l’horaire.
- Exclure Best Match de cette fusion shadow ; conserver Best Match comme ligne de comparaison.
- Réutiliser les sept modèles effectivement disponibles par date et par variable.
- Produire une trace par valeur : modèles retenus, modèles exclus, poids, horizon, score disponible et date de calcul.
- Comparer cette série shadow à la moyenne 15 jours actuelle et à la fusion quotidienne historique, sans remplacer l’affichage public.

### Étape B — Cohérence de la méthode

- Extraire la règle commune de sélection des sources : modèle déterministe, origine Open-Meteo, identifiant de modèle exact, données disponibles au moment du run.
- Aligner les stratégies de poids quotidien et horaire sur la même grille : variable, horizon, nombre de comparaisons et nombre de jours comparables.
- Prévoir explicitement le statut `insufficient_historical_evidence` lorsque la preuve est insuffisante ; ne jamais produire une moyenne de secours cachée.

### Étape C — Validation objective

- Vérifier par SQL que Best Match n’entre dans aucune sortie de fusion officielle candidate.
- Vérifier que les 7 modèles sont considérés lorsque leurs données sont disponibles.
- Vérifier qu’une journée avec couverture partielle signale clairement les absences.
- Comparer les sorties shadow avec les observations physiques qualifiées, sans modifier aucun poids de production.
- Publier un rapport de différence : nombre de jours comparés, variables, horizons, écarts, couvertures et limites statistiques.

### Étape D — Bascule publique, uniquement après validation explicite

- Remplacer la moyenne 15 jours à quatre sources par la série quotidienne MeteoAI officiellement validée.
- Raccorder le Dashboard et les écrans détaillés à la même sortie officielle par date / heure.
- Conserver Best Match et l’ultra-local comme couches de comparaison et d’observation, avec provenance lisible.
- Ne modifier aucun poids de production à partir d’une fenêtre statistique insuffisante.

## Choix à confirmer avant toute modification de production

La proposition couvre un changement de comportement visible : supprimer Best Match de la fusion quotidienne officielle et remplacer la moyenne 15 jours actuelle.

Le chemin le plus sûr, compatible avec les règles déjà établies pour les phases shadow, est :

1. **Construire et comparer d’abord la série quotidienne unifiée en shadow** ;
2. **Ne basculer l’interface publique qu’après votre validation explicite**.

Ce choix ne change aujourd’hui ni la prévision affichée, ni les poids de production, ni les archives existantes.
