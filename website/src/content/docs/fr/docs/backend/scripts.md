---
sourceHash: 87e4ee6ea63add18
title: Scripts et la console
sidebar_label: Scripts et la console
description: Ouvrez les données d'un projet depuis un script, un test ou un REPL avec openRebase, ou depuis le terminal avec rebase console. Aucun serveur, aucune modification de schéma.
---

## Vue d'ensemble

Pour examiner quelques lignes, en corriger une, tester un filtre ou vérifier ce
qu'une politique permet à un utilisateur de voir, vous ne devriez pas avoir à
démarrer un serveur. Rebase met à votre disposition les données du projet sous
forme d'objet, à deux endroits :

- **`rebase console`**, un REPL Node dans votre terminal avec le projet ouvert ;
- **`openRebase`**, le même objet dans un script ou un test qui vous est propre.

Les deux ouvrent la base de données sans la modifier : aucune table, aucun rôle,
déclencheur ou fonction n'est créé. L'appel à `close()` d'un script ferme ce que
`openRebase` a ouvert. Sur la base de données de développement managée, `rebase
console` démarre cette base de données lorsqu'elle n'est pas en cours d'exécution
et la laisse active par la suite, tout comme le font les commandes `rebase db` ;
`rebase db stop` l'arrête. L'objet dispose du même vocabulaire que celui qu'une
[fonction personnalisée](/docs/backend/custom-functions/) reçoit du serveur,
`dataAsAdmin` et `sql`, de sorte qu'un extrait de code peut passer d'une
fonction à un script ou à la console sans aucune modification.

## `rebase console`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Exécutez-le dans votre projet :

```bash
rebase console
```

```text
> const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 })
> data.map(p => p.title)
[ 'Draft', 'Second post', 'Hello' ]
> const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] })
> (await ada.data.posts.find({ limit: 3 })).data.length
3
```

Deux variables sont dans la portée (scope), et le `await` de premier niveau fonctionne :

| Nom | Description |
|---|---|
| `rebase` | Ce que renvoie [`openRebase`](#openrebase) : `dataAsAdmin`, `sql`, `withAuth(user)` et `close()` |
| `tables` | Les descripteurs des tables exposées par le projet, chargées depuis `backend/schema` de la même manière que `rebase db push` les charge (`rebase.tables`) |

La console ouvre le projet de la même manière que `rebase db push` : le même
`.env`, la même base de données et les mêmes tables, depuis `backend/schema`.
Elle charge également les `hooks` globaux depuis `backend/hooks.ts`, afin que ses
écritures exécutent les mêmes hooks qu'une écriture côté serveur. Pour un projet
utilisant la base de données de développement managée, celle-ci est d'abord
démarrée si nécessaire. L'historique de ce que vous avez saisi est conservé dans
`.rebase/console_history`, que le `.gitignore` du scaffold exclut déjà.

L'entrée transmise par un pipe s'exécute ligne par ligne, chacune après la
résolution du `await` de la ligne précédente, de sorte que la transcription
ci-dessus fonctionne avec `printf '…\n…\n' | rebase console`. Tout ce qui suit
`.exit` est ignoré, et les valeurs ne sont colorées que sur un terminal. Tout ce
que la console consigne (logs) est envoyé sur stderr.

### Un extrait de code : `--eval`

`rebase console -e "<code>"` exécute un fragment de code à la place du REPL. La
valeur d'une expression, ou le `return` d'un corps de fonction, est attendue
(`await`) et affichée sous forme de JSON sur stdout, permettant ainsi de
rediriger la sortie (pipe) :

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Tout ce que la console consigne, quelle que soit la valeur de `LOG_LEVEL`, est
envoyé sur stderr, de sorte que stdout ne contienne que le résultat et rien
d'autre. Un extrait qui lève une exception affiche l'erreur sur stderr et se
termine avec le code `1`.

Une base de données que la console ne peut pas ouvrir est signalée une seule
fois, puis elle se termine avec le code `1` : la bannière « Cannot connect to
PostgreSQL » affichée par les commandes `db`, ou, sur la base de données de
développement managée, le fait qu'elle n'ait plus de connexion disponible. Cette
base de données n'accepte que peu de connexions à la fois et une instance en
cours d'exécution de `rebase dev` en conserve certaines ; fermez donc un autre
client ou arrêtez `rebase dev` et réessayez.

### Options

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Option | Description |
|---|---|
| `--eval`, `-e` | Exécute ce code à la place du REPL, affiche son résultat attendu (`await`) au format JSON et quitte avec le code 1 en cas d'erreur |
| `--schema-dir` | Le répertoire du schéma, s'il est différent de celui du projet (`backend/schema`, ou la clé `tables` de `rebase.json`) |
| `--database-url` | Ouvre cette base de données à la place de celle du projet |
| `--docker` | Utilise la base de données provenant de docker compose, en la démarrant si nécessaire |

## `openRebase`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`openRebase` du paquet `@rebasepro/server-postgres` est ce que la console
appelle. Utilisez-le dans un script, un seed, une correction de données ou un
test. Dans un projet généré à partir d'un scaffold, placez le script sous
`backend/`, par exemple `backend/scripts/publish-drafts.ts` : le workspace
backend est celui qui dépend de `@rebasepro/server-postgres`, et un script situé
dans le dossier racine `scripts/` ne peut pas l'importer.

`openRebase` prend en argument les tables compilées du projet : `compileSchema`
de `@rebasepro/common` transforme les résultats de `defineTable` en tables
exploitables par le pilote, hooks inclus. Placez cela dans un module partagé par
les scripts, `backend/scripts/tables.ts`, après avoir ajouté `@rebasepro/common`
à `backend/package.json` :

```typescript no-verify
import { compileSchema } from "@rebasepro/common";
import * as schema from "../schema";

// Every table the index exports, and the defaultRls its "inherit" tables take.
export const tables = compileSchema(
    [schema.users, schema.posts, schema.authors, schema.tags],
    { defaultRls: schema.defaultRls }
);
```

Passez les hooks globaux exportés par `backend/hooks.ts` sous la clé `hooks`, et
les écritures du script les exécuteront tout comme le ferait une écriture côté
serveur ; sans eux, un `beforeSave` global qui associe un tenant ou écrit une
ligne d'audit ne sera exécuté lors d'aucune écriture de script. Omettez `tables`
et `openRebase` lira les tables directement depuis la base de données, comme le
fait un serveur sans `backend/schema`. `rebase console` charge les deux pour
vous.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Exécutez-le depuis `backend/`. `rebase db url` affiche l'URL de la base de
données utilisée par le projet, y compris celle de développement managée :

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Membre | Description |
|---|---|
| `dataAsAdmin` | Toutes les tables, lues et écrites avec l'identité de service du serveur (`{ uid: "service", roles: ["admin"] }`) : admin, tout en restant soumises à l'évaluation de vos politiques RLS, exactement comme `rebase.dataAsAdmin` dans une fonction |
| `sql(query, { params })` | SQL brut sur la connexion propriétaire (owner), avec la même convention d'appel que `rebase.sql` dans une fonction. Il s'exécute sur l'unique source de données ouverte : toute option `{ database }` en désignant une autre est refusée |
| `withAuth(user)` | Se résout en `{ data }` : les tables telles que cet utilisateur les voit. Chaque lecture et écriture s'exécute en son nom, filtrée par la sécurité au niveau des lignes (RLS), tout comme le serait une requête HTTP émise par cet utilisateur |
| `tables` | Les descripteurs des tables desservies : celles qui lui ont été fournies ou celles décrites par la base de données |
| `close()` | Ferme le pool de connexions créé par `openRebase`. Peut être appelé deux fois en toute sécurité |

Ses options :

| Option | Description |
|---|---|
| `databaseUrl` | La base de données à ouvrir. `openRebase` crée le pool et `close()` le ferme |
| `connection` | Une connexion Drizzle que vous détenez déjà (`createPostgresDatabaseConnection(url).db`), à la place de `databaseUrl`. Elle reste la vôtre : `close()` la laisse ouverte |
| `tables` | Les tables du projet, compilées avec `compileSchema` (voir ci-dessus). En cas d'absence ou si la valeur est vide, elles sont lues depuis la base de données, comme le ferait un serveur sans `backend/schema`, et sont desservies en lecture seule |
| `pool` | Paramètres du pool, avec `databaseUrl` |
| `dataSourceKey` | La base de données à partir de laquelle ces tables sont servies. Par défaut `(default)` |
| `hooks` | Les hooks globaux du projet : les `hooks` exportés par `backend/hooks.ts`, que le serveur exécute avant ceux propres à chaque table. Passez-les ici et les écritures du script les exécuteront également. `rebase console` s'en charge pour vous |

`openRebase` ne lit aucune variable d'environnement. La variable `DATABASE_URL`
ci-dessus est lue par votre script, et les paramètres tels que
`REBASE_DB_POOL_MAX` ou `REALTIME_CDC` ne changent rien ici.

L'ouverture ne consigne rien au niveau `info`, de sorte que le stdout d'un script
ne contient que ce que le script affiche, et `tsx scripts/report.ts > report.json`
n'écrit que son JSON. Les avertissements et les erreurs vont sur stderr en
développement. La notification indiquant comment les requêtes sont isolées
(`RLS enforcement active`) est consignée au niveau `debug` ; le démarrage d'un
serveur l'affiche toujours au niveau `info`. Une base de données inaccessible
rejette l'ouverture avec une seule erreur, `Cannot connect to PostgreSQL at
<host>:<port>: <reason>.`, et ne consigne rien d'autre : la décision d'afficher
ou non cette information revient au script.

Ses accesseurs sont typés par l'interface `Database` enregistrée par `rebase
generate-sdk --register`, tout comme le `rebase` d'une fonction, de sorte qu'une
faute de frappe dans le nom d'une table, d'un champ ou d'une valeur
d'énumération dans un script génère une erreur de type. Le fichier
`backend/tsconfig.json` du scaffold inclut `scripts/`, ainsi `tsc --noEmit`
exécuté dans `backend/` la signale. Sans enregistrement, spécifiez-le à chaque
appel avec `openRebase<Database>({ … })` ; `OpenedRebase<Database>` est le type à
attribuer à une fonction utilitaire (helper) qui en reçoit une instance. Sans
l'un ni l'autre, les lignes ne sont pas typées, c'est pourquoi le premier exemple
convertit `draft.id` avec `String()`.

### Vérifier ce qu'un utilisateur peut voir

`withAuth` est le moyen le plus rapide de tester une règle de sécurité sur des
données réelles. Le scaffold de blog, valeur par défaut de `rebase init`, déclare
des règles directement sur `posts` : un utilisateur connecté sans rôle lit les
articles publiés et aucun brouillon, et seul un administrateur peut en écrire.
(Les autres tables indiquent `rls: "inherit"` et adoptent le `defaultRls` défini
dans `backend/schema/index.ts`.) Ceci vérifie les deux aspects, dans
`backend/scripts/ada-check.ts` :

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads published posts, and no drafts…
const { data: seen } = await ada.data.posts.find();
console.log(seen.every(post => post.status === "published"));

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

// SQL as Ada runs under the same policies: her rows, read-only unless { write: true }.
const counted = await ada.sql("SELECT count(*)::int AS n FROM posts");
console.log(Number(counted[0]?.n) === seen.length);

await rebase.close();
```

Exécutez-le de la même manière que le premier script, et il affichera `true`
trois fois :

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Une règle qui filtre les lignes par propriétaire se vérifie de la même façon :
comparez le champ propriétaire de chaque ligne avec l'`uid` transmis. Sur le
scaffold de blog, aucune règle ne le fait, et `authorId` sur un article
correspond à l'identifiant d'une ligne d'auteur, pas à celui d'un utilisateur.

Un utilisateur est représenté par `{ uid, roles?, isAnonymous?, claims? }` ;
`claims` correspond à ce que `rebase.jwt()` lit dans une politique.

`withAuth` s'exécute sous le rôle restreint créé au démarrage du serveur
(`rebase_user`). Sur une base de données sur laquelle aucun serveur Rebase n'a
jamais démarré, ce rôle n'existe pas, et les requêtes `withAuth` échouent avec
l'erreur de rôle inconnu de Postgres plutôt que de s'exécuter sans filtrage.
Exécutez d'abord `rebase db push`, ou démarrez le serveur une fois.

### Dans un test

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, tables });
});
after(() => rebase.close());

test("a signed-in user reads published posts only and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    assert.ok(seen.every(post => post.status === "published"));
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Enregistrez-le sous `backend/scripts/posts.test.ts` et exécutez-le depuis
`backend/` avec le lanceur de tests de Node, en faisant pointer
`TEST_DATABASE_URL` vers une base de données sur laquelle un serveur Rebase a
déjà démarré :

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

La même chose fonctionne avec Vitest ou Jest.

### Tables avec historique

Une écriture sur une table avec [`history: true`](/docs/backend/history/)
enregistre son entrée de la même manière qu'une écriture côté serveur. L'entrée
est inscrite dans la transaction propre à la ligne, de sorte qu'une écriture
annulée (rollback) ne laisse aucune entrée. Elle est enregistrée sous l'identité
avec laquelle l'écriture a été exécutée : `service` pour `dataAsAdmin`, l'`uid`
de l'utilisateur sous `withAuth`. Les écritures depuis `rebase console` sont
enregistrées de la même façon.

`openRebase` ne crée aucune structure pour ces enregistrements. Si aucun backend
avec historique n'a démarré sur la base de données, la table
`rebase.entity_history` est absente. Une écriture sur une table avec historique
est alors refusée avec l'erreur
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) avant
même que l'un de ses hooks ne s'exécute, et le message précise ce qui manque.
Les lectures fonctionnent normalement. Démarrez le backend une fois avec
l'historique activé (ce que fait `rebase dev`), et les écritures aboutiront.

Les entrées sont enregistrées, jamais purgées par le script. La rétention est un
paramètre serveur invisible pour un script ; le serveur les purge donc comme
d'habitude : lors de la prochaine écriture de l'entité, ainsi que lors de son
nettoyage horaire.

### Ce qui n'est pas inclus

`openRebase` ouvre la couche de données et rien d'autre. Il ne démarre aucun
mécanisme temps réel par lui-même, mais ses écritures atteignent tout de même les
requêtes en direct (live queries) : les déclencheurs de capture des modifications
(change-capture triggers) de la base de données signalent chaque écriture, quel
qu'en soit l'auteur, de sorte que les abonnés sur un serveur en cours d'exécution
récupèrent également les données après un backfill. Ce n'est qu'avec
`REALTIME_CDC=off` sur ce serveur qu'elles ne sont pas signalées. Voir
[Capture des modifications de base de données](/docs/backend/realtime-cdc/). Le
stockage, les e-mails, l'administration de l'authentification et vos fonctions
n'en font pas partie.

Les hooks propres à chaque table s'exécutent à chaque écriture, tout comme sur
le serveur. Les hooks globaux du projet ne s'exécutent que si vous les
transmettez via l'option `callbacks`. `rebase console` les transmet pour vous :
elle lit les `hooks` exportés par votre `backend/hooks.ts`, de sorte qu'un
`beforeSave` global s'exécute également lors de ses écritures. Si ce fichier ne
peut pas être importé (par exemple, s'il a besoin d'une variable
d'environnement non fournie à la console), la console affiche une ligne
indiquant que les hooks globaux sont désactivés pour la session et s'ouvre sans
eux.

Lorsqu'un script a également besoin de ces éléments, construisez le backend sans
le servir : `createRebaseBackend({ …, provision: false })` vous fournit
`backend.rebase`, le client in-process complet, sans rien monter ni démarrer.
Voir [le backend sans serveur](/docs/backend/custom-server/#the-backend-without-a-server).
Pour tester le hook d'une table sans aucune base de données, appelez-le avec
[`createCallContext`](/docs/collections/callbacks/#testing-a-hook).

## Voir aussi

- [Intégration d'un serveur personnalisé](/docs/backend/custom-server/) — le backend sous forme de briques publiques
- [Référence de la CLI](/docs/cli/) — toutes les commandes `rebase`
- [Règles de sécurité](/docs/collections/security-rules/) — les règles de filtrage appliquées à `withAuth`
