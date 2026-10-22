# MeteoAI : copie restaurée le 17 octobre 2026

Cette copie provient du bundle `meteoai-recovery-bundle-current-2026-10-17.zip`, révision `0e70d91a87b0e1449d94f8adc68b31b7dbf8d724`. Elle ne remplace aucun dépôt GitHub ni aucun site publié.

## Contenu et adaptation

Le code métier de l'export est conservé. Les 28 images récupérées sont intégrées dans `client/public/manus-storage/`, avec leurs octets et leurs noms historiques. Une route locale ajoutée avant le proxy Manus sert leur vrai type MIME : 27 sont des WebP malgré leur suffixe PNG/JPG, et une est un PNG. Les images connues ne nécessitent donc plus de clé Forge. Le proxy distant reste disponible pour les autres ressources si ses identifiants sont configurés.

Le seul fichier existant adapté est `server/_core/storageProxy.ts`. Le module `localStorageAssets.ts` et son test sont ajoutés. Aucun écran ni calcul météo n'est redessiné.

## Réinstallation sur un nouvel hébergement

1. Prévoir un serveur Node compatible ESM et une base MySQL/TiDB, avec HTTPS. Le site actuel utilisant un Worker n'exécute pas directement ce serveur Node.
2. Installer les dépendances depuis `pnpm-lock.yaml` avec pnpm 10.18.0 : `pnpm install --frozen-lockfile --ignore-scripts`. Le dossier `node_modules` utilisé pour le contrôle local est une jonction vers les dépendances déjà vérifiées ; il n'est pas livré dans l'archive et doit être réinstallé sur le nouvel hébergement.
3. Importer la sauvegarde SQL dans une base neuve et dédiée, avec un compte limité à cette base. L'archive SQL contient des données utilisateur et doit rester privée. Ne jamais l'exposer dans un dossier public du site.
4. Configurer les variables privées côté serveur à partir de `.env.example` et de `server/_core/env.ts`. Ne pas recopier les valeurs factices de test. Créer de nouveaux secrets de session et de chiffrement.
5. Rétablir l'authentification réelle (`VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`). La session utilisée pour le contrôle local est temporaire et ne constitue pas une solution de connexion publique.
6. Reconfigurer Netatmo côté serveur, avec une URI de retour correspondant au nouveau domaine, puis reconnecter le compte. Les anciennes sessions Netatmo sont volontairement absentes de cet export. Ne jamais placer le Client Secret dans une variable `VITE_*`.
7. Reconfigurer les services Forge nécessaires, notamment les analyses textuelles IA et les autres services externes utilisés par la source. Ils ne sont pas validés sans leurs accès. Les 28 images locales fonctionnent indépendamment de Forge.
8. Compiler avec `pnpm build`, lancer le serveur en production et raccorder les tâches planifiées existantes après contrôle de leur authentification et de leurs horaires. Les scripts `start`/`dev` d'origine emploient la syntaxe des variables Unix ; sous PowerShell, définir les variables séparément avant de lancer Node.
9. Contrôler la connexion, Netatmo, les collectes et l'installation PWA sur le domaine HTTPS avant tout remplacement de l'application publiée.

## Base et migrations

Le contrôle initial retrouve 53 tables et 1 046 034 lignes. Les nombres de lignes des 50 tables avec export de données correspondent à l'inventaire fourni. Trois tables conservent seulement leur structure : `netatmo_oauth_tokens`, `netatmo_oauth_states` et `forecast_refresh_locks`.

Les 40 tables et 683 colonnes du schéma principal sont présentes. Aucune migration de rattrapage n'a été appliquée à cette base actuelle. Le journal Drizzle ne contient qu'une entrée, alors que le schéma est beaucoup plus avancé : ne pas lancer `db:push` ou rejouer toutes les migrations sans comparaison préalable du schéma réel. Les scripts auxiliaires de la source restent ceux de l'export ; la compilation et les tests ne garantissent pas l'exécution de chaque outil historique hors application.

Les derniers relevés des tables météo contrôlées atteignent le 14 octobre 2026. La date du ZIP ne signifie pas qu'il contient des observations pour toutes les heures jusqu'au 17 octobre.

## PWA et limites préservées

Le manifeste, les icônes d'installation et le service worker d'origine sont conservés. Ce service worker met en cache la coquille et certains fichiers statiques, mais exclut explicitement les API météo et `/manus-storage/`. La restauration ne transforme pas ce comportement en cache météo complet hors ligne. Le fonctionnement hors ligne et les notifications de mise à jour devront être validés séparément sur l'hébergement final.

Les tests locaux ne valident pas une connexion OAuth externe, Netatmo réel, les appels IA Forge, ni les collectes automatiques en production. Les deux tests Netatmo avec identifiants réels sont intentionnellement ignorés. Aucun identifiant ni jeton de production n'est inclus dans la livraison.
