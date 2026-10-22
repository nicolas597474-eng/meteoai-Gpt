# Sauvegarde privée des clés et historiques MeteoAI

Le dépôt GitHub est public. Il sauvegarde le code, les schémas et le déclencheur Cloudflare, sans clé réelle, session utilisateur ou export d’historique. Un fichier `.env` ignoré n’est pas une sauvegarde distante. Les secrets de GitHub Actions servent aux exécutions de workflows ; ils ne sont pas une archive permettant de relire ultérieurement une clé perdue.

## Inventaire des accès

| Emplacement | Paramètres |
| --- | --- |
| Site MeteoAI | `GEMINI_API_KEY`, `GEMINI_ENABLED`, `METEOAI_BACKGROUND_ENABLED`, `METEOAI_BACKGROUND_OWNER`, `METEOAI_COLLECTOR_KEY`, `NETATMO_ENCRYPTION_KEY` |
| Coffre Netatmo dans R2 | Client ID/Client Secret et jetons OAuth, chiffrés par le Site. |
| Déclencheur Cloudflare | `SITES_SERVICE_TOKEN`, `METEOAI_COLLECTOR_KEY` |

Les noms peuvent être versionnés ; les valeurs restent dans les services ou dans un gestionnaire de mots de passe privé. `NETATMO_ENCRYPTION_KEY` est indispensable pour déchiffrer les coffres existants. Une copie R2 sans cette clé ne garantit pas la restauration de Netatmo. La clé dédiée au collecteur doit correspondre côté Site et côté déclencheur.

Lors du contrôle du 22 octobre 2026, l’outil Sites renvoie les noms des secrets mais masque leurs valeurs. Aucun export de leurs valeurs n’a été réalisé. Un secret masqué ne se récupère pas en lisant la configuration publique. Ne pas révoquer un accès fonctionnel simplement pour essayer de l’exporter.

## Ce qu’exige une sauvegarde complète

1. **D1** : exporter toutes les tables et leur schéma via les fonctions d’administration de l’hébergement. Inclure les index d’archives, favoris, observations personnelles, statuts de collecte et preuves d’apprentissage. Ne pas se limiter aux données affichées par une page.
2. **R2** : exporter les objets référencés par D1 avec leurs clés exactes et leurs octets, notamment les captures, mesures, références physiques, traces de fusion, preuves signées et coffres Netatmo chiffrés.
3. **Secrets** : conserver les valeurs encore disponibles dans un gestionnaire privé et documenter leur emplacement. Préserver les clés de chiffrement nécessaires aux fichiers sauvegardés. Une connexion OAuth peut devoir être renouvelée sur un nouvel hébergement.
4. **Cohérence** : noter l’heure UTC de début et de fin des exports. Pendant que les collectes continuent, deux exports successifs ne constituent pas forcément un instantané atomique. Au rétablissement, vérifier références d’objets, empreintes, schémas et dates avant de déclarer la sauvegarde complète.
5. **Chiffrement** : chiffrer l’archive avec un outil de sauvegarde ou un gestionnaire fiable avant de la déposer dans un stockage privé, avec la clé de récupération conservée séparément. Tester la lecture sur une copie, sans réécrire les archives de production.

Les lectures du visualiseur D1 sont paginées et bornées ; leurs résultats ne suffisent pas à garantir un export exhaustif. Les routes de rapport et `/api/control/history` sont aussi des vues limitées, pas des sauvegardes. L’outil actuellement disponible ne fournit pas un export complet des objets R2. Aucun export intégral D1/R2 n’a été créé par cet ajout au dépôt.

## Sauvegarde locale de restauration existante

Le dossier local `private-import/` de la copie de travail d’origine contient dix lots de restauration historiques. Ces lots sont un échantillon ancien et partiel, pas une copie de toutes les archives récentes du Site. Ils restent hors Git et ne doivent pas être présentés comme une sauvegarde actuelle complète.

## Protection dans Git

`.gitignore` exclut les fichiers d’environnement privés, `.dev.vars`, `.wrangler/`, `private-import/`, `preview-state/`, `backups/`, `private-backups/` et les fichiers `.enc`/`.dpapi`. Les seuls modèles autorisés contiennent des valeurs factices ou vides. Git ignore uniquement les fichiers non suivis : ne jamais forcer l’ajout d’une sauvegarde ou d’une clé, et vérifier les fichiers préparés avant chaque publication.

L’application en ligne continue d’utiliser sa base, ses fichiers et ses secrets actuels. Copier le dépôt n’en transfère pas automatiquement la propriété ou les données.
