---
sourceHash: bee9b136bed53cd1
slug: fr/docs/compatibility
title: Compatibilité
description: Ce que Rebase garantit d'une version à l'autre et ce qu'il ne garantit pas — les six contrats versionnés, leurs modes d'échec et ce qui peut encore changer dans une version mineure.
---

Ce que Rebase garantit d'une version à l'autre, et ce qu'il ne garantit pas.

C'est le document à lire avant de modifier quoi que ce soit dont dépend déjà un projet déployé ou un tenant Rebase Cloud en cours d'exécution. C'est également la réponse honnête à la question : « Si je développe sur Rebase aujourd'hui, qu'est-ce qui risque de casser sous mes pieds plus tard ? »

## Ce que signifie « bêta » ici

Rebase est en bêta publique. La plupart des projets utilisent ce terme pour signifier que « tout peut casser », ce qui ne donne au lecteur aucune visibilité pour s'organiser. Voici donc la limite exacte que trace ce projet :

> **L'API sur laquelle vous écrivez peut changer lors d'une version mineure, avec une entrée dans le changelog.
> Vos données ne peuvent pas être corrompues silencieusement.**

La première partie correspond au comportement habituel d'une version `0.x` et est détaillée plus bas. La seconde partie est celle qui mérite d'être vérifiée, car il s'agit d'une affirmation sur des mécanismes réels plutôt que sur des intentions : les contrats versionnés présentés dans la section suivante sont chacun inscrits dans un artefact ou une base de données, chacun est vérifié au démarrage ou à l'ingestion, et chacun **échoue de manière explicite et spécifique** au lieu de se dégrader silencieusement. Un push de schéma qui supprimerait une colonne est bloqué par une barrière de protection contre les opérations destructives (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), et le processus de mise à niveau lui-même fait l'objet d'un test : `upgrade-e2e.test.ts` restaure des bases de données telles que les anciennes versions les ont laissées, exécute le chemin de migration actuel sur chacune d'elles, et vérifie que les lignes survivent — et pas seulement que le démarrage s'est bien déroulé.

Ce que signifie réellement la bêta : des fonctionnalités manquent encore, certains sous-systèmes sont plus récents que d'autres, et les imperfections se traduisent par l'absence d'un élément ou une utilisation malcommode, non par la corruption silencieuse de vos données. L'état d'avancement de chaque sous-système est documenté et daté publiquement plutôt que laissé à votre découverte — le tableau ci-dessous en constitue la publication officielle.

## État de préparation par sous-système

**Dernière révision le 14 septembre 2026, pour la version 0.21.0.** À relire lors de chaque version mineure ; une évaluation qui n'a pas bougé depuis trois releases est soit stabilisée, soit oubliée, et cette note est là pour inciter à vérifier la nuance.

Les trois niveaux d'évaluation signifient :

- **Stable** — la structure est figée et couverte par un test de validation (gate) en CI. Elle peut encore s'enrichir de fonctionnalités ; elle ne sera pas redessinée sans préavis au sein de la branche 0.x, et toute modification susceptible de casser la compatibilité est annoncée dans le changelog.
- **Bêta** — la fonctionnalité marche et tourne en production, mais certains aspects sont connus pour être encore bruts : une limite que l'on peut atteindre, un cas particulier malcommode, une décision d'architecture non encore arrêtée. La partie brute est mentionnée dans les notes, car le terme « bêta » seul ne vous donne aucun élément sur lequel vous appuyer.
- **Expérimental** — livré pour pouvoir être utilisé et faire l'objet de retours. Attendez-vous à rencontrer des zones encore inexplorées.

| Sous-système | Évaluation | Sur quoi repose l'évaluation |
|---|---|---|
| API REST + SDK généré | Stable | Le contrat réseau est versionné et validé par un gate ; `client-sdk-e2e` pilote de bout en bout l'inscription → la connexion → les lectures restreintes par RLS → le rafraîchissement → le stockage → le temps réel |
| Auth — email/mot de passe, OAuth, OIDC, magic link, code à usage unique | Stable | Douze fournisseurs OAuth sont intégrés. Le schéma d'authentification est un contrat versionné, inscrit et vérifié au démarrage |
| Auth — MFA (TOTP) | Bêta | L'enrôlement, la vérification et la récupération fonctionnent et sont testés. La rotation des clés est implémentée pour la clé de chiffrement ; il n'y a pas d'interface d'administration pour réinitialiser le facteur d'un utilisateur bloqué |
| Sécurité au niveau des lignes (RLS) | Stable | La clé de voûte du produit. `pnpm rls:check` audite une base de données active par rapport à quinze vérifications, et la suite e2e RLS s'exécute à chaque push |
| Stockage | Stable | Local, S3 et GCS. Refus par défaut en production depuis la 0.17.0, et le scaffold fournit un hook d'autorisation |
| Temps réel | **Bêta** | Les abonnements sont filtrés uniquement par chemin de collection, donc N abonnés sur une même collection coûtent N réexécutions de requêtes sous RLS par écriture. Cela plafonne un déploiement à quelques centaines d'abonnés simultanés. Correct à toute échelle ; coûteux au-delà de ce seuil |
| Recherche vectorielle (pgvector) | Bêta | Chaque colonne vectorielle reçoit par défaut un index HNSW pour la distance cosinus, configurable par propriété via `VectorIndexConfig` (méthode, distances, paramètres de construction) ou désactivable, ce qui laisse un scan exact. pgvector ne peut pas indexer une colonne de plus de 2 000 dimensions, celles-ci restent donc non indexées et font l'objet d'un scan |
| Synchronisation hors-ligne | Bêta | Les mutations portent des clés d'idempotence respectées par le serveur, et les défauts de perte de données identifiés lors de l'audit de juillet sont corrigés. Le modèle de conflit est le dernier écrivain l'emporte (last-write-wins) sans fusion champ par champ |
| Historique des entités | Stable | Basé sur des snapshots, validé par sa propre suite de tests |
| Fonctions et tâches cron | Stable | Le point d'entrée portable (`@rebasepro/server/functions`) est un contrat versionné avec sa propre section sur la surface d'API |
| Serveur MCP + compétences agent | Bêta | `@rebasepro/mcp` s'exécute sur stdio : cinquante-trois outils, authentification bearer par projet, les outils destructifs refusent les cibles non locales sans consentement explicite. Depuis la version 0.21, le serveur peut également monter un endpoint distant `/mcp` — OAuth 2.1, treize outils de données, chaque appel sous le RLS propre à la personne connectée — désactivé sauf si `REBASE_MCP_ENABLED=true`, et réservé à Postgres |
| Studio (SQL, schéma, RLS, explorateur d'API) | Bêta | Utilisé au quotidien sur de vrais projets. La gestion des branches est présente dans le paquet open source et volontairement absente de Rebase Cloud, car le basculement d'un déploiement en cours vers une branche n'est pas encore pris en charge |
| CMS + panneau d'administration | Bêta | Complet pour le CRUD, les relations, les champs de stockage et les rôles. **La table de données n'a pas de sémantique de grille** — pas de `role`, pas de `aria-rowindex`, `tabIndex` supprimé — les utilisateurs au clavier et lecteurs d'écran ne peuvent donc pas manipuler la vue principale. Pas de brouillons, pas de contenu par locale, pas de texte riche sous forme de blocs |
| Base de dev gérée PGlite | Bêta | `rebase dev` sans configuration et sans Docker. Une seule session à la fois, les requêtes sont donc séquencées et la concurrence ne peut pas être reproduite dessus ; les commandes basées sur Atlas (`db push`, `generate`, `migrate`) planifient sur une seconde instance PGlite éphémère lancée pour la commande ; `db branch` ne fonctionne pas dans cet environnement et l'indique |
| Helm chart | Bêta | Restitue la topologie en processus séparés et est publié dans le registre OCI à chaque release. La configuration par défaut reste un conteneur unique |
| `@rebasepro/server-mongo` | **Expérimental** | Un pilote fonctionnel avec temps réel via change-stream et historique par snapshots. **Pas de sécurité au niveau des lignes (RLS)** — tout le modèle d'isolation ci-dessus ne s'y applique pas — et pas de relations. Les change streams nécessitent un replica set : sur un `mongod` autonome, rien ne les remplace, de sorte qu'un abonnement ne voit que les écritures effectuées via ce processus Rebase et rate toutes les autres. Pas de MFA : l'enrôlement renvoie 501, et les vérifications répondent « pas de facteur », la connexion n'en demande donc jamais. L'agrégat admin ne peut pas cibler une collection — il lit le nom depuis une étape `$from` que MongoDB n'a pas — il ne renvoie donc rien |
| `@rebasepro/firebase` | Expérimental | Fait tourner le panneau d'administration et le SDK avec Firestore. Pas de RLS, pas de surface SQL ; l'ensemble des fonctionnalités Postgres n'est pas transposé. Le pilote Firestore ignore les groupes de filtres `or(...)`/`and(...)`, de sorte qu'une requête qui en utilise un lit chaque ligne autorisée par ses filtres simples |
| Rebase Cloud | **Bêta privée** | En ligne, hébergeant de vrais tenants, ouvert par vagues. Pas d'accès en libre-service |

Deux entrées ci-dessus représentent le coût de transparence lié à la publication de ce tableau : la réinterrogation en temps réel et l'accessibilité de la table de données sont des anomalies ouvertes, pas des éléments de feuille de route, et toutes deux sont listées plutôt que laissées à la découverte du lecteur.

Ce tableau reflète ce qui existe. Ce qui n'existe pas encore figure sur la
[roadmap](https://rebase.pro/roadmap), à raison d'une entrée par issue GitHub, avec le sous-ensemble requis pour la 1.0 explicitement signalé.

## La promesse de la 0.x

Rebase est en `0.x`. Cette section est rédigée pour s'appliquer à chaque version 0.x plutôt qu'à une seule d'entre elles, afin de ne pas devenir obsolète à chaque coupure de release. **Les changements cassants dans l'API TypeScript exposée restent autorisés lors d'une version mineure**, et le changelog est l'endroit où ils sont annoncés. Ce qui n'est
*pas* autorisé à casser silencieusement, c'est l'ensemble des contrats versionnés ci-dessous : chacun est inscrit dans un artefact ou une base de données, chacun est vérifié au boot ou à l'ingestion, et chacun échoue **de manière explicite et spécifique** plutôt que de se dégrader.

Cette distinction constitue l'intégralité de la promesse. Un export renommé vous coûte une erreur de compilation et cinq minutes. Un bundle qui démarre sur le mauvais runtime et sert des données subtilement erronées vous coûte un incident, et les contrats existent pour que la seconde catégorie ne puisse pas survenir silencieusement.

Rebase Cloud consomme exactement ces contrats et rien d'autre. Tout ce qui n'est pas répertorié ici est un détail d'implémentation dont la plateforme ne dépend pas.

### Badges de version et canaries

La documentation étant publiée depuis `main`, une page peut décrire un élément qu'aucune release stable ne propose encore. Un badge *Since* indique la première release stable qui l'intègre, et le texte à côté précise le comportement de la release précédente.

Un canary est un build de `main` numéroté d'après la version vers laquelle il se dirige : `0.25.0-canary.g<commit>` correspond à `main` à ce commit précis, après la 0.24.0 et avant la 0.25.0, et `rebase upgrade --to canary` installe la version la plus récente. Il intègre tout ce qui avait atteint `main` au moment de sa construction, donc un badge mentionnant sa version s'applique à vous, et la note sur la version précédente décrit la version stable dont vous venez.

## Les contrats versionnés

Les valeurs ci-dessous sont extraites des sources ; considérez les références de fichiers comme la source de vérité et ce tableau comme le plan.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrat | Déclaré dans | Vérifié dans | Sens de compatibilité |
|---|---|---|---|---|
| 1 | Plage `rebase` dans `rebase.json` | le projet de l'utilisateur | CLI au build | le projet indique les runtimes qu'il accepte |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **rétrocompatible** — le nouveau runtime lit les anciens bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | même fichier | même fichier | **correspondance exacte, dans les deux sens** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | au boot, contre `rebase.schema_meta` | **vers l'avant uniquement** — le nouveau runtime migre les anciennes bases |
| 5 | `manifest.schemaVersion` | émis par `rebase build` | envoyé par le SDK via `x-rebase-schema` lorsque configuré | informatif — identifie le schéma avec lequel un client a été généré |
| 6 | Identifiants de base de données dérivés | `contracts/derived-names.txt` | `pnpm check:derived-names` | **figé** — un nom émis par une release n'est jamais recalculé |

### 1 — `rebase` dans `rebase.json`

Une plage semver, lue de la même façon que `engines` dans un `package.json` : les versions de runtime acceptées par ce projet. Nommé délibérément `rebase` plutôt que `runtime`, car `runtime` désigne déjà *qui gère le processus* (`managed` | `custom`) sur une application.

### 2 — `BUNDLE_FORMAT_VERSION` (actuellement 2)

L'organisation sur disque d'un bundle compilé. Un runtime accepte tout bundle dont le format est **inférieur ou égal** au sien, ce qui permet à l'offre managée de faire migrer un tenant vers une nouvelle image sans imposer de rebuild du projet.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` est un dossier unique, `entry.admin` pour une interface d'administration embarquée.
- **2** — `kind: "backend" | "static"`, `entry.static` est une liste, `entry.admin` est retiré. Le format 1 est toujours lu, via `upgradeLegacyManifest`.

**Incrémentez-le lorsque** la structure change de telle sorte qu'un ancien runtime interpréterait mal un nouveau bundle. L'incrémentation est ce qui transforme un « démarre et ne sert rien » en un refus net de démarrer.

### 3 — `RUNTIME_CONTRACT_VERSION` (actuellement 1)

Le numéro majeur du contrat bundle↔runtime. Distinct de la version du paquet `@rebasepro/server`, qui peut publier de nombreuses versions mineures et correctifs pendant que celui-ci reste inchangé.

**À lire impérativement avant toute modification.** La vérification est de type `!==`, et non `>` :

> un bundle ciblant le contrat *N* s'exécute **uniquement** sur un runtime implémentant *N*

par conséquent, l'incrémenter invalide **l'ensemble des bundles jamais créés**, d'un coup, jusqu'à ce que chacun soit recompilé. C'est la sévérité voulue — c'est le levier « rien d'ancien ne peut tourner ici » — mais cela implique qu'une incrémentation est une migration globale de tout le parc, et non une simple note de release. Pour l'offre managée, cela doit être coordonné avec une recompilation des bundles de l'ensemble des tenants.

Si une modification est *cumulative* (additive) et que les anciens bundles restent corrects, elle nécessite `BUNDLE_FORMAT_VERSION` (ou rien du tout), et non ce contrat.

### 4 — `AUTH_SCHEMA_VERSION` (actuellement 2)

Inscrit dans `rebase.schema_meta` et comparé au boot. Un runtime **refuse de démarrer** sur une base de données migrée par une version plus récente du framework, plutôt que de fonctionner sur une structure qu'il ne comprend pas — lors d'un déploiement progressif (rolling deploy), c'est la différence entre la moitié du parc qui renvoie une erreur et la moitié du parc qui corrompt des données.

La migration vers l'avant est automatique : `ensureAuthTablesExist` met à niveau les anciennes bases de données. Notez que ce bloc de migration est volontairement encapsulé dans un `try/catch` et journalise au lieu de lever une exception — un démarrage en mode dégradé est préférable à une boucle de plantages (crash loop) — donc **« ça a démarré » ne prouve rien**. Chaque assertion de la suite de tests de mise à niveau inspecte le catalogue ou les données directement.

**Incrémentez-le lorsqu'une** migration ne doit pas être ignorée par un runtime plus ancien. Ne l'incrémentez pas pour l'ajout d'une colonne rétrocompatible ; un cas d'école documentant cet arbitrage figure dans `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash des définitions de collections compilées, inscrit dans le manifeste du bundle et renvoyé par un SDK généré dans l'en-tête `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Son rôle est de permettre à la plateforme d'indiquer « cette application a été construite contre un schéma plus ancien » au lieu d'échouer de manière obscure dès la première requête.

`rebase generate-sdk` écrit cette valeur dans `schema.meta.ts` ; transmettez-la au client pour qu'il l'envoie :

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Le backend lit cet en-tête à chaque requête de données. Un décalage de version ne bloque jamais un appel — un SDK en retard d'un schéma reste généralement compatible, et déployer le backend avant le frontend correspond à l'ordre normal de déploiement — mais lorsqu'une requête échoue avec un code 400 ou 404, l'erreur inclut ce décalage comme cause :

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

Ainsi, une colonne renommée se signale par le message « votre SDK est obsolète, regénérez-le » plutôt que par l'absence d'un champ dont vos propres types garantissent pourtant l'existence. Une requête qui aboutit n'en est jamais avertie.

Cela couvre **uniquement les collections**. La modification d'un hook ou d'une fonction ne change pas le contrat du client et ne doit pas invalider l'ensemble des SDK générés.

### Qui appelle

Deux signaux d'identification supplémentaires, dont aucun ne sert de gate à lui seul :

- **`GET /api/meta/schema-version`** ne nécessite pas d'authentification et renvoie la `schemaVersion` du projet *ainsi que* son `runtime` (`version` et `contract`). Un job CI comparant son SDK généré à un projet en production n'a besoin d'aucun identifiant, de même qu'un client cherchant à savoir à quel runtime il s'adresse.
- **`User-Agent: rebase-cli/<version>`** accompagne chaque requête `rebase cloud`. Le format réseau du plan de contrôle évolue plus vite que ce qui est publié sur npm ; il doit donc pouvoir répondre `CLI_TOO_OLD` avec la version minimale requise à un client obsolète — ce qu'il ne peut faire que si l'appelant s'identifie.

### 6 — Identifiants de base de données dérivés

Chaque nom que ce framework détermine lui-même plutôt que de le recevoir en paramètre : une colonne de clé étrangère, une contrainte de clé étrangère, une table de jonction et ses deux colonnes de clés, un type enum, un nom de politique de sécurité, la colonne `snake_case` issue d'une propriété en `camelCase`.

> **Un identifiant dérivé est figé dès l'instant où une release l'a émis.**

Pas « figé jusqu'à la prochaine version majeure » — figé définitivement. La logique diffère des cinq autres contrats et s'avère plus stricte. Ces derniers sont versionnés, ce qui permet de *détecter* une non-concordance et de la rejeter. Ce n'est pas possible ici : le nom est inscrit dans la base de données du client le jour du déploiement, et il n'y a aucun marqueur de version sur une colonne. Chaque base provisionnée par n'importe quelle version jamais publiée conserve les noms qui ont été dérivés, et aucun code de ce dépôt ne peut intervenir pour tous les renommer.

La version 0.13 en est l'exemple concret. `generateForeignKeyName` a appris à gérer correctement les singuliers — `categorie_id` → `category_id`, `addres_id` → `address_id` — ce qui constitue indéniablement une meilleure dérivation, mais cela a cassé toutes les bases anciennes possédant un pluriel irrégulier. L'étape de boot-ensure a migré la colonne, préservant ainsi les données ; en revanche, le fichier versionné du projet `schema.generated.ts` ne l'a pas fait, et le boot a échoué sur une colonne qui existait pourtant. Trois commits, un nouveau test d'intégration aux jointures et une entrée permanente dans les notes de mise à niveau, simplement pour un nom de colonne plus élégant que personne n'avait demandé.

**Si une règle de dérivation est véritablement erronée**, elle est modifiée uniquement pour les collections créées *postérieurement*, derrière une stratégie de nommage consignée dans le projet — jamais de façon rétroactive, et jamais comme effet secondaire de l'amélioration de la fonction sous-jacente.

**La seule dérogation légitime** est une modification visant à aligner le code avec un nom que la base de données *possède déjà*. L'exemple typique est la troncature des identifiants : Postgres tronque silencieusement un identifiant à 63 octets, de sorte qu'un nom de contrainte dérivé plus long ne correspondait jamais au nom réel dans le catalogue — la dérivation décrivait un objet qui n'existait pas sous cette orthographe, et boot-ensure réémettait `ADD CONSTRAINT` à chaque démarrage car sa comparaison échouait systématiquement. Tronquer dès la construction modifie ce que ce dépôt *dérive*, sans rien changer à ce qu'une base de données déployée *contient*. C'est le critère à appliquer : non pas « le nouveau nom est-il meilleur », mais « une base existante doit-elle être modifiée ».

L'autre cas où un nom peut changer concerne un ensemble de noms qui ne pouvaient structurellement pas coexister. Une règle couvrant plusieurs opérations sur une table de 42 octets ou plus dérivait `<table>_default_admin_write_insert`, `_update` et `_delete`, et toutes trois se trouvaient tronquées aux mêmes 63 octets. Postgres n'enregistrait qu'une seule politique, DELETE, et rejetait tous les INSERT et UPDATE administrateur. C'est uniquement lors d'une telle collision que les noms sont dérivés avec le suffixe en premier, sous la forme `<head>_<hash8>_<op>`. Tout nom qui fonctionne aujourd'hui conserve son orthographe. Le démarrage ou push suivant supprime la politique tronquée unique et crée une politique pour chaque opération.

La seule démarche toujours sans danger consiste à *reconnaître* un ancien nom afin de pouvoir le migrer : `legacyForeignKeyName` n'existe que pour être détecté, jamais pour être généré, et la référence de base (baseline) fige également ces détections. En supprimer une annulerait silencieusement la migration de toute base de données conservant cette orthographe.

**Le gate.** `tooling/scripts/derived-names.mts` soumet un scénario de test extrême de nommage — pluriels irréguliers, terminaison en `ss`, acronyme, jonction sur un slug au pluriel, surcharges explicites, slug suffisamment long pour être tronqué — aux deux générateurs de DDL de schéma, et produit l'ensemble des identifiants nommés par l'un ou l'autre :

```bash
pnpm check:derived-names
```

Une ligne modifiée ou supprimée échoue en tant que rupture de contrat, en affichant l'ancienne et la nouvelle orthographe côte à côte. Une modification purement additive échoue également, mais en invitant à « régénérer » — empêchant ainsi la baseline de dériver sans surveillance.

Il garantit également que `rebase db push` et le boot-ensure du runtime managé dérivent les *mêmes* noms, ce qui constitue un second contrat imbriqué dans le premier : ils compilent les mêmes collections via du code différent, et un projet déployé via push une fois puis démarré plus tard ne doit pas se retrouver avec deux schémas divergents.

## Ce qui n'est *pas* figé

Exprimé en toute transparence, afin que personne ne présume d'une garantie qui n'a jamais été formulée :

- L'API TypeScript exposée — configuration des collections, options d'`initializeRebaseBackend`, props d'admin, noms des méthodes du SDK. Les changements cassants interviennent dans les versions mineures et sont signalés dans le changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — ces paquets évoluent le plus rapidement et ont le moins de consommateurs.
- Tout élément situé sous le dossier `src/` d'un paquet qui n'est pas réexporté depuis son barrel (index). `packages/client/src/index.ts` comporte une note expliquant que sa liste d'exports est soigneusement restreinte précisément pour éviter qu'un export interne ne devienne public par inadvertance.
- Le schéma de base de données de *vos* collections. Il vous appartient ; Rebase ne possède que le schéma `rebase` (et, sur une base provisionnée avant la 0.13, l'ancien schéma `auth` jusqu'à ce que le boot le retire).

## Les gates de validation qui garantissent ces règles

Rien de ce qui précède n'est une simple convention — chaque point est assorti d'un test qui échoue en cas de rupture :

| Gate | Ce qu'il verrouille |
|---|---|
| `pnpm verify:corpus` | toutes les formes de bundles jamais publiées, exécutées sur le runtime actuel. Les jeux de données dans `tests/fixtures/bundles/` sont **écrits à la main et figés** — un fichier témoin régénéré par le builder changerait dès que le builder change |
| `pnpm verify:selfhost` | un vrai bundle compilé, replié, démarré et interrogé comme le ferait un navigateur |
| `upgrade-e2e.test.ts` | les anciens schémas de base de données (`schema-snapshots/`) pris en charge par le runtime actuel |
| `tests/e2e/tests/cli-init-e2e.ts` | un projet échafaudé installé depuis de **véritables archives tarball**, et non des liens d'espace de travail |
| `tests/e2e/tests/client-sdk-e2e.ts` | le parcours de l'utilisateur final : inscription → connexion → lectures soumises à RLS → rafraîchissement → stockage → temps réel |
| `pnpm check:derived-names` | chaque nom de colonne, contrainte, table de jonction, enum et politique dérivé par le framework — et vérification que le boot et `db push` les dérivent de manière identique |
| `pnpm rls:check` | les politiques de sécurité du schéma généré |
| `pnpm check:api-surface` | chaque export et chacun de ses membres pour les cinq paquets fournis par l'image — `@rebasepro/server`, `types`, `client`, `common`, `utils` — ainsi que le point d'entrée `@rebasepro/server/functions`, par rapport aux six sections de `contracts/server.api.txt`. Ce sont les paquets que `infra/docker/entrypoint.mjs` lie symboliquement par-dessus les copies propres d'un bundle déployé ; supprimer un export de l'un d'eux ne se traduit donc pas par une erreur de compilation pour quiconque — mais par un échec au démarrage sur tout le parc, lors d'un déploiement non sollicité |
| `pnpm test:gates` | les propres tests des barrières de vérification sur des fixtures — quarante-sept fichiers, parmi lesquels `check:api-surface` et la vérification d'incrément de release ci-dessous — de sorte qu'une barrière qui cesserait de surveiller ce qu'elle protège échoue ici. `check:api-surface` a longtemps été incapable de détecter la disparition d'un membre de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | vérifie que le niveau d'incrément de version sous lequel une release est publiée correspond à ce que la release a apporté aux baselines ci-dessus — exécuté par `publish.yml` avant l'estampillage du changelog |
| CI saas | le plan de contrôle compilé contre la branche `main` de ce dépôt, lors de ses propres pushs et chaque nuit |

**Enregistrez un bundle de test et un instantané de schéma une fois par release.** La valeur de ces deux corpus réside entièrement dans l'ancienneté du plus vieux spécimen conservé, et aucun ne peut être reconstitué a posteriori.

### Ce qui n'est pas encore couvert par un gate

Le tableau ci-dessus liste ce qui est effectivement contrôlé. Voici les points de la politique qu'aucun mécanisme ne verrouille encore, listés afin que nul n'y voie une garantie implicite :

- **Aucune période d'obsolescence ou de support définie.** Tant que Rebase est en `0.x`, il n'y a pas de règle écrite régissant la durée de survie d'un export déprécié avant sa suppression, ni la durée pendant laquelle une ancienne version mineure reçoit des correctifs. Les correctifs de sécurité ne sont appliqués que sur la dernière version mineure.
- **Le format des requêtes HTTP n'a pas de gate.** Aucun script `check:*` ne compare la structure des requêtes et des réponses à une baseline de référence comme le fait `check:api-surface` pour les exports ; une modification de la forme d'une réponse n'est repérée que si une suite de tests e2e la lit par hasard.
- **Les options de la CLI ne disposent pas de baseline de compatibilité.** Le vérificateur de documentation échoue lorsqu'un drapeau utilisé par les compétences, les exemples ou le site marketing disparaît ; en dehors de cela, rien ne signale la disparition d'une option ou la modification de son comportement.
- **Une publication en CI n'enregistre aucun des deux corpus.** Le workflow de publication n'enregistre ni fixture de bundle ni snapshot de schéma ; seul le script de publication local tente de le faire, et il émet un simple avertissement sans bloquer en cas d'impossibilité. Les versions 0.18 à 0.21 ne disposent d'aucun instantané de projet enregistré.
- **La surface d'export est un gate, pas un contrat.** La décision d'ériger les exports publics des paquets fournis par le runtime en un septième contrat versionné — déclaré comme la baseline de `check:api-surface`, compatible de manière additive au sein d'une version majeure de contrat — reste à trancher.

## Modifier un contrat

1. Identifiez auquel des six contrats vous avez affaire. La plupart des changements ne concernent aucun d'entre eux — mais « aucun des six » ne veut pas dire « anodin ». Supprimer ou renommer un export de `@rebasepro/server`, ou un membre de celui-ci, n'entre dans aucun des six et constitue la modification la plus dangereuse du dépôt, car le code qu'elle casse est déjà compilé et ne sera pas recompilé. C'est `pnpm check:api-surface` qui surveille ce périmètre ; son passage au statut de septième contrat officiel reste en discussion (voir *Ce qui n'est pas encore couvert par un gate*, plus haut).
2. Ajoutez d'abord un jeu de test ou un snapshot pour l'**ancienne** structure, et assurez-vous qu'il passe.
3. Appliquez le changement dans le code et incrémentez la constante.
4. Confirmez que l'ancien jeu de test passe toujours, ou qu'il échoue désormais *avec le message explicite dont un utilisateur aurait besoin*. Ces deux résultats sont valables ; un échec silencieux ne l'est pas.
5. Pour le contrat 3, prévoyez la recompilation de l'ensemble des bundles déployés avant de merger.
6. Le contrat 6 fait exception aux étapes 3 et 4 : il n'y a pas de constante à incrémenter ni de version permettant de rejeter l'opération, car une colonne ne porte aucun marqueur de version. L'étape qui les remplace consiste à décider de ne pas faire la modification — consultez la section ci-dessus pour voir à quoi ressemble l'alternative.

## Voir aussi

- [Mise à niveau](/docs/upgrading/) — ce qui a effectivement changé, version par version
- [Changelog](/docs/changelog/) — chaque modification, y compris celles sans impact destructif
- [Runtime et Bundles](/docs/architecture/runtime-and-bundles/) — contrat 3 — le format de bundle contre lequel un projet déployé est déjà compilé
