# MeteoAI

Code de l’application MeteoAI actuelle : Dashboard, Prévisions, Fiabilité avec assistant conversationnel, Stations et AI Lab.

Cette version remplace le contenu de l’ancienne PWA autonome. Elle provient de la source de l’application publiée, révision `89107af0a168ed3415654c294264c04d970f2fc4` du 22 octobre 2026, avec la correction du 503 de l’archivage quotidien. Le moteur météorologique est conservé.

Application : [MeteoAI](https://meteoai-restauree-controle.givingbay1.chatgpt.site). Son accès reste géré par le Site ; rendre le code disponible sur GitHub ne rend pas les données privées publiques.

## Architecture actuelle

- `client/` : interface React, TypeScript, PWA, cache de l’appareil et assistant local.
- `worker/` : backend Cloudflare Worker, routes privées, collecte, archivage, diagnostics, Netatmo et extension Gemini facultative.
- `server/` et `shared/` : services et calculs météo réutilisés par l’application.
- `drizzle/` : migrations SQLite/D1 de la version Sites ; `db/schema.ts` en décrit le schéma.
- `client/public/` : images, icônes, textures, manifeste et service worker. Conserver les crédits des ressources.
- `legacy-mysql/` : migrations historiques MySQL, conservées comme référence ; ne pas les appliquer à D1.
- `docs/`, `notes/`, `references/` : documentation technique et audits datés. Les anciens documents décrivent parfois une étape antérieure ; ce README décrit le démarrage actuel.

Les prévisions, observations physiques, traces de calcul et scores historiques ont des provenances distinctes. Une donnée absente reste absente. Les historiques et scores ne sont pas recréés artificiellement après un clonage.

## Démarrer en local

Prérequis : **Node.js 24** et **pnpm 10.18.0**.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Ouvrir l’adresse affichée : `http://127.0.0.1:33076`. `pnpm start` lance le même aperçu local après compilation. La compilation produit `dist/client/` et `dist/server/index.js`.

L’aperçu utilise SQLite et un stockage de fichiers dans `preview-state/`, et une identité de contrôle réservée à la boucle locale. **Ce serveur d’aperçu n’est pas un serveur de production** et ne doit pas être exposé sur Internet. Une nouvelle installation démarre avec une base vide, sans sauvegarde privée obligatoire. Les imports locaux éventuels restent dans `private-import/`, exclu de Git.

Les prévisions publiques disponibles peuvent être interrogées sans clé Open-Meteo. Les quotas et indisponibilités du fournisseur restent applicables. Netatmo et Gemini demandent une configuration serveur supplémentaire ; leur absence ne doit pas être remplacée par des données inventées. Le serveur d’aperçu ne charge pas automatiquement les secrets de production.

## Vérification

```sh
pnpm check
pnpm test
pnpm build
pnpm test:worker
```

Les tests du Worker nécessitent le build préalable et utilisent des bases et services simulés. Les tests Gemini n’appellent pas le fournisseur réel. Le workflow GitHub utilise un runner Ubuntu standard et ne déploie pas automatiquement l’application.

## Hébergement et données privées

La version en ligne fonctionne sur **Sites avec un Worker Cloudflare, une base D1 (`DB`) et un stockage R2 (`BUCKET`)**. Le manifeste `.openai/hosting.json` identifie ce Site existant. Ce dépôt contient du code et des migrations de structure, pas une copie de sa base de données.

GitHub Pages seul ne fournit pas les routes serveur, D1, R2 ou l’authentification nécessaires. Publier ce dépôt ne déplace pas l’hébergement actuel, ne reconnecte pas automatiquement Netatmo et ne transfère pas le collecteur horaire Cloudflare existant. Les en-têtes d’identité `oai-authenticated-user-*` doivent être fournis par l’hébergement de confiance ; ils ne constituent pas une authentification autonome sur un nouveau serveur.

Ne jamais publier de clé Gemini, Client Secret Netatmo, jeton OAuth, clé de chiffrement, accès de collecte ou export utilisateur. Les secrets restent configurés côté serveur. `.env.example` et `.env.test` contiennent des exemples et valeurs factices de l’architecture historique, jamais des accès de production.

Gemini est facultatif, avec des plafonds et suspensions dans `worker/assistant-gemini.ts`. Une limite de requêtes ne garantit pas à elle seule la gratuité d’un projet Google devenu payant. Aucun abonnement, facturation ou nouveau service n’est activé par ce dépôt. Voir [Assistant local](docs/ASSISTANT_LOCAL.md), [Extension Gemini](docs/ASSISTANT_GEMINI.md) et [Connexion Netatmo](docs/connexion-netatmo-site.md).

## Conservation de l’ancienne version

Le remplacement est un nouveau commit : l’historique Git reste disponible. L’ancienne branche `feat/atmosphere-pwa` est conservée pour permettre un retour ou une comparaison. L’ancienne application n’est pas combinée au nouveau moteur.
