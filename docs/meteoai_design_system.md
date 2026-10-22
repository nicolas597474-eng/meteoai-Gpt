# Design system et architecture cible — MeteoAI

## Principe directeur

Le design system n’est pas une nouvelle direction artistique. Il codifie la direction existante afin de la reproduire exactement : profondeur bleu-noir, accent bleu, textes clairs, textes secondaires gris bleuté, cartes sombres, rayons modérés et graphiques à conventions météo stables.

## Tokens existants à préserver

| Famille | Valeurs actuelles | Usage à préserver |
|---|---|---|
| Fond | `--background: oklch(0.13 0.015 250)` | Canvas global bleu-noir. |
| Carte | `--card: oklch(0.17 0.02 250)` | Surface sombre des modules de données. |
| Accent | `--primary: oklch(0.55 0.18 250)` | État actif, liens, navigation et éléments météo accentués. |
| Texte | `--foreground: oklch(0.93 0.005 250)` | Informations principales et chiffres clés. |
| Texte secondaire | `--muted-foreground: oklch(0.65 0.01 250)` | Libellés, descriptions et unités. |
| Bordure | `--border: oklch(0.28 0.02 250)` | Séparation discrète sans effet de tableau générique. |
| Graphiques | `--chart-1` à `--chart-5` | Bleu, cyan, vert, orange et violet déjà affectés aux variables. |
| Rayon | `--radius: 0.625rem` | Base des petits contrôles ; cartes et graphiques gardent leurs rayons spécifiques existants. |

## Conventions de composition à préserver

| Élément | Règle de rendu actuelle | Centralisation cible |
|---|---|---|
| Cadre de page | Largeur métier centrée, marges mobiles compactes, fond sombre | `PageFrame` neutre qui ne modifie ni largeur ni fond d’une page existante. |
| En-tête de section | Icône de contexte, titre fort, texte explicatif éventuel | `SectionHeader` acceptant les classes de taille existantes. |
| Carte de données | Fond `card`, bordure `border`, rayon adapté au contenu | `MeteoSurface` sans couleur arbitraire et avec variantes strictement dérivées des classes actuelles. |
| Métrique | Valeur claire, unité et libellé secondaire | `Metric` de présentation uniquement, sans formatage métier implicite. |
| États | Squelette, erreur, absence de collecte ou absence de station | Composants d’état explicites qui reçoivent le message existant sans changer le contrat. |
| Pictogrammes | `MeteoIcon` pour conditions et régimes ; icônes d’interface pour navigation | Ne pas fusionner ces deux vocabulaires, afin de préserver le langage météo. |
| Graphiques | Canvas ou Recharts selon la page, légendes et unités par variable | Gabarit extérieur seulement ; la logique de dessin reste propriétaire de chaque graphique. |

## Architecture frontend cible

La cible conserve les routes, les appels tRPC et les composants métier. Elle sépare uniquement le **cadre visuel** de la **donnée**.

| Couche | Responsabilité | Éléments interdits |
|---|---|---|
| `pages/` | Orchestrer une route, les queries, les mutations, l’état local et l’ordre de sections | Recalculer une prévision, transformer une observation en prévision ou inventer une donnée. |
| `components/weather/` | Encadrer surface, section, métrique, badge, légende et état visuel | Appeler tRPC ou posséder une règle météo. |
| `components/` métier | Graphiques, carte de station, favoris, traçabilité, delta local/officiel | Être remplacés par des composants génériques sans tests d’équivalence. |
| `lib/` | Helpers déterministes de formatage, libellés, image, échelle et mise en page | Accéder directement à une source externe. |
| `index.css` | Tokens sémantiques et variantes de surface mesurées | Une refonte globale qui change les couleurs de pages non migrées. |
| `server/routers/` | Contrats officiels, données et séparation des sources | Subir une modification pour un objectif uniquement visuel. |

## Contrat de non-régression

Toute extraction de composant devra satisfaire simultanément les conditions suivantes : mêmes données rendues, mêmes conditions de repli, mêmes libellés de provenance, mêmes interactions tactiles, même structure de route et mêmes unités. La comparaison visuelle doit être faite à 390 px, 768 px et 1280 px avec une page alimentée, un squelette et un état sans donnée.

> La reconstruction peut améliorer l’organisation des fichiers ; elle ne doit jamais changer la réponse à la question « quelle donnée est affichée, pour quel lieu, à quel instant et avec quelle provenance ? ».
