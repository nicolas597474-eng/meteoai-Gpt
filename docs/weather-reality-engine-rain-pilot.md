# Weather Reality Engine — pilote pluie

Ce pilote relie le choix de condition déjà utilisé par le tableau de bord à un unique calque de pluie WebGL natif. Il ne modifie ni les données météo, ni leur fusion, ni les prévisions, observations, stations ou scores, et n’ajoute aucune dépendance.

## Entrées et limites

- La pluie n’est affichée que si le libellé de condition/régime sélectionné indique explicitement pluie, averse ou bruine. Une quantité numérique sans période documentée ne déclenche pas la pluie et ne l’intensifie pas.
- L’orage exige un libellé explicite d’orage ou un code WMO correspondant; le seul mot « tempête » n’active pas les éclairs. Un orage ne crée pas automatiquement pluie ou grêle sans signal distinct.
- Le débit n’est pas disponible sous une forme courante dont la période est documentée : `precipitationRateMmPerHour` reste donc `null`. Aucun chiffre de précipitations n’est utilisé pour l’intensité WebGL.
- Les qualificatifs textuels explicites (« faible », « forte »…) peuvent moduler le nombre et la vitesse des particules comme choix de rendu, pas comme mesure physique. Sans qualificatif, le moteur conserve une densité modérée.
- Le vent est transmis en km/h avec sa direction et ses rafales quand ces valeurs existent. Une direction absente donne une pluie verticale neutre; les valeurs invalides sont ignorées.

## Rendu et dégradation

Le canvas réutilise WebGL natif, limite le nombre de particules et la résolution de dessin, et suspend sa boucle lorsque la page est cachée ou hors écran. Le mode « réduit » baisse fortement la densité et plafonne l’animation; le mode « désactivé » n’initialise pas le renderer. `prefers-reduced-motion` empêche le démarrage de l’animation. Si WebGL ou ses shaders échouent, si le contexte est perdu, ou si la préférence système demande moins de mouvement, l’habillage CSS déjà présent reste le repli; le reste de l’atmosphère n’est pas remplacé.

## Hors périmètre

Les gouttes sur une vitre, la réfraction, la neige, le brouillard, les éclairs, les niveaux graphiques ULTRA/HIGH/LOW, l’instrumentation FPS et la simulation de scènes ne font pas partie de ce premier pilote. Il doit être validé visuellement sur mobile avant d’étendre le moteur.

## Validation visuelle

Le rendu WebGL et le fallback CSS ont été vérifiés dans une émulation Chromium de 390 × 844 px, avec conditions et vent synthétiques, sans appel aux API météo. Cette capture est une émulation, pas un essai sur un téléphone physique; la validation sur appareil réel reste à faire avant d’étendre le périmètre.
