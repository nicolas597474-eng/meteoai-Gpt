# Préférence d’affichage de la provenance météo

## Résumé

MeteoAI affiche par défaut, sous chaque valeur météo, la source et la
fraîcheur **réellement reçues** (par exemple
`Open-Meteo · 09:00 · il y a 11 min`).

Un réglage du bloc **Paramètres Application** de l’AI Lab permet de masquer
ces indications sur toutes les pages météo. Ce n’est **qu’un masque
d’affichage** : aucune donnée, source, horodatage ou trace n’est modifié,
côté client comme côté serveur.

## Réglage

- Emplacement : page **AI Lab** → bloc « Paramètres Application » → carte
  « Provenance des données météo ».
- Stockage : `localStorage`, clé `meteoai_provenance_display`
  (`shown` par défaut, `hidden` pour masquer).
- Portée : immédiate sur la page en cours, et synchronisée entre les onglets
  via l’événement `storage`.

## Implémentation

| Fichier                                                    | Rôle                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `client/src/lib/provenanceDisplay.ts`                      | Lecture / écriture / normalisation de la préférence (sans React).     |
| `client/src/contexts/ProvenanceDisplayContext.tsx`         | Provider + hook `useProvenanceDisplay()` partagé par toutes les pages. |
| `client/src/App.tsx`                                       | Montage du `ProvenanceDisplayProvider`.                              |
| `client/src/pages/WeatherAILab.tsx`                        | Carte de réglage dans « Paramètres Application ».                     |

Le hook renvoie `showProvenance: true` lorsqu’aucun provider n’est monté
(tests unitaires, rendu isolé d’un composant) : le comportement historique
est donc conservé.

## Zones masquées quand le réglage est activé

- **Dashboard** : mentions de provenance sous la température, l’état du
  ciel, le ressenti, la direction du vent, les nuages, le vent, les rafales,
  l’humidité et les précipitations ; blocs « échéance / source / calcul »
  de la pression, des UV et de la visibilité ; lignes de source et de
  fraîcheur du régime dominant ; infobulles de provenance (`title`).
- **Prévisions** (`ForecastByDaySection`) : libellés de provenance par
  échéance et par champ, mention de repli OpenWeatherMap, pastilles
  « Source » et « Calcul », bloc « Provenance de la fusion quotidienne » et
  encart dépliable « Provenance et disponibilité des champs ».
- **Graphe horaire** (`HourlyChart`) : mention « Point actuel : mesure des
  stations physiques Netatmo ».
- **Horodatages de calcul** (`OfficialForecastCalculationTimes`).

## Zones volontairement conservées

Ces éléments décrivent la **nature** de la valeur et non sa provenance ; les
masquer ferait croire à une observation ce qui est une prévision (ou
l’inverse) :

- les badges **Mesuré / Prévu** ;
- la mention « Tendance quotidienne · pas une observation instantanée » ;
- les notes de lecture et limites (par exemple « Cumul station non
  comparable », « Visibilité météo, pas spécifique aux nuages ») ;
- l’AI Lab lui-même, dont l’objet est la traçabilité des sources.
