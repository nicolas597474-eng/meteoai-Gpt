# Référence et décisions de portage

Source consultée : https://github.com/nicolas597474-eng/meteo-ai-app, branche main au 15 octobre 2026. Audit en lecture seule ; aucune modification du dépôt d’origine.

Le brief décrit 8 modèles, 12 régimes et 4 bandes de distance. Le code de référence a évolué : `server/officialModels.ts` fusionne 7 modèles physiques ; `best_match` sert de référence et de secours. `server/fusionEngine.ts` contient désormais 20 régimes. `server/ultraLocalService.ts` configure des bandes différentes selon le mode. Ces écarts ne sont pas masqués.

## Règles conservées dans la PWA

- Best Match exclu du classement et du consensus physique pour éviter le double comptage.
- Valeurs absentes conservées comme telles et couverture indiquée à chaque échéance.
- MAE, RMSE et biais signé prévu − observé ; absence de preuve différente d’une erreur nulle.
- Poids séparés par variable et horizon ; adaptation soumise à un historique suffisant, récent et local.
- Cap des poids, moyenne circulaire du vent et vote catégoriel pour WMO.
- Observations physiques distinctes des références de grille et de la réanalyse.
- Horodatage de la température, exclusions des mesures futures et anciennes ; aucun updatedAt global utilisé comme preuve de fraîcheur de mesure.
- Gradient d’altitude de 0,65 °C par 100 m uniquement avec deux altitudes connues.
- Corrections heuristiques ville/vallée/côte non appliquées sans calibration.

## Adaptations explicites

La PWA implémente les 12 régimes et quatre bandes demandés dans le brief. Le modèle de confiance est indicatif, sa formule affichée dans l’AI Lab. La pondération navigateur est un inverse de MAE plafonné après qualification ; ce n’est pas la formule complète de `server/fusionPerformance.ts`, laquelle utilise des erreurs standard, une MAE médiane régularisée, 120 jours d’historique et des identifiants de runs. Le fallback serveur médiane/MAD est remplacé par un consensus égal non calibré.

Le moteur ultra-local navigateur combine stations physiques disponibles et état actuel. Il ne prétend pas reproduire à l’identique les allocations de bandes et contrats privés du serveur. Les réseaux ouverts ne garantissent pas une station à moins de 20 km d’Hondeghem ; aucune station fictive de remplacement n’est créée.

Les données et intégrations du backend d’origine ne sont pas copiées, transférées, modifiées ou accessibles depuis cette version. Une conservation intégrale de ce backend exigerait une deuxième phase d’intégration serveur, notamment pour l’apprentissage continu lorsque l’application est fermée.
