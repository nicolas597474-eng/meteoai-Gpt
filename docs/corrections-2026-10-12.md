# MeteoAI — bilan des corrections de performance et de complétude

**Pour Nicolas — 12 octobre 2026**  
**Référence de départ :** `5d339897`  
**Objectif :** afficher les données utiles plus tôt, fiabiliser les collectes et expliquer les valeurs réellement indisponibles.

> Les correctifs ci-dessous sont implémentés dans le code et vérifiés dans l’aperçu et la base accessibles. Cela ne constitue pas, à lui seul, une preuve de déploiement sur le domaine public ni de succès des prochains cycles planifiés.

## 1. Résultat concret

- Le Dashboard peut afficher les conditions présentes sans attendre tout l’horizon multi-modèles ni les diagnostics des stations.
- L’horizon journalier est indépendant du chargement horaire ; une panne de l’un ne bloque pas l’autre.
- Une réponse météo courte a un budget serveur de **7 secondes**. C’est un budget de réponse de l’API, **pas une garantie que la page complète sera prête en 7 secondes** : téléchargement du code, réseau mobile et rendu s’ajoutent.
- Les modèles démarrent en parallèle de la lecture d’archive. Une archive DB lente ne consomme donc plus tout leur budget.
- Une prévision archivée qualifiée reste affichée, explicitement marquée, si un rafraîchissement ne rapporte rien.
- Les résultats journaliers arrivant après le premier délai d’affichage sont conservés pour les lectures suivantes, au lieu d’être perdus.
- Les ressources de l’interface ne consomment plus le quota API : le contrôle navigateur a effectivement révélé des imports de pages/graphiques défaillants avant ce correctif.
- Les diagnostics météo détaillés sont transférés avec **gzip sans perte**, sans supprimer les valeurs ni les preuves de la page Prévisions.
- Les sources incomplètes ou en erreur ne sont plus systématiquement présentées comme une absence métier ou des zéros.

## 2. Corrections réalisées, point par point

| Lot | Problème | Correction appliquée | Garantie / limite |
|---|---|---|---|
| Base | Tables citoyennes prévues mais absentes | Réparation additive ciblée de `0058`–`0061`, vérification des colonnes et index, réexécution idempotente | Aucune ligne historique supprimée ; le journal ancien n’a pas été artificiellement avancé |
| Base | Quatre colonnes quotidiennes absentes, découvertes au contrôle runtime | Ajout contrôlé des champs de `0050_prevision-vs-observation` | Les anciennes lignes conservent leurs valeurs NULL ; aucune disponibilité historique n’est inventée |
| Base | Évaluations citoyennes limitées à l’état courant | Migration additive `0062_citizen_evaluation_events` et archivage événementiel | Les événements antérieurs manquants ne sont pas fabriqués |
| Collectes | Verrous insuffisamment atomiques et références proches pouvant se mélanger | Leases persistants, acquisition atomique, propriétaire/version du verrou et clé de cycle | Tests comportementaux ; un prochain cycle réel doit confirmer l’exploitation en production |
| Collectes | Traces physiques non atomiques et échecs de stockage silencieux | Persistance atomique, résultat explicite et remontée d’échec de stockage | On ne confond plus absence de trace et succès de collecte |
| Collectes | Scoring quotidien pouvant être lancé plusieurs fois | Claim/clé de cycle et contrôle de la fenêtre locale Paris | La programmation UTC reste à ajuster après déploiement, voir section 6 |
| Collectes | Erreurs des callbacks divulguant pile, message ou identité technique | Réponse publique stable avec identifiant de requête ; détails sensibles retirés | Tests de refus et d’erreurs sans déclencher de collecte administrative réelle |
| Fournisseurs | Timeouts cumulés, réessais et requêtes dupliquées | Budget global, single-flight, timeout, annulation et reprise bornés | Ne garantit pas la disponibilité d’un fournisseur externe |
| Fournisseurs | Contrats journaliers/horizons et traitement des valeurs absentes | Contrats de mapping/horizon corrigés et tests étendus | Une variable non fournie demeure indisponible, pas zéro |
| openSenseMap | Chaînes vides converties en faux zéros ; confusion vitesse/rafale/direction | Parsing strict, mapping explicite et conversions d’unités connues | Aucune conversion arbitraire d’une unité inconnue |
| Performance | Réponse courante dépendant du moteur complet | Chemin court dédié, retrait des observations brutes non affichées | Nature de la donnée modèle/station toujours distinguée |
| Performance | Collecte environnementale lancée malgré un panneau hors écran | Requête réellement activée à l’intersection | La partie utile s’affiche avant les panneaux secondaires |
| Performance | Caches sans plafond et préchargements excessifs | Caches bornés, clés normalisées, batching sélectif et préchargement réduit | Pas de fusion destructive des historiques de favoris proches |
| Performance | Quota global appliqué aux modules JavaScript/CSS | Limitation conservée sur les API, pas sur les assets de rendu | Authentification et callbacks restent protégés |
| Performance | Payload quotidien Dashboard trop volumineux | Projection conservant valeurs, accord des modèles, provenance et statuts ; retrait des diagnostics détaillés inutilisés | La route Prévisions complète conserve ces diagnostics |
| Performance | Prévisions étendues pouvant transférer environ 26 Mo non compressés | Middleware gzip sur la météo et les assets, hors réponses auth/callbacks | Compression sans perte ; le coût de décodage du gros objet détaillé n’est pas entièrement supprimé |
| Performance | Assets versionnés retéléchargés | Cache long réservé aux assets Vite portant un hash | HTML et données/session ne sont pas rendus publiquement cacheables |
| Interface | Pages bloquées en loader ou erreurs assimilées à une liste vide | États d’erreur explicites, reprise et distinction donnée manquante/erreur | Les valeurs disponibles restent affichées |
| Interface | Rayon, cadence ou préférences ne reflétant pas l’état actif | Raccordements du rayon/cadence et préférences Windy par lieu corrigés | Tests UI et navigation ; les contrôles mobiles sont anonymes |
| Fiabilité | Comparaisons rétrospectives avec les émissions les plus récentes | Reconstruction historique sélectionnant uniquement les captures et scores antérieurs à la mesure | Disponibilité inconnue ou postérieure exclue |
| Fiabilité | Alignement sur l’heure d’archive plutôt que de mesure | Heure propre par variable ; cumuls de pluie non comparables exclus | Pas de comparaison de cumuls différents présentée comme pluie horaire |
| Fusion | Horodatages futurs admis et poids tous nuls réactivés uniformément | Rejet des données futures ; masse finale nulle conservée | Le noyau spatial normalisé existant est préservé |
| Fusion | Qualification température interprétée comme validation de toutes les variables | Admission citoyenne par variable avant Ultra-local | Une valeur exclue, candidate ou sans preuve est neutralisée |
| Fiabilité | Qualification actuelle utilisée pour justifier un impact passé | Fenêtre prospective, postérieure à la qualification effectivement persistée | Preuve temporelle absente = historique insuffisant, pas impact démontré |
| Sécurité | CORS trop large et dépendances vulnérables | Origines de production exactes et correctifs de dépendances ciblés | Rotation de secrets non effectuée, voir section 6 |
| Livraison | Validation non reproductible | Version pnpm alignée, configuration reconnue, workflow CI typage/tests/build | Aucun déploiement automatique ajouté à la CI |

## 3. Mesures réelles, sans extrapolation

### Navigateur sur l’aperçu HTTPS

Un chargement contrôlé a donné :

| Lecture critique | Durée observée |
|---|---:|
| Conditions présentes, chemin modèle court | 2,081 s |
| Prévision horaire officielle courte | 4,230 s |
| État courant local/favoris | 2,336 s |
| Horizon journalier séparé | 2,825 s |

Ces observations ont été réalisées pendant la validation, sur l’aperçu, et avant certains derniers ajustements. Elles ne sont ni des percentiles ni un benchmark contrôlé avant/après. Les mesures du rapport initial sur le domaine public concernaient des GET du shell et des assets : elles ne permettent pas de déduire un pourcentage d’accélération de page.

### Payloads Dashboard

Le contrôle local mobile a observé environ **105 ko** pour la réponse quotidienne projetée, alors que l’aperçu antérieur de ce même lot transmettait environ **622 ko** avec les diagnostics complets. Les contenus météo étaient issus d’instants différents : il s’agit d’une illustration du volume, pas d’une comparaison statistique strictement appariée.

### Compression de Prévisions, mesurée sur une réponse réelle

Mesure enregistrée dans `transfert-gzip-verifie.json` :

- HTTP **200**, `Content-Encoding: gzip`.
- Corps JSON décodé : **2 090 429 octets**.
- Corps réellement transmis : **82 097 octets**.
- Réduction du transfert de cet échantillon : **96,07 %**.
- **15 heures** et **16 jours** présents dans cet échantillon ; traces de pondération horaire et sources quotidiennes conservées.

Ce nombre d’heures décrit uniquement la disponibilité de l’échantillon du contrôle, pas un engagement de couverture complète sur 16 jours. Le contrôle mobile antérieur avait observé une réponse de 26 318 315 octets : sa couverture était différente ; on ne lui applique pas artificiellement le taux mesuré sur la réponse de 2 Mo.

## 4. Validations

- Contrôle TypeScript effectué après l’intégration.
- Suite Vitest complète et build de production exécutés ; le résultat exact de la toute dernière exécution sera ajouté ci-dessous.
- Garde réseau de tests conservé : seuls les fixtures HTTP loopback sont admis. Les tests ne collectent pas de fausses observations réelles.
- Contrôle de schéma en lecture seule : **45 tables déclarées, 776 colonnes, aucune table ni colonne déclarée absente**.
- Ce contrôle démontre la présence, pas l’égalité exhaustive des types, contraintes et index ni la reconstitution du journal historique.
- Test local mobile **375 × 812**, quatre pages : Dashboard, Prévisions, Stations, Fiabilité. **Aucune erreur JavaScript fatale, aucun débordement horizontal du document** ; captures prises après neuf secondes. Dashboard et Prévisions affichent effectivement des données.
- Ce test n’utilise aucune session injectée. Les favoris privés, Netatmo personnel et AI Lab administrateur nécessitent un contrôle authentifié distinct.
- Audit des dépendances de production relancé après les mises à jour ciblées ; résultat exact final ajouté ci-dessous.

## 5. Protection des données et retour arrière

- Checkpoint initial : `5d339897`.
- Sauvegarde complète conservée dans l’espace privé de travail ; gzip et SHA-256 validés avant les réparations.
- Dump compatible TiDB **non transactionnel** : il ne garantit pas un instant commun inter-tables. Une restauration sur une instance isolée n’a pas été testée pendant cette intervention.
- Réparations ciblées consignées avec checksum dans `meteoai_schema_repairs` ; le journal ancien Drizzle incomplet est préservé.
- Ajouts de schéma uniquement ; aucune purge, réécriture de relevés anciens ou fusion forcée de favoris.
- Pour revenir au code précédent, restaurer le checkpoint de départ. Les tables et colonnes additives peuvent rester : ne pas les supprimer automatiquement lors d’un rollback de code.
- Les nowcasts locaux température/pluie restent **shadow**. Aucun retour de P1–P8, aucune promotion de ces candidats en production.

## 6. Ce qui nécessite encore une action ou une observation réelle

### A. Déployer la version corrigée

Un checkpoint et un aperçu ne prouvent pas que le domaine public a été déployé. La version doit être publiée depuis la fiche du projet pour que les visiteurs et heartbeats utilisent ces correctifs. Ne pas interpréter les mesures de l’aperçu comme un résultat déjà acquis sur le domaine public.

### B. Ajuster la planification nocturne après ce déploiement

Le code contient le garde-fou **00:30–00:50 Europe/Paris**, été et hiver. La tâche existante `meteoai-collect-observations` était encore enregistrée avec `0 30 22 * * *` UTC lors de la vérification.

La modification à enregistrer **après publication du handler corrigé** est :

```text
Tâche existante : meteoai-collect-observations
Endpoint inchangé : POST /api/scheduled/collect-observations
Cron UTC à six champs : 0 30 22,23 * * *
Garde-fou applicatif : n’exécuter le cycle qu’à 00:30–00:50 Europe/Paris
```

Ne pas créer une seconde tâche ni lancer d’exécution immédiate. Le créneau UTC inadapté à la saison sera ignoré par le garde-fou ; le lease empêche les doubles traitements.

### C. Sources réellement indisponibles

Des timeouts modèles et un échec de renouvellement Netatmo ont été observés pendant les contrôles. Un collecteur plus robuste ne peut pas produire une donnée absente chez le fournisseur.

- Vérifier/reconnecter Netatmo si ses relevés restent indisponibles.
- Ne pas attribuer des mesures aux stations qui n’en fournissent pas.
- Conserver les erreurs et la couverture partielle visibles.
- Contrôler les prochains vrais cycles : modèles configurés versus effectivement obtenus, heures/variables manquantes, traces persistées, durée et raisons d’exclusion.

### D. Secrets et journal ancien

La séparation/rotation des clés Netatmo ne peut pas être effectuée aveuglément : elle peut invalider les jetons ou rendre des données chiffrées illisibles. Aucune rotation ni modification d’accès compte n’a été réalisée. La réconciliation complète du journal Drizzle et le test de restauration isolée restent une procédure distincte.

### E. Identité des favoris

Les historiques existants de coordonnées proches n’ont pas été fusionnés. Une unification métier éventuelle doit confirmer que les lieux représentent réellement le même favori et prévoir une transition non destructive.

## Conclusion

Le code est désormais conçu pour **afficher plus tôt les données utiles, conserver les résultats qualifiés, réduire les transferts et rendre les manques explicites**. La complétude ne doit pas être obtenue en inventant des valeurs ni en assouplissant les règles temporelles : les corrections rendent la récupération plus fiable, mais les fournisseurs, les autorisations et les futurs cycles réels déterminent ce qui pourra effectivement être affiché.

## Validation finale effective

Dernière exécution complète après tous les correctifs, y compris gzip :

- **281 fichiers de tests réussis.**
- **1 501 tests réussis, 2 ignorés.**
- **TypeScript : OK.**
- **Build de production : OK.**
- **Contrôle de diff : OK.**
- **Audit des dépendances de production : aucune vulnérabilité connue détectée au moment de ce contrôle.**

Fichiers de preuve conservés dans le dossier de ce rapport : `tests-validation-finale.log`, `build-validation-finale.log`, `schema-verifie.json`, `transfert-gzip-verifie.json`, `mobile/resultats.json` et quatre captures mobiles. Les résultats de tests n’équivalent pas à une certification de disponibilité de tous les fournisseurs ni à une restauration de sauvegarde testée.
