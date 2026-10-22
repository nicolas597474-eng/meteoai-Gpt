# Vérification visuelle — transparence des modes locaux

Le 21 août 2026, le Dashboard de prévisualisation charge correctement en mode Officiel, avec les contrôles Officiel, Local et Ultra-local visibles. La session de prévisualisation non connectée ne possède pas de lieu favori actif ; elle ne déclenche donc pas le contrat `getLocationWeather` et ne permet pas d’afficher un exemple réel de bande ou de station contributrice.

Le contrôle automatisé doit donc s’appuyer sur le contrat réel exposant `bandBreakdown` et `stationsUsed`, puis sur la validation de la vue avec un lieu de test local au navigateur. Aucun historique, favori ni réglage serveur n’a été modifié pendant cette vérification.

Une vérification ultérieure avec un lieu temporaire conservé uniquement dans le stockage du navigateur a confirmé le comportement Local à 30 km : les quatre bandes `0-5`, `5-10`, `10-20` et `20-30 km` sont affichées, chacune avec son nombre de stations et un état explicite lorsqu’aucune station ne contribue. Le contexte affichait correctement le repli officiel, la confiance insuffisante et l’absence de station, sans présenter de modèle comme station ni modifier de donnée persistée.
