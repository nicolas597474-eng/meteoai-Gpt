# Paramètres d’embed Windy vérifiés le 25 août 2026

Le configurateur officiel Windy génère `metricWind=km/h` lorsque l’unité de vent « km/h » est choisie. Avec l’option « Show marker » activée, il ajoute `detailLat`, `detailLon` et `marker=true` à l’URL d’embed.

Le marqueur doit donc être fourni par l’iframe Windy aux coordonnées du lieu actif ; un marqueur HTML centré au-dessus de l’iframe ne doit pas être utilisé, car il resterait au centre de l’écran lors d’un déplacement de carte.

Source : https://embed.windy.com/

## Fond de carte Satellite

Le 25 août 2026, l’URL `embed2.html` testée avec `map=satellite` a malgré tout chargé les tuiles `darkmap` de Windy. Dans l’embed public, ce paramètre ne garantit donc pas l’affichage effectif d’un fond satellite. L’interface ne doit pas présenter un basculement visuel comme confirmé tant que Windy ne retourne pas réellement les tuiles correspondantes.

Un essai avec `overlay=satellite` a bien activé le libellé « Satellite » dans Windy, mais les tuiles de fond restaient `darkmap` et la couche météo active était remplacée. Cette variante ne convient donc pas au besoin de conserver simultanément pluie, vent ou nuages avec un fond satellite.
