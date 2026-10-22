# Validation du profil de relief local — 19 août 2026

## Constat visuel
- Le panneau Soleil & Lune affiche correctement les trajectoires en pointillés (Soleil jaune, Lune bleu pâle).
- Le Soleil est positionné à l'Est le matin, la Lune est sous l'horizon (indication visible).
- La phase lunaire affiche « Croissant croissant » avec éclairage 43% — cohérent avec la géométrie Astronomy Engine.
- Le bouton « Relief » est visible en bas à droite du panneau, en état inactif (gris).
- Le fond de l'arche est diurne, conformément à la hauteur du Soleil au-dessus de 6°.
- Les repères horaires (09h, 12h, 15h, 18h pour le Soleil ; 18h, 21h pour la Lune) sont visibles.
- Le texte « Position fixe calculée à … · sans rotation » a été remplacé par « Calculé à … · Astronomy Engine. »
- Aucune rotation ni animation décorative sur la Lune.

## Validation TypeScript et Vitest
- TypeScript : 0 erreur.
- Tests : 309 passants, 2 ignorés (311 total).
