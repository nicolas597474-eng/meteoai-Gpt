# Recherche — Modèles météo candidats pour le nord de la France

## Modèles actuellement distincts

MeteoAI collecte déjà huit sorties quotidiennes et horaires : AROME France HD, ARPEGE Europe, ICON-EU, IFS HRES, GFS, GEM, UKMET et Open-Meteo `best_match`. Les deux premiers couvrent déjà la maille locale française ; ICON-EU, IFS, GFS, GEM et UKMET apportent les principaux systèmes globaux ou continentaux.

## Sources consultées et constats vérifiables

| Candidat | Source et disponibilité | Valeur potentielle | Limite à respecter |
|---|---|---|---|
| KNMI HARMONIE-AROME Europe | 5,5 km, horaire, 2,5 jours, mise à jour horaire ; couverture Europe centrale et septentrionale. [Open-Meteo KNMI](https://open-meteo.com/en/docs/knmi-api) | Configuration régionale à convection explicite, utile au voisinage Benelux / Flandre. | Initialisé par IFS ; ne doit pas être traité comme totalement indépendant d’ECMWF. |
| DMI HARMONIE-AROME DINI | 2 km, horaire, 2,5 jours, mise à jour toutes les 3 h ; Europe centrale et septentrionale. [Open-Meteo DMI](https://open-meteo.com/en/docs/dmi-api) | Candidat prioritaire pour 0–48 h : fournit notamment CAPE, inhibition convective, visibilité, base/sommet des nuages et brouillard. | Même famille UWC-West / IFS que KNMI ; évaluer les deux avant d’en retenir un seul. |
| ICON-D2 / ICON-D2-EPS | 2,2 km, 48 h, sorties toutes les 3 h ; couvre Benelux et pays voisins. [DWD](https://www.dwd.de/EN/ourservices/nwp_forecast_data/nwp_forecast_data.html) | Très utile pour convection, rafales, brouillard et fortes pluies à courte échéance. | Même famille DWD que l’ICON-EU déjà présent ; l’ajout doit être justifié par un gain mesuré à 0–48 h. |
| ECMWF AIFS | Modèle IA global, 0,25°, pas de 6 h, 15 jours, quatre cycles par jour. [Open-Meteo ECMWF](https://open-meteo.com/en/docs/ecmwf-api) ; [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data) | Apporte une approche IA distincte du solveur physique IFS, particulièrement intéressante à moyen terme. | Pas de 6 h et résolution globale : ne pas l’utiliser seul pour le détail horaire local. |
| Ensembles IFS, AIFS, ICON, GFS et GEM | Membres individuels, moyennes et dispersions disponibles jusqu’à 36 jours selon le système. [Open-Meteo Ensemble API](https://open-meteo.com/en/docs/ensemble-api) | La priorité scientifique est de dériver une probabilité et une incertitude, pas d’ajouter une nouvelle « température moyenne ». | Les membres d’ensemble complètent un modèle déterministe ; ils ne doivent pas être comptés comme autant de modèles indépendants. |

## Sources complémentaires

Open-Meteo précise que ses données sont répliquées de manière éventuellement cohérente entre serveurs et recommande d’attendre environ dix minutes après une mise à jour pour viser la version la plus récente. [Model updates](https://open-meteo.com/en/docs/model-updates)

Météo-France AROME France HD et ARPEGE Europe sont déjà dans MeteoAI ; ils ne sont donc pas des candidats additionnels. La documentation confirme le rôle d’AROME France HD à 1,5 km sur les deux premiers jours et d’ARPEGE Europe à environ 11 km sur quatre jours. [Open-Meteo Météo-France](https://open-meteo.com/en/docs/meteofrance-api)

## Vérification d’API à Hondeghem — 14 août 2026

Une requête directe à `50.7567, 2.5204` a fourni des séries horaires non nulles pour `dmi_seamless` et `dwd_icon_d2`. La même réponse contenait `ecmwf_aifs025`, mais toutes ses valeurs étaient nulles à cet instant : ce modèle ne peut donc pas être archivé comme prévision exploitable avant un contrôle ultérieur concluant.

L’endpoint d’ensemble a répondu avec une moyenne et 50 membres pour `ecmwf_ifs025_ensemble`, ce qui permet de dériver une dispersion mesurée sans compter les membres comme 50 modèles indépendants. `ecmwf_aifs025_ensemble` restera en attente tant qu’une série utilisable n’est pas confirmée.

La réponse avec `dwd_icon_seamless` a reproduit, sur la fenêtre inspectée, les sorties de `dwd_icon_d2`. L’intégration ne doit donc pas compter « ICON global » et ICON-D2 comme deux voix distinctes avant d’avoir établi une différence opérationnelle vérifiable.

Sources de vérification :

- https://api.open-meteo.com/v1/forecast?latitude=50.7567%26longitude=2.5204%26hourly=temperature_2m,precipitation,wind_speed_10m%26forecast_days=2%26timezone=Europe%2FParis%26models=dmi_seamless,dwd_icon_d2,ecmwf_aifs025,dwd_icon_seamless
- https://ensemble-api.open-meteo.com/v1/ensemble?latitude=50.7567%26longitude=2.5204%26hourly=temperature_2m,precipitation,wind_speed_10m%26forecast_days=2%26timezone=Europe%2FParis%26models=ecmwf_ifs025_ensemble,ecmwf_aifs025_ensemble
