# Code météo WMO quotidien

## Portée

La collecte de prévision quotidienne demande `daily=weather_code` directement à chacun des sept modèles officiels déjà présents dans le moteur. La documentation officielle Open-Meteo décrit ce champ comme le code WMO de la condition la plus marquante de la journée et exige un fuseau horaire pour les variables quotidiennes : [documentation de l’API Forecast](https://open-meteo.com/en/docs).

Le champ et sa présentation restent **strictement quotidiens**. Le panneau « Prévision horaire officielle », son schéma, son classement de variables et son endpoint ne sont pas modifiés par cette correction. Aucun type/intensité de pluie ni rayonnement solaire n’est ajouté. Les observations SYNOP/METAR/Netatmo ne sont pas utilisées pour prévoir une échéance future.

## Sélection et absences

- Une seule valeur valide : exposer le code avec le statut descriptif `single_model`; ne pas appeler cela une fusion.
- Plusieurs codes valides : exposer uniquement le code WMO exact le plus fréquent lorsqu’il existe un premier rang unique. L’effectif est affiché; il s’agit d’une fréquence brute descriptive, **non pondérée, non calibrée et non probabiliste**.
- Égalité au premier rang : garder `weatherCode` et `condition` inconnus. Le premier élément ou le modèle Best Match ne départage pas l’égalité.
- Valeur nulle/invalide, variable absente, date/validTime incompatible, réponse absente ou doublon contradictoire : conserver un statut source distinct et ne pas inventer de valeur.
- Best Match n’est ni demandé pour ce code dans cette collecte ni considéré comme modèle officiel ou vote.

Les codes sources sont rattachés au jour civil `Europe/Paris`, au modèle et à son ID, à un `runId` de capture, à `requestStartedAt`, `availableAt`, au nombre de tentatives réseau et au `validTime` quotidien canonique (également exposé en UTC). `networkAttemptCount=0` signale une réponse servie depuis le cache partagé; une valeur positive signale le réseau. `computedAt` indique l’assemblage du résumé. `availableAt` est l’heure à laquelle la réponse est devenue disponible à l’application, et non l’heure de calcul météorologique du fournisseur. L’API Open-Meteo ne fournit pas ici une identité/heure certifiée du run amont : le `runId` ne prétend donc pas être un identifiant de run fournisseur, et la fraîcheur du run modèle amont reste inconnue même si l’heure de réception est connue.

## Persistance et limites

Le code quotidien est transporté dans la réponse de prévision et accompagné de son résumé de provenance; il n’est pas écrit dans une nouvelle table ni présenté comme statistiquement calibré. Le diagnostic conserve les sept modèles attendus, y compris les valeurs absentes. La liste des champs quotidiens de fusion numérique, les calculs historiques de performance et les variables horaires restent inchangés.
