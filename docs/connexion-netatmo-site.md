# Netatmo indépendant — Site restauré

Page privée : /connexion-netatmo. Renseigner Client ID et Client Secret dans le formulaire, jamais dans la conversation ou le dépôt.

Redirect URI à autoriser dans Netatmo Connect :
https://meteoai-restauree-controle.givingbay1.chatgpt.site/api/netatmo/callback

API sur la même origine, identité Sites obligatoire et coffre R2 AES-256-GCM propre au compte. Secret serveur NETATMO_ENCRYPTION_KEY configuré dans Sites ; ne pas remplacer cette clé sans migration du coffre. Aucun secret du précédent Site repris. Aucun accès inter-applications.

Recherche getpublicdata sur une boîte couvrant un cercle de 50 km, puis filtrage par distance réelle. Cache utilisateur + cellule géographique pendant 10 minutes, partagé entre lieux proches et protégé par promesse et bail R2. Rayon demandé explicite radiusKm=50. Les modèles Local et Ultra-local restent des calculs distincts : sélection Local <30 km et Ultra-local <10 km selon le moteur restauré. Cette sélection ne réduit pas la zone interrogée de 50 km.

Netatmo peut renvoyer une liste vide, refuser l’accès public ou limiter le débit. Aucun relevé n’est simulé. L’intégration réelle exige que le propriétaire termine l’autorisation OAuth.

L’archivage navigateur à Hondeghem accepte les relevés jusqu’à 50 km et les découpe par 200. Ces mesures restent des données reçues via le navigateur, exclues de la calibration qualifiée. Les anciennes archives sont conservées.

Correction du signe du gradient d’altitude dans spatialFusionCore : T_cible = T_station + 0,0065 × (z_station − z_cible). Hypothèse standard explicitée, différente d’un profil atmosphérique mesuré. Altitude cible et altitude station requises ; tests dans les deux sens.

Validation : tests Node du coffre, OAuth/CSRF/rejeu, caches/renouvellement concurrents, isolement, rayon50 ; tests moteur spatial/Ultra-local, compilation TS et client/Worker. Aucun identifiant réel pendant les tests automatisés.
