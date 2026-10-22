# Extension Gemini 3.6 Flash

Le moteur météo, les poids, la fusion, les historiques et les collecteurs ne sont
pas modifiés. Aucune dépendance ajoutée. Le module LLM historique n'est pas utilisé.
`client/src/assistant/gemini.ts` complète uniquement les questions avancées après
la réponse locale. Les faits et leurs sources restent visibles séparément de
l'interprétation IA. Les questions simples et guides usuels restent locaux.

## Configuration et sécurité

Secrets de production Sites : `GEMINI_API_KEY`, activation `GEMINI_ENABLED=true`.
Sans configuration, le fonctionnement reste local. Ne jamais placer la clé dans
une variable VITE, le manifeste, le code, une commande ou les journaux. Le fichier
local temporaire `.env.gemini.local` est ignoré par Git et ne fait pas partie du
paquet publié. Transférer la clé dans le secret de production, puis vider ce fichier.

`worker/assistant-gemini.ts` expose `/api/assistant/gemini` : GET statut, POST
analyse. Les deux exigent une identité Sites ; le POST exige aussi une origine
identique et un JSON borné. Aucune génération à l'ouverture d'une page ou du panneau.
Le panneau lit seulement le compteur du Site. Aucun outil de mutation n'est exposé.

Le modèle est fixé côté serveur à `gemini-3.6-flash`. Aucun autre modèle, fournisseur,
outil Search/Maps, interpréteur ou accès URL n'est proposé. Les secrets ne sont pas
renvoyés dans les réponses ni les erreurs. Une réponse indiquant un autre modèle
suspend le fournisseur ; aucune redirection de modèle n'est acceptée silencieusement.

## Quotas

Quotas constatés dans « Projet meteo Ai » le 21 octobre 2026 : **5 RPM, 250 000
tokens d'entrée/minute, 20 RPD**. Les chiffres 15 RPM/1 500 RPD ne sont pas ceux du
tableau de ce projet pour Gemini 3.6 Flash. Les limites peuvent changer.

- Plafond serveur : 20 tentatives/jour au total, 4/minute globales, 3/minute par
  utilisateur. Les échecs comptent aussi ; aucun remboursement spéculatif ni retry
  automatique. Les autres usages du projet peuvent consommer le quota Google.
- Compteur et bail dans une petite table D1 dédiée, créée de façon idempotente au
  premier accès configuré. Réservation atomique par révision : plusieurs instances
  et onglets partagent le plafond. Une panne du compteur interdit l'appel Google.
- Remise à zéro au changement de date `America/Los_Angeles`, avec les changements
  d'heure. Le panneau affiche cette échéance en heure de Paris.
- 429 : suspension immédiate. Une erreur clairement minute attend au moins une
  minute ou le délai demandé ; une erreur quotidienne ou ambiguë attend la date
  Pacifique suivante. Aucun appel de sondage Gemini n'est lancé pendant la pause.
- Après expiration, le panneau peut relire le statut. Une nouvelle question avancée
  est nécessaire pour reprendre une génération : pas de consommation automatique.
- Un seul appel simultané ; cache de la dernière explication consultable quinze
  minutes pour une empreinte identique (question, faits, sources, utilisateur).
  Le cache conserve l'empreinte et le texte IA, pas les questions ni les faits.
- Corps borné : 600 caractères de question, 7 000 de faits. Génération : 1 024
  tokens au maximum, délai fournisseur 12 secondes. JSON validé, réponse tronquée
  écartée, liens et nouveaux nombres absents des faits refusés. Le garde numérique
  n'est pas une preuve d'exactitude sémantique ; les faits locaux restent séparés.

## Coût et confidentialité

L'application n'active ni Cloud Billing ni une offre payante. Le projet doit rester
au niveau sans frais. Un compteur ne rend pas gratuite une clé ultérieurement
associée à un projet payant : l'API de génération ne fournit pas de verrou
« gratuit uniquement ». Vérifier AI Studio après tout changement de compte/projet.

Les conditions Google imposent les Paid Services lorsqu'un client API est mis à
disposition d'utilisateurs dans l'EEE, au Royaume-Uni ou en Suisse. L'existence d'un
quota gratuit ne lève pas cette condition ; cette limite a été signalée avant la
demande explicite de poursuivre sans activer de facturation. Le quota technique ne
constitue pas une garantie d'éligibilité contractuelle.

Seules la question en cours et les données nécessaires partent vers Google : ni
historique complet, identité de connexion, coordonnées précises, jetons Netatmo,
ni clé. Ne pas saisir d'informations confidentielles. Le traitement Google dépend
du niveau de service et de la région ; les conditions prévoient un régime propre
à l'EEE, la Suisse et le Royaume-Uni. L'historique reste local, avec une étiquette
IA conservée dans les anciens messages. Les tests ne consomment aucun quota réel.

Sources : https://ai.google.dev/gemini-api/docs/rate-limits ;
https://ai.google.dev/gemini-api/docs/pricing ; https://ai.google.dev/gemini-api/terms.
