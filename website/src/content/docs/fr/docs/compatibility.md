---
sourceHash: ec13f8f9c203aae2
slug: fr/docs/compatibility
title: Compatibilité
description: Ce que Rebase garantit d'une version à l'autre et ce qu'il ne garantit pas — les six contrats versionnés, la manière dont chacun échoue et ce qui peut encore changer dans une version mineure.
---

Ce que Rebase garantit d'une version à l'autre, et ce qu'il ne garantit pas.

C'est le document à lire avant de modifier quoi que ce soit dont dépend déjà un
projet déployé ou un tenant Rebase Cloud en cours d'exécution. C'est aussi la
réponse honnête à la question : « si je développe sur Rebase aujourd'hui, qu'est-ce
qui risque de casser sous mes pieds plus tard ? »

## Ce que « bêta » signifie ici

Rebase est en bêta publique. La plupart des projets utilisent ce terme pour dire
« tout peut casser », ce qui n'apporte aucune visibilité permettant de planifier
quoi que ce soit. Voici donc la limite réelle fixée par ce projet :

> **L'API sur laquelle vous écrivez du code peut changer lors d'une version
> mineure, avec une entrée dans le journal des modifications (changelog). Vos
> données ne peuvent pas être corrompues ou cassées silencieusement.**

La première moitié correspond au comportement habituel d'une version `0.x` et
est décrite ci-dessous. La seconde moitié est la partie qui mérite vérification,
car il s'agit d'une affirmation sur des mécanismes et non sur des intentions :
les contrats versionnés de la section suivante sont chacun gravés dans un
artefact ou une base de données, chacun est vérifié au démarrage ou à la réception,
et chacun **échoue de manière explicite et spécifique** plutôt que de se dégrader.
Une mise à jour de schéma (push) qui supprimerait une colonne est refusée par un
verrou de sécurité contre les opérations destructives
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), et le processus de
mise à niveau est lui-même un test : `upgrade-e2e.test.ts` restaure des bases de
données telles que les versions antérieures les avaient laissées, exécute le
processus de migration actuel sur chacune d'elles et s'assure que les lignes
survivent — pas seulement que le démarrage a réussi.

Ce que la bêta signifie concrètement : certaines fonctionnalités manquent encore,
certains sous-systèmes sont plus récents que d'autres, et la nature d'une aspérité
se traduit par quelque chose d'absent ou de peu pratique, et non par la
corruption silencieuse de données. L'état de chaque sous-système est publié et
daté plutôt que laissé à la découverte empirique — le tableau ci-dessous en est
la publication officielle.

## État de préparation par sous-système

**Dernière révision le 14 septembre 2026, pour la version 0.21.0.** À relire à chaque
version mineure ; une évaluation qui n'a pas bougé depuis trois versions est soit
stabilisée, soit oubliée, et cette note est là pour que la différence soit vérifiée.

Les trois évaluations signifient :

- **Stable** — la forme est fixée et couverte par une barrière de validation en CI.
  Elle peut encore recevoir de nouvelles fonctionnalités ; elle ne subira pas de
  refonte majeure sous vos pieds au sein de la branche 0.x, et tout changement qui
  pourrait casser votre code sera annoncé dans le changelog.
- **Bêta** — elle fonctionne et est utilisée en production, mais comporte des
  aspérités connues : une limite que l'on peut atteindre, un cas limite peu
  pratique, un choix d'architecture pas encore tranché. L'aspérité est mentionnée
  dans les notes, car le mot « bêta » à lui seul ne vous donne aucune information
  exploitable pour planifier.
- **Expérimental** — livré pour pouvoir être utilisé et faire l'objet de retours.
  Attendez-vous à rencontrer les zones encore inexplorées.

| Sous-système | Évaluation | Ce sur quoi repose l'évaluation |
|---|---|---|
| API REST + SDK généré | Stable | Le contrat de communication (wire) est versionné et validé par des tests d'accès ; `client-sdk-e2e` pilote de bout en bout l'enregistrement → la connexion → les lectures restreintes par RLS → le rafraîchissement → le stockage → le temps réel |
| Auth — e-mail/mot de passe, OAuth, OIDC, lien magique, code à usage unique | Stable | Douze fournisseurs OAuth sont intégrés. Le schéma d'authentification est un contrat versionné, gravé et vérifié au démarrage |
| Auth — MFA (TOTP) | Bêta | L'enrôlement, la vérification et la récupération fonctionnent et sont testés. La rotation de clé est implémentée pour la clé de chiffrement ; il n'y a pas d'interface d'administration pour réinitialiser le facteur d'un utilisateur bloqué |
| Sécurité au niveau des lignes (RLS) | Stable | La clé de voûte du produit. `pnpm rls:check` audite une base de données active par rapport à quinze points de contrôle, et la suite e2e RLS s'exécute à chaque push |
| Stockage | Stable | Local, S3 et GCS. Refus par défaut en production depuis la 0.17.0, et le modèle initial (scaffold) inclut un hook d'autorisation |
| Temps réel | **Bêta** | Les abonnements sont filtrés uniquement par chemin de collection : N abonnés sur une même collection coûtent N ré-extractions soumises aux règles RLS par écriture. Cela limite un déploiement à quelques centaines d'abonnés simultanés. Exact à toute échelle ; coûteux au-delà de cette limite |
| Recherche vectorielle (pgvector) | Bêta | Chaque colonne vectorielle reçoit par défaut un index HNSW pour la distance cosinus, paramétrable par propriété via `VectorIndexConfig` (méthode, distances, paramètres de construction) ou désactivable, ce qui laisse un scan exact. pgvector ne peut pas indexer une colonne de plus de 2 000 dimensions, celles-ci restent donc non indexées et utilisent un scan |
| Synchronisation hors ligne | Bêta | Les mutations portent des clés d'idempotence respectées par le serveur, et les défauts de perte de données identifiés lors de l'audit de juillet sont corrigés. Le modèle de conflit applique le principe de « dernière écriture gagnante » sans fusion par champ |
| Historique des entités | Stable | Basé sur des instantanés (snapshots), validé par sa propre suite de tests |
| Fonctions et tâches cron | Stable | Le point d'entrée portable (`@rebasepro/server/functions`) est un contrat versionné avec sa propre section de surface d'API |
| Serveur MCP + compétences agent (agent skills) | Bêta | `@rebasepro/mcp` s'exécute sur stdio : quarante-deux outils, authentification bearer par projet, les outils destructifs refusent les cibles non locales sauf consentement explicite. Depuis la 0.21, le serveur peut également monter un endpoint distant `/mcp` — OAuth 2.1, six outils de données, chaque appel sous le RLS de la personne connectée — désactivé sauf si `REBASE_MCP_ENABLED=true`, et Postgres uniquement |
| Studio (SQL, schéma, RLS, explorateur d'API) | Bêta | Utilisé quotidiennement sur des projets réels. Le système de branches est présent dans le paquet open-source et délibérément non exposé dans Rebase Cloud, car le basculement d'un déploiement actif sur une branche n'est pas encore pris en charge |
| CMS + panneau d'administration | Bêta | Complet pour le CRUD, les relations, les champs de stockage et les rôles. **Le tableau de données n'a pas de sémantique de grille** — pas de `role`, pas d'`aria-rowindex`, `tabIndex` supprimé — si bien que les utilisateurs du clavier et des lecteurs d'écran ne peuvent pas utiliser la vue principale. Pas de brouillons, pas de contenu par langue, pas de texte enrichi par blocs |
| Base de données de dev gérée PGlite | Bêta | `rebase dev` sans configuration et sans Docker. Une seule session à la fois, les requêtes sont donc sérialisées et la concurrence ne peut pas être reproduite dessus ; les commandes basées sur Atlas (`db push`, `generate`, `migrate`) ne fonctionnent pas dans cet environnement et le signalent |
| Helm chart | Bêta | Restitue la topologie en processus séparés et est publié sur le registre OCI à chaque version. Le comportement par défaut reste un conteneur unique |
| `@rebasepro/server-mongo` | **Expérimental** | Un pilote fonctionnel avec temps réel basé sur les flux de modification (change streams) et historique par instantanés. **Pas de sécurité au niveau des lignes (RLS)** — l'ensemble du modèle d'isolation ci-dessus ne s'y applique pas — et pas de relations. Les flux de modification nécessitent un replica set : sur un `mongod` autonome, rien ne les remplace, de sorte qu'un abonnement voit les écritures effectuées via ce processus Rebase et manque toutes les autres. Pas de MFA : l'enrôlement renvoie 501, et les vérifications répondent « aucun facteur », si bien que la connexion n'en demande jamais. L'agrégat d'administration ne peut pas cibler une collection — il lit le nom depuis une étape `$from` que MongoDB ne possède pas — et ne renvoie donc rien |
| `@rebasepro/firebase` | Expérimental | Exécute le panneau d'administration et le SDK sur Firestore. Pas de RLS, pas de surface SQL ; l'ensemble des fonctionnalités Postgres n'est pas transposé. Le pilote Firestore ignore les groupes de filtres `or(...)`/`and(...)` ; une requête qui en utilise un lit donc toutes les lignes permises par ses filtres simples |
| Rebase Cloud | **Bêta privée** | En production, hébergeant de vrais tenants, ouvert par vagues. Pas de libre-service (self-serve) |

Deux entrées ci-dessus représentent le coût de l'honnêteté nécessaire à la
publication de ce tableau : la ré-extraction temps réel et l'accessibilité de
la table de données sont des anomalies ouvertes, pas des éléments de la feuille
de route, et les deux sont documentées ici plutôt que laissées à la découverte
de l'utilisateur.

Ce tableau reflète ce qui existe. Ce qui n'existe pas encore figure sur la
[feuille de route](https://rebase.pro/roadmap), à raison d'une entrée par issue
GitHub, avec la mention du sous-ensemble requis pour la version 1.0.

## La promesse de la branche 0.x

Rebase est en version `0.x`. Cette section est rédigée pour s'appliquer à chaque
version 0.x plutôt qu'à une seule d'entre elles, afin de ne pas devenir obsolète
à chaque release. **Des changements cassants (breaking changes) sur l'API TypeScript
écrite sont toujours autorisés lors d'une version mineure**, et le journal des
modifications est le lieu où ils sont annoncés. Ce qui n'est
*pas* autorisé à casser silencieusement est l'ensemble des contrats versionnés
ci-dessous : chacun est gravé dans un artefact ou une base de données, chacun
est vérifié au démarrage ou à la réception, et chacun échoue **de manière
explicite et spécifique** plutôt que de se dégrader.

Cette distinction constitue l'intégralité de la promesse. Une exportation renommée
vous coûte une erreur de compilation et cinq minutes. Un bundle qui démarre sur un
mauvais environnement d'exécution et sert des données subtilement erronées vous
coûte un incident de production, et ces contrats existent précisément pour que la
seconde catégorie ne puisse jamais survenir en silence.

Rebase Cloud utilise exactement ces contrats et rien d'autre. Tout ce qui ne
figure pas dans cette liste est un détail d'implémentation dont la plateforme
ne dépend pas.

## Les contrats versionnés

Les valeurs ci-dessous sont lues à partir du code source ; considérez les
références de fichiers comme la source de vérité et ce tableau comme la carte.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrat | Déclaré dans | Vérifié dans | Sens de compatibilité |
|---|---|---|---|---|
| 1 | Plage `rebase` dans `rebase.json` | le projet de l'utilisateur | CLI au build | le projet indique quels runtimes il accepte |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **rétrocompatible** — un runtime récent lit les anciens bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | même fichier | même fichier | **correspondance exacte, dans les deux sens** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | au démarrage, via `rebase.schema_meta` | **vers l'avant uniquement** — un runtime récent migre les anciennes bases |
| 5 | `manifest.schemaVersion` | émis par `rebase build` | envoyé par le SDK via `x-rebase-schema` lorsque configuré | indicatif — identifie le schéma utilisé pour générer un client |
| 6 | Identifiants de base de données dérivés | `contracts/derived-names.txt` | `pnpm check:derived-names` | **figé** — un nom émis par une version n'est jamais recalculé |

### 1 — `rebase` dans `rebase.json`

Une plage semver, lue de la même façon que `engines` dans un `package.json` :
les versions de runtime que ce projet accepte. Délibérément nommé `rebase`
plutôt que `runtime`, car `runtime` désigne déjà *l'entité propriétaire du
processus* (`managed` | `custom`) sur une application.

### 2 — `BUNDLE_FORMAT_VERSION` (actuellement 2)

La disposition sur disque d'un bundle compilé. Un runtime accepte tout bundle
dont le format est **inférieur ou égal** au sien, ce qui permet à l'offre gérée
de migrer un tenant vers une nouvelle image sans que personne n'ait à recompiler
son projet.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` sous forme de
  répertoire unique, `entry.admin` pour une interface d'administration intégrée.
- **2** — `kind: "backend" | "static"`, `entry.static` sous forme de liste,
  `entry.admin` supprimé. Le format 1 est toujours lu, via `upgradeLegacyManifest`.

**Incrémentez-le lorsque** la disposition change de sorte qu'un runtime plus
ancien interpréterait mal un bundle plus récent. Cette incrémentation transforme
un « démarre et ne sert rien » en un refus net de démarrer.

### 3 — `RUNTIME_CONTRACT_VERSION` (actuellement 1)

La version majeure du contrat bundle↔runtime. Distincte de la version du paquet
`@rebasepro/server`, qui peut publier un nombre indéfini de versions mineures et
correctifs pendant que celle-ci reste inchangée.

**À lire avant toute modification.** La vérification utilise `!==`, pas `>` :

> un bundle ciblant le contrat *N* s'exécute **uniquement** sur un runtime implémentant *N*

l'incrémenter invalide donc **absolument tous les bundles jamais créés**, en une
seule fois, jusqu'à ce que chacun soit recompilé. C'est la sévérité voulue — c'est
le levier « plus rien d'ancien ne peut tourner ici » —, mais cela signifie qu'une
incrémentation est une migration à l'échelle de tout le parc, et non une simple note
de version. Pour l'offre gérée, elle doit être synchronisée avec une recompilation
du bundle de chaque tenant.

Si une modification est *additive* et que les anciens bundles restent valides,
elle relève de `BUNDLE_FORMAT_VERSION` (ou de rien du tout), et non de celle-ci.

### 4 — `AUTH_SCHEMA_VERSION` (actuellement 2)

Gravé dans `rebase.schema_meta` et comparé au démarrage. Un runtime **refuse de
démarrer** sur une base de données migrée par une version plus récente du framework,
plutôt que d'opérer sur une structure qu'il ne comprend pas — lors d'un déploiement
progressif (rolling deploy), c'est ce qui fait la différence entre la moitié du
parc qui renvoie une erreur et la moitié du parc qui corrompt des données.

La migration ascendante est automatique : `ensureAuthTablesExist` met à niveau une
base plus ancienne. Notez que ce bloc de migration est délibérément encapsulé dans
un `try/catch` et consigne des logs plutôt que de lever une exception — un démarrage
dégradé vaut mieux qu'une boucle de crash —, donc **« le fait qu'il ait démarré »
ne prouve rien**. Chaque assertion de la suite de mise à niveau lit plutôt le
catalogue ou les données.

**Incrémentez-le lorsqu'** une migration ne doit absolument pas être ignorée par
un runtime plus ancien. Ne l'incrémentez pas pour une colonne additive et
rétrocompatible ; un cas pratique illustrant cet arbitrage est disponible dans
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash des définitions de collections compilées, inscrit dans le manifeste du
bundle et renvoyé en écho par un SDK généré dans l'en-tête `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Il existe pour que la plateforme puisse indiquer « cette
application a été compilée avec un ancien schéma » au lieu d'échouer de façon
incompréhensible dès la première requête.

`rebase generate-sdk` écrit la valeur dans `schema.meta.ts` ; transmettez-la au
client pour qu'il l'envoie :

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Le backend lit cet en-tête à chaque requête de données. Un écart de version
(drift) ne bloque jamais un appel — un SDK en retard d'une version de schéma reste
généralement compatible, et déployer le backend avant le frontend constitue
l'ordre de déploiement classique —, mais lorsqu'une requête échoue avec un code
400 ou 404, l'erreur inclut cet écart dans sa cause :

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

Ainsi, une colonne renommée est signalée par « votre SDK est obsolète,
régénérez-le », plutôt que par l'absence d'un champ que vos propres types
affirment exister. Une requête qui réussit n'en est jamais avertie.

Cela concerne **uniquement les collections**. La modification d'un hook ou d'une
fonction ne modifie pas le contrat du client et ne doit pas invalider tous les
SDK générés.

### Qui appelle

Deux signaux d'identification supplémentaires, dont aucun ne bloque quoi que ce
soit de manière autonome :

- **`GET /api/meta/schema-version`** est non authentifié et renvoie le
  `schemaVersion` du projet *ainsi que* son `runtime` (`version` et `contract`).
  Un job de CI comparant son SDK généré à un projet actif n'a besoin d'aucun
  identifiant, tout comme un client souhaitant savoir à quel runtime il s'adresse.
- **`User-Agent: rebase-cli/<version>`** accompagne chaque requête `rebase cloud`.
  Le format de communication (wire format) du plan de contrôle évolue plus vite
  que ce qui est publié sur npm ; il doit donc pouvoir répondre `CLI_TOO_OLD`
  avec la version minimale requise à un client obsolète — ce qu'il ne peut faire
  que si l'appelant s'identifie.

### 6 — Identifiants de base de données dérivés

Chaque nom que ce framework détermine de manière autonome plutôt que par saisie
explicite : une colonne de clé étrangère, une contrainte de clé étrangère, une
table de jonction et ses deux colonnes de clés, un type enum, un nom de politique
de sécurité, la colonne `snake_case` d'une propriété en `camelCase`.

> **Un identifiant dérivé est figé dès l'instant où une version le produit.**

Pas « figé jusqu'à la prochaine version majeure » — figé définitivement. La logique
est différente de celle des cinq autres contrats, et plus stricte. Ceux-ci sont
versionnés, de sorte qu'une incohérence peut être *détectée* et refusée. Pour
celui-ci, c'est impossible : le nom est inscrit dans la base de données d'un client
le jour où il déploie, et il n'y a pas d'estampille de version sur une colonne.
Chaque base de données provisionnée par n'importe quelle version publiée porte les
noms qu'elle a dérivés, et aucun code dans ce dépôt ne peut aller renommer
l'ensemble de ces bases.

La version 0.13 en est l'exemple concret. `generateForeignKeyName` a appris à
singulariser correctement — `categorie_id` → `category_id`, `addres_id` → `address_id` —,
ce qui est sans conteste une meilleure dérivation, mais cela a cassé toutes les bases
de données existantes qui possédaient un pluriel irrégulier. Le mécanisme de
vérification au démarrage (boot-ensure) a migré la colonne, les données ont donc
survécu ; mais le fichier `schema.generated.ts` archivé dans le projet ne l'était
pas, et le démarrage a échoué sur une colonne qui existait pourtant. Trois commits,
un nouveau test d'intégration et une note permanente dans le guide de mise à
niveau, tout cela en échange d'un nom de colonne plus élégant que personne n'avait
demandé.

**Si une règle de dérivation est véritablement incorrecte**, elle est modifiée pour
les collections créées *après coup*, sous le contrôle d'une stratégie de nommage
enregistrée dans le projet — jamais rétroactivement, et jamais comme effet de bord
de l'amélioration d'une fonction sous-jacente.

**La seule dérogation légitime** est une modification qui aligne le code sur un
nom que la base de données *possède déjà*. L'exemple concret en est la troncature
des identifiants : Postgres tronque silencieusement un identifiant à 63 octets ;
un nom de contrainte dérivé plus long ne correspondait donc jamais au nom figurant
dans le catalogue — la dérivation décrivait un objet qui n'existait pas sous cette
orthographe, et boot-ensure réexécutait `ADD CONSTRAINT` à chaque démarrage car sa
comparaison ne pouvait jamais correspondre. La troncature à la construction modifie
ce que ce dépôt *dérive* sans rien changer à ce qu'une base de données déployée
*contient*. C'est le test à appliquer : non pas « le nouveau nom est-il meilleur »,
mais « une base de données existante doit-elle être modifiée ».
La seule opération toujours sûre consiste à *reconnaître* un ancien nom afin de
pouvoir le migrer : `legacyForeignKeyName` existe pour être détecté, jamais pour être
généré, et la ligne de référence (baseline) fige également ces détections. En
supprimer une annule silencieusement la migration de toutes les bases de données
portant encore cette orthographe.

**La validation (gate).** `tooling/scripts/derived-names.mts` exécute un scénario
d'évaluation de nommage poussé — pluriels irréguliers, terminaison en `ss`, acronymes,
jonction depuis un slug au pluriel, surcharges explicites, slug suffisamment long
pour être tronqué — à travers les deux générateurs de DDL de schéma, et produit
chaque identifiant nommé par l'un ou l'autre :

```bash
pnpm check:derived-names
```

Une ligne modifiée ou supprimée échoue en tant que rupture de contrat, affichant
l'ancienne et la nouvelle orthographe côte à côte. Une modification purement
additive échoue également, mais avec l'instruction « regenerate » — afin que la
ligne de référence ne puisse pas dériver à l'insu de quiconque.

Ce test garantit également que `rebase db push` et le boot-ensure du runtime géré
dérivent les *mêmes* noms, ce qui constitue un second contrat masqué dans le
premier : ils compilent les mêmes collections via un code différent, et un projet
poussé une fois puis démarré plus tard ne doit pas se retrouver avec deux schémas.

## Ce qui n'est *pas* figé

Exprimé clairement, afin que personne n'en déduise une promesse qui n'a jamais
été faite :

- L'API TypeScript développeur — configuration de collection, options de
  `initializeRebaseBackend`, props d'admin, noms de méthodes du SDK. Les changements
  cassants arrivent dans les versions mineures et sont annoncés dans le changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — ces éléments évoluent le plus rapidement et ont le moins
  d'utilisateurs.
- Tout ce qui se trouve sous le dossier `src/` d'un paquet et qui n'est pas
  réexporté depuis son index racine. `packages/client/src/index.ts` comporte une note
  expliquant que sa liste d'exports est restreinte précisément pour qu'un export
  interne ne puisse pas devenir public par accident.
- Le schéma de base de données de *vos* collections. Il vous appartient ; Rebase
  ne possède que les schémas `rebase` et `auth`.

## Les barrières de validation qui garantissent ces règles

Rien de ce qui précède n'est une simple convention — chaque point dispose d'un
test qui échoue en cas de rupture :

| Barrière (Gate) | Ce qu'elle verrouille |
|---|---|
| `pnpm verify:corpus` | chaque format de bundle jamais publié, exécuté sur le runtime actuel. Les fixtures dans `tests/fixtures/bundles/` sont **écrites à la main et figées** — une fixture régénérée par le builder changerait chaque fois que le builder change |
| `pnpm verify:selfhost` | un véritable bundle compilé, assemblé, démarré et interrogé comme le ferait un navigateur |
| `upgrade-e2e.test.ts` | les anciens schémas de base de données (`schema-snapshots/`) pris en charge par le runtime actuel |
| `tests/e2e/tests/cli-init-e2e.ts` | un projet initialisé installé à partir de **véritables archives tarball**, et non de liens d'espace de travail (workspace) |
| `tests/e2e/tests/client-sdk-e2e.ts` | le parcours utilisateur final : enregistrement → connexion → lectures restreintes par RLS → rafraîchissement → stockage → temps réel |
| `pnpm check:derived-names` | chaque nom de colonne, contrainte, jonction, enum et politique que le framework dérive — et le fait que le démarrage et `db push` les dérivent de manière identique |
| `pnpm rls:check` | les politiques du schéma généré |
| `pnpm check:api-surface` | chaque export, et ses membres, des cinq paquets fournis par l'image — `@rebasepro/server`, `types`, `client`, `common`, `utils` — ainsi que le point d'entrée `@rebasepro/server/functions`, par rapport aux six sections de `contracts/server.api.txt`. Ce sont les paquets que `infra/docker/entrypoint.mjs` lie par lien symbolique par-dessus les propres copies d'un bundle déployé ; supprimer un export de l'un d'eux n'est donc pas une erreur de compilation pour quiconque — c'est un échec au démarrage sur tout le parc, lors d'un déploiement que personne n'a sollicité |
| `pnpm test:gates` | les propres tests des barrières de validation, appliqués à des fixtures — onze fichiers, dont `check:api-surface` et la vérification de montée de version ci-dessous — afin qu'une barrière qui cesserait de surveiller ce qu'elle protège échoue ici. `check:api-surface` a passé toute son existence sans pouvoir détecter la disparition d'un membre de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | le fait que le type d'incrément de version sous lequel une release est publiée corresponde à ce qu'elle a modifié dans les références ci-dessus — exécuté par `publish.yml` avant que le changelog ne soit validé |
| CI saas | le plan de contrôle compilé par rapport à la branche `main` de ce dépôt, sur ses propres pushes et chaque nuit |

**Enregistrez une fixture de bundle et un instantané de schéma une fois par release.**
La valeur de ces deux corpus repose entièrement sur l'ancienneté du plus ancien
d'entre eux, et aucun ne peut être reconstitué a posteriori.

### Pas encore sous barrière de validation

Le tableau ci-dessus représente ce qui est aujourd'hui garanti. Voici les points
de la politique qu'aucun test ne verrouille pour l'instant, listés afin que
personne n'y voie un engagement implicite :

- **Aucune période de dépréciation ou de support garanti.** Tant que Rebase est en
  `0.x`, il n'y a pas de règle écrite sur la durée pendant laquelle un export
  déprécié est conservé avant suppression, ni sur la durée de maintenance d'une
  version mineure plus ancienne. Les correctifs de sécurité ne sont appliqués que
  sur la dernière version mineure.
- **Le format HTTP wire n'a pas de barrière de validation.** Aucun script `check:*`
  ne compare les formats de requête et de réponse à une référence comme le fait
  `check:api-surface` pour les exports ; une modification de la structure de réponse
  n'est interceptée que si une suite de tests e2e la lit par hasard.
- **Les options du CLI (flags) n'ont pas de référence de compatibilité.** L'outil
  de vérification de la documentation échoue lorsqu'une option utilisée par les
  skills, les exemples ou le site marketing disparaît ; mais rien ne détecte la
  suppression d'une autre option ou le changement de signification d'une option.
- **Une release de CI n'enregistre aucun des deux corpus.** Le workflow de
  publication n'enregistre ni fixture de bundle ni instantané de schéma ; seul le
  script de release local tente de le faire, et il émet un avertissement plutôt que
  de s'interrompre s'il n'y parvient pas. Les versions 0.18 à 0.21 n'ont aucun
  instantané de projet enregistré.
- **La surface d'exportation est une barrière, pas un contrat.** La décision de
  transformer les exports publics des paquets fournis par le runtime en un septième
  contrat numéroté — déclaré comme référence de `check:api-surface`, compatible de
  manière additive au sein d'une version majeure de contrat — reste en suspens.

## Modifier un contrat

1. Déterminez duquel des six il s'agit. La plupart des modifications ne concernent
   aucun d'entre eux — mais « aucun des six » ne signifie pas « sans risque ».
   Supprimer ou renommer un export de `@rebasepro/server`, ou l'un de ses membres,
   ne relève d'aucun des six contrats et constitue la modification la plus
   dangereuse de tout le dépôt, car le code qu'elle casse est déjà compilé et ne
   sera pas recompilé. `pnpm check:api-surface` est ce qui protège cette frontière ;
   la décision d'en faire un septième contrat numéroté reste ouverte (voir
   *Pas encore sous barrière de validation* plus haut).
2. Ajoutez d'abord une fixture ou un instantané pour l'**ancienne** structure, et
   vérifiez que le test passe.
3. Effectuez la modification et incrémentez la constante.
4. Confirmez que l'ancienne fixture passe toujours, ou qu'elle échoue désormais
   *avec le message explicite dont un utilisateur aurait besoin*. Les deux cas sont
   valables ; un échec silencieux ne l'est pas.
5. Pour le contrat 3, prévoyez la recompilation de chaque bundle déployé avant de
   procéder à la fusion (merge).
6. Le contrat 6 est l'exception aux étapes 3 et 4 : il n'y a pas de constante à
   incrémenter ni de version sur laquelle rejeter l'opération, car une colonne ne
   porte aucune estampille de version. L'étape qui les remplace consiste à décider
   de ne pas faire la modification — consultez la section ci-dessus pour voir à quoi
   ressemble l'alternative.

## Voir aussi

- [Mise à niveau](/docs/upgrading/) — ce qui a réellement changé de manière cassante, version par version
- [Changelog](/docs/changelog/) — chaque changement, y compris ceux qui n'ont rien cassé
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contrat 3 — le format de bundle sur lequel un projet déployé est déjà construit

---
