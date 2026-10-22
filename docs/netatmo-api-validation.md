# Validation API Netatmo — 13 août 2026

La documentation officielle Netatmo indique que `read_station` autorise la lecture des données de station météo. Chaque appel API doit utiliser un access token avec le schéma `Authorization: Bearer`, renouvelé à l’aide du refresh token côté serveur. Les refresh tokens rotatifs remplacent les précédents ; les renouvellements concurrents doivent donc être sérialisés.

L’endpoint météo officiel `GET /api/getpublicdata` renvoie les modules extérieurs partagés dans une zone géographique. Sa structure publique peut contenir des séries horodatées dans `measures`, avec une liste `type`, des valeurs dans `res`, et des attributs de vent ou pluie (`wind_strength`, `gust_strength`, `rain_60min`). Le collecteur MeteoAI les décode sans enregistrer l’access token ni le refresh token.

Lors de la validation réelle, l’API a retourné 470 stations publiques authentifiées dans un rayon de 20 km autour de Hondeghem et 810 autour d’Erquinghem-Lys. Une réponse temporaire `503` / code `27` a également été observée ; elle est traitée comme indisponibilité transitoire, sans assimilation à une absence de station.

Après persistance ponctuelle, 227 stations Netatmo actives ont été enregistrées pour Erquinghem-Lys (`50.67601, 2.84505`) avec des observations horodatées. Le cycle vers Hondeghem a reçu le `503` transitoire et n’a donc pas créé de fausse absence. Un appel direct à la procédure Fiabilité doit encore être lu avec le format de transport tRPC/SuperJSON exact avant de conclure sur le rendu ; le statut HTTP seul n’est pas suffisant.

Le transport tRPC est désormais confirmé : l’entrée Erquinghem-Lys est correctement interprétée (`locationKey` `50.676_2.845`, rayon 20 km), mais la réponse Fiabilité ne retourne encore aucune station. Le problème est donc situé entre la lecture DB de Fiabilité et les 227 lignes persistées, non dans la sélection du lieu ou le format tRPC.

La cause a été isolée : la comparaison SQL stricte de coordonnées stockées en `FLOAT` ne retrouvait pas toujours la même représentation binaire du lieu demandé. La lecture utilise maintenant une tolérance de ±`0,0001°`. La lecture directe et la réponse tRPC Fiabilité retournent chacune 227 stations Netatmo pour Erquinghem-Lys après correction.

Sources :

- https://dev.netatmo.com/apidocumentation/oauth
- https://dev.netatmo.com/apidocumentation/weather
- https://dev.netatmo.com/apidocumentation/general
- https://cbornet.github.io/netatmo-swagger-decl/
