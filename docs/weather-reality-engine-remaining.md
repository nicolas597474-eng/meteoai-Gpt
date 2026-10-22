# Moteur visuel météo — autres phénomènes

## Point de départ et périmètre

Cette extension est préparée depuis `main` au commit `a482b23008126f9f4d28481ac5bc612a2c41e97b`, après fusion des PR #109 (pluie WebGL) et #110 (neige WebGL et brouillard). Elle complète uniquement le décor atmosphérique du Dashboard; elle ne remplace ni ne duplique les couches pluie, neige et brouillard déjà livrées.

Les effets de chaleur, nuit, poussière, givre/verglas et nuages déjà présents restent en place. Les globes dédiés au Soleil et à la Lune ne sont pas modifiés; le Soleil n’ajoute qu’un voile coloré ambiant, sans disque ni position solaire artificielle.

Aucune prévision, observation, station, source météo, fusion, pondération, score, collecte ou dépendance n’est modifié.

## Signaux et limites

- **Grêle** : codes WMO 96/99 ou libellé explicite de grêle/grésil. Le code 95 (orage sans grêle) n’ajoute pas de grêlons. Le code 99 représente le seul niveau WMO explicitement classé fort; le code 96 reste modéré.
- **Verglas** : codes WMO 56/57 (bruine verglaçante) et 66/67 (pluie verglaçante), ou libellé explicite de précipitation verglaçante. Le gel seul ou une température négative ne crée pas de couche de verglas. Les codes 56/66 sont légers; 57/67 sont classés forts pour le rendu.
- **Orage** : les codes WMO 95/96/99 et les libellés explicitement liés à l’orage (`orage`, `thunderstorm`) déclenchent l’éclair; le terme « tempête » seul ne suffit pas. L’orage n’ajoute pas automatiquement une pluie ou de la grêle : la pluie exige un libellé explicite pluie/averse/bruine et la grêle son propre signal. Une quantité de précipitations sans période connue ne suffit pas à faire apparaître ou intensifier la pluie dans un orage.
- **Nuages** : une couverture finie comprise entre 0 et 100 % module l’opacité; zéro est une observation valide. Une valeur `null` reste « inconnue » et utilise un rendu neutre conditionné par le libellé nuageux, elle n’est pas convertie en zéro.
- **Soleil** : la couverture nuageuse valide module l’intensité d’un voile diffus et non localisé. `null` garde un niveau ambiant neutre distinct de la valeur observée 0 %. Aucun azimut, élévation ou disque solaire n’est inventé.
- **Vent** : la vitesse, les rafales et la direction existantes pilotent une dérive plafonnée. Les vitesses hors plages (vitesse > 250 km/h, rafale > 300 km/h), les directions hors 0–360° et les valeurs non finies sont ignorées. Sans direction, les rubans restent neutres; aucune direction n’est supposée.

Ces champs servent uniquement à l’habillage décoratif. Ils ne modifient pas les mesures, prévisions, observations ou valeurs présentées ailleurs dans l’application.

## Rendu, accessibilité et performance

- La grêle utilise un shader WebGL natif de sphères ombrées avec rendu CSS de repli. Le moteur partage le plafond DPR du canvas pluie existant, borne le nombre de particules à 36 et limite la dérive horizontale.
- Le canvas grêle se limite à 60 images/s sur grand écran, 45 sur écran compact et 30 en mode d’effets réduit; sa boucle est suspendue lorsque l’onglet est masqué ou le canvas hors écran. WebGL indisponible/échec ou perte de contexte ramène au CSS; les particules ne sont pas dessinées deux fois.
- `prefers-reduced-motion` ne démarre pas le WebGL grêle et conserve au plus deux grêlons CSS statiques. Les modes existants complet, réduit et désactivé restent disponibles; désactivé ne monte pas l’atmosphère.
- Les nuages et le vent ne s’animent que si le système autorise le mouvement. En mobile, le nombre de particules et l’opacité sont limités. Tous les overlays restent non interactifs (`pointer-events: none`).
- Le rendu solaire est un simple voile uniforme modulé par la nébulosité, sans nouvelle sphère ni localisation de source lumineuse.

## Validation

- `pnpm check` : réussi.
- `pnpm test` : 228 fichiers; 1 147 tests réussis et 2 ignorés.
- `pnpm build` : réussi. Vite avertit qu’un bundle dépasse 500 kB (le bundle principal est d’environ 1,05 MB); le build termine sans erreur.
- `git diff --check` : réussi.
- Après correction de deux assertions de test hors portée, les 12 tests ciblés concernés passent également.

Aucun aperçu mobile en navigateur ni essai sur téléphone physique n’a été effectué. La validation visuelle reste à faire sur de vrais appareils iOS et Android; les tests actuels valident le comportement automatisé, pas la fluidité WebGL ni le rendu physique.

- **Grêle** : codes WMO 96/99 ou libellé explicite de grêle/grésil. Le code 95 (orage sans grêle) n’ajoute pas de grêlons. Le code 99 représente le seul niveau WMO explicitement classé fort; le code 96 garde une intensité visuelle `steady`.
