# MeteoAI · Atmosphère

Une PWA météo React et TypeScript, conçue pour Hondeghem et les lieux que vous choisissez. Scène météo vivante, fenêtres de verre dépoli, exploration du consensus et données réelles sans clé API.

Ce projet est développé exclusivement dans **nicolas597474-eng/meteoai-Gpt**. Le dépôt **meteo-ai-app** a été consulté en lecture seule et n’a reçu aucun changement.

## Démarrer

Prérequis : Node.js 22.12+ et pnpm 10.

```sh
pnpm install
pnpm dev
```

```sh
pnpm test
pnpm build
pnpm preview
```

La sortie `dist/` est un site statique. Elle peut être hébergée sur un serveur HTTPS sans service payant obligatoire. L’aperçu local utilise `localhost` ; l’installation PWA et le service worker demandent HTTPS ou localhost. Le build génère les icônes PNG et injecte les fichiers JS/CSS dans le précache du service worker.

## Parcours

- **Ma météo** : température, min/max, ressenti, vent, rafales, pluie, humidité, nuages, pression, UV, confiance, régime et pondérations ; sélecteur Standard / Local / Ultra-local et transparence.
- **Prévisions** : graphique 24 h, température, ressenti, précipitations et vent ; détails de toutes les heures, y compris WMO, étendue thermique et contributeurs ; horizon 7 / 15 / 16 jours et détails quotidiens, éphémérides et rose des vents.
- **Classement** : scores par variable, MAE, RMSE, biais, POD/FAR/CSI, tendance, poids blended et grille des douze régimes.
- **AI Lab** : confiance, stabilité, analyse explicable locale, divergences, couverture réelle des sources, formules, données brutes et replay animé des étapes.
- **Historique** : captures prévues/observées sur 7 / 14 / 30 jours, journal, export JSON, saisie d’observations manuelles et archive de réanalyse séparée.
- **Stations** : découverte OpenSenseMap et SYNOP Météo-France, rayon 5 / 10 / 20 km, vue spatiale, distance, altitude, température, horodatage et qualité technique.
- Jusqu’à cinq favoris, recherche de communes et géolocalisation uniquement sur demande. Les échecs de source et l’absence de station sont affichés explicitement.

## Données et moteur

Les prévisions proviennent d’[Open-Meteo](https://open-meteo.com/en/docs), via les identifiants AROME, ARPEGE, ICON, ECMWF IFS, GFS, GEM, UKMET et Best Match. Aucune donnée météo n’est fabriquée. La couverture est celle de chaque réponse : aucune extrapolation artificielle des modèles courts jusqu’à J16.

Conformément à l’évolution du dépôt de référence, **Best Match reste une référence/solution de secours**, et ne double pas les voix des sept modèles physiques. Les modèles manquants et valeurs nulles sont exclus de chaque calcul. Le code météo fait l’objet d’un vote pondéré et la direction d’une moyenne circulaire.

Les poids par variable utilisent l’inverse de la MAE, normalisé sur les modèles présents, après au moins **30 comparaisons sur 30 jours**, avec preuve datant de 7 jours maximum. Les comparaisons sont séparées par lieu, variable et bande d’échéance. Un plafond de 35 % est appliqué, relâché au minimum mathématique si moins de trois modèles sont présents. Sans preuves suffisantes, le consensus utilise des poids égaux et reste explicitement **non calibré**.

Les scores sont calculés sur des prévisions sauvegardées au moins une heure avant une observation. L’archive de captures n’est pas réécrite après actualisation. Les observations sont physiques ou manuellement déclarées, ces dernières étant signalées non certifiées. La réanalyse Open-Meteo reste distincte de la vérité terrain.

L’ajustement local utilise des stations plausibles et récentes, quatre bandes de distance et des poids combinant distance, qualité technique et fraîcheur. Gradient d’altitude : −0,65 °C / 100 m, uniquement lorsque les deux altitudes sont connues. Correction bornée à ±3 °C ; le mode Local utilise au plus 60 minutes d’ancienneté, Ultra-local 30 minutes. Les corrections urbaines, de vallée et côtières ne sont pas inventées faute de calibration. Les observations locales ajustent l’état actuel ; les prévisions futures restent celles des modèles.

Les indices de stabilité et de confiance sont des **indicateurs de consensus explicables**, pas des probabilités statistiquement calibrées. La synthèse du matin, de l’après-midi et de la nuit est produite localement par règles, sans appel à un LLM payant ni clé obligatoire.

## Périmètre de cette version autonome

Le dépôt de référence contient un serveur tRPC/Drizzle, des tâches planifiées et des intégrations authentifiées. Cette PWA est une **réimplémentation autonome du périmètre décrit**, pas un portage intégral de ce serveur. Son historique commence sur chaque appareil, reste dans son navigateur et ne collecte rien lorsque l’application est fermée. Elle ne reprend pas les données historiques privées du serveur, Netatmo OAuth, les connexions de compte, ni les 20 régimes présents dans la version récente du serveur ; elle propose les 12 régimes demandés dans le brief.

La qualification statistique du moteur serveur d’origine (régularisation d’incertitude, suivi de runs, fenêtres historiques de 120 jours et calibration physique) n’est pas identique à celle du moteur navigateur. Voir [l’audit de référence](docs/REFERENCE.md). Cette distinction est volontairement documentée pour ne pas annoncer une conservation intégrale du backend qui n’a pas eu lieu.

## PWA et accessibilité

- Manifeste standalone, icônes 192 / 512 et maskable ; lancement natif sur mobile.
- Précache de la coquille et du bundle dès l’installation du worker ; cache des API en stale-while-revalidate et rafraîchissement réseau à la demande.
- Conservation de l’horodatage original des réponses en cache, bannière hors ligne et avertissement pour les données anciennes.
- Notification d’une version disponible ; activation à la demande de l’utilisateur.
- Fenêtres modales natives avec focus contenu et fermeture Échap, navigation clavier, noms accessibles, unités françaises et fuseau Europe/Paris.
- Animations réduites si le système le demande ; effets atmosphériques interrompus quand la page est masquée.

## Organisation

```text
src/
  components/  # Scène, fenêtres, cartes, graphiques SVG
  engine/      # Fusion, régimes, scoring, spatialisation et tests
  hooks/       # Collecte, cache, installation et profondeur
  lib/         # APIs, formats français, stockage et captures
  pages/       # Classement, AI Lab, Historique, Stations
public/        # Service worker, manifeste et icônes
scripts/       # Génération déterministe des icônes et outils de livraison
```

## Vérification

29 tests couvrent notamment la fusion, l’absence de double comptage, les données manquantes, la direction circulaire, les erreurs et événements pluvieux, les seuils de calibration, les changements d’heure, l’altitude, les stations anciennes/futures, les captures antérieures et le cache hors ligne du worker. TypeScript strict et build de production sont contrôlés séparément.

L’interface a été parcourue dans le navigateur intégré aux formats mobile et ordinateur. Les captures d’écran sont indisponibles dans cet environnement : la vérification par image et le dialogue natif d’installation sur un appareil réel restent à effectuer.

Données : Open-Meteo et ses fournisseurs, OpenSenseMap, SYNOP Météo-France via OpenDataSoft. Respecter leurs conditions d’utilisation et limites de requêtes, notamment pour un usage commercial.
