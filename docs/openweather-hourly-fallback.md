# Repli horaire OpenWeather par cellule manquante

**Périmètre :** réponse de `weather.getDetailedForecast` uniquement. La fusion horaire de base demeure celle des sept modèles officiels Open-Meteo; Best Match reste exclu.

## Règle de repli

Le serveur ne sollicite l’endpoint existant Forecast 5 jours / 3 heures que si une ou plusieurs cellules officielles des champs comparables sont absentes. Une réponse OpenWeather peut compléter, sans écrire en base, les seuls champs réellement fournis par cette réponse : température, vitesse du vent, direction du vent, humidité relative et nébulosité totale.

Une cellule est complétée uniquement si son `validTime` UTC en millisecondes est **strictement égal** au `dt` OpenWeather converti depuis les secondes Unix. Aucun arrondi d’heure, décalage toléré, interpolation, extrapolation, redistribution de cumul ou génération d’échéance n’est effectué. La cadence de trois heures et l’horizon de cinq jours impliquent donc que de nombreuses cellules officielles restent inchangées et possiblement manquantes.

Les valeurs officielles finies sont toujours conservées, y compris zéro. Les valeurs nulles, invalides, hors domaine ou dupliquées ne deviennent pas une valeur de secours. Les timestamps officiels dupliqués et les échéances OpenWeather dupliquées sont ignorés comme ambigus. Un échec HTTP/réseau, une clé absente ou l’absence de paire exacte laisse les valeurs d’origine en place.

La vitesse OpenWeather en m/s est convertie en km/h; la direction est normalisée en degrés; température, humidité et nébulosité utilisent les unités métriques explicitement demandées. Précipitations, rafales, pression, condition/code météo, UV, rosée, visibilité et rayonnement ne sont pas complétés par cette étape, faute de sémantique/unité confirmée dans le contrat du comparateur.

## Provenance et limites de fraîcheur

Chaque cellule effectivement complétée porte son fournisseur, le produit, le `validTime`, l’heure de récupération par l’application et `providerRunAt: null`. Cette heure de récupération n’est pas l’heure de génération du modèle; l’endpoint Forecast ne fournit pas de run certifié, donc la fraîcheur amont reste explicitement **inconnue**. L’interface affiche ces limites sous la température ou dans le détail de la variable concernée.

OpenWeather n’est jamais ajouté aux sept modèles, aux poids, aux scores, aux classements, à la calibration, au consensus pluie, aux régimes météo ou aux archives. L’observation SYNOP/METAR/Netatmo n’intervient pas dans ce repli de prévision.

## Exécution et validation

Le repli est à la demande dans la requête de page et conditionné à la présence de trous; il ne crée pas de tâche planifiée, collecte manuelle, écriture DB, migration ou dépendance. Le cache HTTP météo existant et le partage de requête en cours évitent de répéter inutilement le même appel. Les tests utilisent uniquement des réponses synthétiques; aucun appel réel à OpenWeather ou autre API météo n’est requis.
