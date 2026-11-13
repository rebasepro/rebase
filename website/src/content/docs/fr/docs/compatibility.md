---
sourceHash: fb9fac4af8dcfaaf
slug: fr/docs/compatibility
title: Compatibilité
description: Ce que Rebase garantit d'une version à l'autre et ce qu'il ne garantit pas — les six contrats versionnés, la manière dont chacun échoue, et ce qui peut encore changer dans une version mineure.
---

Ce que Rebase garantit d'une version à l'autre, et ce qu'il ne garantit pas.

C'est le document à lire avant de modifier quoi que ce soit dont dépend déjà
un projet déployé ou un tenant actif de Rebase Cloud. C'est également la réponse
honnête à la question : « si je développe sur Rebase aujourd'hui, qu'est-ce qui
risque de casser sous mes pieds plus tard ? »

## Ce que signifie « bêta » ici

Rebase est en bêta publique. La plupart des projets utilisent ce terme pour dire
que « tout peut casser », ce qui ne donne au lecteur aucune visibilité pour planifier.
Voici donc la ligne de démarcation que ce projet trace réellement :

> **L'API sur laquelle vous écrivez du code peut changer dans une version mineure, avec une entrée dans le changelog.
> Vos données ne peuvent pas casser silencieusement.**

La première moitié correspond au comportement habituel d'une version `0.x` et est
décrite ci-dessous. La seconde moitié est la partie qui mérite d'être vérifiée, car il
s'agit d'une affirmation sur des mécanismes plutôt que sur des intentions : les contrats
versionnés de la section suivante sont chacun gravés dans un artefact ou une base de données,
chacun est vérifié au démarrage ou à l'ingestion, et chacun **échoue de manière explicite et
précise** plutôt que de se dégrader. Une application de schéma (push) qui supprimerait
une colonne est refusée par une barrière destructive
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), et le chemin de mise
à niveau lui-même constitue un test : `upgrade-e2e.test.ts` restaure les bases de données
dans l'état où les anciennes versions les ont laissées, exécute le chemin de migration
actuel sur chacune d'elles, et vérifie que les lignes survivent — et pas seulement que
le démarrage a réussi.

Ce que la bêta signifie concrètement : certaines fonctionnalités manquent encore, certains
sous-systèmes sont plus récents que d'autres, et la présence d'une imperfection signifie que
quelque chose est absent ou peu ergonomique, et non que cela corrompt silencieusement
des données. La maturité de chaque sous-système est publiée et datée plutôt que laissée à
découvrir par soi-même — le tableau ci-dessous en constitue la publication.

## État de préparation par sous-système

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Dernière révision le 14 septembre 2026, par rapport à la version 0.21.0.** Relisez-le à chaque version mineure ; une évaluation qui n'a pas bougé depuis trois versions est soit stabilisée, soit oubliée, et cette note est là pour s'assurer que la différence soit vérifiée.

Les trois niveaux d'évaluation signifient :

- **Stable** — la structure est stabilisée et couverte par une gate dans la CI. Il peut encore recevoir de nouvelles fonctionnalités ; il ne sera pas remanié sous vos pieds au sein de la branche 0.x, et tout changement susceptible de casser votre code sera annoncé dans le changelog.
- **Bêta** — il fonctionne et est utilisé en production, mais certains aspects sont connus pour être encore bruts : une limite que l'on peut atteindre, un cas limite peu pratique, une décision de conception pas encore arrêtée. La partie brute est mentionnée dans les notes, car le terme « bêta » seul ne donne aucune information exploitable pour planifier.
- **Expérimental** — publié afin de pouvoir être utilisé et faire l'objet de retours. Attendez-vous à rencontrer des zones encore inexplorées.

| Sous-système | Évaluation | Sur quoi repose l'évaluation |
|---|---|---|
| API REST + SDK généré | Stable | Le contrat réseau est versionné et validé par des gates ; `client-sdk-e2e` valide de bout en bout l'enregistrement → connexion → lectures restreintes par RLS → rafraîchissement → stockage → temps réel |
| Auth — e-mail/mot de passe, OAuth, OIDC, magic link, code à usage unique | Stable | Douze fournisseurs OAuth sont intégrés. Le schéma d'authentification est un contrat versionné, estampillé et vérifié au démarrage |
| Auth — MFA (TOTP) | Bêta | L'enrôlement, la vérification et la récupération fonctionnent et sont testés. La rotation de clé est implémentée pour la clé de chiffrement ; il n'y a pas d'interface d'administration pour réinitialiser le facteur d'un utilisateur bloqué |
| Sécurité au niveau des lignes (RLS) | Stable | La clé de voûte du produit. `pnpm rls:check` audite une base de données active selon quinze contrôles, et la suite e2e RLS s'exécute à chaque push |
| Stockage | Stable | Local, S3 et GCS. Refus par défaut en production depuis 0.17.0, et le scaffold inclut un hook d'autorisation |
| Temps réel | **Bêta** | Les abonnements sont mis en correspondance uniquement par chemin de table, donc N abonnés sur une même table coûtent N réexécutions de requêtes (refetches) restreintes par RLS par écriture. Cela limite un déploiement à quelques centaines d'abonnés simultanés. Précis à n'importe quelle échelle ; coûteux au-delà de ce seuil |
| Recherche vectorielle (pgvector) | Bêta | Chaque colonne vectorielle reçoit par défaut un index HNSW pour la distance cosinus, configurable par colonne via `col.vector({ dimensions, index })` (méthode, distances, paramètres de construction) ou désactivable, ce qui laisse un scan exact. pgvector ne peut pas indexer une colonne de plus de 2 000 dimensions, celles-ci restent donc non indexées et font l'objet d'un scan |
| Synchronisation hors ligne | Bêta | Les mutations portent des clés d'idempotence respectées par le serveur, et les anomalies de perte de données découvertes lors de l'audit de juillet sont corrigées. Le modèle de conflit est en last-write-wins sans fusion champ par champ |
| Historique des entités | Stable | Basé sur des instantanés (snapshots), validé par sa propre suite de tests |
| Fonctions et crons | Stable | Le point d'entrée portable (`@rebasepro/server/functions`) est un contrat versionné avec sa propre section de surface d'API |
| Serveur MCP + compétences d'agent | Bêta | `@rebasepro/mcp` s'exécute sur stdio : cinquante-trois outils, authentification bearer par projet, les outils destructifs refusent les cibles non locales sauf consentement explicite. Depuis la version 0.21, le serveur peut également monter un endpoint distant `/mcp` — OAuth 2.1, dix-sept outils de données (les quatre pour les applications sauvegardées étant expérimentaux), chaque appel sous le RLS propre à la personne connectée — désactivé sauf si `REBASE_MCP_ENABLED=true`, et réservé à Postgres |
| Studio (SQL, schéma, RLS, explorateur d'API) | Bêta | Utilisé quotidiennement sur de vrais projets. Le branching est présent dans le paquet open source et délibérément non exposé dans Rebase Cloud, car le basculement d'un déploiement en cours d'exécution sur une branche n'est pas encore pris en charge |
| CMS + panneau d'administration | Bêta | Complet pour le CRUD, les relations, les champs de stockage et les rôles. **La table de données ne dispose pas de sémantique de grille** — pas de `role`, pas de `aria-rowindex`, `tabIndex` retiré — ce qui empêche les utilisateurs naviguant au clavier ou par lecteur d'écran d'utiliser la vue principale. Pas de brouillons, pas de contenu par locale, pas de texte riche sous forme de blocs |
| Base de données de dev gérée PGlite | Bêta | `rebase dev` sans configuration et sans Docker. Une seule session à la fois, les requêtes sont donc sérialisées et la concurrence ne peut pas être reproduite dessus ; les commandes reposant sur Atlas (`db push`, `generate`, `migrate`) planifient leurs opérations sur une seconde instance PGlite temporaire lancée pour la commande ; `db branch` n'y fonctionne pas et l'indique explicitement |
| Chart Helm | Bêta | Génère la topologie en processus séparés et est publié sur le registre OCI à chaque version. La configuration par défaut reste un conteneur unique |
| `@rebasepro/firebase` | Expérimental | Firestore en tant que source lue directement par le panneau d'administration, aux côtés des tables du backend : `defineFirestoreCollection` dans `frontend/src/cms`, passé en tant que `externalCollections`. Aucun RLS, aucune surface SQL ; les fonctionnalités de Postgres ne sont pas transposées. Le pilote Firestore ignore les groupes de filtres `or(...)`/`and(...)`, par conséquent une requête qui en utilise un lira toutes les lignes autorisées par ses filtres simples |
| Rebase Cloud | **Bêta privée** | En production, exécutant de vrais tenants, ouvert par vagues. Pas d'accès en libre-service |

Deux éléments ci-dessus représentent le coût de la transparence nécessaire à la publication de ce tableau : la réexécution des requêtes temps réel et l'accessibilité de la table de données sont des défauts ouverts, et non des éléments de la roadmap, et tous deux sont listés plutôt que laissés à la découverte du lecteur.

Ce tableau décrit ce qui existe. Ce qui n'existe pas encore se trouve sur la
[roadmap](https://rebase.pro/roadmap), à raison d'une entrée par issue GitHub, avec
le sous-ensemble requis pour la version 1.0 identifié.

## La promesse de la 0.x

Rebase est en `0.x`. Cette section est rédigée pour s'appliquer à chaque version 0.x plutôt
qu'à une seule d'entre elles, afin de ne pas devenir obsolète à chaque livraison. **Des modifications cassantes apportées à l'API TypeScript restent autorisées dans une version mineure**, et le changelog est l'endroit où elles sont annoncées. Ce qui n'est
*pas* autorisé à casser silencieusement, c'est l'ensemble des contrats versionnés ci-dessous : chacun est gravé dans un artefact ou une base de données, chacun est vérifié au démarrage ou à l'ingestion, et chacun échoue **de manière explicite et précise** plutôt que de se dégrader.

Cette distinction constitue l'intégralité de la promesse. Un export renommé vous coûte une erreur de compilation et cinq minutes. Un bundle qui démarre sur le mauvais runtime et sert des données subtilement erronées vous coûte un incident, et les contrats existent pour que cette seconde catégorie ne puisse jamais survenir en silence.

Rebase Cloud consomme exactement ces contrats et rien d'autre. Tout ce qui n'est pas listé ici est un détail d'implémentation dont la plateforme ne dépend pas.

### Badges de version et canaries

La documentation étant publiée depuis la branche `main`, une page peut décrire un élément qu'aucune version stable ne possède encore. Un badge *Since* indique la première version stable qui l'intègre, et le texte attenant précise le comportement de la version précédente.

Un canary est un build de `main` numéroté d'après la version vers laquelle il se dirige :
`0.25.0-canary.g<commit>` correspond à `main` sur ce commit, après la 0.24.0 et avant la
0.25.0, et `rebase upgrade --to canary` installe le plus récent. Il intègre tout ce qui avait atteint `main` au moment de sa construction ; un badge mentionnant sa version s'applique donc à vous, et la note sur la version précédente décrit la version stable dont vous provenez.

## Les contrats versionnés

Les valeurs ci-dessous sont extraites du code source ; considérez les références de fichiers comme la source de vérité et ce tableau comme le plan d'ensemble.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrat | Déclaré dans | Vérifié dans | Direction de compatibilité |
|---|---|---|---|---|
| 1 | Plage `rebase` dans `rebase.json` | le projet de l'utilisateur | CLI lors du build | le projet indique quels runtimes il accepte |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **rétrocompatible** là où la structure le permet — le format 3 refuse les formats 1 et 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | même fichier | même fichier | **correspondance exacte, dans les deux sens** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | au démarrage, par rapport à `rebase.schema_meta` | **vers l'avant uniquement** — un nouveau runtime migre les anciennes bases de données |
| 5 | `manifest.schemaVersion` | émis par `rebase build` | envoyé par le SDK via `x-rebase-schema` lorsqu'il est configuré | indicatif — identifie le schéma avec lequel un client a été construit |
| 6 | Identifiants de base de données dérivés | `contracts/derived-names.txt` | `pnpm check:derived-names` | **figé** — un nom émis par une version n'est jamais redérivé |

### 1 — `rebase` dans `rebase.json`

Une plage semver, lue comme le champ `engines` d'un `package.json` : les versions de runtime acceptées par ce projet. Nommé délibérément `rebase` plutôt que `runtime`, car `runtime` désigne déjà *qui détient le processus* (`managed` | `custom`) sur une application.

### 2 — `BUNDLE_FORMAT_VERSION` (actuellement 3)

<span class="since-badge" data-since="0.31">Since 0.31</span>

La disposition sur disque d'un bundle compilé. Un runtime refuse un bundle dont le format est plus récent que le sien, et lit un format plus ancien lorsque la structure le permet, ce qui permet à l'offre managée de basculer un tenant sur une nouvelle image sans que personne n'ait à recompiler son projet.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un répertoire unique,
  `entry.admin` pour une interface d'administration embarquée.
- **2** — `kind: "backend" | "static"`, `entry.static` une liste, `entry.admin`
  supprimé.
- **3** (0.31) — le schéma devient `entry.tables`, soit le `backend/schema` compilé,
  aux côtés de `entry.resources`, `entry.storage` et `entry.hooks` ; `entry.config`,
  `entry.collections` et `entry.usersCollection` ont disparu. **Les formats 1 et 2
  sont refusés, et non mis à niveau** : ils comportent `config/collections`, qu'un runtime
  lisant `backend/schema` n'a aucun moyen d'interpréter, et en démarrer un conduirait
  à introspecter la base de données et à servir une API différente. Le message de refus
  indique `rebase migrate collections-to-tables` ; migrez le code source et recompilez.
  Il s'agit de la seule rupture de rétrocompatibilité opérée, appliquée conjointement
  avec la montée de version du contrat de runtime ci-dessous.

**Incrémentez-le lorsque** la disposition change de telle sorte qu'un runtime plus ancien interpréterait mal un bundle plus récent. Cette incrémentation est ce qui transforme un scénario du type « démarre et ne sert rien » en un refus net de démarrer.

### 3 — `RUNTIME_CONTRACT_VERSION` (actuellement 2)

La version majeure du contrat bundle↔runtime. Distincte de la version du paquet
`@rebasepro/server`, qui peut publier autant de versions mineures et de patchs qu'elle le
souhaite pendant que celle-ci reste fixe.

**À lire avant toute modification.** La vérification utilise `!==`, et non `>` :

> un bundle ciblant le contrat *N* s'exécute **uniquement** sur un runtime implémentant *N*

par conséquent, l'incrémenter invalide **absolument tous les bundles jamais créés**, d'un coup,
jusqu'à ce que chacun soit recompilé. C'est le niveau de sévérité voulu — c'est le levier « rien
d'ancien ne peut tourner ici » —, mais cela implique qu'une incrémentation constitue une
migration à l'échelle de tout le parc, et non une simple note de release. Pour l'infrastructure
managée, cela doit être coordonné avec une recompilation du bundle de chaque tenant.

Si une modification est *additive* et que les anciens bundles restent valides, c'est
`BUNDLE_FORMAT_VERSION` qu'il faut incrémenter (voire rien du tout), et non cette valeur.
La version 0.31 l'a fait passer à 2, conjointement au format de bundle 3 : le modèle de schéma
ayant changé, le bundle de chaque tenant a été recompilé à partir du code source migré.

### 4 — `AUTH_SCHEMA_VERSION` (actuellement 2)

Inscrit dans `rebase.schema_meta` et comparé au démarrage. Un runtime **refuse de démarrer** face à une base de données migrée par une version plus récente du framework, plutôt que d'opérer sur une structure qu'il ne comprend pas — lors d'un déploiement progressif (rolling deploy), c'est la différence entre la moitié du parc qui renvoie des erreurs et la moitié du parc qui corrompt des données.

La migration vers l'avant est automatique : `ensureAuthTablesExist` met à niveau une base de données plus ancienne. Notez que ce bloc de migration est délibérément encapsulé dans un `try/catch` et consigne des logs plutôt que de lever une exception — un démarrage en mode dégradé vaut mieux qu'une boucle de crash —, ainsi **« il a démarré » ne prouve rien**. Chaque assertion de la suite de mise à niveau vérifie plutôt le catalogue ou les données.

**Incrémentez-le lorsqu'** une migration ne doit en aucun cas être ignorée par un runtime plus ancien. Ne l'incrémentez pas pour une colonne additive rétrocompatible ; un exemple détaillé de cet arbitrage se trouve dans `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash des descripteurs de tables compilés (`v2:…` depuis la version 0.31), inscrit dans le manifeste du bundle et renvoyé par un SDK généré via l'en-tête `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Il permet à la plateforme d'indiquer « cette application a été construite contre un schéma plus ancien » au lieu d'échouer de manière obscure dès la première requête.

`rebase generate-sdk` écrit cette valeur dans `schema.meta.ts` ; transmettez-la au client pour qu'il l'envoie :

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Le backend lit cet en-tête à chaque requête de données. Un décalage de version ne bloque jamais un appel — un SDK en retard d'une version de schéma reste généralement compatible, et déployer le backend avant le frontend constitue l'ordre de déploiement classique — mais lorsqu'une requête échoue avec un code 400 ou 404, l'erreur mentionne ce décalage comme cause :

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on table \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v2:0e1c…",
      "serverSchema": "v2:9ab4…",
      "message": "This client was generated against schema v2:0e1c…; this backend serves v2:9ab4…"
    }
  }
}
```

Ainsi, une colonne renommée sera signalée par le message « votre SDK est obsolète, régénérez-le » plutôt que comme un champ dont vos propres types affirment l'existence. Une requête réussie n'en est jamais informée.

Cela concerne **uniquement les tables** — leurs descripteurs compilés, dans lesquels un hook se résume à un simple indicateur de présence. Le code d'un hook ou la modification d'une fonction ne modifie pas le contrat du client et ne doit pas invalider tous les SDK générés. Comme la version 0.31 a déplacé le hash des collections vers les descripteurs, chaque base de données estampillée `v1:` signale le changement une seule fois, lors de la réinscription de l'empreinte (au démarrage du propriétaire du schéma, ou via `rebase db push`), et chaque SDK généré apparaît une seule fois comme obsolète.

### Qui appelle

Deux signaux d'identification supplémentaires, dont aucun ne constitue une barrière de blocage à lui seul :

- **`GET /api/meta/schema-version`** est non authentifié et renvoie le `schemaVersion` du projet *ainsi que* son `runtime` (`version` et `contract`). Un job de CI comparant son SDK généré à un projet actif n'a besoin d'aucun identifiant, pas plus qu'un client cherchant à savoir à quel runtime il s'adresse.
- **`User-Agent: rebase-cli/<version>`** accompagne chaque requête vers `rebase cloud`. Le format réseau du plan de contrôle évolue plus vite que ce qui est publié sur npm ; il doit donc pouvoir répondre à un ancien client avec le code `CLI_TOO_OLD` et la version minimale requise — ce qu'il ne peut faire que pour un appelant qui s'identifie clairement.

### 6 — Identifiants de base de données dérivés

<span class="since-badge" data-since="0.31">Since 0.31</span>

Chaque nom que ce framework détermine par lui-même au lieu qu'on le lui indique : une colonne de clé étrangère, une contrainte de clé étrangère, une table de jonction et ses deux colonnes de clés, un type enum, un nom de policy, le passage en `snake_case` d'une clé de colonne en `camelCase`. Depuis la version 0.31, les tables sont déclarées via `defineTable`, qui dérive exactement les mêmes noms que ceux qu'une collection dérivait pour un schéma équivalent ; `rebase migrate collections-to-tables` le prouve projet par projet en comparant le SQL généré octet par octet.

> **Un identifiant dérivé est figé dès l'instant où une version l'émet.**

Pas « figé jusqu'à la prochaine majeure » — figé définitivement. La logique diffère des cinq autres contrats, et elle est plus stricte. Ces derniers sont versionnés, ce qui permet de *détecter* une discordance et de la refuser. Celui-ci ne le permet pas : le nom est écrit dans la base de données d'un client le jour de son déploiement, et il n'y a pas d'estampille de version sur une colonne. Chaque base de données provisionnée par chaque version jamais publiée conserve les noms dérivés à ce moment-là, et aucun code de ce dépôt ne peut intervenir pour tous les renommer.

La version 0.13 en est l'exemple concret. `generateForeignKeyName` a appris à gérer correctement le singulier — `categorie_id` → `category_id`, `addres_id` → `address_id` —, ce qui représente indiscutablement une meilleure dérivation, mais cela a cassé toutes les anciennes bases de données qui contenaient un pluriel irrégulier. Le mécanisme de boot-ensure a migré la colonne, les données ont donc survécu ; en revanche, le fichier `schema.generated.ts` versionné du projet n'a pas été mis à jour, et le démarrage a échoué sur une colonne qui existait pourtant. Résultat : trois commits, un nouveau test d'intégration et une entrée permanente dans les notes de mise à niveau, en échange d'un nom de colonne plus élégant que personne n'avait demandé.

**Si une dérivation s'avère réellement erronée**, elle est modifiée uniquement pour les tables créées *ultérieurement*, sous le couvert d'une stratégie de nommage consignée dans le projet — jamais rétroactivement, et jamais comme effet secondaire de l'amélioration de la fonction sous-jacente.

**La seule dérogation légitime** est une modification qui aligne le code sur un nom que la base de données *possède déjà*. L'exemple concret est la troncature des identifiants : Postgres tronque silencieusement les identifiants à 63 octets, par conséquent un nom de contrainte dérivé plus long n'a jamais été le nom réel enregistré dans le catalogue — la dérivation décrivait un objet qui n'existait pas sous cette orthographe, et boot-ensure réémettait `ADD CONSTRAINT` à chaque démarrage car sa comparaison ne pouvait jamais concorder. Tronquer dès la construction modifie ce que ce dépôt *dérive*, sans rien changer à ce qu'une base de données déjà déployée *contient*. C'est le test à appliquer : non pas « le nouveau nom est-il meilleur ? », mais « une base de données existante doit-elle changer ? ».

L'autre situation où un nom peut être modifié concerne un ensemble de noms qui n'auraient jamais pu coexister. Une règle s'étendant sur plusieurs opérations pour une table de 42 octets ou plus dérivait `<table>_default_admin_write_insert`, `_update` et `_delete`, et toutes trois étaient tronquées aux mêmes 63 octets. Postgres ne conservait qu'une seule policy, DELETE, et refusait chaque INSERT et UPDATE d'administration. C'est uniquement lorsque les noms d'une règle entrent ainsi en collision qu'ils sont dérivés par suffixe, sous la forme `<head>_<hash8>_<op>`. Tout nom fonctionnant aujourd'hui conserve son orthographe. Le prochain démarrage ou push supprime la policy tronquée unique et crée une policy pour chaque opération.

La seule chose qui soit toujours sûre consiste à *reconnaître* un ancien nom afin de le migrer : `legacyForeignKeyName` existe pour être détecté, jamais pour être généré, et la référence de base fige également ces détections. En abandonner une supprime silencieusement la migration pour toutes les bases de données portant encore cette orthographe.

**La gate.** `tooling/scripts/derived-names.mts` soumet un jeu de données de test poussé sur le nommage — pluriels irréguliers, terminaison en `ss`, acronymes, jonction depuis un slug au pluriel, surcharges explicites, slug suffisamment long pour être tronqué — aux deux générateurs de DDL de schéma, et produit l'ensemble des identifiants que l'un ou l'autre nomme :

```bash
pnpm check:derived-names
```

Toute ligne modifiée ou supprimée échoue en tant que rupture de contrat, affichant l'ancienne et la nouvelle orthographe côte à côte. Une modification purement additive échoue également, mais en demandant une « régénération » — afin que la référence de base ne dérive sous les pieds de personne.

Cela garantit également que `rebase db push` et le boot-ensure du runtime managé dérivent exactement les *mêmes* noms, ce qui constitue un second contrat dissimulé dans le premier : ils compilent les mêmes tables via du code différent, et un projet poussé une première fois puis démarré plus tard ne doit pas se retrouver avec deux schémas distincts.

## Ce qui n'est *pas* figé

<span class="since-badge" data-since="0.31">Since 0.31</span>

Exprimé clairement, pour que personne n'en déduise une promesse qui n'a jamais été faite :

- L'API TypeScript que vous écrivez — `defineTable` et `customizeTable`, les options de `initializeRebaseBackend`, les props de l'admin, les noms de méthodes du SDK. La version 0.31 a remplacé les collections par des tables au sein d'une version mineure, avec un codemod prouvant que le SQL généré reste inchangé. Les changements cassants interviennent dans les versions mineures et sont annoncés dans le changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — ces paquets évoluent le plus rapidement et comptent le moins d'utilisateurs.
- Tout élément situé sous le répertoire `src/` d'un paquet qui n'est pas réexporté depuis son barrel file. `packages/client/src/index.ts` comporte une note précisant que sa liste d'exports est soigneusement organisée précisément pour éviter qu'un export interne ne devienne public par inadvertance.
- Le schéma de base de données de *vos* tables. Il vous appartient ; Rebase ne possède que le schéma `rebase` (et, sur une base de données provisionnée avant la version 0.13, l'ancien schéma `auth` jusqu'à ce que le démarrage le retire).

## Les gates qui les garantissent

Rien de tout ce qui précède n'est une simple convention — chaque règle dispose d'un test qui échoue en cas de rupture :

| Gate | Ce qu'elle verrouille |
|---|---|
| `pnpm verify:corpus` | Chaque structure de bundle jamais publiée, démarrée sur le runtime d'aujourd'hui. Les fixtures dans `tests/fixtures/bundles/` sont **rédigées à la main et figées** — une fixture régénérée par le builder évolue dès que le builder évolue |
| `pnpm verify:selfhost` | Un véritable bundle construit, assemblé, démarré et interrogé comme le ferait un navigateur |
| `upgrade-e2e.test.ts` | Les anciens schémas de base de données (`schema-snapshots/`) pris en charge par le runtime actuel |
| `tests/e2e/tests/cli-init-e2e.ts` | Un projet échafaudé installé depuis de **véritables archives tarball**, et non des liens d'espace de travail (workspace links) |
| `tests/e2e/tests/client-sdk-e2e.ts` | Le parcours de l'utilisateur final : enregistrement → connexion → lectures restreintes par RLS → rafraîchissement → stockage → temps réel |
| `pnpm check:derived-names` | Chaque nom de colonne, de contrainte, de table de jonction, d'enum et de policy dérivé par le framework — et l'assurance que le démarrage et `db push` les dérivent de manière identique |
| `pnpm rls:check` | Les policies du schéma généré |
| `pnpm check:api-surface` | Chaque export, ainsi que ses membres, des cinq paquets fournis par l'image — `@rebasepro/server`, `types`, `client`, `common`, `utils` — en plus du point d'entrée `@rebasepro/server/functions`, par rapport aux six sections de `contracts/server.api.txt`. Ce sont les paquets que `infra/docker/entrypoint.mjs` lie via des liens symboliques par-dessus les copies propres d'un bundle déployé ; supprimer l'un de leurs exports ne constitue pas une erreur de compilation pour un utilisateur — cela provoque un échec de démarrage sur l'ensemble du parc, lors d'un déploiement que personne n'a sollicité |
| `pnpm test:gates` | Les tests propres aux gates, appliqués sur des fixtures — quarante-sept fichiers, parmi lesquels `check:api-surface` et la vérification d'incrémentation de version ci-dessous — afin qu'une gate cessant de surveiller ce qu'elle protège échoue ici. `check:api-surface` a passé toute son existence dans l'incapacité de détecter la disparition d'un membre de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | S'assure que le niveau d'incrémentation sous lequel une version est publiée correspond bien à ce que la version a apporté aux références de base ci-dessus — exécuté par `publish.yml` avant que le changelog ne soit validé |
| CI SaaS | Le plan de contrôle compilé contre la branche `main` de ce dépôt, lors de ses propres pushs et de tests nocturnes |

**Enregistrez une fixture de bundle et un snapshot de schéma une fois par release.** La valeur de ces deux corpus repose entièrement sur l'ancienneté du plus ancien d'entre eux, et aucun ne peut être reconstitué a posteriori.

### Pas encore couvert par une gate

Le tableau ci-dessus présente ce qui est garanti. Voici les aspects de la politique qu'aucun mécanisme ne protège encore pour le moment, mentionnés afin que personne n'y voie un engagement implicite :

- **Aucune période de dépréciation ou de support formalisée.** Tant que Rebase est en `0.x`, il n'y a pas de règle écrite régissant la durée de maintien d'un export déprécié avant sa suppression, ni la durée pendant laquelle une version mineure plus ancienne reçoit des correctifs. Les correctifs de sécurité ne s'appliquent qu'à la version mineure la plus récente.
- **Le format réseau HTTP ne dispose d'aucune gate.** Aucun script `check:*` ne compare les structures des requêtes et des réponses à une référence de base comme le fait `check:api-surface` pour les exports ; une modification de la structure de réponse n'est détectée que par une suite e2e qui se trouve par hasard à la lire.
- **Les options de la CLI (flags) n'ont pas de référence de compatibilité.** Le vérificateur de documentation échoue lorsqu'un flag utilisé par les compétences (skills), les exemples ou le site marketing disparaît ; en revanche, rien ne détecte la disparition d'un autre flag ni le changement de signification d'un flag existant.
- **Une release de CI n'enregistre aucun des deux corpus.** Le workflow de publication n'enregistre aucune fixture de bundle ni aucun snapshot de schéma ; seul le script de release local tente de le faire, et il émet un simple avertissement au lieu d'interrompre l'opération lorsqu'il ne le peut pas. Les versions 0.18 à 0.21 ne disposent d'aucun snapshot de projet enregistré.
- **La surface d'export est une gate, pas un contrat.** La décision d'ériger ou non les exports publics des paquets fournis par le runtime en un septième contrat numéroté — déclaré comme la référence de base de `check:api-surface`, rétrocompatible de manière additive au sein d'une version majeure de contrat — reste en suspens.

## Modifier un contrat

1. Déterminez auquel des six contrats la modification se rapporte. La plupart des changements ne concernent aucun d'entre eux — mais « aucun des six » ne veut pas dire « anodin ». Supprimer ou renommer un export de `@rebasepro/server`, ou l'un de ses membres, ne concerne aucun des six et constitue pourtant le changement le plus dangereux du dépôt, car le code qu'il casse est déjà compilé et ne sera pas recompilé. `pnpm check:api-surface` est ce qui maintient cette ligne ; faire de cela un septième contrat numéroté reste une décision ouverte (voir *Pas encore couvert par une gate* plus haut).
2. Ajoutez d'abord une fixture ou un snapshot pour l'**ancienne** structure, et vérifiez que le test passe.
3. Effectuez la modification et incrémentez la constante.
4. Confirmez que l'ancienne fixture passe toujours, ou qu'elle échoue désormais *avec le message précis dont un utilisateur aurait besoin*. Ces deux résultats sont valides ; le silence ne l'est pas.
5. Pour le contrat 3, planifiez la recompilation de chaque bundle déployé avant de merger.
6. Le contrat 6 fait exception aux étapes 3 et 4 : il n'y a pas de constante à incrémenter ni de version sur laquelle refuser l'exécution, car une colonne ne porte aucune estampille de version. L'étape qui les remplace consiste à décider de ne pas appliquer le changement — reportez-vous à la section ci-dessus pour voir à quoi ressemble l'alternative.

## Voir aussi

- [Mise à niveau](/docs/upgrading/) — ce qui a réellement cassé, version par version
- [Changelog](/docs/changelog/) — chaque modification, y compris celles qui n'ont rien cassé
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contrat 3 — le format de bundle contre lequel un projet déployé est déjà compilé
