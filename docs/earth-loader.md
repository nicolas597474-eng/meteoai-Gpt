# Visuel de chargement de `WeatherAILoader`

## État actuel : visuel 100 % CSS

Le visuel de l'écran de chargement est constitué uniquement de dégradés, de
bordures et d'animations CSS (préfixe `weather-loader-globe`) :

- `__disc` : disque terrestre en `radial-gradient`, mêmes position, taille et
  ombres internes que l'ancien globe ;
- `__orbit` / `__orbit--back` : deux orbites elliptiques avec un point lumineux ;
- `__sun` : halo solaire ; `__halo` : lueur d'ambiance.

**Il ne télécharge aucun octet** : ni image, ni moteur de rendu, ni requête.

## Pourquoi la scène WebGL Three.js a été supprimée

La version précédente affichait une Terre 3D texturée. Coût mesuré par le build
de production (`gzip -9`) :

| Ressource | Poids |
|---|---|
| `earthScene-*.js` (Three.js) | 474,2 ko brut / **118,3 ko gzip** |
| `earth_atmos_2048.jpg` (fond CSS du repli) | 512,6 ko |
| `earth_normal_2048.jpg` | 336,8 ko |
| `earth_lights_2048.png` | 410,2 ko |
| `earth_clouds_1024.png` | 226,1 ko |
| `earth_specular_2048.jpg` | 223,4 ko |
| **Total ajouté à chaque chargement à froid** | **118,3 ko gzip + 1,71 Mo** |

Ces ressources étaient demandées par l'écran d'attente de **toutes les routes**,
donc précisément pendant que les requêtes de données se disputaient la même
bande passante. Elles étaient par ailleurs servies en `no-store` : elles étaient
donc retéléchargées à chaque chargement à froid, y compris pour un visiteur
revenant sur le site.

L'élément était décoratif (`aria-hidden="true"`) et le cycle de chargement météo
n'a jamais attendu sa scène. Son coût n'était donc justifié ni par
l'accessibilité, ni par les données : il a été supprimé, ainsi que ses textures,
`EarthGlobe.tsx`, `earthScene.ts` et la page d'aperçu `earth-preview.html`.

Les textures restent récupérables dans l'historique Git si la scène devait
revenir un jour.

## Comportement conservé

- Les variantes `full`, `light`, `compact`, les messages et les trois phases
  restent disponibles et inchangés.
- Aucun appel météo/IA supplémentaire et aucun délai de chargement imposé.
- La sortie conserve ses 340 ms (`.weather-ai-loader--exiting`).
- Le conteneur `.weather-ai-loader` garde `contain: layout style paint`.

## Accessibilité et mouvement

Les animations CSS sont déclarées sous
`@media (prefers-reduced-motion: no-preference)`, et la prop `reducedMotion`
(ou la préférence système) les désactive via les règles existantes
`.weather-ai-loader--reduced-motion *` et `@media (prefers-reduced-motion: reduce)`.
Le visuel reste décoratif : les informations du loader restent accessibles
(`role="status"`, `aria-live="polite"`, `aria-busy`).

## Validation

- `WeatherAILoader.test.ts` : vérifie l'absence totale de dépendance 3D, d'image,
  de `three` et de texture, et la présence des animations CSS sous condition de
  mouvement.
- `pnpm check`, `pnpm test`, `pnpm build` : voir les résultats consignés dans le
  rapport de performance `analyse-performance-pages.md`.
