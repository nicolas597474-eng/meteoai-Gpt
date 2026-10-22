# Moteur visuel météo — neige et brouillard

## Périmètre

Cette extension est un habillage décoratif du Dashboard, réutilisant son choix de condition et ses modes existants (`complet`, `réduit`, `désactivé`). Elle ne modifie ni prévisions, ni scoring, ni observations, ni stations, ni fusion; elle ne lance aucune collecte météo. Aucune dépendance n’est ajoutée.

## Signaux et limites

### Neige

- Le signal est exclusivement la catégorie de neige déjà affichée dans `condition` ou, en repli, `regime`.
- Les qualificatifs textuels disponibles (`faible/léger/light/fine`, `fort/intense/heavy/violent`) n’ajustent que la densité décorative; sinon l’intensité visuelle reste `steady`.
- Le champ de précipitations n’est pas utilisé pour intensifier la neige : sa période n’est pas suffisamment établie pour en faire un taux de chute neigeuse sûr. Aucune épaisseur, accumulation ou probabilité n’est déduite.
- La direction et la vitesse du vent, quand elles sont finies et dans les plages acceptées, donnent seulement une dérive visuelle bornée. En leur absence, les flocons gardent un mouvement latéral doux.

### Brouillard

- Le brouillard est sélectionné à partir de la condition/régime déjà affiché ou du seuil de visibilité de repli déjà présent dans le sélecteur visuel (< 1 km).
- `server/weatherServices.ts` normalise la visibilité horaire en kilomètres à partir de la valeur source en mètres, arrondie au dixième; l’habillage ne change ni la source ni cette conversion.
- Une visibilité numérique finie de 0 à 100 km module uniquement l’opacité CSS du voile, selon une plage visuelle configurée de 0 à 1 km. Une donnée invalide, hors plage ou absente (`null`) ne devient jamais zéro : le voile conserve son apparence de base sans modulation et l’attribut de rendu indique `unknown`.
- La mesure n’est ni affichée ni transformée en nouvelle observation. Le résultat sert uniquement au style; il ne prétend pas calculer une portée de visibilité exacte.

## Rendu et accessibilité

- La neige utilise un canvas WebGL léger avec particules procédurales à taille, profondeur et rotation variées. La densité est bornée, le DPR du canvas est plafonné par le moteur partagé, et la cadence est réduite sur écran compact ou en mode réduit.
- Un fallback CSS est disponible si WebGL est indisponible, échoue ou perd son contexte. Les deux rendus n’affichent pas simultanément leurs particules.
- La boucle est suspendue lorsque l’onglet est caché ou le canvas hors viewport; les observers et le contexte sont libérés au démontage.
- `prefers-reduced-motion` désactive le WebGL et conserve au plus sept flocons immobiles, distribués sur l’écran; le brouillard reste statique et flouté. Le mode `réduit` et le mode `désactivé` existants restent respectés.
- Les calques gardent `pointer-events: none` afin de laisser les interactions du tableau de bord accessibles.

## Vérifications

- TypeScript : `pnpm check` — réussi.
- Suite complète : `pnpm test` — 227 fichiers, 1 138 tests réussis, 2 ignorés.
- Production : `pnpm build` — réussi. Vite affiche également des avertissements sur les variables analytics non renseignées, une image `/manus-storage/...` conservée pour résolution runtime et la taille d’un chunk; ces avertissements n’ont pas empêché le build.
- Prévisualisation navigateur en fenêtre responsive de 390 × 844 pixels CSS : neige, brouillard et contrôles affichés; aucune donnée météo réelle n’est chargée dans ce harness. Aucun téléphone physique n’a été testé.
