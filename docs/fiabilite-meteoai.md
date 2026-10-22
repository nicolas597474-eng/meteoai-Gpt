# Notes historiques MeteoAI

Les trois cartes de Fiabilité concernent les prévisions fusionnées MeteoAI,
comparées aux observations physiques vérifiées du même lieu. Elles n'utilisent
pas les moyennes d'erreur des modèles fournisseurs.

- Horaire : une température prédite par échéance, comparée à la référence
  physique horaire existante. La dernière émission archivée avant le début de
  l'heure est retenue, indépendamment de son erreur.
- Quotidienne : températures minimale et maximale, prédites et archivées avant
  le début de la journée locale, comparées à l'agrégat physique existant. Sa
  couverture minimale de 18 heures est conservée.
- Chaque note vaut `max(0, min(10, 10 - 2 × MAE en °C))`, sur toutes ses paires
  disponibles, sans fenêtre glissante ni filtre d'échéance du graphique.
- Globale : moyenne à parts égales des composantes disponibles. Si une seule
  existe, la carte indique « globale partielle ». Une absence n'est jamais zéro.
- Dès une paire, une note provisoire peut apparaître. Une composante est dite
  consolidée à 30 comparaisons et 7 dates distinctes. Cela ne constitue ni une
  probabilité météorologique ni une garantie de performance future.

Les sorties sont enregistrées côté serveur pendant le calcul horaire ou
quotidien existant (`worker/weather.ts`), sans changer ses résultats ni faire
de requête fournisseur supplémentaire. Elles portent leur disponibilité réelle
d'archivage. La réception d'un cache ne devient pas une nouvelle émission.

Le traitement de collecte existant termine progressivement les journées closes
à partir des références physiques originales. Il tourne après les échecs pour
éviter qu'une journée défectueuse bloque les suivantes. Les comparaisons sont
signées et conservées dans les services D1/R2 existants. Aucun service payant ni
appel IA n'est ajouté.

Le lecteur agrège tout l'historique signé, indépendamment du graphique. Son
cache dure cinq minutes, expire au changement de jour et est invalidé après les
écritures. Il ne collecte ni n'écrit à la consultation. Un fichier corrompu,
une lecture interrompue ou le budget opérationnel de 8 Mo de fichiers lus
interdisent de présenter la lecture comme complète ; les notes sont suspendues.
Le nombre de comparaisons et de jours reste distinct pour chaque composante.

Les anciens diagnostics navigateur ne sont pas promus en prévisions serveur.
Aucune sortie passée n'est reconstruite ou antidatée. Les comparaisons commencent
donc avec les nouvelles émissions réellement archivées et leurs observations.
Les notes portent sur les températures ; pluie, vent et autres unités ne sont
pas additionnés à des degrés. Les qualifications servant à l'apprentissage des
modèles et au moteur météorologique sont inchangées.
