# MeteoAI Assistant local

Le bloc est intégré à la page Fiabilité, avec import différé du panneau. Il ne
déclenche aucune lecture météo à son ouverture. Le panneau lit seulement le statut
du quota du Site, sans génération Gemini. Les lectures météo commencent après une
question ; les explications documentées ne nécessitent pas de fournisseur.

## Architecture et sources

- `client/src/assistant/router.ts` reconnaît les intentions et dates en français.
- `memory.ts` conserve au plus 24 messages sur l'appareil, pendant 24 heures sans
  activité ; l'historique complet n'est jamais envoyé à Gemini.
- `data.ts` passe par les lectures tRPC, caches et pont Netatmo déjà présents.
- `answers.ts` décrit leurs résultats ; les différences et étendues sont des
  statistiques descriptives. La formule de note est celle du composant existant.
- `activities.ts` contient uniquement des critères de confort explicites : ce
  n'est ni une nouvelle prévision ni une validation de sécurité.
- `knowledge.ts` décrit le fonctionnement réellement raccordé et des liens internes.

Aucune dépendance ajoutée. Le module LLM historique du projet n'est pas utilisé.
L'extension facultative Gemini 3.6 Flash est décrite dans ASSISTANT_GEMINI.md :
clé exclusivement serveur, plafond quotidien et suspension automatique sur quota.
Sans configuration ou pendant une suspension, les réponses locales restent actives.

## Mémoire et transparence

« Et demain ? » conserve le lieu et le paramètre. « Et à Hondeghem ? » conserve la
date. Le lieu de conversation reste affiché ; il ne modifie pas le lieu actif de
l'application. Une nouvelle conversation repart du lieu actif. Les lieux ambigus
demandent une sélection. Le stockage relu est validé ; les liens et objets de
réponse ne sont pas restaurés. Les anciens messages sont signalés comme historique.
Le bouton Nouvelle conversation supprime cet historique, même pendant une lecture.
Une réponse ancienne terminée ensuite ne peut pas réapparaître.

Chaque réponse chiffrée précise sa nature et les sources disponibles. Les horodatages
des sources sont conservés ; l'heure de consultation n'est pas présentée comme une
nouvelle réception. Une réponse marquée périmée par le transport est refusée.
La disponibilité ancienne d'un cycle encore valide est distincte d'un cache périmé.
Si le cache lance un rafraîchissement, le lecteur attend son événement de fin
(dix secondes au maximum) avant une seule relecture. Aucun polling ni collecte
fournisseur forcée n'est ajouté. Hors ligne, il conserve le refus explicite.

## Limites explicites

- Dates et heures : Europe/Paris ; maintenant ou journée entière. Les demandes de
  période plus fine et de plusieurs journées donnent une clarification.
- Prévision quotidienne : aujourd'hui à J+14 selon données effectivement reçues.
- Comparaisons et activités : couverture horaire réelle seulement, sans prolonger
  artificiellement un modèle court. Modèles manquants explicitement indiqués.
- Stations : températures admissibles récentes dans 50 km ; pas de relevé futur.
- Fiabilité : sélection de période/horizon de la page ; métriques par modèle et
  variable, seuils inchangés. Une proportion de modèles n'est pas une probabilité.
- Activités : deux échéances horaires successives complètes, critères affichés,
  pluie/vent/rafales/température et code météo. La vigilance officielle n'est pas
  vérifiée. Débits, courants, eau, état de mer et restrictions ne sont pas connus.
- Moteur à règles : une formulation non reconnue demande une précision. Il ne
  prétend pas fournir la compréhension générale d'un modèle de langue.

Une lecture est bornée à 25 secondes côté conversation, avec protection contre les
réponses tardives et doubles envois. Les requêtes sous-jacentes conservent leurs
délais et déduplications existants. Les tests utilisent des doubles locaux.
