---
sourceHash: 574dcb0aad3f6719
slug: fr/docs/compatibility
title: Compatibilité
description: Ce que Rebase garantit d'une version à l'autre et ce qu'il ne garantit pas — les six contrats versionnés, la façon dont chacun échoue et ce qui peut encore changer dans une version mineure.
---

Ce que Rebase garantit d'une version à l'autre, et ce qu'il ne garantit pas.

C'est le document à lire avant de modifier quoi que ce soit dont dépend déjà un
projet déployé ou un tenant Rebase Cloud en production. C'est également la réponse
honnête à la question : « si je développe sur Rebase aujourd'hui, qu'est-ce qui
risque de casser sous mes pieds plus tard ? »

## Ce que « bêta » signifie ici

Rebase est en bêta publique. La plupart des projets emploient ce terme pour signifier
que « tout peut casser », ce qui ne donne au lecteur aucune visibilité pour planifier
quoi que ce soit. Voici donc la limite réelle fixée par ce projet :

> **L'API sur laquelle vous écrivez du code peut changer lors d'une version mineure,
> avec une entrée dans le journal des modifications (changelog). Vos données ne
> peuvent pas se corrompre silencieusement.**

La première partie correspond au comportement ordinaire d'une version `0.x` et est
décrite ci-dessous. La seconde partie est celle qui mérite d'être examinée, car il
s'agit d'une affirmation sur des mécanismes plutôt que sur des intentions : les
contrats versionnés de la section suivante sont chacun gravés dans un artefact ou
une base de données, chacun est vérifié au démarrage ou à la réception, et chacun
**échoue de manière explicite et spécifique** plutôt que de se dégrader en silence.
Un push de schéma qui supprimerait une colonne est refusé par une barrière de
sécurité destructive (`packages/server-postgres/test/e2e/db-push-safety.test.ts`),
et le chemin de mise à niveau lui-même fait l'objet d'un test : `upgrade-e2e.test.ts`
restaure les bases de données telles que les anciennes versions les ont laissées,
exécute le chemin de migration actuel sur chacune d'elles et vérifie que les lignes
survivent — pas simplement que le démarrage s'est bien déroulé.

Ce que signifie réellement le statut bêta : des fonctionnalités manquent encore,
certains sous-systèmes sont plus récents que d'autres, et la manifestation d'une
imperfection se traduit par une absence ou une maladresse ergonomique, pas par une
corruption silencieuse de données. La maturité de chaque sous-système est publiée
et datée plutôt que laissée à découvrir — le tableau ci-dessous en est la publication.

## Maturité par sous-système

**Dernière révision le 14 septembre 2026, pour la version 0.21.0.** À relire à chaque
version mineure ; une évaluation qui n'a pas bougé depuis trois versions est soit
stabilisée, soit oubliée, et cette note est là pour s'assurer que la différence soit vérifiée.

Les trois niveaux d'évaluation signifient :

- **Stable** — la forme est fixée et couverte par un test de validation en CI.
  Elle peut encore s'enrichir de fonctionnalités ; elle ne subira pas de refonte
  au cours de la branche 0.x, et toute modification qui entraînerait une rupture
  sera annoncée dans le changelog.
- **Bêta** — fonctionne et est utilisé en production, mais comporte des aspects
  connus pour être perfectibles : une limite atteignable, un cas particulier maladroit,
  une décision de conception non encore tranchée. Ces aspérités sont explicitées
  dans les notes, car le mot « bêta » seul ne donne aucune information exploitable.
- **Expérimental** — livré pour pouvoir être utilisé et faire l'objet de retours.
  Attendez-vous à explorer des zones que personne n'a encore touchées.

| Sous-système | Évaluation | Sur quoi repose l'évaluation |
|---|---|---|
| API REST + SDK généré | Stable | Le contrat réseau est versionné et validé par des tests ; `client-sdk-e2e` pilote inscription → connexion → lectures sous RLS → rafraîchissement → stockage → temps réel de bout en bout |
| Auth — email/mot de passe, OAuth, OIDC, lien magique, code à usage unique | Stable | Douze fournisseurs OAuth intégrés. Le schéma d'authentification est un contrat versionné, gravé et vérifié au démarrage |
| Auth — MFA (TOTP) | Bêta | L'enrôlement, la vérification et la récupération fonctionnent et sont testés. La rotation de clé est implémentée pour la clé de chiffrement ; il n'y a pas d'interface d'administration pour réinitialiser le facteur d'un utilisateur bloqué |
| Sécurité au niveau des lignes (RLS) | Stable | La clé de voûte du produit. `pnpm rls:check` audite une base de données active selon quinze vérifications, et la suite e2e RLS s'exécute à chaque push |
| Stockage | Stable | Local, S3 et GCS. Refus par défaut en production depuis la 0.17.0, et le scaffold fournit un hook d'autorisation |
| Temps réel | **Bêta** | Chaque trame est une lecture sous la portée RLS propre à son abonné. Les sockets d'un même utilisateur sur une même liste partagent cette lecture, et une liste filtrée sur une colonne de la ligne (`where owner == me`) n'est sollicitée que lorsqu'une écriture peut l'atteindre : 5 000 utilisateurs observant chacun leurs propres lignes coûtent **une** lecture par écriture, avec un délai de livraison de ~305 ms (mesuré, `tooling/scripts/bench-realtime-fanout.mts`). La limite concerne une liste filtrée uniquement par la RLS : une lecture par utilisateur distinct par écriture, de sorte que 5 000 utilisateurs sur la même liste non filtrée représentent 5 000 lectures et ~2,6 s pour terminer la diffusion (fan-out). Comportement correct à toute échelle ; filtrez sur la colonne lue par la politique pour rester à une seule lecture |
| Recherche vectorielle (pgvector) | Bêta | Chaque colonne vectorielle reçoit par défaut un index HNSW pour la distance cosinus, configurable par colonne via `col.vector({ dimensions, index })` (méthode, distances, paramètres de construction) ou désactivable, ce qui laisse un scan exact. pgvector ne peut pas indexer une colonne de plus de 2 000 dimensions, celles-ci restent donc non indexées et font l'objet d'un scan |
| Synchronisation hors ligne | Bêta | Les mutations portent des clés d'idempotence respectées par le serveur, et les défauts de perte de données identifiés lors de l'audit de juillet sont corrigés. Le modèle de conflit est de type « le dernier écrivain l'emporte » (last-write-wins) sans fusion champ par champ |
| Historique des entités | Stable | Basé sur des instantanés (snapshots), validé par sa propre suite de tests |
| Fonctions et crons | Stable | Le point d'entrée portable (`@rebasepro/server/functions`) est un contrat versionné avec sa propre section de surface d'API |
| Serveur MCP + compétences d'agent | Bêta | `@rebasepro/mcp` s'exécute sur stdio : cinquante-trois outils, authentification bearer par projet, les outils destructifs refusent les cibles non locales sauf consentement explicite. Depuis la version 0.21, le serveur peut également monter un endpoint distant `/mcp` — OAuth 2.1, dix-sept outils de données (les quatre pour les applications sauvegardées étant expérimentaux), chaque appel sous le RLS propre à la personne connectée — désactivé sauf si `REBASE_MCP_ENABLED=true`, et réservé à Postgres |
| Studio (SQL, schéma, RLS, explorateur d'API) | Bêta | Utilisé quotidiennement sur de vrais projets. Le branching est présent dans le paquet open source et délibérément non exposé dans Rebase Cloud, car le basculement d'un déploiement en cours d'exécution sur une branche n'est pas encore pris en charge |
| CMS + panneau d'administration | Bêta | Complet pour le CRUD, les relations, les champs de stockage et les rôles. **La table de données ne dispose pas de sémantique de grille** — pas de `role`, pas de `aria-rowindex`, `tabIndex` retiré — ce qui empêche les utilisateurs naviguant au clavier ou par lecteur d'écran d'utiliser la vue principale. Pas de brouillons, pas de contenu par locale, pas de texte riche sous forme de blocs |
| Base de données de dev gérée PGlite | Bêta | `rebase dev` sans configuration et sans Docker. Une seule session à la fois, les requêtes sont donc sérialisées et la concurrence ne peut pas être reproduite dessus ; les commandes `db push` et `db generate` utilisent Ptah pour planifier sur une seconde instance PGlite temporaire ; `db migrate` applique l'historique des migrations ; `db branch` n'y fonctionne pas et l'indique explicitement |
| Chart Helm | Bêta | Génère la topologie en processus séparés et est publié sur le registre OCI à chaque version. La configuration par défaut reste un conteneur unique |
| `@rebasepro/firebase` | Expérimental | Firestore en tant que source lue directement par le panneau d'administration, aux côtés des tables du backend : `defineFirestoreCollection` dans `frontend/src/cms`, passé en tant que `externalCollections`. Aucun RLS, aucune surface SQL ; les fonctionnalités de Postgres ne sont pas transposées. Le pilote Firestore ignore les groupes de filtres `or(...)`/`and(...)`, par conséquent une requête qui en utilise un lira toutes les lignes autorisées par ses filtres simples |
| Rebase Cloud | **Bêta privée** | En production, exécutant de vrais tenants, ouvert par vagues. Pas d'accès en libre-service |

Deux éléments ci-dessus représentent le coût de transparence lié à la publication
de ce tableau : la diffusion temps réel (fan-out) pour les listes restreintes
uniquement par la RLS et l'accessibilité de la table de données sont des limites
actuelles, pas des éléments de feuille de route, et toutes deux sont mentionnées
ici plutôt que laissées à la découverte de l'utilisateur.

Ce tableau présente ce qui existe aujourd'hui. Ce qui n'existe pas encore figure
sur la [roadmap](https://rebase.pro/roadmap), à raison d'une entrée par issue GitHub,
avec le sous-ensemble requis pour la version 1.0 identifié.

## La promesse de la 0.x

Rebase est en `0.x`. Cette section est rédigée pour s'appliquer à chaque version 0.x
plutôt qu'à une seule en particulier, afin de ne pas devenir obsolète à chaque cycle.
**Les changements cassants sur l'API TypeScript écrite par l'utilisateur sont
toujours autorisés dans une version mineure**, et le changelog est l'endroit où ils
sont annoncés. Ce qui n'est *pas* autorisé à casser silencieusement est l'ensemble
des contrats versionnés ci-dessous : chacun est gravé dans un artefact ou une base
de données, chacun est vérifié au démarrage ou à la réception, et chacun échoue de
**manière explicite et spécifique** plutôt que de se dégrader silencieusement.

Cette distinction constitue l'intégralité de la promesse. Un export renommé vous
coûte une erreur de compilation et cinq minutes. Un bundle qui démarre sur un
mauvais runtime et sert des données subtilement erronées vous coûte un incident,
et les contrats existent pour que cette seconde catégorie ne puisse jamais se
produire en silence.

Rebase Cloud utilise exactement ces contrats et rien d'autre. Tout ce qui n'est pas
listé ici est un détail d'implémentation dont la plateforme ne dépend pas.

### Badges de version et canaries

La documentation étant publiée depuis `main`, une page peut décrire une fonctionnalité
qu'aucune version stable ne possède encore. Un badge *Since* indique la première
version stable qui l'intègre, et le texte adjacent précise le comportement de la
version précédente.

Une version canary est une compilation de `main` numérotée selon la version vers
laquelle elle se dirige : `0.25.0-canary.g<commit>` correspond à `main` à ce commit,
après la 0.24.0 et avant la 0.25.0, et `rebase upgrade --to canary` installe la plus
récente. Elle intègre tout ce qui a atteint `main` au moment de sa compilation ; un
badge mentionnant sa version s'applique donc à vous, et la note sur la version
précédente décrit la version stable dont vous provenez.

## Les contrats versionnés

Les valeurs ci-dessous sont extraites du code source ; considérez les références
de fichiers comme la source de vérité et ce tableau comme le guide.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrat | Déclaré dans | Vérifié dans | Sens de compatibilité |
|---|---|---|---|---|
| 1 | Plage `rebase` dans `rebase.json` | le projet de l'utilisateur | Le CLI lors du build | Le projet définit les runtimes qu'il accepte |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **Rétrocompatible** quand l'agencement le permet — le format 3 refuse les formats 1 et 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | même fichier | même fichier | **Correspondance exacte, dans les deux sens** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | au démarrage, contre `rebase.schema_meta` | **Ascendant uniquement** — un nouveau runtime migre les anciennes bases de données |
| 5 | `manifest.schemaVersion` | émis par `rebase build` | envoyé par le SDK via `x-rebase-schema` lorsqu'il est configuré | Informatif — identifie par rapport à quel schéma un client a été compilé |
| 6 | Identifiants dérivés de base de données | `contracts/derived-names.txt` | `pnpm check:derived-names` | **Figé** — un nom émis par une version n'est jamais redérivé |

### 1 — `rebase` dans `rebase.json`

Une plage semver, interprétée comme le champ `engines` d'un `package.json` : indique
quelles versions de runtime ce projet accepte. Nommé délibérément `rebase` plutôt
que `runtime`, car `runtime` désigne déjà *l'entité qui possède le processus*
(`managed` | `custom`) sur une application.

### 2 — `BUNDLE_FORMAT_VERSION` (actuellement 3)

L'agencement sur disque d'un bundle compilé. Un runtime refuse un bundle dont le
format est plus récent que le sien, et lit un format plus ancien lorsque la
disposition le permet, ce qui permet à l'offre managée de basculer un tenant sur
une nouvelle image sans obliger quiconque à recompiler son projet.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` sous forme d'un dossier
  unique, `entry.admin` pour une interface d'administration embarquée.
- **2** — `kind: "backend" | "static"`, `entry.static` sous forme de liste, `entry.admin`
  supprimé.
- **3** (0.31) — le schéma est `entry.tables`, le `backend/schema` compilé, aux
  côtés de `entry.resources`, `entry.storage` et `entry.hooks` ; `entry.config`,
  `entry.collections` et `entry.usersCollection` ont disparu. **Les formats 1 et 2
  sont refusés, et non mis à niveau** : ils transportent `config/collections`, qu'un
  runtime lisant `backend/schema` ne sait pas interpréter, et en démarrer un
  entraînerait une introspection de la base de données servant une API différente.
  Le refus mentionne `rebase migrate collections-to-tables` ; migrez le code source
  et recompilez. C'était la seule rupture de rétrocompatibilité, opérée conjointement
  avec la montée de version du contrat de runtime ci-dessous.

**Incrémentez-le lorsque** l'agencement change de telle sorte qu'un runtime plus
ancien interpréterait incorrectement un bundle plus récent. Cette incrémentation
est ce qui transforme un « démarre et ne sert rien » en un refus net de démarrage.

### 3 — `RUNTIME_CONTRACT_VERSION` (actuellement 2)

La version majeure du contrat bundle↔runtime. Distincte de la version du paquet
`@rebasepro/server`, qui peut publier de nombreuses versions mineures et correctifs
pendant que celle-ci reste inchangée.

**Lisez ceci avant d'y toucher.** La vérification est un `!==`, pas un `>` :

> un bundle ciblant le contrat *N* s'exécute **uniquement** sur un runtime implémentant *N*

par conséquent, l'incrémenter invalide **absolument tous les bundles jamais compilés**,
d'un seul coup, jusqu'à ce que chacun soit recompilé. C'est le niveau de sévérité
voulu — c'est le levier « rien d'ancien ne peut tourner ici » — mais cela implique
qu'une incrémentation correspond à une migration de l'ensemble du parc, et non à une
simple note de version. Pour l'infrastructure managée, elle doit être synchronisée
avec une recompilation du bundle de chaque tenant.

Si une modification est *additive* et que les anciens bundles restent valides, elle
relève de `BUNDLE_FORMAT_VERSION` (ou de rien du tout), pas de celle-ci. La version 0.31
l'a passée à 2, avec le format de bundle 3 : le modèle de schéma a changé, et le bundle
de chaque tenant est recompilé à partir des sources migrées.

### 4 — `AUTH_SCHEMA_VERSION` (actuellement 2)

Gravé dans `rebase.schema_meta` et comparé au démarrage. Un runtime **refuse de
démarrer** sur une base de données migrée par une version plus récente du framework,
plutôt que d'opérer sur une structure qu'il ne comprend pas — lors d'un déploiement
progressif (rolling deploy), c'est la différence entre la moitié du parc qui renvoie
des erreurs et la moitié du parc qui corrompt des données.

La migration descendante vers l'amont (forward migration) est automatique :
`ensureAuthTablesExist` met à niveau une base de données plus ancienne. Notez que ce
bloc de migration est délibérément enveloppé dans un `try/catch` et consigne des logs
au lieu de lever une exception — un démarrage en mode dégradé vaut mieux qu'une boucle
infinie de crashs — par conséquent, **« il a démarré » ne prouve rien**. Chaque
assertion dans la suite de tests de mise à niveau vérifie le catalogue ou les données.

**Incrémentez-le lorsqu'une** migration ne doit en aucun cas être ignorée par un
runtime plus ancien. Ne l'incrémentez pas pour une colonne additive et rétrocompatible ;
un cas pratique illustrant cet arbitrage est disponible dans
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hachage des descripteurs de tables compilés (`v2:…` depuis la 0.31), inscrit
dans le manifeste du bundle et renvoyé par un SDK généré dans l'en-tête
`x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Il existe pour permettre à la plateforme
d'indiquer « cette application a été compilée avec un schéma plus ancien » au lieu
d'échouer mystérieusement dès la première requête.

`rebase generate-sdk` écrit cette valeur dans `schema.meta.ts` ; passez-la au
client pour qu'il la transmette :

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Le backend lit cet en-tête sur chaque requête de données. Un écart de version ne
refuse jamais un appel — un SDK en retard d'un schéma reste généralement compatible,
et déployer le backend avant le frontend est l'ordre de déploiement classique — mais
lorsqu'une requête échoue avec une erreur 400 ou 404, l'erreur porte cet écart
comme cause :

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

Ainsi, une colonne renommée se signale par « votre SDK est obsolète, régénérez-le »
plutôt que par un champ dont vos propres types affirment l'existence. Une requête
qui réussit n'en est jamais informée.

Cela ne couvre **que les tables** — leurs descripteurs compilés, dans lesquels un
hook se résume à un drapeau de présence. Le code d'un hook ou la modification d'une
fonction ne modifie pas le contrat du client et ne doit pas invalider tous les SDK
générés. Comme la version 0.31 a déplacé le hachage des collections vers les
descripteurs, chaque base de données marquée `v1:` signale ce changement une fois,
avec la réactualisation de l'empreinte (démarrage du propriétaire du schéma, ou
`rebase db push`), et chaque SDK généré apparaît comme obsolète une fois.

### Qui appelle

Deux signaux d'identification supplémentaires, dont aucun ne bloque quoi que ce
soit à lui seul :

- **`GET /api/meta/schema-version`** ne nécessite pas d'authentification et renvoie
  le `schemaVersion` du projet *ainsi que* son `runtime` (`version` et `contract`).
  Un job de CI comparant son SDK généré avec un projet en production n'a pas besoin
  d'identifiants, tout comme un client souhaitant savoir à quel runtime il s'adresse.
- **`User-Agent: rebase-cli/<version>`** accompagne chaque requête `rebase cloud`.
  Le format réseau du plan de contrôle évolue plus vite que ce qui est publié sur
  npm, il doit donc pouvoir répondre `CLI_TOO_OLD` avec la version minimale requise
  à un client trop ancien — ce qu'il ne peut faire que pour un appelant qui
  déclare son identité.

### 6 — Identifiants dérivés de base de données

Chaque nom que ce framework détermine par lui-même plutôt que par configuration
explicite : une colonne de clé étrangère, une contrainte de clé étrangère, une
table de jonction et ses deux colonnes de clés, un type enum, un nom de politique,
la colonne en `snake_case` issue d'une clé de colonne en `camelCase`. Depuis la 0.31,
les tables sont déclarées avec `defineTable`, qui dérive exactement les mêmes noms
que ceux qu'une collection dérivait pour un schéma équivalent ; `rebase migrate
collections-to-tables` le prouve pour chaque projet en comparant le SQL généré
octet par octet.

> **Un identifiant dérivé est figé dès l'instant où une version l'émet.**

Pas « figé jusqu'à la prochaine majeure » — figé définitivement. La logique diffère
des cinq autres contrats et est plus contraignante. Les autres sont versionnés,
donc une incompatibilité peut être *détectée* et refusée. Pas celui-ci : le nom est
écrit dans la base de données d'un client le jour de son déploiement, et il n'y a
aucun marquage de version sur une colonne. Chaque base de données provisionnée par
chaque version jamais publiée conserve les noms qu'elle a dérivés, et aucun code
dans ce dépôt ne peut aller renommer l'ensemble de ces colonnes.

La version 0.13 en est un exemple concret. `generateForeignKeyName` a appris à
singulariser correctement les noms — `categorie_id` → `category_id`, `addres_id` →
`address_id` — ce qui constitue indiscutablement une meilleure dérivation, mais
a brisé toutes les bases de données existantes qui contenaient un pluriel irrégulier.
Le mécanisme d'initialisation au démarrage a migré la colonne, préservant ainsi
les données ; en revanche, le fichier `schema.generated.ts` versionné dans le projet
ne l'était pas, et le démarrage a échoué sur une colonne qui existait pourtant. Trois
commits, un nouveau test d'intégration et une entrée permanente dans les notes de
mise à niveau, tout cela en échange d'un nom de colonne plus élégant que personne
n'avait demandé.

**Si une dérivation est véritablement erronée**, elle est modifiée uniquement
pour les tables créées *ultérieurement*, via une stratégie de nommage consignée
dans le projet — jamais rétroactivement, et jamais comme effet secondaire de
l'amélioration de la fonction sous-jacente.

**La seule dérogation légitime** est une modification qui aligne le code sur un
nom que la base de données *possède déjà*. L'exemple concret est la troncature des
identifiants : Postgres tronque silencieusement les identifiants à 63 octets, de sorte
qu'un nom de contrainte dérivé plus long n'a jamais été le nom présent dans le
catalogue — la dérivation décrivait un objet qui n'existait pas sous cette orthographe,
et le processus d'initialisation réémettait `ADD CONSTRAINT` à chaque démarrage
parce que sa comparaison ne pouvait jamais concorder. Tronquer à la construction
modifie ce que ce dépôt *dérive*, sans rien changer à ce qu'une base de données
déployée *contient*. C'est le test à appliquer : non pas « le nouveau nom est-il
meilleur », mais « une base de données existante doit-elle être modifiée ».

L'autre cas où un nom peut changer concerne un ensemble de noms qui ne pourraient
jamais coexister. Une règle couvrant plusieurs opérations sur une table de 42 octets
ou plus dérivait `<table>_default_admin_write_insert`, `_update` et `_delete`, et
tous trois étaient tronqués aux mêmes 63 octets. Postgres n'enregistrait qu'une seule
politique, DELETE, et refusait chaque INSERT et UPDATE administrateur. C'est
uniquement lorsque les noms d'une règle entrent ainsi en collision qu'ils sont
dérivés avec le suffixe en priorité, sous la forme `<head>_<hash8>_<op>`. Chaque nom
fonctionnel aujourd'hui conserve son orthographe. Le prochain démarrage ou push
supprime la politique tronquée unique et crée une politique pour chaque opération.

La seule opération toujours sûre consiste à *reconnaître* un ancien nom afin de le
migrer : `legacyForeignKeyName` existe pour être détecté, jamais pour être généré,
et la référence fige également ces détections. En abandonner une annule silencieusement
la migration de chaque base de données portant encore cette orthographe.

**La barrière de contrôle.** `tooling/scripts/derived-names.mts` soumet un jeu d'essai
de cas complexes de nommage — pluriels irréguliers, terminaison en `ss`, acronymes,
jonction depuis un slug au pluriel, surcharges explicites, slug suffisamment long
pour être tronqué — aux deux générateurs de DDL de schéma, et produit chaque
identifiant nommé par l'un ou l'autre :

```bash
pnpm check:derived-names
```

Une ligne modifiée ou supprimée échoue en tant que rupture de contrat, en affichant
l'ancienne et la nouvelle orthographe côte à côte. Un changement purement additif
échoue également, mais avec un message demandant de « régénérer » — afin que la
référence de base ne dérive sous les pieds de personne.

Cela garantit également que `rebase db push` et l'initialisation au boot du runtime
managé dérivent exactement les *mêmes* noms, ce qui constitue un second contrat
dissimulé dans le premier : ils compilent les mêmes tables via du code différent,
et un projet poussé une fois puis démarré plus tard ne doit pas se retrouver avec
deux schémas distincts.

## Ce qui n'est *pas* figé

Exprimé en toute franchise, afin que personne n'en déduise une promesse qui n'a
jamais été faite :

- L'API TypeScript rédigée par l'utilisateur — `defineTable` et `customizeTable`,
  les options de `initializeRebaseBackend`, les props de l'admin, les noms de
  méthodes du SDK. La 0.31 a remplacé les collections par des tables dans une
  version mineure, avec un codemod qui prouve que le SQL généré reste inchangé.
  Les changements cassants arrivent dans des versions mineures et sont annoncés
  dans le changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — ces paquets évoluent le plus rapidement et ont le moins
  d'utilisateurs.
- Tout élément situé sous le dossier `src/` d'un paquet qui n'est pas réexporté
  depuis son point d'entrée principal (barrel). `packages/client/src/index.ts`
  comporte une note expliquant que sa liste d'exports est soigneusement organisée
  précisément pour éviter qu'un export interne ne devienne public par inadvertance.
- Le schéma de base de données de *vos* tables. Il vous appartient ; Rebase ne
  possède que le schéma `rebase` (et, sur une base provisionnée avant la 0.13,
  l'ancien schéma `auth` jusqu'à ce que le démarrage le retire).

## Les barrières qui protègent ces contrats

Rien de ce qui précède n'est une simple convention — chaque point dispose d'un
test qui échoue en cas de rupture :

| Barrière | Ce qu'elle verrouille |
|---|---|
| `pnpm verify:corpus` | Chaque structure de bundle jamais publiée, démarrée sur le runtime d'aujourd'hui. Les fixtures dans `tests/fixtures/bundles/` sont **rédigées à la main et figées** — une fixture régénérée par l'outil de build évolue dès que l'outil de build évolue |
| `pnpm verify:selfhost` | Un vrai bundle compilé, assemblé, démarré et interrogé comme le ferait un navigateur |
| `upgrade-e2e.test.ts` | D'anciens schémas de base de données (`schema-snapshots/`) pris en charge par le runtime actuel |
| `tests/e2e/tests/cli-init-e2e.ts` | Un projet échafaudé installé à partir de **véritables archives tarball**, et non de liens de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | Le parcours de l'utilisateur final : inscription → connexion → lectures sous RLS → rafraîchissement → stockage → temps réel |
| `pnpm check:derived-names` | Chaque nom de colonne, contrainte, jonction, enum et politique dérivé par le framework — et l'assurance que le démarrage et `db push` les dérivent de manière identique |
| `pnpm rls:check` | Les politiques de sécurité du schéma généré |
| `pnpm check:api-surface` | Chaque export, et ses membres, des cinq paquets fournis par l'image — `@rebasepro/server`, `types`, `client`, `common`, `utils` — ainsi que le point d'entrée `@rebasepro/server/functions`, par rapport aux six sections de `contracts/server.api.txt`. Ce sont les paquets que `infra/docker/entrypoint.mjs` lie symboliquement sur les propres copies d'un bundle déployé ; supprimer un export de l'un d'eux n'est donc pas une simple erreur de compilation — c'est un échec au démarrage sur tout le parc, lors d'un déploiement non sollicité |
| `pnpm test:gates` | Les propres tests des barrières de validation, sur des fixtures — quarante-sept fichiers, parmi lesquels `check:api-surface` et la vérification de saut de version ci-dessous — afin qu'une barrière qui cesserait de détecter ce qu'elle protège échoue ici. `check:api-surface` a passé toute son existence sans pouvoir détecter la disparition d'un membre de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | Vérifie que le niveau d'incrémentation de version sous lequel une release est publiée correspond à ce que la release a modifié sur les références ci-dessus — exécuté par `publish.yml` avant que le changelog ne soit gravé |
| CI saas | Le plan de contrôle compilé contre la branche `main` de ce dépôt, sur ses propres pushs et chaque nuit |

**Enregistrez une fixture de bundle et un instantané de schéma une fois par version.**
La valeur de ces deux corpus réside entièrement dans l'ancienneté du plus ancien
d'entre eux, et aucun ne peut être reconstitué a posteriori.

### Pas encore sous contrôle automatisé

Le tableau ci-dessus représente ce qui est aujourd'hui verrouillé. Voici les parties
de la politique qu'aucun test ne verrouille pour l'instant, listées afin que nul n'y
voie un engagement implicite :

- **Aucune période de dépréciation ou de support.** Tant que Rebase est en `0.x`,
  il n'y a pas de règle écrite fixant la durée de maintien d'un export déprécié avant
  sa suppression, ni la durée pendant laquelle une ancienne version mineure reçoit
  des correctifs. Les correctifs de sécurité ne sont appliqués que sur la dernière mineure.
- **Le format réseau HTTP ne fait l'objet d'aucune barrière de contrôle.** Aucun script
  `check:*` ne compare les structures de requête et de réponse à une référence comme
  le fait `check:api-surface` pour les exports ; une modification de la structure de
  réponse n'est interceptée que par une suite e2e qui se trouve la lire.
- **Les options du CLI ne disposent d'aucune référence de compatibilité.** Le vérificateur
  de documentation échoue lorsqu'une option utilisée par les compétences, les exemples
  ou le site marketing disparaît ; rien ne détecte la disparition d'une autre option,
  ni le changement de sens d'une option.
- **Une release de CI n'enregistre aucun des deux corpus.** Le workflow de publication
  n'enregistre aucune fixture de bundle ni aucun instantané de schéma ; seul le script
  de release local s'y emploie, et il émet un avertissement plutôt que de s'arrêter
  lorsqu'il n'y parvient pas. Les versions 0.18 à 0.21 ne disposent d'aucun instantané
  de projet enregistré.
- **La surface d'export est une barrière, pas un contrat.** La décision de faire des
  exports publics des paquets fournis par le runtime un septième contrat numéroté —
  déclaré comme la référence `check:api-surface`, rétrocompatible de façon additive
  au sein d'une version majeure de contrat — reste en suspens.

## Modifier un contrat

1. Déterminez duquel des six il s'agit. La plupart des modifications ne relèvent
   d'aucun d'eux — mais « aucun des six » ne veut pas dire « sans conséquence ».
   Supprimer ou renommer un export de `@rebasepro/server`, ou un de ses membres, ne
   relève d'aucun des six contrats et constitue pourtant la modification la plus
   dangereuse du dépôt, car le code qu'elle casse est déjà compilé et ne sera pas
   recompilé. C'est `pnpm check:api-surface` qui maintient cette ligne de défense ;
   la question de savoir si cela devient un septième contrat numéroté reste ouverte
   (voir *Pas encore sous contrôle automatisé* ci-dessus).
2. Ajoutez d'abord une fixture ou un instantané pour l'**ancienne** structure, et
   vérifiez qu'elle passe.
3. Apportez la modification et incrémentez la constante.
4. Confirmez que l'ancienne fixture passe toujours, ou qu'elle échoue désormais
   *avec le message d'erreur utile pour l'utilisateur*. Les deux sont des résultats
   valables ; un silence ne l'est pas.
5. Pour le contrat 3, planifiez la recompilation de chaque bundle déployé avant de fusionner.
6. Le contrat 6 est l'exception aux étapes 3 et 4 : il n'y a aucune constante à
   incrémenter et aucune version sur laquelle refuser l'opération, car une colonne
   ne porte aucun tampon de version. L'étape qui les remplace consiste à décider de
   ne pas faire la modification — consultez la section ci-dessus pour comprendre à
   quoi ressemble l'alternative.

## Voir aussi

- [Mise à niveau](/docs/upgrading/) — ce qui a réellement changé, version par version
- [Changelog](/docs/changelog/) — chaque changement, y compris ceux sans rupture
- [Runtime et Bundles](/docs/architecture/runtime-and-bundles/) — contrat 3 — le format de bundle avec lequel un projet déployé est déjà compilé
