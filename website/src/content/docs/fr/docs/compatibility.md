---
sourceHash: 1fd0f89847e543c2
slug: fr/docs/compatibility
title: Compatibilité
description: Ce que Rebase garantit d'une version à l'autre et ce qu'il ne garantit pas — les six contrats versionnés, la façon dont chacun échoue, et ce qui peut encore changer dans une version mineure.
---

Ce que Rebase garantit d'une version à l'autre, et ce qu'il ne garantit pas.

C'est le document à lire avant de modifier quoi que ce soit dont dépend déjà un
projet déployé ou un tenant Rebase Cloud en cours d'exécution. C'est également la
réponse honnête à la question : « si je développe sur Rebase aujourd'hui, qu'est-ce
qui cassera sous mes pieds plus tard ? »

## Ce que « bêta » signifie ici

Rebase est en bêta publique. La plupart des projets utilisent ce terme pour dire
que « tout peut casser », ce qui n'aide en rien le lecteur à s'organiser ; voici
donc la limite que ce projet trace réellement :

> **L'API avec laquelle vous interagissez peut changer lors d'une version mineure, avec une entrée dans le journal des modifications (changelog).
> Vos données ne peuvent pas se corrompre silencieusement.**

La première moitié correspond au comportement habituel des versions `0.x` et est
décrite ci-dessous. La seconde moitié est la partie qui mérite d'être vérifiée, car
il s'agit d'une affirmation sur des mécanismes plutôt que sur des intentions : les
contrats versionnés de la section suivante sont chacun inscrits dans un artefact
ou une base de données, chacun est vérifié au démarrage ou à la réception, et chacun
**échoue de manière explicite et bruyante** plutôt que de se dégrader. Un push de
schéma qui supprimerait une colonne est refusé par un contrôle destructif
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), et le chemin de mise
à niveau lui-même est un test : `upgrade-e2e.test.ts` restaure les bases de données
telles que les anciennes versions les ont laissées, exécute le chemin de migration
actuel sur chacune d'elles et vérifie que les lignes survivent — pas seulement que
le démarrage a réussi.

Ce que signifie réellement le statut bêta : des fonctionnalités manquent encore,
certains sous-systèmes sont plus récents que d'autres, et la nature d'une aspérité
réside dans le fait que quelque chose est manquant ou peu pratique, et non qu'il
corrompt silencieusement des données. L'état d'avancement de chaque sous-système
est publié et daté plutôt que laissé à votre découverte — le tableau ci-dessous
constitue cette publication.

## Degré de maturité par sous-système

**Dernière révision le 14 septembre 2026, par rapport à la version 0.21.0.** Relisez-le
à chaque version mineure ; une évaluation qui n'a pas bougé depuis trois versions est
soit stabilisée, soit oubliée, et cette note est là pour s'assurer que la différence
soit vérifiée.

Les trois niveaux d'évaluation signifient :

- **Stable** — la forme est stabilisée et couverte par une barrière de validation
  (gate) en CI. Il peut encore recevoir des fonctionnalités ; il ne sera pas remanié
  sous vos yeux au sein des versions 0.x, et tout changement de nature à casser
  l'existant sera annoncé dans le changelog.
- **Beta** — fonctionne et est utilisé en production, mais présente un aspect encore
  imparfait : une limite atteignable, un comportement peu pratique, une décision
  d'architecture pas encore tranchée. L'imperfection est précisée dans les notes, car
  le terme « bêta » à lui seul ne vous donne aucun repère sur lequel vous baser.
- **Experimental** — livré pour être testé et faire l'objet de retours. Attendez-vous
  à rencontrer des zones inexplorées.

| Sous-système | Évaluation | Fondement de l'évaluation |
|---|---|---|
| REST API + SDK généré | Stable | Le contrat réseau (wire contract) est versionné et contrôlé ; `client-sdk-e2e` pilote l'inscription → la connexion → les lectures délimitées par RLS → le rafraîchissement → le stockage → le temps réel de bout en bout |
| Authentification — e-mail/mot de passe, OAuth, OIDC, lien magique, code à usage unique | Stable | Douze fournisseurs OAuth sont intégrés. Le schéma d'authentification est un contrat versionné, inscrit et vérifié au démarrage |
| Authentification — MFA (TOTP) | Beta | L'enrôlement, la vérification et la récupération fonctionnent et sont testés. La rotation de clé est implémentée pour la clé de chiffrement ; il n'y a pas d'interface d'administration pour réinitialiser le facteur d'un utilisateur bloqué |
| Row-level security (RLS) | Stable | La clé de voûte du produit. `pnpm rls:check` audite une base de données active selon quinze vérifications, et la suite e2e RLS s'exécute à chaque push |
| Stockage | Stable | Local, S3 et GCS. Refus par défaut (default-deny) en production depuis la 0.17.0, et le modèle de base (scaffold) intègre un hook d'autorisation |
| Temps réel | **Beta** | Les abonnements sont mis en correspondance uniquement par chemin de collection, donc N abonnés sur une collection coûtent N réexécutions de requêtes délimitées par RLS par écriture. Cela plafonne un déploiement à quelques centaines d'abonnés simultanés. Rigoureusement correct à toute échelle ; coûteux au-delà de ce seuil |
| Recherche vectorielle (pgvector) | Beta | Chaque colonne vectorielle reçoit par défaut un index HNSW pour la distance cosinus, configurable par propriété via `VectorIndexConfig` (méthode, distances, paramètres de construction) ou désactivable, ce qui laisse un scan exact. pgvector ne peut pas indexer une colonne de plus de 2 000 dimensions, celles-ci restent donc non indexées et font l'objet d'un scan |
| Synchronisation hors ligne | Beta | Les mutations portent des clés d'idempotence respectées par le serveur, et les défauts de perte de données relevés lors de l'audit de juillet sont corrigés. Le modèle de conflit est « le dernier écrit l'emporte » (last-write-wins) sans fusion par champ |
| Historique des entités | Stable | Basé sur des snapshots, protégé par sa propre suite de tests |
| Fonctions et tâches cron | Stable | Le point d'entrée portable (`@rebasepro/server/functions`) est un contrat versionné disposant de sa propre section d'exposition d'API |
| Serveur MCP + compétences d'agent | Beta | `@rebasepro/mcp` s'exécute via stdio : cinquante-trois outils, authentification bearer par projet, les outils destructifs refusent les cibles non locales sauf autorisation explicite. Depuis la version 0.21, le serveur peut également monter un endpoint `/mcp` distant — OAuth 2.1, onze outils de données, chaque appel sous le RLS propre de la personne connectée — désactivé sauf si `REBASE_MCP_ENABLED=true`, et uniquement sur Postgres |
| Studio (SQL, schéma, RLS, explorateur d'API) | Beta | Utilisé au quotidien sur de vrais projets. Le branchage (branching) est présent dans le package open source et délibérément non exposé dans Rebase Cloud, car le basculement d'un déploiement en cours sur une branche n'est pas encore pris en charge |
| CMS + panneau d'administration | Beta | Complet pour le CRUD, les relations, les champs de stockage et les rôles. **La table de données n'a pas de sémantique de grille (grid)** — pas de `role`, pas de `aria-rowindex`, `tabIndex` supprimé — les utilisateurs au clavier et lecteurs d'écran ne peuvent donc pas exploiter la vue principale. Pas de brouillons, pas de contenu par région linguistique (locale), pas de texte enrichi par blocs |
| Base de données de dev managée PGlite | Beta | `rebase dev` sans configuration et sans Docker. Une seule session à la fois, les requêtes sont donc sérialisées et la concurrence ne peut pas être reproduite dessus ; les commandes basées sur Atlas (`db push`, `generate`, `migrate`) planifient sur une deuxième instance PGlite éphémère démarrée pour la commande (en 0.24, elles refusent la base managée) ; `db branch` n'y fonctionne pas et l'indique explicitement |
| Chart Helm | Beta | Génère la topologie en processus séparés et est publié dans le registre OCI à chaque version. La valeur par défaut reste un conteneur unique |
| `@rebasepro/server-mongo` | **Experimental** | Un pilote fonctionnel avec temps réel par flux de modifications (change streams) et historique par snapshots. **Aucune Row-Level Security (RLS)** — l'ensemble du modèle d'isolation ci-dessus ne s'y applique pas — et aucune relation. Les flux de modifications nécessitent un replica set : sur un `mongod` autonome, rien ne les remplace, donc un abonnement ne voit que les écritures effectuées via ce processus Rebase et manque toutes les autres. Pas de MFA : l'enrôlement renvoie 501, et les vérifications répondent « pas de facteur », donc la connexion n'en demande jamais. L'agrégation admin ne peut pas cibler de collection — elle lit le nom depuis une étape `$from` que MongoDB ne possède pas — elle ne renvoie donc rien |
| `@rebasepro/firebase` | Experimental | Exécute le panneau d'administration et le SDK sur Firestore. Pas de RLS, pas de surface SQL ; l'ensemble des fonctionnalités Postgres ne s'applique pas. Le pilote Firestore ignore les groupes de filtres `or(...)`/`and(...)` , de sorte qu'une requête en utilisant un lit toutes les lignes autorisées par ses filtres simples |
| Rebase Cloud | **Bêta privée** | En ligne, hébergeant de vrais tenants, ouvert par vagues. Pas en libre-service |

Deux entrées ci-dessus représentent le prix de l'honnêteté lié à la publication
même de ce tableau : le refetch en temps réel et l'accessibilité de la table de
données sont des anomalies connues, et non des éléments de la feuille de route,
et toutes deux sont listées plutôt que laissées à la découverte fortuite du lecteur.

Ce tableau représente ce qui existe. Ce qui n'existe pas encore se trouve sur la
[feuille de route](https://rebase.pro/roadmap), avec une entrée par ticket GitHub,
le sous-ensemble requis pour la 1.0 étant indiqué.

## La garantie 0.x

Rebase est en version `0.x`. Cette section est rédigée pour s'appliquer à chaque
version 0.x plutôt qu'à une seule d'entre elles, afin de ne pas devenir obsolète
à chaque release. **Les modifications avec rupture (breaking changes) sur l'API TypeScript rédigée sont toujours autorisées dans une version mineure**,
et le journal des modifications (changelog) est l'endroit où elles sont annoncées.
Ce qui n'est *pas* autorisé à casser silencieusement est l'ensemble des contrats
versionnés ci-dessous : chacun est inscrit dans un artefact ou une base de données,
chacun est vérifié au démarrage ou à la réception, et chacun échoue **de manière explicite et bruyante** plutôt que de se dégrader.

Cette distinction résume toute notre promesse. Un export renommé vous coûte une erreur
de compilation et cinq minutes. Un bundle qui démarre sur un runtime inapproprié
et sert des données subtilement erronées vous coûte un incident, et les contrats
existent pour que cette seconde catégorie ne puisse jamais survenir en silence.

Rebase Cloud consomme exactement ces contrats et rien d'autre. Tout ce qui n'est
pas répertorié ici est un détail d'implémentation dont la plateforme ne dépend pas.

### Badges de version et versions canari (canaries)

La documentation est publiée à partir de la branche `main`, une page peut donc
décrire des éléments qu'aucune version stable ne possède encore. Un badge *Since*
(Depuis) indique la première version stable qui l'intègre, et le texte à côté
précise le comportement de la version précédente.

Une version canari (canary) est un build de `main` numéroté d'après la version vers
laquelle il se dirige : `0.25.0-canary.g<commit>` correspond à `main` à ce commit
précis, après la 0.24.0 et avant la 0.25.0, et `rebase upgrade --to canary` installe
la plus récente. Elle embarque tout ce qui avait atteint `main` au moment de sa
compilation ; un badge mentionnant sa version (Since 0.25) s'applique donc à vous,
et la note concernant la version précédente (sur la 0.24) décrit la version stable
dont vous venez. Les canaries avant la 0.25.0 étaient numérotées d'après la dernière
version : `0.24.1-canary.g<commit>` constitue également un aperçu de la 0.25.

## Les contrats versionnés

Les valeurs ci-dessous sont extraites du code source ; considérez les références de
fichiers comme la source de vérité et ce tableau comme la carte d'orientation.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrat | Déclaré dans | Vérifié dans | Sens de compatibilité |
|---|---|---|---|---|
| 1 | Plage `rebase` dans `rebase.json` | le projet de l'utilisateur | CLI lors du build | le projet indique les runtimes qu'il accepte |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **rétrocompatible** — un nouveau runtime lit les anciens bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | même fichier | même fichier | **correspondance exacte, dans les deux sens** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | au démarrage, par rapport à `rebase.schema_meta` | **vers l'avant uniquement** — un nouveau runtime migre les anciennes bases de données |
| 5 | `manifest.schemaVersion` | émis par `rebase build` | envoyé par le SDK sous `x-rebase-schema` lorsqu'il est configuré | consultatif — identifie le schéma pour lequel un client a été compilé |
| 6 | Identifiants dérivés de base de données | `contracts/derived-names.txt` | `pnpm check:derived-names` | **figé** — un nom émis par une version n'est jamais redérivé |

### 1 — `rebase` dans `rebase.json`

Une plage semver, interprétée comme `engines` dans un `package.json` : les versions
de runtime acceptées par ce projet. Nommé délibérément `rebase` plutôt que `runtime`,
car `runtime` désigne déjà *qui détient le processus* (`managed` | `custom`) sur
une application.

### 2 — `BUNDLE_FORMAT_VERSION` (actuellement 2)

La disposition sur disque d'un bundle compilé. Un runtime accepte tout bundle dont
le format est **inférieur ou égal** au sien, ce qui permet à l'offre managée de migrer
un tenant vers une nouvelle image sans que personne n'ait à recompiler son projet.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` un répertoire unique,
  `entry.admin` pour une interface d'administration intégrée.
- **2** — `kind: "backend" | "static"`, `entry.static` une liste, `entry.admin`
  supprimé. Le format 1 est toujours lu, via `upgradeLegacyManifest`.

**Incrémentez-le lorsque** la disposition change de telle sorte qu'un ancien runtime
interpréterait incorrectement un bundle plus récent. Cette incrémentation transforme
ce qui aurait été un démarrage servant du contenu vide en un refus pur et simple de
démarrer.

### 3 — `RUNTIME_CONTRACT_VERSION` (actuellement 1)

La version majeure du contrat bundle↔runtime. Distincte de la version du package
`@rebasepro/server`, qui peut publier un nombre quelconque de mineures et de
correctifs pendant que celle-ci reste inchangée.

**Lisez ceci avant d'y toucher.** La vérification est `!==`, et non `>` :

> un bundle ciblant le contrat *N* s'exécute **uniquement** sur un runtime implémentant *N*

par conséquent, l'incrémenter invalide **tous les bundles jamais compilés**, d'un
seul coup, jusqu'à ce que chacun soit recompilé. C'est la sévérité voulue — c'est le
levier « plus rien d'ancien ne peut tourner ici » — mais cela implique qu'une
incrémentation est une migration à l'échelle de toute la flotte, pas une simple
note de release. Pour l'offre managée, cela doit être coordonné avec une recompilation
du bundle de chaque tenant.

Si un changement est *additif* et que les anciens bundles restent valides, il relève
de `BUNDLE_FORMAT_VERSION` (ou de rien du tout), et non de ce contrat.

### 4 — `AUTH_SCHEMA_VERSION` (actuellement 2)

Inscrit dans `rebase.schema_meta` et comparé au démarrage. Un runtime **refuse de démarrer**
face à une base de données migrée par une version plus récente du framework, plutôt
que de fonctionner sur une structure qu'il ne comprend pas — lors d'un déploiement
progressif (rolling deploy), c'est la différence entre la moitié de la flotte qui
renvoie une erreur et la moitié de la flotte qui corrompt les données.

La migration vers l'avant est automatique : `ensureAuthTablesExist` met à niveau
une ancienne base de données. Notez que ce bloc de migration est délibérément
encapsulé dans un `try/catch` et consigne des logs plutôt que de lever une
exception — un démarrage bancal vaut mieux qu'une boucle de crash — donc **« le
démarrage a réussi » ne prouve rien**. Chaque assertion de la suite de mise à niveau
vérifie directement le catalogue ou les données.

**Incrémentez-le lorsqu'** une migration ne doit absolument pas être ignorée par
un runtime plus ancien. Ne l'incrémentez pas pour une colonne additive
rétrocompatible ; un exemple concret de cette distinction se trouve dans
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Un hash des définitions de collections compilées, inscrit dans le manifeste du
bundle et renvoyé par un SDK généré dans l'en-tête `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Il existe pour permettre à la plateforme d'indiquer « cette
application a été compilée avec un schéma plus ancien » au lieu d'échouer
mystérieusement dès la première requête.

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

Le backend lit cet en-tête à chaque requête de données. Un écart de version (drift)
ne bloque jamais un appel — un SDK en retard d'un schéma reste généralement
compatible, et déployer le backend avant le frontend constitue l'ordre de déploiement
normal — mais lorsqu'une requête échoue avec une erreur 400 ou 404, l'erreur comporte
cet écart comme cause :

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

Ainsi, une colonne renommée se traduit par « votre SDK est obsolète, régénérez-le »,
plutôt que par un champ que vos propres types affirment exister. Une requête qui
réussit n'en est jamais informée.

Cela ne couvre **que les collections**. La modification d'un hook ou d'une
fonction ne change pas le contrat du client et ne doit pas invalider l'ensemble
des SDK générés.

### Qui appelle

Deux autres signaux d'identification, dont aucun ne bloque quoi que ce soit à lui seul :

- **`GET /api/meta/schema-version`** ne nécessite pas d'authentification et répond avec
  le `schemaVersion` du projet *et* son `runtime` (`version` et `contract`). Un job
  CI comparant son SDK généré à un projet actif n'a besoin d'aucun identifiant, pas
  plus qu'un client cherchant à savoir à quel runtime il s'adresse.
- **`User-Agent: rebase-cli/<version>`** accompagne chaque requête `rebase cloud`.
  Le format réseau (wire format) du plan de contrôle évolue plus vite que ce qui
  est publié sur npm ; il doit donc pouvoir répondre à un ancien client avec
  `CLI_TOO_OLD` et la version minimale requise — ce qu'il ne peut faire que pour un
  appelant qui s'identifie.

### 6 — Identifiants dérivés de base de données

Chaque nom que ce framework détermine de lui-même plutôt qu'on ne lui indique : une
colonne de clé étrangère, une contrainte de clé étrangère, une table de jonction et
ses deux colonnes de clés, un type enum, un nom de politique (policy), la colonne
en `snake_case` d'une propriété en `camelCase`.

> **Un identifiant dérivé est figé dès l'instant où une version l'émet.**

Pas « figé jusqu'à la prochaine version majeure » — figé. Le raisonnement est
différent de celui des cinq autres contrats, et plus rigoureux. Ceux-là sont
versionnés, ce qui permet de *détecter* une non-concordance et de la rejeter.
Celui-ci ne le permet pas : le nom est inscrit dans la base de données d'un client
le jour de son déploiement, et il n'y a aucun marqueur de version sur une colonne.
Chaque base de données provisionnée par chaque version publiée porte les noms qui
ont été dérivés, et aucun code de ce dépôt ne peut intervenir pour tous les renommer.

La version 0.13 en est l'exemple concret. `generateForeignKeyName` a appris à
singulariser correctement — `categorie_id` → `category_id`, `addres_id` → `address_id` — ce
qui constitue indubitablement une meilleure dérivation, et cela a cassé toutes les
anciennes bases de données comportant un pluriel irrégulier. La vérification au
démarrage a migré la colonne, les données ont donc survécu ; le fichier
`schema.generated.ts` versionné du projet ne l'a pas fait, et le démarrage a échoué
sur une colonne qui existait pourtant. Trois commits, un nouveau test d'intégration
et une mention permanente dans les notes de mise à niveau, en échange d'un nom de
colonne plus élégant que personne n'avait demandé.

**Si une dérivation est réellement erronée**, elle change pour les collections créées
*après coup*, derrière une stratégie de nommage enregistrée dans le projet — jamais
rétroactivement, et jamais comme effet secondaire de l'amélioration de la fonction
sous-jacente.

**La seule dérogation légitime** est un changement qui met le code en accord avec
un nom que la base de données *possède déjà*. L'exemple type est la troncature des
identifiants : Postgres tronque silencieusement un identifiant à 63 octets, donc
un nom de contrainte dérivé plus long n'a jamais été le nom figurant dans le catalogue —
la dérivation décrivait un objet qui n'existait pas sous cette graphie, et la
vérification au démarrage réémettait `ADD CONSTRAINT` à chaque démarrage parce que
sa comparaison ne pouvait jamais correspondre. Tronquer dès la construction modifie
ce que ce dépôt *dérive* et ne change rien à ce que toute base de données déployée
*contient*. C'est le test à appliquer : non pas « le nouveau nom est-il meilleur »,
mais « une quelconque base existante doit-elle changer ».

L'autre cas où un nom peut changer concerne un ensemble de noms qui n'ont jamais
pu coexister. Une règle s'étendant sur plusieurs opérations sur une table de 42
octets ou plus dérivait `<table>_default_admin_write_insert`, `_update` et `_delete`,
et toutes trois étaient tronquées aux mêmes 63 octets. Postgres enregistrait une
seule politique, DELETE, et refusait tous les INSERT et UPDATE d'administration.
Ce n'est que lorsque les noms d'une règle entrent ainsi en collision qu'ils sont
dérivés en plaçant le suffixe au début, sous la forme `<head>_<hash8>_<op>`. Tout
nom qui fonctionne aujourd'hui conserve son orthographe. Le démarrage ou le push
suivant supprime la politique tronquée unique et crée une politique pour chaque
opération.

La seule chose toujours sans risque est de *reconnaître* un ancien nom afin de
le migrer : `legacyForeignKeyName` existe pour être détecté, jamais pour être
généré, et la référence de base (baseline) fige également ces détections. En
supprimer une annule silencieusement la migration de chaque base de données portant
encore cette orthographe.

**La barrière de contrôle (gate).** `tooling/scripts/derived-names.mts` soumet un
jeu de tests de nommage intensif — pluriels irréguliers, terminaison en `ss`,
acronyme, jonction à partir d'un slug pluriel, remplacements explicites, slug
suffisamment long pour être tronqué — aux deux générateurs de DDL de schéma, et
produit chaque identifiant que l'un ou l'autre nomme :

```bash
pnpm check:derived-names
```

Une ligne modifiée ou supprimée échoue en tant que rupture de contrat, affichant
l'ancienne et la nouvelle graphie côte à côte. Un changement purement additif échoue
également, mais avec l'instruction « regenerate » — de sorte que la référence de
base ne puisse pas dériver à l'insu de quiconque.

Elle garantit également que `rebase db push` et la vérification au démarrage du
runtime managé dérivent les *mêmes* noms, ce qui constitue un deuxième contrat
dissimulé dans le premier : ils compilent les mêmes collections via du code
différent, et un projet pushé une fois puis démarré plus tard ne doit pas se
retrouver avec deux schémas distincts.

## Ce qui n'est *pas* figé

Exprimé clairement, afin que personne n'en déduise une promesse qui n'a jamais été faite :

- L'API TypeScript que vous écrivez — configuration des collections, options de
  `initializeRebaseBackend`, props d'administration, noms des méthodes du SDK.
  Les changements cassants interviennent dans les versions mineures et sont annoncés
  dans le changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — ce sont les éléments qui évoluent le plus vite et
  comptent le moins d'utilisateurs.
- Tout ce qui se trouve sous le dossier `src/` d'un package et qui n'est pas
  réexporté depuis son point d'entrée principal (barrel). `packages/client/src/index.ts`
  comporte une note expliquant que sa liste d'exports est précisément calibrée afin
  qu'un export interne ne devienne pas public par accident.
- Le schéma de base de données de *vos* collections. Il vous appartient ; Rebase
  ne possède que le schéma `rebase` (et, sur une base de données provisionnée
  avant la version 0.13, l'ancien schéma `auth` jusqu'à ce que le démarrage le retire).

## Les barrières de contrôle qui les garantissent

Rien de ce qui précède n'est une simple convention — chacun dispose d'un test qui
échoue en cas de rupture :

| Barrière | Ce qu'elle verrouille |
|---|---|
| `pnpm verify:corpus` | chaque forme de bundle jamais publiée, démarrée sur le runtime actuel. Les jeux de test (fixtures) dans `tests/fixtures/bundles/` sont **écrits à la main et figés** — un jeu de test régénéré par le builder bouge à chaque évolution de celui-ci |
| `pnpm verify:selfhost` | un vrai bundle compilé, plié, démarré et interrogé comme le ferait un navigateur |
| `upgrade-e2e.test.ts` | les anciens schémas de base de données (`schema-snapshots/`) pris en charge par le runtime actuel |
| `tests/e2e/tests/cli-init-e2e.ts` | un projet généré à partir d'un modèle et installé depuis de **vraies archives tarball**, et non des liens de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | le parcours utilisateur final : inscription → connexion → lectures délimitées par RLS → rafraîchissement → stockage → temps réel |
| `pnpm check:derived-names` | chaque nom de colonne, contrainte, jonction, enum et politique dérivé par le framework — et le fait que le démarrage et `db push` les dérivent de manière identique |
| `pnpm rls:check` | les politiques du schéma généré |
| `pnpm check:api-surface` | chaque export, et ses membres, des cinq packages fournis par l'image — `@rebasepro/server`, `types`, `client`, `common`, `utils` — ainsi que le point d'entrée `@rebasepro/server/functions`, par rapport aux six sections de `contracts/server.api.txt`. Ce sont les packages que `infra/docker/entrypoint.mjs` lie via des liens symboliques par-dessus les copies propres d'un bundle déployé ; supprimer un export de l'un d'eux ne constitue donc pas une erreur de compilation pour quiconque — c'est un échec au démarrage sur toute la flotte, lors d'un déploiement que personne n'a demandé |
| `pnpm test:gates` | les propres tests des barrières, sur des jeux d'essai — quarante-sept fichiers, dont `check:api-surface` et la vérification d'incrémentation de version ci-dessous — afin qu'une barrière qui cesserait de surveiller ce qu'elle protège échoue ici. `check:api-surface` a passé toute son existence sans pouvoir détecter la disparition d'un membre de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | la concordance entre le niveau d'incrémentation d'une version publiée et les modifications apportées aux références de base ci-dessus — exécuté par `publish.yml` avant l'estampillage du changelog |
| CI saas | le plan de contrôle compilé par rapport à la branche `main` de ce dépôt, sur ses propres pushs et chaque nuit |

**Enregistrez un jeu de test de bundle et un snapshot de schéma une fois par version.**
La valeur de ces deux corpus repose entièrement sur l'ancienneté du plus ancien d'entre
eux, et aucun ne peut être reconstitué a posteriori.

### Ce qui n'est pas encore sous contrôle automatisé

Le tableau ci-dessus représente ce qui est garanti. Voici les pans de la politique
que rien ne verrouille encore, listés afin que personne n'y voie une promesse infondée :

- **Pas de période d'obsolescence (deprecation) ni de fenêtre de support.** Tant
  que Rebase est en `0.x`, il n'y a pas de règle écrite fixant la durée de maintien
  d'un export déprécié avant suppression, ni la durée pendant laquelle une ancienne
  version mineure reçoit des correctifs. Les correctifs de sécurité ne sont appliqués
  que sur la dernière version mineure.
- **Le format réseau HTTP n'a pas de barrière de contrôle.** Aucun script `check:*`
  ne compare la structure des requêtes et des réponses à une référence de base comme
  le fait `check:api-surface` pour les exports ; une modification de la structure
  de réponse n'est interceptée que par une suite e2e qui se trouve la lire.
- **Les options (flags) de la CLI n'ont pas de référence de base de compatibilité.**
  Le vérificateur de documentation échoue lorsqu'une option utilisée par les compétences,
  les exemples ou le site marketing disparaît ; rien ne détecte la disparition d'une
  autre option, ni le changement de signification d'une option.
- **Une release CI n'enregistre aucun des deux corpus.** Le workflow de publication
  n'enregistre ni jeu de test de bundle ni snapshot de schéma ; seul le script de
  publication local s'y emploie, et il émet un avertissement plutôt que de s'interrompre
  s'il n'y parvient pas. Les versions 0.18 à 0.21 n'ont aucun snapshot de projet enregistré.
- **La surface d'export est une barrière, pas un contrat.** La question de savoir
  si les exports publics des packages fournis par le runtime deviendront un septième
  contrat numéroté — déclaré comme la référence de `check:api-surface`, compatible de
  manière additive au sein d'une version majeure de contrat — reste une décision ouverte.

## Modifier un contrat

1. Déterminez duquel des six il s'agit. La plupart des modifications ne concernent
   aucun d'entre eux — mais « aucun des six » ne signifie pas « anodin ». Supprimer
   ou renommer un export de `@rebasepro/server`, ou l'un de ses membres, ne relève
   d'aucun des six et constitue la modification la plus dangereuse de tout le
   dépôt, car le code qu'elle casse est déjà compilé et ne sera pas recompilé.
   `pnpm check:api-surface` est ce qui maintient cette ligne de défense ; la
   question de savoir si cela deviendra un septième contrat numéroté reste ouverte
   (voir *Ce qui n'est pas encore sous contrôle automatisé*, plus haut).
2. Ajoutez d'abord un jeu de test (fixture) ou un snapshot pour l'**ancienne**
   structure, et assurez-vous qu'il réussit.
3. Effectuez la modification et incrémentez la constante.
4. Confirmez que l'ancienne fixture réussit toujours, ou qu'elle échoue désormais
   *avec le message dont l'utilisateur aurait besoin*. Ces deux issues sont valables ;
   le silence ne l'est pas.
5. Pour le contrat 3, planifiez la recompilation de chaque bundle déployé avant
   de fusionner (merge).
6. Le contrat 6 fait exception aux étapes 3 et 4 : il n'y a pas de constante à
   incrémenter ni de version sur laquelle rejeter l'opération, car une colonne ne
   porte aucun marqueur de version. L'étape qui les remplace consiste à décider de
   ne pas faire la modification — consultez la section ci-dessus pour voir à quoi
   ressemble l'alternative.

## Voir aussi

- [Mise à niveau](/docs/upgrading/) — ce qui a effectivement changé avec rupture, version par version
- [Journal des modifications](/docs/changelog/) — chaque modification, y compris celles qui n'ont rien cassé
- [Runtime et Bundles](/docs/architecture/runtime-and-bundles/) — contrat 3 — le format de bundle pour lequel un projet déployé est déjà compilé
