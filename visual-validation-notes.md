# Vérification visuelle mobile

Le rendu authentifié du Dashboard confirme que la carte de température utilise les valeurs attendues. Le moteur de capture isolé ne partage pas la session Manus et affiche donc l’état de chargement sur l’URL mobile. La correction responsive est protégée par le test `dashboardTemperatureLayout.test.ts` : colonne d’extrêmes non réductible, température principale bornée et valeurs sans retour à la ligne.

L’aperçu du 12 août montre que les températures maximale et minimale demeurent désormais entièrement visibles. Les prochaines améliorations d’affichage concernent principalement la densité de l’en-tête de carte, les libellés secondaires et l’espace disponible pour les graphiques sous la ligne de flottaison.

La vérification suivante confirme que l’en-tête est condensé sur mobile, que le bouton d’actualisation conserve une hauteur tactile de 44 px et que les marges des lignes de mesures sont réduites uniquement sous le point de rupture `sm`.

Le rendu vérifié après optimisation conserve la hiérarchie de la température, des extrêmes et des six indicateurs, tout en rapprochant le lien de détail, le sélecteur de mode et le graphique horaire.

L’AI Lab a été remplacé par une vue de traçabilité. Lorsqu’aucun snapshot officiel n’est chargé, elle affiche explicitement l’absence de trace et supprime les compteurs, écarts et modèles auparavant affichés comme des valeurs certaines.
