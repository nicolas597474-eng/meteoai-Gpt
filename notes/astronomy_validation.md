# Validation visuelle — positions astronomiques apparentes

Le 19 août 2026, le tableau de bord de développement a été chargé avec succès. La page principale est rendue sans erreur cliente observable. Pour ce chargement précis, la source distante d’éphémérides a retourné une indisponibilité et le panneau a affiché son état explicite « Éphémérides réelles temporairement indisponibles » ; aucune position n’a été substituée.

Les calculs restent couverts de manière déterministe par les tests unitaires Astronomy Engine pour Paris, l’équateur et une haute latitude. Une validation visuelle complémentaire du tracé sera automatiquement possible dès que la source d’horaires Open-Meteo répond de nouveau.

Le contrôle direct de l’endpoint a aussi révélé que l’import de type espace de noms ne préservait pas les constructeurs Astronomy Engine dans le processus serveur. Le calcul a été corrigé pour employer les exports nommés (`Body`, `Observer`, `Equator`, `Horizon`) ; une nouvelle vérification de réponse est requise après le rechargement du serveur.

La vérification finale directe de `weather.getApparentAstronomyPosition` a répondu HTTP 200 pour le lieu actif, avec un Soleil au-dessus de l’horizon (`+26,0°`, azimut `102,0°`) et une Lune sous l’horizon (`−47,5°`, azimut `63,1°`). Le contrat de hauteur, azimut et état d’horizon est donc opérationnel. La page principale reste en état de repli tant que la requête Open-Meteo d’horaires demeure indisponible ; elle n’invente pas d’éphémérides dans ce cas.

Après la correction du même mécanisme de chargement dans le calcul d’éclipses, `weather.getEnvironmentalSnapshot` répond lui aussi HTTP 200. Pour le lieu actif, il expose désormais les horaires Open-Meteo, les positions apparentes Astronomy Engine et les couches de visibilité d’éclipse ; le panneau peut donc revenir de son état de repli sans aucune donnée substituée.

La vérification visuelle du tableau de bord confirme que le panneau affiche les valeurs réelles (`Soleil +26,3° · azimut 102,4°`, `Lune −47,3° · azimut 63,7°`) et l’indicateur « Lune sous l’horizon ». La Lune n’est pas dessinée dans l’arche visible et sa fiche mentionne explicitement « Position fixe … sans rotation ».
