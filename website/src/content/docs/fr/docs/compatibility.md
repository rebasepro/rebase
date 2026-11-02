---
sourceHash: 63db41eff259cc37
slug: fr/docs/compatibility
title: Compatibilité
description: Ce que Rebase garantit ou non d'une version à l'autre — les six contrats versionnés, leurs modes de défaillance, et ce qui peut encore changer dans une version mineure.
---

Ce que Rebase garantit d'une version à l'autre, et ce qu'il ne garantit pas.

Il s'agit du document à lire avant de modifier quoi que ce soit dont dépend déjà un
projet déployé ou un tenant Rebase Cloud en cours d'exécution. C'est également la
réponse honnête à la question : « si je développe sur Rebase aujourd'hui, qu'est-ce
qui risque de casser plus tard ? »

## Ce que « bêta » signifie ici

Rebase est en bêta publique. La plupart des projets utilisent ce terme pour signifier
que « tout peut casser », ce qui ne donne au lecteur aucun repère pour planifier quoi
que ce soit. Voici donc la limite réelle fixée par ce projet :

> **L'API sur laquelle vous écrivez du code peut changer lors d'une version mineure, avec une mention dans le journal des modifications. Vos données ne peuvent pas être corrompues silencieusement.**

La première partie relève du comportement habituel d'une version `0.x` et est
décrite ci-dessous. La seconde partie mérite que l'on s'y attarde, car il s'agit d'une
affirmation sur des mécanismes et non sur des intentions : les contrats versionnés
de la section suivante sont chacun gravés dans un artefact ou une base de données,
chacun est vérifié au démarrage ou à l'ingestion, et chacun **échoue de manière
explicite et spécifique** plutôt que de se dégrader en silence. Un push de schéma qui
supprimerait une colonne est rejeté par un verrou destructif
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), et le chemin de mise
à niveau lui-même est un test : `upgrade-e2e.test.ts` restaure les bases de données
telles que les versions précédentes les ont laissées, exécute la migration actuelle
sur chacune d'elles et valide que les lignes de données survivent — pas seulement
que le démarrage a réussi.

Ce que signifie être en bêta : des fonctionnalités manquent encore, certains
sous-systèmes sont plus récents que d'autres, et la nature d'une imperfection est
qu'une fonctionnalité est absente ou peu pratique, et non qu'elle corrompt des
données en arrière-plan. L'état précis de chaque sous-système est publié et daté au
lieu d'être laissé à deviner — le tableau ci-dessous constitue cette publication.

## État de préparation par sous-système

**Dernière révision le 14 septembre 2026, pour la version 0.21.0.** À relire à chaque
version mineure ; une évaluation qui n'a pas bougé depuis trois versions est soit
stabilisée, soit oubliée, et cette note est là pour s'assurer que la différence soit vérifiée.

Les trois niveaux d'évaluation signifient :

- **Stable** — la forme est fixée et couverte par un test de validation (gate) dans
  la CI. Elle peut encore s'enrichir de fonctionnalités ; elle ne subira pas de
  refonte majeure au sein de la branche 0.x, et toute modification susceptible de
  casser votre code sera annoncée dans le changelog.
- **Bêta** — cela fonctionne et est utilisé en production, mais un aspect est connu
  pour être perfectible : une limite qu'il est possible d'atteindre, un cas limite
  malcommode, une décision de conception pas encore arrêtée. La partie imparfaite
  est mentionnée dans les notes, car le mot « bêta » seul ne vous apporte rien pour
  planifier votre travail.
- **Expérimental** — livré afin de pouvoir être utilisé et faire l'objet de retours.
  Attendez-vous à rencontrer les zones encore inexplorées.

| Sous-système | Statut | Ce sur quoi repose l'évaluation |
|---|---|---|
| API REST + SDK généré | Stable | Le contrat réseau est versionné et validé ; `client-sdk-e2e` pilote inscription → connexion → lectures restreintes par RLS → rafraîchissement → stockage → temps réel de bout en bout |
| Auth — e-mail/mot de passe, OAuth, OIDC, magic link, code à usage unique | Stable | Douze fournisseurs OAuth inclus. Le schéma d'authentification est un contrat versionné, estampillé et vérifié au démarrage |
| Auth — MFA (TOTP) | Bêta | L'enregistrement, la vérification et la récupération fonctionnent et sont testés. La rotation des clés est implémentée pour la clé de chiffrement ; il n'y a pas d'interface d'administration pour réinitialiser le facteur d'un utilisateur bloqué |
| Sécurité au niveau des lignes (RLS) | Stable | La clé de voûte du produit. `pnpm rls:check` audite une base de données en direct via quinze vérifications, et la suite e2e RLS est exécutée à chaque push |
| Stockage | Stable | Local, S3 et GCS. Refus par défaut en production depuis la 0.17.0, et le modèle initial inclut un hook d'autorisation |
| Temps réel | **Bêta** | Les abonnements sont mis en correspondance uniquement par chemin de collection, donc N abonnés sur une collection coûtent N réexécutions de requêtes sous RLS par écriture. Cela limite un déploiement à quelques centaines d'abonnés simultanés. Rigoureusement exact à toute échelle ; coûteux au-delà de cette limite |
| Recherche vectorielle (pgvector) | Bêta | Chaque colonne vectorielle reçoit par défaut un index HNSW pour la distance cosinus, ajustable par propriété via `VectorIndexConfig` (méthode, distances, paramètres de construction) ou désactivable, ce qui laisse un scan exact. pgvector ne peut pas indexer une colonne de plus de 2 000 dimensions : celles-ci restent donc non indexées et font l'objet d'un scan complet |
| Synchronisation hors ligne | Bêta | Les mutations portent des clés d'idempotence respectées par le serveur, et les défauts de perte de données identifiés lors de l'audit de juillet sont corrigés. Le modèle de conflit est le dernier écrivain l'emporte (« last-write-wins ») sans fusion champ par champ |
| Historique des entités | Stable | Basé sur des instantanés (snapshots), validé par sa propre suite de tests |
| Fonctions et tâches cron | Stable | Le point d'entrée portable (`@rebasepro/server/functions`) est un contrat versionné disposant de sa propre section d'exposition d'API |
| Serveur MCP + compétences d'agent | Bêta | `@rebasepro/mcp` s'exécute sur stdio : cinquante-trois outils, authentification bearer par projet, les outils destructifs refusent les cibles non locales sans accord explicite. Depuis la version 0.21, le serveur peut aussi monter un endpoint distant `/mcp` — OAuth 2.1, huit outils de données, chaque appel sous le RLS propre de l'utilisateur connecté — désactivé sauf si `REBASE_MCP_ENABLED=true`, et réservé à Postgres |
| Studio (SQL, schéma, RLS, explorateur d'API) | Bêta | Utilisé au quotidien sur de vrais projets. La gestion de branches est présente dans le package open source et délibérément absente de Rebase Cloud, car le basculement d'un déploiement en production sur une branche n'est pas encore défini |
| CMS + panneau d'administration | Bêta | Complet pour le CRUD, les relations, les champs de stockage et les rôles. **Le tableau de données ne possède pas de sémantique de grille** — pas de `role`, pas de `aria-rowindex`, `tabIndex` supprimé — les utilisateurs au clavier et lecteurs d'écran ne peuvent donc pas manipuler la vue principale. Pas de brouillons, pas de contenu par langue/locale, pas de texte riche sous forme de blocs |
| Base de dev gérée PGlite | Bêta | `rebase dev` sans aucune configuration ni Docker. Une seule session à la fois, donc les requêtes sont sérialisées et la concurrence ne peut pas être reproduite dessus ; les commandes basées sur Atlas (`db push`, `generate`, `migrate`) planifient sur une seconde instance PGlite jetable lancée pour l'occasion (sur la 0.24, elles refusent la base gérée) ; `db branch` n'y fonctionne pas et le signale explicitement |
| Chart Helm | Bêta | Effectue le rendu de la topologie à processus séparés et est publié dans le registre OCI à chaque release. Le déploiement par défaut reste un conteneur unique |
| `@rebasepro/server-mongo` | **Expérimental** | Un pilote fonctionnel avec temps réel basé sur les change streams et historique par instantanés. **Aucune sécurité au niveau des lignes (RLS)** — tout le modèle d'isolation décrit plus haut ne s'y applique pas — et pas de relations. Les change streams nécessitent un replica set : sur un `mongod` autonome, rien ne les remplace, de sorte qu'un abonnement ne voit que les écritures faites via ce processus Rebase précis et manque toutes les autres. Pas de MFA : l'enrôlement renvoie une 501, et les vérifications répondent « aucun facteur », si bien que la connexion n'en demande jamais. L'agrégation d'administration ne peut cibler une collection — elle lit le nom depuis une étape `$from` que MongoDB ne possède pas — elle ne retourne donc rien |
| `@rebasepro/firebase` | Expérimental | Exécute le panneau d'administration et le SDK sur Firestore. Pas de RLS, pas d'interface SQL ; les fonctionnalités Postgres ne sont pas transposées. Le pilote Firestore ignore les groupes de filtres `or(...)`/`and(...)` : une requête qui en utilise lit donc chaque ligne que ses filtres simples autorisent |
| Rebase Cloud | **Bêta privée** | En ligne, hébergeant de vrais tenants, ouvert par vagues. Pas en libre-service |

Deux entrées ci-dessus représentent le coût direct de l'honnêteté de ce tableau :
la réinterrogation en temps réel et l'accessibilité du tableau de données sont des
défauts ouverts, et non des éléments de feuille de route, et tous deux sont listés
ici plutôt que laissés à la découverte du lecteur.

Ce tableau décrit ce qui existe. Ce qui n'existe pas encore figure sur la
[roadmap](https://rebase.pro/roadmap), à raison d'une entrée par issue GitHub, avec
le sous-ensemble requis pour la version 1.0 explicitement indiqué.

## La promesse de la version 0.x

Rebase est en `0.x`. Cette section est rédigée pour s'appliquer à chaque version 0.x
plutôt qu'à une seule en particulier, afin de ne pas devenir obsolète à chaque cycle.
**Des modifications cassantes de l'API TypeScript écrite par l'utilisateur sont
toujours permises dans une version mineure**, et le changelog est l'endroit où
elles sont annoncées. Ce qui n'est
*pas* autorisé à casser silencieusement, c'est l'ensemble des contrats versionnés
ci-dessous : chacun est estampillé dans un artefact ou une base de données, chacun
est contrôlé au boot ou à la réception, et chacun échoue **de manière explicite et
spécifique** plutôt que de se dégrader en silence.

Cette distinction constitue toute la promesse. Un export renommé vous coûte une
erreur de compilation et cinq minutes. Un bundle qui démarre sur un mauvais runtime
et sert des données subtilement erronées vous coûte un incident en production, et les
contrats existent pour empêcher cette seconde catégorie de survenir discrètement.

Rebase Cloud consomme exactement ces contrats et rien d'autre. Tout ce qui n'est pas
listé ici constitue un détail d'implémentation dont la plateforme ne dépend pas.

### Badges de version et canaries

La documentation étant publiée depuis `main`, une page peut décrire une fonctionnalité
qu'aucune version stable ne propose encore. Un badge *Depuis* indique la première
version stable qui la prend en charge, et le texte attenant explique le comportement
de la version précédente.

Un build canary est une compilation de `main` numérotée selon la version vers laquelle
elle se dirige : `0.25.0-canary.g<commit>` correspond à `main` à ce commit, après
0.24.0 et avant 0.25.0, et `rebase upgrade --to canary` installe la plus récente. Elle
embarque tout ce qui avait atteint `main` au moment de sa construction, donc un
badge mentionnant sa version (Depuis 0.25) s'applique à vous, et la note sur la version
antérieure (sur la 0.24) décrit la version stable d'où vous venez. Les canaries
antérieures à la 0.25.0 étaient numérotées d'après la dernière version stable :
`0.24.1-canary.g<commit>` est également un aperçu de la 0.25.

## Les contrats versionnés

Les valeurs ci-dessous sont extraites directement du code source ; considérez les
références de fichiers comme la vérité et ce tableau comme la carte d'orientation.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrat | Déclaré dans | Vérifié dans | Direction de compatibilité |
|---|---|---|---|---|
| 1 | plage `rebase` dans `rebase.json` | projet de l'utilisateur | CLI au build | le projet indique quels runtimes il accepte |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **rétrocompatible** — un nouveau runtime lit les anciens bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | même fichier | même fichier | **correspondance exacte, dans les deux sens** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | au démarrage, contre `rebase.schema_meta` | **vers l'avant uniquement** — un nouveau runtime migre les anciennes bases |
| 5 | `manifest.schemaVersion` | émis par `rebase build` | envoyé par le SDK via `x-rebase-schema` si configuré | informatif — identifie le schéma pour lequel un client a été généré |
| 6 | Identifiants de base de données dérivés | `contracts/derived-names.txt` | `pnpm check:derived-names` | **figé** — un nom émis par une version n'est jamais redérivé différemment |

### 1 — `rebase` dans `rebase.json`

Une plage semver, interprétée comme le champ `engines` d'un `package.json` : les
versions de runtime que ce projet accepte. Nommé délibérément `rebase` plutôt que
`runtime`, car `runtime` désigne déjà l'entité *qui possède le processus*
(`managed` | `custom`) sur une application.

### 2 — `BUNDLE_FORMAT_VERSION` (actuellement 2)

La structure sur disque d'un bundle compilé. Un runtime accepte tout bundle dont le
format est **inférieur ou égal** au sien, ce qui permet à l'infrastructure gérée de
basculer un tenant vers une nouvelle image sans obliger quiconque à recompiler son projet.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` est un répertoire unique,
  `entry.admin` pour un admin embarqué.
- **2** — `kind: "backend" | "static"`, `entry.static` est une liste, `entry.admin`
  est supprimé. Le format 1 reste lisible via `upgradeLegacyManifest`.

**À incrémenter quand** la disposition change de telle sorte qu'un ancien runtime
interpréterait mal un bundle plus récent. C'est cette incrémentation qui transforme
un « démarre et ne sert rien » en un refus net de démarrer.

### 3 — `RUNTIME_CONTRACT_VERSION` (actuellement 1)

Le numéro majeur du contrat bundle↔runtime. Distinct de la version du package
`@rebasepro/server`, qui peut publier autant de versions mineures et de correctifs
qu'elle le souhaite pendant que celui-ci reste inchangé.

**À lire impérativement avant toute modification.** La vérification utilise `!==` et non `>` :

> un bundle ciblant le contrat *N* s'exécute **uniquement** sur un runtime implémentant *N*

Incrémenter cette valeur invalide donc **absolument tous les bundles jamais créés**,
instantanément, jusqu'à ce que chacun soit recompilé. C'est la sévérité voulue — le
levier « rien d'ancien ne peut tourner ici » — mais cela implique qu'une incrémentation
est une migration globale du parc, et non une simple note de version. Pour le service
géré, elle doit être coordonnée avec une recompilation des bundles de chaque tenant.

Si une modification est purement *additive* et que les anciens bundles restent valides,
elle relève de `BUNDLE_FORMAT_VERSION` (ou de rien du tout), pas de celle-ci.

### 4 — `AUTH_SCHEMA_VERSION` (actuellement 2)

Inscrit dans `rebase.schema_meta` et comparé au démarrage. Un runtime **refuse de
démarrer** sur une base de données migrée par une version plus récente du framework,
plutôt que d'opérer sur une structure qu'il ne comprend pas — lors d'un déploiement
progressif (rolling deploy), c'est ce qui fait la différence entre la moitié du parc
qui renvoie des erreurs et la moitié du parc qui corrompt les données.

La migration vers l'avant est automatique : `ensureAuthTablesExist` met à niveau
une base de données plus ancienne. Notez que ce bloc de migration est délibérément
encapsulé dans un `try/catch` qui consigne des logs plutôt que de lever une exception
— un démarrage dégradé vaut mieux qu'une boucle de crashs — par conséquent, **« le
démarrage a réussi » ne prouve rien**. Chaque assertion de la suite de tests de mise
à niveau inspecte le catalogue système ou les données réelles.

**À incrémenter quand** une migration ne doit en aucun cas être ignorée par un
runtime plus ancien. N'incrémentez pas pour une colonne additive rétrocompatible ;
un exemple concret de cet arbitrage est visible dans
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash des définitions de collections compilées, inscrit dans le manifeste du
bundle et renvoyé par un SDK généré dans l'en-tête `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Son rôle est de permettre à la plateforme d'indiquer :
« cette application a été construite pour un schéma plus ancien », plutôt que
d'échouer de manière obscure dès la première requête.

`rebase generate-sdk` écrit cette valeur dans `schema.meta.ts` ; transmettez-la au
client pour qu'il l'envoie :

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Le backend lit cet en-tête sur chaque requête de données. Un décalage de version ne
provoque jamais de rejet d'appel — un SDK ayant un schéma de retard reste généralement
compatible, et déployer le backend avant le frontend est l'ordre normal de livraison
— mais lorsqu'une requête échoue avec un code 400 ou 404, l'erreur inclut ce décalage
dans sa cause :

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

Ainsi, une colonne renommée se manifeste par « votre SDK est obsolète, veuillez le
régénérer » plutôt que par un champ fantôme que vos propres types s'obstinent à
croire présent. Une requête qui réussit n'en est jamais informée.

Cela ne couvre **que les collections**. La modification d'un hook ou d'une fonction
ne change pas le contrat du client et ne doit pas invalider tous les SDK générés.

### Qui appelle

Deux signaux d'identification supplémentaires, dont aucun ne bloque quoi que ce
soit à lui seul :

- **`GET /api/meta/schema-version`** ne nécessite pas d'authentification et renvoie
  le `schemaVersion` du projet *ainsi que* son `runtime` (`version` et `contract`). Un
  job CI comparant son SDK généré à un projet en ligne n'a besoin d'aucun identifiant,
  pas plus qu'un client souhaitant savoir à quel runtime il s'adresse.
- **`User-Agent: rebase-cli/<version>`** accompagne chaque requête vers `rebase cloud`.
  Le protocole de communication du plan de contrôle évolue plus vite que ce qui est
  publié sur npm ; il doit donc pouvoir répondre `CLI_TOO_OLD` à un ancien client
  en lui fournissant la version minimale requise — ce qui n'est possible que si
  l'appelant décline son identité.

### 6 — Identifiants de base de données dérivés

Chaque nom que ce framework détermine par lui-même au lieu d'en être explicitement
informé : une colonne de clé étrangère, une contrainte de clé étrangère, une table
de jonction et ses deux colonnes de clés, un type enum, un nom de policy RLS, la
colonne en `snake_case` d'une propriété définie en `camelCase`.

> **Un identifiant dérivé est figé à la seconde même où une version le produit.**

Pas « figé jusqu'à la prochaine version majeure » — figé définitivement. Le
raisonnement diffère des cinq autres contrats et s'avère bien plus strict. Les autres
sont versionnés, de sorte qu'une discordance peut être *détectée* et refusée.
Celui-ci ne le peut pas : le nom est écrit dans la base de données d'un client le
jour de son déploiement, et aucune estampille de version n'existe sur une colonne.
Chaque base provisionnée par n'importe quelle version publiée porte les noms
dérivés à cet instant, et aucun code de ce dépôt ne peut s'y introduire pour tous
les renommer.

La version 0.13 en est l'exemple type. `generateForeignKeyName` a appris à gérer
correctement la mise au singulier — `categorie_id` → `category_id`, `addres_id` →
`address_id` — ce qui constitue indéniablement une meilleure dérivation, mais cela a
cassé toutes les bases anciennes possédant un pluriel irrégulier. Le mécanisme de
contrôle au démarrage (boot-ensure) a migré la colonne, préservant ainsi les données ;
mais le fichier `schema.generated.ts` versionné dans le projet ne l'était pas, et le
démarrage s'est soldé par un échec sur une colonne pourtant bien présente. Trois
commits, un nouveau test d'intégration de couture et une entrée permanente dans les
notes de mise à niveau, simplement pour un nom de colonne plus élégant que personne
n'avait réclamé.

**Si une dérivation est réellement erronée**, elle ne change que pour les collections
créées *postérieurement*, derrière une stratégie de nommage enregistrée dans le projet
— jamais de manière rétroactive, et jamais comme effet secondaire de l'amélioration
de la fonction sous-jacente.

**La seule dérogation légitime** est une modification visant à aligner le code sur
un nom que la base de données *possède déjà*. L'exemple concret est la troncature
des identifiants : Postgres tronque silencieusement les identifiants à 63 octets.
Un nom de contrainte dérivé plus long n'a donc jamais existé tel quel dans le catalogue
— la dérivation décrivait un objet inexistant sous cette graphie, et boot-ensure
réémettait un `ADD CONSTRAINT` à chaque démarrage car sa comparaison échouait
systématiquement. Tronquer dès la construction modifie ce que ce dépôt *dérive*,
sans rien changer à ce qu'une base de données déployée *contient*. C'est le critère
à appliquer : non pas « le nouveau nom est-il meilleur ? », mais « une base existante
doit-elle être modifiée ? ».

L'autre cas où un nom peut changer concerne un ensemble de noms qui ne pouvaient
pas tous coexister. Une règle couvrant plusieurs opérations sur une table de 42 octets
ou plus dérivait `<table>_default_admin_write_insert`, `_update` et `_delete`, et
tous trois étaient tronqués aux mêmes 63 octets. Postgres n'enregistrait qu'une seule
policy, DELETE, et refusait chaque INSERT et UPDATE administrateur. Ce n'est que
lorsque les noms d'une règle entrent ainsi en collision qu'ils sont dérivés avec le
suffixe en priorité, sous la forme `<head>_<hash8>_<op>`. Tout nom fonctionnel
aujourd'hui conserve son orthographe. Le boot ou le push suivant supprime la policy
tronquée unique et crée une policy pour chaque opération.

La seule démarche systématiquement sûre consiste à *reconnaître* un ancien nom afin
de le migrer : `legacyForeignKeyName` existe pour être détecté, jamais pour être
généré, et la ligne de référence fige également ces détections. En supprimer une
annule silencieusement la migration de chaque base de données portant encore cette graphie.

**Le mécanisme de validation (gate).** `tooling/scripts/derived-names.mts` soumet un
jeu d'essai poussé sur le nommage — pluriels irréguliers, terminaison en `ss`,
acronymes, jonction depuis un slug au pluriel, remplacements explicites, slug
suffisamment long pour être tronqué — aux deux générateurs de DDL de schéma, et
produit chaque identifiant nommé par l'un ou l'autre :

```bash
pnpm check:derived-names
```

Une ligne modifiée ou supprimée échoue en tant que rupture de contrat, affichant
côte à côte l'ancienne et la nouvelle graphie. Une modification purement additive
échoue également, mais avec l'instruction « regenerate » — afin que la référence
ne puisse dériver à l'insu de quiconque.

Il garantit également que `rebase db push` et le boot-ensure du runtime géré dérivent
exactement les *mêmes* noms, ce qui constitue un second contrat dissimulé dans le
premier : ils compilent les mêmes collections via un code différent, et un projet
poussé une fois puis démarré plus tard ne doit pas se retrouver avec deux schémas.

## Ce qui n'est *pas* figé

Exprimé clairement, afin que personne ne présume d'une garantie qui n'a jamais été donnée :

- L'API TypeScript rédigée par l'utilisateur — configuration des collections,
  options de `initializeRebaseBackend`, props d'administration, noms de méthodes du
  SDK. Des changements de rupture peuvent intervenir dans les versions mineures et
  sont annoncés dans le changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — ce sont les composants qui évoluent le plus vite et
  comptent le moins de consommateurs.
- Tout élément situé dans le `src/` d'un package qui n'est pas réexporté depuis son
  point d'entrée principal (barrel file). `packages/client/src/index.ts` comporte
  une note expliquant que sa liste d'exports est restreinte précisément pour éviter
  qu'un export interne ne devienne public par inadvertance.
- Le schéma de base de données de *vos* collections. Il vous appartient ; Rebase
  ne possède que le schéma `rebase` (et, sur une base de données provisionnée avant
  la 0.13, l'ancien schéma `auth` jusqu'à ce que le boot le retire).

## Les verrous qui garantissent ces règles

Rien de ce qui précède n'est une simple convention — chaque règle dispose d'un
test qui échoue en cas de rupture :

| Verrou (Gate) | Ce qu'il verrouille |
|---|---|
| `pnpm verify:corpus` | chaque structure de bundle jamais publiée, démarrée sur le runtime actuel. Les jeux de données dans `tests/fixtures/bundles/` sont **écrits à la main et figés** — un jeu d'essai régénéré par le compilateur bougerait dès que le compilateur bouge |
| `pnpm verify:selfhost` | un véritable bundle compilé, assemblé, démarré et interrogé comme le ferait un navigateur |
| `upgrade-e2e.test.ts` | les anciens schémas de base de données (`schema-snapshots/`) pris en charge par le runtime actuel |
| `tests/e2e/tests/cli-init-e2e.ts` | un projet échafaudé installé depuis de **véritables archives tarball**, et non des liens de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | le parcours utilisateur : inscription → connexion → lectures restreintes par RLS → rafraîchissement → stockage → temps réel |
| `pnpm check:derived-names` | chaque nom de colonne, contrainte, jonction, enum et policy que le framework dérive — et l'assurance que le boot et `db push` les dérivent à l'identique |
| `pnpm rls:check` | les policies du schéma généré |
| `pnpm check:api-surface` | chaque export, et ses membres, des cinq packages fournis par l'image — `@rebasepro/server`, `types`, `client`, `common`, `utils` — ainsi que le point d'entrée `@rebasepro/server/functions`, par rapport aux six sections de `contracts/server.api.txt`. Ce sont les packages que `infra/docker/entrypoint.mjs` lie symboliquement par-dessus les copies propres d'un bundle déployé ; supprimer l'un de leurs exports ne provoque donc une erreur de compilation pour personne — cela provoque un échec de démarrage sur tout le parc lors d'un déploiement non sollicité |
| `pnpm test:gates` | les propres tests de ces verrous, sur des jeux d'essai — quarante-sept fichiers, dont `check:api-surface` et la vérification d'incrémentation de version ci-dessous — afin qu'un verrou cessant de surveiller ce qu'il protège échoue ici. `check:api-surface` est longtemps resté incapable de voir un membre disparaître de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que le niveau d'incrémentation sous lequel une version est publiée correspond bien à ce qu'elle a fait subir aux bases de référence ci-dessus — exécuté par `publish.yml` avant que le changelog ne soit validé |
| saas CI | le plan de contrôle compilé contre la branche `main` de ce dépôt, sur ses propres pushs et chaque nuit |

**Enregistrez un bundle de test et un instantané de schéma une fois par version.**
La valeur de ces deux corpus réside entièrement dans l'ancienneté du plus vieux d'entre
eux, et aucun ne peut être reconstitué a posteriori.

### Pas encore verrouillé

Le tableau ci-dessus recense ce qui est sous contrôle. Voici les points de la
politique que rien ne verrouille encore, listés afin que nul n'y lise un engagement indu :

- **Aucune période d'obsolescence ou de support garantie.** Tant que Rebase est en
  `0.x`, il n'y a pas de règle formelle sur la durée de survie d'un export déprécié
  avant sa suppression, ni sur la durée pendant laquelle une ancienne version mineure
  reçoit des correctifs. Les correctifs de sécurité ne sont appliqués qu'à la dernière
  version mineure.
- **Le format réseau HTTP ne fait l'objet d'aucun verrou.** Aucun script `check:*` ne
  compare la structure des requêtes et réponses à une référence de base comme le fait
  `check:api-surface` pour les exports ; une modification de la structure de réponse
  n'est détectée que par une suite e2e qui se trouve la lire.
- **Les options de la CLI n'ont pas de base de compatibilité.** Le vérificateur de
  documentation échoue lorsqu'un flag utilisé par les compétences, les exemples ou
  le site disparaît ; mais rien ne surveille la disparition de tout autre flag, ni
  un changement de sa signification.
- **Une release via CI n'enregistre aucun corpus.** Le workflow de publication
  n'enregistre aucun bundle témoin ni aucun instantané de schéma ; seul le script
  de release local s'y emploie, et il émet un simple avertissement au lieu de
  s'interrompre en cas d'échec. Les versions 0.18 à 0.21 n'ont aucun instantané de
  projet consigné.
- **La surface d'export est un verrou, pas un contrat.** La décision d'ériger ou
  non les exports publics des packages fournis par le runtime en un septième contrat
  numéroté — déclaré comme la base de référence de `check:api-surface`, compatible de
  manière additive au sein d'une version majeure de contrat — reste ouverte.

## Modifier un contrat

1. Déterminez auquel des six il correspond. La plupart des modifications ne concernent
   aucun d'entre eux — mais « aucun des six » ne veut pas dire « sans conséquence ».
   Supprimer ou renommer un export de `@rebasepro/server`, ou l'un de ses membres, ne
   relève d'aucun des six et constitue la modification la plus dangereuse de tout
   le dépôt, car le code qu'elle casse est déjà compilé et ne sera pas recompilé.
   `pnpm check:api-surface` est le garant de cette frontière ; la décision d'en faire
   un septième contrat numéroté demeure ouverte (voir *Pas encore verrouillé* plus haut).
2. Ajoutez d'abord un jeu de test ou un instantané pour l'**ancienne** forme, et
   vérifiez qu'il passe avec succès.
3. Effectuez la modification et incrémentez la constante.
4. Confirmez que l'ancien jeu de données continue de passer, ou qu'il échoue désormais
   *en affichant le message dont l'utilisateur aurait besoin*. Les deux issues sont
   valables ; le silence ne l'est pas.
5. Pour le contrat 3, planifiez la recompilation de tous les bundles déployés avant
   de procéder au merge.
6. Le contrat 6 fait exception aux étapes 3 et 4 : il n'y a aucune constante à
   incrémenter ni aucune version sur laquelle refuser l'exécution, car une colonne ne
   porte aucune estampille de version. L'étape qui les remplace consiste à décider
   de ne pas faire la modification — consultez la section ci-dessus pour comprendre
   à quoi ressemble l'alternative.

## Voir aussi

- [Mise à niveau](/docs/upgrading/) — ce qui a effectivement changé, version par version
- [Journal des modifications (Changelog)](/docs/changelog/) — chaque changement, y compris ceux sans rupture
- [Runtime et Bundles](/docs/architecture/runtime-and-bundles/) — contrat 3 — le format de bundle pour lequel un projet déployé est déjà compilé
