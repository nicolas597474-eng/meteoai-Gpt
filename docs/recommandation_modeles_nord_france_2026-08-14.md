# Recommandation de modèles — Nord de la France

## Conclusion courte

L’ajout le plus utile n’est pas d’empiler des sorties globales. MeteoAI possède déjà AROME, ARPEGE, ICON-EU, IFS, GFS, GEM et UKMET. Pour Hondeghem et Erquinghem-Lys, les gains plausibles viennent d’abord d’un modèle régional à convection explicite pour les 0–60 heures, puis d’une prévision probabiliste d’ensemble. Les modèles supplémentaires ne doivent obtenir un poids de fusion qu’après une comparaison archivée avec des observations physiques qualifiées.

## Comparaison des candidats

| Candidat | Horizon utile | Valeur ajoutée réelle | Redondance / contrainte | Décision proposée |
|---|---|---|---|---|
| **DMI HARMONIE-AROME DINI** | 0–60 h | 2 km, horaire, CAPE, inhibition convective, visibilité, base/sommet nuageux et brouillard natifs. [Source](https://open-meteo.com/en/docs/dmi-api) | Famille HARMONIE-AROME avec initialisation IFS ; ne pas l’assimiler à une source entièrement indépendante. | **Priorité 1**, en mode candidat sans poids. |
| **ICON-D2** | 0–48 h | 2,2 km, mises à jour toutes les 3 h, conçu pour convection, rafales, brouillard et fortes pluies. Le domaine couvre le Benelux ; une requête vérifiée à Hondeghem retourne des données. [Source](https://www.dwd.de/EN/ourservices/nwp_forecast_data/nwp_forecast_data.html) | Même famille DWD que l’ICON-EU existant. | **Priorité 2**, en mode candidat sans poids. |
| **KNMI HARMONIE-AROME Europe** | 0–60 h | 5,5 km, horaire, mise à jour horaire ; couvre l’Europe centrale et septentrionale. [Source](https://open-meteo.com/en/docs/knmi-api) | Très proche du candidat DMI par famille UWC-West et initialisation IFS. | Étudier **à la place** de DMI, pas simultanément au départ. |
| **ECMWF AIFS** | 1–15 jours | Approche IA distincte du solveur IFS ; quatre cycles/jour, 6 h, jusqu’à 15 jours. [Source](https://open-meteo.com/en/docs/ecmwf-api) | 0,25° et 6 h : trop grossier pour le détail horaire local. Lors du test à Hondeghem le 14 août, la réponse AIFS était vide, malgré la disponibilité théorique documentée. | **Pilote différé** avec contrôle de disponibilité ; pas de poids initial. |
| **Ensembles IFS / AIFS / ICON-EU** | 0–15 jours | Fournissent une dispersion et des probabilités, utiles pour pluie, rafales et confiance plutôt qu’une nouvelle valeur déterministe. [Source](https://open-meteo.com/en/docs/ensemble-api) | Les membres d’un même ensemble ne sont pas des modèles indépendants. | **Priorité fonctionnelle élevée** pour l’indice d’incertitude, sans les fusionner comme modèles séparés. |

## Ce qu’il ne faut pas ajouter comme modèle indépendant

`Open-Meteo best_match` est un choix ou une combinaison de modèle locale, et non une source physique indépendante. Météo-France `seamless` combine déjà AROME et ARPEGE. Les injecter comme modèles supplémentaires dans le moteur de pondération compterait plusieurs fois des informations corrélées. AROME France HD est déjà le modèle local le plus fin de la liste ; sa variante 15 minutes doit être traitée comme une fréquence de mise à jour plus rapide, non comme un nouveau vote.

## Plan expérimental recommandé

1. Ajouter **DMI HARMONIE-AROME DINI** et **ICON-D2** au stockage de candidatures, avec un poids de fusion nul.
2. Archiver au minimum 60 jours de sorties 0–48 h et ne scorer que face à des observations physiques qualifiées, synchronisées dans le temps et le lieu.
3. Comparer séparément température, précipitation, vent, rafales, nébulosité et brouillard, par horizons 0–6 h, 6–24 h et 24–48 h. Mesurer MAE, biais, POD, FAR et CSI selon la variable.
4. N’intégrer qu’un seul modèle HARMONIE au départ, seulement s’il améliore statistiquement un indicateur défini et sans dégrader les autres régimes météo.
5. Ajouter ensuite l’écart-type et les probabilités d’ensemble à l’indice de confiance, sans transformer les membres en pseudo-modèles déterministes.

> Aucune recommandation ci-dessus ne modifie la collecte actuelle, les pondérations ou les prévisions de MeteoAI. L’intérêt réel doit être démontré par des observations archivées.
