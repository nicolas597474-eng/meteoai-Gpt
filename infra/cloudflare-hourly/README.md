# Déclencheur horaire Cloudflare MeteoAI

Sauvegarde du déclencheur `meteoai-collecte-horaire`, créé le 20 octobre 2026. `worker.mjs` reprend ses octets source existants ; aucun changement de destination, de cadence ou de logique de collecte n’est introduit par cet ajout au dépôt.

Le déclencheur effectue un POST vers l’API privée du Site. Les collectes Netatmo/Open-Meteo, calculs, contrôles d’intégrité, archives et déduplication restent dans le backend principal, notamment `worker/background-collection.ts`.

## Fichiers et planification

- `wrangler.json` : configuration de contrôle désactivée, sans cron, sans endpoint HTTP public.
- `wrangler.production.json` : configuration correspondant au déploiement existant, activée, avec `7 * * * *`, chaque heure à la minute 7 en UTC (également minute 7 en heure de Paris).
- `.dev.vars.example` : noms des variables et valeurs vides ; aucune clé réelle.
- `worker.test.mjs` : simulations ; les tests ne déclenchent pas de collecte réelle.

Le compte indiqué dans la configuration de production est celui du propriétaire de l’instance existante. Cet identifiant de compte n’est pas un secret d’authentification. Vérifier compte et nom du Worker avant toute restauration pour éviter de créer un second déclencheur.

```sh
pnpm test:collector
```

Le workflow GitHub valide le code et ses tests. Il ne déploie aucun Worker et ne crée aucun nouveau cron.

## Accès nécessaires

Deux secrets chiffrés doivent être présents dans Cloudflare :

| Nom | Fonction |
| --- | --- |
| `SITES_SERVICE_TOKEN` | Accès de service au Site privé existant. Ne fournit pas d’identité utilisateur. |
| `METEOAI_COLLECTOR_KEY` | Clé dédiée, identique à celle configurée côté Site. |

Les clés Gemini, Client Secret/jetons Netatmo et clés de chiffrement Netatmo restent dans le Site ; ne pas les recopier dans le déclencheur. Les noms des paramètres du Site sont détaillés dans [la procédure de sauvegarde privée](../../docs/PRIVATE_BACKUPS.md).

Un accès existant dont la valeur est masquée ne peut pas être récupéré depuis ce dépôt. Lors d’une perte d’accès, utiliser la procédure de récupération du service concerné et mettre à jour les deux côtés d’une clé partagée. Ne pas changer ou révoquer les accès fonctionnels uniquement pour créer une sauvegarde.

## Restaurer dans Cloudflare

1. Se connecter au compte Cloudflare propriétaire et sélectionner le Worker existant `meteoai-collecte-horaire`.
2. Conserver un seul planning. Pour préparer une restauration, garder `COLLECTION_ENABLED=false` pendant la configuration ; le minuteur désactivé ne lance aucun appel.
3. Restaurer `worker.mjs`. Vérifier la destination fixe : `https://meteoai-restauree-controle.givingbay1.chatgpt.site/api/automation/hourly-collection`.
4. Configurer les deux secrets dans les réglages Cloudflare et vérifier que le Site dispose des valeurs correspondantes et de son accès privé de service. Ne pas placer les secrets dans des commentaires GitHub, journaux, fichiers suivis ou variables frontend.
5. Activer `COLLECTION_ENABLED=true` et le cron `7 * * * *` selon la configuration de production. Préserver l’absence de route HTTP publique et d’URL de prévisualisation.
6. Vérifier le prochain passage dans les journaux Cloudflare et le reçu côté Site. Les états `partial`, `busy`, refus de quota ou erreurs de fournisseur ne doivent pas être présentés comme une collecte complète. Une réponse `duplicate` confirme un créneau déjà traité ; ce n’est pas une nouvelle collecte.

Avec un environnement Wrangler déjà configuré et autorisé, utiliser explicitement `wrangler.production.json` pour la production ; `wrangler.json` désactive volontairement la collecte. L’ajout de ces fichiers ne modifie pas le Worker déployé.

## Limites

Un seul appel par passage, aucune relance automatique, délai maximal de 180 secondes et lecture bornée du reçu. Aucun rattrapage de créneaux manquants. Le déclencheur conserve les quotas et limites des fournisseurs ; aucun abonnement ou service payant n’est activé par ce dépôt.

Les informations de mise en service ne prouvent pas l’état opérationnel actuel. Consulter les journaux et les archives vérifiées du Site pour connaître le dernier résultat réel.
