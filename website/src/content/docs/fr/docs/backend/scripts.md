---
sourceHash: 10cf48a2f2326c5a
title: Scripts et console
sidebar_label: Scripts et console
description: Ouvrez les données d'un projet depuis un script, un test ou un REPL avec openRebase, ou depuis le terminal avec rebase console. Pas de serveur, pas de modification du schéma.
---

## Vue d'ensemble

<span class="since-badge" data-since="0.25">Depuis 0.25</span> En 0.24, il n'existe
ni `openRebase` ni `rebase console` : un script doit construire un backend, ou
appeler l'API REST d'un serveur en cours d'exécution.

Pour consulter quelques lignes, en corriger une, essayer un filtre ou vérifier ce qu'une stratégie laisse
voir à un utilisateur, vous ne devriez pas avoir à démarrer un serveur. Rebase vous donne les données du projet
sous la forme d'un objet, à deux endroits :

- **`rebase console`**, un REPL Node dans votre terminal avec le projet ouvert ;
- **`openRebase`**, le même objet dans un script ou un test qui vous appartient.

Les deux ouvrent la base de données sans la modifier : aucune table, aucun rôle, aucun déclencheur ni
aucune fonction n'est créé. Le `close()` d'un script termine ce qu'`openRebase` a ouvert. Sur la
base de développement gérée, `rebase console` démarre cette base lorsqu'elle n'est pas en cours
d'exécution et la laisse démarrée ensuite, comme le font les commandes `rebase db` ;
`rebase db stop` l'arrête. L'objet a le
vocabulaire qu'une [fonction personnalisée](/docs/backend/custom-functions/) reçoit du
serveur, `dataAsAdmin` et `sql`, de sorte qu'un extrait de code passe tel quel d'une fonction à un script
puis à la console.

## `rebase console`

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

Lancez-la dans votre projet :

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

Deux noms sont dans la portée, et l'`await` de premier niveau fonctionne :

| Nom | Ce que c'est |
|---|---|
| `rebase` | Ce que renvoie [`openRebase`](#openrebase) : `dataAsAdmin`, `sql`, `withAuth(user)` et `close()` |
| `collections` | Les collections du projet, chargées comme les charge `rebase db push` |

La console ouvre le projet comme le fait `rebase db push` : le même `.env`,
la même base de données et les mêmes collections. Un projet qui utilise la base de développement
managée la voit démarrer d'abord. L'historique de ce que vous avez tapé est
conservé dans `.rebase/console_history`, que le `.gitignore` du scaffold
exclut déjà.

Une entrée envoyée par un pipe s'exécute ligne par ligne, chacune après que le `await` de la
précédente s'est réglé, de sorte que la session ci-dessus fonctionne ainsi :
`printf '…\n…\n' | rebase console`. Tout ce qui suit `.exit` est ignoré, et les
valeurs ne sont colorées que dans un terminal. Tout ce que la console journalise va sur
stderr.

### Un extrait : `--eval`

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

`rebase console -e "<code>"` exécute un seul morceau de code au lieu du REPL. La valeur d'une
expression, ou le `return` du corps d'une fonction, est attendue (awaited) puis affichée
en JSON sur stdout, de sorte que la sortie peut être redirigée dans un pipe :

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Tout ce que la console journalise, quelle que soit la valeur de `LOG_LEVEL`, va sur stderr, de sorte
que stdout contient le résultat et rien d'autre. Un extrait qui lève une exception affiche l'erreur
sur stderr et se termine avec le code `1`.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Une base de données que la
console ne peut pas ouvrir est signalée une seule fois, et la console se termine avec le code `1` : la
bannière « Cannot connect to PostgreSQL » qu'affichent les commandes `db`, ou, sur la base de
développement managée, le fait qu'elle n'a plus de connexion libre. Cette base n'accepte que
quelques connexions à la fois et un `rebase dev` en cours d'exécution en détient certaines :
fermez donc un autre client ou arrêtez `rebase dev`, puis relancez-la. En 0.24, la bannière
apparaissait deux fois, sous une ligne `❌ [ERROR]` vide, et une base managée pleine affichait
`read ECONNRESET` avec sa pile d'appels sur une seule ligne de JSON.

### Options

| Option | Ce qu'elle fait |
|---|---|
| `--eval`, `-e` | Exécute ce code à la place du REPL, affiche son résultat attendu en JSON, et sort avec le code 1 s'il lève une exception |
| `--collections`, `-c` | Chemin du répertoire des collections, s'il diffère de celui du projet |
| `--database-url` | Ouvre cette base de données plutôt que celle du projet |
| `--docker` | Utilise la base de données de docker compose, en la démarrant si nécessaire |

## `openRebase`

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

`openRebase`, de `@rebasepro/server-postgres`, est ce qu'appelle la console. Utilisez-le
dans un script, un seed, une correction de données ou un test. Dans un projet issu d'un
scaffold, placez le script sous `backend/`, par exemple `backend/scripts/publish-drafts.ts` :
le workspace backend est celui qui dépend de `@rebasepro/server-postgres`, et un script du
dossier `scripts/` à la racine ne peut pas l'importer.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Lancez-le depuis `backend/`. `rebase db url` affiche l'URL de la base de données qu'utilise le
projet, y compris la base de développement gérée :

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Membre | Ce qu'il fait |
|---|---|
| `dataAsAdmin` | Toutes les collections, lues et écrites avec l'identité de service du serveur (`{ uid: "service", roles: ["admin"] }`) : administrateur, et toujours évaluées par vos stratégies RLS, exactement comme `rebase.dataAsAdmin` dans une fonction |
| `sql(query, { params })` | SQL brut sur la connexion propriétaire, avec la même convention d'appel que `rebase.sql` dans une fonction |
| `withAuth(user)` | Se résout en `{ data }` : les collections telles que cet utilisateur les voit. Chaque lecture et chaque écriture s'exécute sous son identité, filtrée par la sécurité au niveau des lignes, comme le serait une requête HTTP de cet utilisateur |
| `collections` | Les collections avec lesquelles il a été ouvert |
| `close()` | Termine le pool de connexions créé par `openRebase`. Peut être appelé deux fois sans risque |

Ses options :

| Option | Ce qu'elle fait |
|---|---|
| `databaseUrl` | La base de données à ouvrir. `openRebase` crée le pool et `close()` le termine |
| `connection` | Une connexion Drizzle que vous détenez déjà (`createPostgresDatabaseConnection(url).db`), à la place de `databaseUrl`. Elle reste la vôtre : `close()` la laisse ouverte |
| `collections` | Les collections du projet. Un tableau vide les lit plutôt depuis la base de données, comme le fait un serveur sans fichiers de collections, et les sert en lecture seule |
| `pool` | Les paramètres du pool, avec `databaseUrl` |
| `dataSourceKey` | La source de données dont ces collections sont servies. Par défaut `(default)` |

`openRebase` ne lit aucune variable d'environnement. Le `DATABASE_URL` ci-dessus est lu par
votre script, et des paramètres comme `REBASE_DB_POOL_MAX` ou `REALTIME_CDC` ne changent
rien ici.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> L'ouverture ne journalise rien
au niveau `info`, de sorte que le stdout d'un script contient ce que le script affiche, et que
`tsx scripts/report.ts > report.json` n'écrit que son JSON. Les avertissements et les erreurs
vont sur stderr en développement. La note sur la façon dont les requêtes sont isolées
(`RLS enforcement active`) est journalisée au niveau `debug` ; le démarrage d'un serveur
l'affiche toujours au niveau `info`. Une base de données injoignable fait rejeter l'ouverture
avec une seule erreur, `Cannot connect to PostgreSQL at <host>:<port>: <reason>.`, et rien
n'est journalisé : c'est au script de décider quoi afficher. En 0.24, cette note ouvrait le
stdout d'un script, et une base de données injoignable journalisait une bannière avant l'erreur.

Ses accesseurs sont typés par le `Database` qu'enregistre `rebase generate-sdk --register`,
comme l'est le `rebase` d'une fonction : un nom de collection, de champ ou de valeur d'enum
mal orthographié dans un script est donc une erreur de type. Le `backend/tsconfig.json` du
scaffold inclut `scripts/`, de sorte que `tsc --noEmit` dans `backend/` la signale. Sans
enregistrement, nommez-le
à chaque appel avec `openRebase<Database>({ … })` ; `OpenedRebase<Database>` est le type à
donner à un helper qui en reçoit un. Sans l'un ni l'autre, les lignes ne sont pas typées, ce
qui explique pourquoi le premier exemple convertit `draft.id` avec `String()`.

### Vérifier ce qu'un utilisateur peut voir

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

`withAuth` est le moyen le plus rapide de tester une règle de sécurité sur des données réelles.
Le scaffold blog, celui que `rebase init` crée par défaut, donne à chaque collection les
`defaultSecurityRules` de `config/collections/index.ts` : chaque utilisateur connecté lit chaque
article, et seul un administrateur en écrit un. Ce script vérifie les deux moitiés, sous le nom
`backend/scripts/ada-check.ts` :

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads every post…
const { data: seen } = await ada.data.posts.find();
const { data: all } = await rebase.dataAsAdmin.posts.find();
console.log(seen.length === all.length);

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

await rebase.close();
```

Lancez-le comme le premier script, et il affiche `true` deux fois :

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Une règle qui filtre les lignes par propriétaire se vérifie de la même façon : comparez le champ
propriétaire de chaque ligne avec l'`uid` que vous avez passé. Sur le scaffold blog, aucune règle
ne le fait, et `authorId` sur un article est l'id d'une ligne d'auteur, pas d'un utilisateur.

Un utilisateur est `{ uid, roles?, isAnonymous?, claims? }` ; les `claims` sont ce que
`rebase.jwt()` lit dans une stratégie.

`withAuth` s'exécute sous le rôle restreint qu'un démarrage de serveur crée (`rebase_user`).
Sur une base de données où aucun serveur Rebase n'a démarré, ce rôle n'existe pas, et
les requêtes `withAuth` échouent avec l'erreur de rôle inconnu de Postgres plutôt que de s'exécuter
sans filtre. Lancez d'abord `rebase db push`, ou démarrez le serveur une fois.

### Dans un test

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, collections });
});
after(() => rebase.close());

test("a signed-in user reads every post and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    const { data: all } = await rebase.dataAsAdmin.posts.find();
    assert.equal(seen.length, all.length);
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Enregistrez-le sous `backend/scripts/posts.test.ts` et lancez-le depuis `backend/` avec le
lanceur de tests de Node, en faisant pointer `TEST_DATABASE_URL` vers une base de données sur
laquelle un serveur Rebase a démarré :

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

Cela fonctionne de la même façon sous Vitest ou Jest.

### Collections avec historique

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

Une écriture sur une collection avec [`history: true`](/docs/backend/history/) enregistre son entrée
comme le fait une écriture du serveur. L'entrée est écrite dans la transaction de la ligne elle-même,
si bien qu'une écriture annulée ne laisse aucune entrée. Elle est enregistrée sous l'identité avec
laquelle l'écriture s'est exécutée : `service` pour `dataAsAdmin`, l'`uid` de l'utilisateur avec
`withAuth`. Les écritures de `rebase console` sont enregistrées de la même façon.

`openRebase` ne crée rien où enregistrer. Si aucun backend avec historique n'a encore démarré sur la
base de données, la table `rebase.entity_history` est absente. Une écriture sur une collection avec
historique est alors refusée avec
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) avant que l'un de ses callbacks
ne s'exécute, et le message nomme ce qui manque. Les lectures fonctionnent comme d'habitude. Démarrez
le backend une fois avec l'historique activé (`rebase dev` le fait), et les écritures passent.

Les entrées sont enregistrées, jamais purgées. La rétention est un réglage du serveur qu'un script ne
peut pas voir ; le serveur les purge donc comme d'habitude : à sa prochaine écriture sur l'entité, et
lors de son balayage horaire.

### Ce qu'il laisse de côté

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

`openRebase` ouvre la couche de données et rien d'autre. Il ne démarre aucun temps réel, de sorte que
ses écritures ne sont pas annoncées aux requêtes en direct. Le stockage, l'e-mail, l'administration de
l'authentification et vos fonctions n'y figurent pas.

Lorsqu'un script a aussi besoin de ceux-là, construisez le backend sans le servir :
`createRebaseBackend({ …, provision: false })` vous donne `backend.rebase`, le
client complet en processus, sans rien monter ni rien démarrer. Voir
[le backend sans serveur](/docs/backend/custom-server/#the-backend-without-a-server).
Pour tester un callback de collection sans aucune base de données, appelez-le avec
[`createCallContext`](/docs/collections/callbacks/#testing-a-callback).

## Voir aussi

- [Intégration de serveur personnalisé](/docs/backend/custom-server/) — le backend sous forme de pièces publiques
- [Référence de la CLI](/docs/cli/) — toutes les commandes `rebase`
- [Règles de sécurité](/docs/collections/security-rules/) — ce par quoi `withAuth` est filtré
