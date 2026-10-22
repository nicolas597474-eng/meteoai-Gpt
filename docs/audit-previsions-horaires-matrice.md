# Matrice pré-PR — audit des prévisions horaires

**État :** audit et corrections locales sur `fix/previsions-horaires-disponibilite-complete`, basée sur `main` `13c6491913b0b4785bb5ede7119c702fbb3ba9e5`. La PR #38 était fusionnée lors de la vérification live; la PR #33 était ouverte et n’a pas été modifiée. Aucune migration n’est ajoutée, aucune base de production n’est lue ou modifiée, et aucune publication, fusion ou mise en production n’a eu lieu.

## Matrice d’acceptation §§1–24

| § | État | Preuve / limite précise |
|---:|---|---|
| 1. Objectif principal | **Implémenté** | Plusieurs pertes artificielles confirmées et reproduites par tests : température seule exigée pour garder une heure, réponse partielle remplaçant la dernière projection complète, dates civiles calculées comme des blocs fixes de 24 h, conditions/régimes fabriqués à partir de champs absents, et série manuelle pouvant dégrader le snapshot officiel. Les changements et non-régressions correspondants sont testés. |
| 2. Architecture existante | **Audité et couvert** | Le pipeline officiel reste le producteur public; les chemins planifiés, manuels, favoris, personnalisation, snapshot/cache, API, Dashboard et Weather AI Lab ont été suivis. Aucune seconde fusion horaire n’est créée. Le comportement d’une instance de production n’a pas été rejoué. |
| 3. Diagnostic de l’indisponibilité | **Implémenté** | La preuve versionnée par variable et par `validTime` distingue valeur valide (y compris zéro), null fournisseur, champ absent, valeur invalide, unité incompatible, heure reçue hors grille et erreur de source. Les niveaux d’archive partielle et de projection publiable sont séparés. Le panneau expose aussi les valeurs finales de la fusion. Aucune erreur de fusion technique n’a été reproduite; aucun statut n’est inventé pour ce cas. |
| 4. Sélection dynamique | **Déjà couvert et testé** | Les modèles sont retenus par échéance et par variable; l’absence d’un run n’élimine pas les autres. Sept modèles déterministes au plus; Best Match reste une référence séparée, jamais un huitième vote. |
| 5. Horizons et buckets | **Déjà couvert et testé** | L’horizon est calculé par run depuis `validTime - availableAt`; les buckets servent à choisir les preuves historiques et ne forcent pas un horizon commun. Les tests exacts, bucket local et repli robuste sont couverts. |
| 6. Calibration et disponibilité | **Déjà couvert et testé** | Une donnée valide reste publiable sans preuve exacte; les statuts calibré, partiellement calibré et repli robuste restent distincts. L’absence d’historique ne supprime plus une prévision exploitable. |
| 7. Poids | **Déjà couvert et testé** | Les poids sont renormalisés sur les seuls modèles admissibles. Le plafond s’adapte au nombre de sources et le repli robuste est explicite; un poids nul ou invalide ne fabrique pas un `null` si des valeurs restent utilisables. |
| 8. Variables indépendantes | **Implémenté** | Les valeurs sont normalisées et diagnostiquées indépendamment. Les 20 champs d’archive sont conservés/diagnostiqués; la complétude de publication n’exige que les champs effectivement consommés par la projection. Un champ secondaire absent ne bloque pas une projection autrement complète. |
| 9. Dates, fuseaux et DST | **Partiellement satisfait — limite de schéma documentée** | Les archives portent les instants UTC exacts; personnalisation, moteur et affichage préservent les deux occurrences de 02:00. Les jours civils Paris ont 23/24/25 instants et l’UI distingue les offsets. La projection historique `hourly_forecasts`, limitée à date/heure locale sans `validAt`, ne peut pas identifier seule les deux folds; elle est traitée comme non confirmée lorsqu’elle ne prouve pas sa complétude. Aucune migration n’a été ajoutée. |
| 10. Formats, unités, null et zéro | **Implémenté et testé** | Les nombres textuels stricts, les timestamps Unix/ISO avec fuseau et les conversions d’unité prévues sont explicites. `NaN`, l’infini, dates impossibles, timestamps locaux ambigus et unités non prises en charge sont rejetés/diagnostiqués. Zéro reste une mesure valide; null ne devient pas zéro. |
| 11. Filtres de qualité | **Implémenté et testé** | La divergence reste mesurée sans supprimer toute la prévision; un modèle historiquement moins performant peut garder un poids plus faible. Aucun nouveau seuil scientifique n’est ajouté. Un test dédié vérifie qu’une étendue de 40 °C ne rend pas la fusion indisponible. |
| 12. Cache et actualisation | **Implémenté selon la règle approuvée** | Un lot incomplet est archivé et diagnostiqué, mais ne remplace pas la dernière projection complète. Le cache manuel refuse une série vide ou moins couverte qui masquerait le snapshot officiel. L’âge réel de la projection conservée est exposé. Aucun seuil de fraîcheur n’étant défini, l’âge n’entraîne pas automatiquement un statut « périmé ». |
| 13. Fallback sans données inventées | **Implémenté, avec fraîcheur explicitée** | La fusion/repli robuste, le modèle unique et la conservation d’une projection complète sont traçables; les tentatives manuelles partielles ne remplacent pas silencieusement l’officiel. L’ancienneté est mesurée, mais il n’existe pas de règle approuvée permettant de rejeter automatiquement une projection ancienne. |
| 14. Précipitations et probabilités | **Déjà couvert et testé** | Quantité, accord déterministe et probabilité calibrée restent distincts. L’accord ne se présente pas comme une probabilité météo; 0 mm reste valide. |
| 15. Continuité horaire | **Déjà couvert et testé** | L’ensemble des modèles peut varier d’une heure à l’autre. Une heure d’un modèle manquante n’empêche pas les autres de contribuer; une heure absente de toutes les sources n’est pas interpolée silencieusement. |
| 16. Observations et stations | **Déjà couvert et testé** | Observations, prévisions et fusion restent séparées; l’archive exacte est alignée par lieu, échéance et disponibilité pour éviter les fuites temporelles. Un biais station ne modifie pas les prévisions futures. |
| 17. Pipelines concurrents | **Audité et couvert** | Les chemins officiel, collecte, manuel, favoris et routes ont été inspectés. La voie de production reste identifiée; le flux personnel consomme l’archive UTC plutôt qu’une clé horaire locale ambiguë. Les suppressions Data Hub P1–P8 de `main` sont conservées et aucun code supprimé n’est restauré. |
| 18. Diagnostic Weather AI Lab | **Implémenté, avec une limite explicitée** | Par échéance, le panneau expose les valeurs brutes par modèle déjà présentes dans la trace (instant, horizon, bucket, preuve historique, calibration, poids brut/final, contribution et exclusions), puis les valeurs finales réellement fusionnées par variable, avec unités et nulls. Il expose source et horodatage. Le contrat actuel ne fournit pas toujours un indicateur explicite « cache-hit » par échéance; aucun état de cache n’est fabriqué. |
| 19. Tests automatisés | **24 scénarios mappés; T12 limité par l’absence de règle de péremption** | La matrice ci-dessous associe chaque cas de recette à des tests exécutés. Pour T12, l’âge et la conservation sont testés, mais une limite de fraîcheur non définie ne peut pas être testée sans en inventer une. |
| 20. Types et contrats API | **Implémenté et testé** | Le mapping client garde le type tRPC réel; dates/instants et valeurs null/0 sont explicites. Le read model AI Lab transmet les valeurs finales par variable; tests d’intégration UI inclus. |
| 21. Performance | **Vérifié statiquement** | Le diagnostic final réutilise le snapshot et les traces déjà chargés; aucun nouvel appel fournisseur ni requête par heure/modèle n’est introduit. Aucun benchmark de production n’a été exécuté. |
| 22. Plan d’exécution | **Exécuté** | Audit des couches, reproduction des causes, correction ciblée, tests, vérification TypeScript/build, recherche des autres writers et revue de diff effectués. |
| 23. Critères de réussite | **Partiellement satisfait, sans prétention de conformité complète** | Les tests pertinents passent et les données partielles ne remplacent plus la projection complète. Restent la limite structurelle de la projection locale sans migration, l’absence de politique de péremption et l’absence de vérification runtime production. La suite globale présente aussi 7 échecs d’environnement reproduits sur `main` propre; ils ne sont pas masqués. |
| 24. Rapport final | **En cours avant PR** | Le présent document fournit la matrice et les preuves pré-PR; le rapport de livraison final devra ajouter le SHA du commit et le lien de PR après sa création. |

## Couverture des 24 tests prescrits au §19

| Test | État | Preuve exécutée |
|---:|---|---|
| T1 — Sept sources disponibles | **Couvert** | `server/officialHourlyForecast.test.ts` : fusion exacte des sept modèles et exclusion de Best Match du vote. |
| T2 — Source absente | **Couvert** | `server/officialHourlyForecast.test.ts` : un modèle sans run est exclu à cette échéance; `server/weatherServices.hourlyRun.test.ts` : erreurs d’un fournisseur isolées. |
| T3 — Historique insuffisant | **Couvert** | `server/officialHourlyForecast.test.ts` : preuve partielle/repli robuste, valeur conservée et statut non calibré. |
| T4 — Buckets différents | **Couvert** | `server/officialHourlyForecast.test.ts` : fusion par lead individuel sans horizon commun. |
| T5 — Valeur zéro | **Couvert** | `server/officialHourlyForecast.test.ts`, `server/hourlyValueNormalization.test.ts` et tests d’affichage : zéro conservé. |
| T6 — Valeur null | **Couvert** | Tests du normaliseur, du collecteur et des graphiques : null reste absent, distinct de zéro. |
| T7 — Variable partielle | **Couvert** | `server/officialHourlyForecast.test.ts` : le modèle participe à la température mais pas au vent manquant. |
| T8 — Un seul modèle | **Couvert** | `server/officialHourlyForecast.test.ts` : valeur `SINGLE_MODEL` conservée sans prétendre à une fusion multi-modèle. |
| T9 — Aucun modèle | **Couvert** | `server/officialHourlyForecast.test.ts` : échéance conservée avec statut `UNAVAILABLE`. |
| T10 — Poids nuls/invalides | **Couvert** | `server/fusionEngine.test.ts` et `server/officialHourlyForecast.test.ts` : repli robuste, sans poids pour un modèle exclu. |
| T11 — Plafond de poids | **Couvert** | `server/fusionEngine.test.ts` : plafond adapté à deux sources et poids renormalisés. |
| T12 — Données périmées | **Non vérifiable pour une expiration automatique** | Tests de cache et de relance mesurent l’âge et retirent une échéance terminée; aucune durée maximale d’ancienneté n’existe dans la règle approuvée. L’âge est affiché sans inventer un seuil. |
| T13 — Fuseau horaire | **Couvert** | `server/weatherTime.test.ts` et `server/hourlyForecastCompleteness.test.ts` : instants UTC de la journée locale exacte. |
| T14 — Changement d’heure | **Couvert** | `server/weatherTime.test.ts`, `server/personalHourlyForecast.test.ts`, tests d’affichage : journées de 23/25 h et deux 02:00 distinctes via UTC. |
| T15 — Cache incomplet | **Couvert** | `server/officialWeatherSnapshot.test.ts` et `server/hourlyForecastPersistence.test.ts` : série officielle complète conservée; essai partiel archivé sans projection. |
| T16 — Erreur temporaire d’API | **Couvert** | `server/weatherServices.hourlyRun.test.ts` : retry des fournisseurs incomplets et conservation des sources réussies. |
| T17 — Divergence | **Couvert** | Nouveau test `server/officialHourlyForecast.test.ts` : étendue 0–40 °C, fusion numérique maintenue pour les deux modèles valides. |
| T18 — Best Match | **Couvert** | `server/officialHourlyForecast.test.ts` et `server/weatherServices.hourlyRun.test.ts` : référence archivée séparément, jamais modèle officiel. |
| T19 — Fallback manuel | **Couvert** | `server/officialWeatherSnapshot.test.ts` et `server/manualFusion.test.ts` : override explicite; projection officielle antérieure conservée si le lot est partiel. |
| T20 — Absence réelle | **Couvert** | Tests de `favoriteRegime`, `weatherConditionAggregation`, `personalCalibration`, `statsEngine` et normalisation : aucun 15 °C/0 fictif; état inconnu si les entrées requises manquent. |
| T21 — Pas de score précis | **Couvert** | `server/officialHourlyForecast.test.ts` : repli exact → bucket admissible → robuste, sans emprunt d’une autre variable. |
| T22 — Disponibilité variable par heure | **Couvert** | `server/officialHourlyForecast.test.ts` : série continue malgré un nombre variable de modèles. |
| T23 — Validation historique | **Couvert** | `server/officialHourlyForecast.test.ts` : scores contemporains ou futurs écartés; tests de calibration personnelle alignés par instant. |
| T24 — Interface | **Couvert** | `client/src/pages/Dashboard.test.ts`, `client/src/components/HourlyChart.test.ts`, `client/src/components/weather/HourlyFusionDebugPanel.test.ts`, `server/aiLabForecastComparison.test.ts`. |

## Validation exécutée

- `pnpm check` — **réussi**.
- `pnpm build` — **réussi**. Avertissements préexistants : variables `VITE_ANALYTICS_*` absentes, asset `/manus-storage/sky-pack-sunny_1500b9a0.jpg` non résolu au build (conservé pour résolution runtime), et bundle >500 kB.
- Suite ciblée AI Lab/alignement/panneau de fusion — **14 tests réussis**.
- `server/officialHourlyForecast.test.ts` après ajout du test de divergence — **26 tests réussis**.
- Suite filtrée `pnpm exec vitest run --exclude server/netatmo.credentials.test.ts --exclude server/netatmoOAuth.test.ts --exclude server/weather.test.ts` — **175 fichiers, 776 tests réussis**.
- Suite complète `pnpm test` — **175 fichiers réussis, 3 fichiers en échec; 792 tests réussis, 7 échoués, 2 ignorés**. Les mêmes 7 échecs ont été reproduits sur un `main` propre : un test d’identifiants Netatmo sans credentials, cinq tests OAuth exigeant `JWT_SECRET`, et `weather.getReport` sans base de test seedée. Aucun des trois fichiers n’a été exclu du relevé complet.
- `git diff --check` — **propre**. Aucun fichier de migration modifié ou ajouté.

## Causes confirmées et corrections

- Le collecteur horaire candidat gardait une échéance seulement si sa température était présente; les autres variables valides de cette heure disparaissaient. La collecte est désormais indépendante par variable, préserve les zéros, normalise les nombres valides et ne garde pas une heure sans aucune valeur finie.
- Le writer pouvait remplacer une projection complète par une réponse partielle. Les tentatives incomplètes sont conservées en archive/diagnostic, mais le writer de projection est sauté; le dernier lot complet reste utilisé et son âge réel est exposé.
- La complétude était inférée à partir des lignes reçues plutôt que de la grille attendue. La grille Paris exacte (23/24/25 instants UTC) et les seuls champs consommés par la projection sont désormais requis; les champs d’archive secondaires manquants restent diagnostiqués sans bloquer une projection prête.
- La date « N jours avant » soustrayait des durées de 24 h, ce qui pouvait passer au mauvais jour civil aux changements DST. Le calcul utilise maintenant des jours civils Europe/Paris.
- Des fallbacks de conditions/régimes convertissaient des champs inconnus en ciel clair ou en valeurs 15 °C/0. Les détecteurs, calibrations, agrégateurs et vues renvoient un état inconnu/indisponible tant que les entrées requises ne sont pas présentes; les zéros réellement mesurés sont gardés.
- Une relance horaire manuelle vide ou moins couverte pouvait masquer le snapshot officiel. Le cache la refuse et la projection existante n’est rapportée conservée que si elle est effectivement présente et vérifiée.
- La route de personnalisation regroupait les deux occurrences locales de 02:00. Elle consomme maintenant les derniers runs archivés par instant UTC exact et ignore les tentatives incomplètes.
- Le graphique affichait des précipitations nulles comme zéro et traçait potentiellement une ligne de température à travers des valeurs absentes. Les trous restent visibles comme inconnus; le zéro reste tracé comme valeur valide.
- Le diagnostic Weather AI Lab montrait la trace par modèle, mais pas toutes les valeurs finales envoyées au client. Les valeurs fusionnées des dix champs projetés sont désormais exposées par échéance avec leurs unités, leurs statuts et la distinction zéro/null.

## Fichiers d’application modifiés

```text
client/src/components/FifteenDayChart.test.ts
client/src/components/FifteenDayChart.tsx
client/src/components/HourlyChart.test.ts
client/src/components/HourlyChart.tsx
client/src/components/weather/HourlyFusionDebugPanel.test.ts
client/src/components/weather/HourlyFusionDebugPanel.tsx
client/src/lib/chartTemperatureTone.test.ts
client/src/lib/chartTemperatureTone.ts
client/src/lib/forecastAlignment.test.ts
client/src/lib/forecastAlignment.ts
client/src/lib/hourlyConditionLabel.test.ts
client/src/lib/hourlyConditionLabel.ts
client/src/pages/Dashboard.test.ts
client/src/pages/Dashboard.tsx
client/src/pages/WeatherAILab.test.ts
client/src/pages/WeatherAILab.tsx
server/aiLabForecastComparison.test.ts
server/aiLabForecastComparison.ts
server/db.ts
server/favoriteRegime.test.ts
server/favoriteRegime.ts
server/forecastVariableCoverage.test.ts
server/forecastVariableCoverage.ts
server/fusionEngine.test.ts
server/fusionEngine.ts
server/hourlyForecastCompleteness.test.ts
server/hourlyForecastCompleteness.ts
server/hourlyForecastPersistence.test.ts
server/hourlyForecastPersistence.ts
server/hourlyProjectionReport.test.ts
server/hourlyValueNormalization.test.ts
server/hourlyValueNormalization.ts
server/manualFusion.test.ts
server/manualFusion.ts
server/officialHourlyForecast.test.ts
server/officialRegime.test.ts
server/officialRegime.ts
server/officialWeatherSnapshot.test.ts
server/officialWeatherSnapshot.ts
server/personalCalibration.test.ts
server/personalCalibration.ts
server/personalHourlyForecast.test.ts
server/personalHourlyForecast.ts
server/personalObservationHistory.ts
server/routers/favorites.ts
server/routers/personalObservations.test.ts
server/routers/personalObservations.ts
server/routers/weather.ts
server/scheduledHandlers.test.ts
server/scheduledHandlers.ts
server/statsEngine.test.ts
server/statsEngine.ts
server/weatherConditionAggregation.test.ts
server/weatherConditionAggregation.ts
server/weatherConditionLabels.test.ts
server/weatherServices.bestMatchReference.test.ts
server/weatherServices.hourlyRun.test.ts
server/weatherServices.validationHourly.test.ts
server/weatherServices.ts
server/weatherTime.test.ts
server/weatherTime.ts
shared/weatherConditionLabels.ts
```

Le rapport lui-même est `docs/audit-previsions-horaires-matrice.md`. Aucun code de migration ni test/fichier du Data Hub P1–P8 supprimé de `main` n’a été restauré.
