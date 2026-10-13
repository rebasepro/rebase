---
title: Scripts and the Console
sidebar_label: Scripts and the Console
description: Open a project's data from a script, a test or a REPL with openRebase, or from the terminal with rebase console. No server, no schema changes.
---

## Overview

<span class="since-badge" data-since="0.25">Since 0.25</span> On 0.24 there is
no `openRebase` and no `rebase console`: a script has to build a backend, or
call the REST API of a running server.

To look at some rows, fix one, try a filter or check what a policy lets a user
see, you should not have to start a server. Rebase gives you the project's data
as an object, in two places:

- **`rebase console`**, a Node REPL in your terminal with the project open;
- **`openRebase`**, the same object in a script or a test of your own.

Both open the database without changing it: no table, role, trigger or
function is created. A script's `close()` ends what `openRebase` opened. On the
managed development database, `rebase console` starts that database when it is
not running and leaves it running afterwards, as the `rebase db` commands do;
`rebase db stop` stops it. The object has the
vocabulary a [custom function](/docs/backend/custom-functions/) gets from the
server, `dataAsAdmin` and `sql`, so a snippet moves between a function, a script
and the console unchanged.

## `rebase console`

<span class="since-badge" data-since="0.25">Since 0.25</span>

Run it in your project:

```bash
rebase console
```

```text
> const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 })
> data.map(p => p.title)
[ 'Hello', 'Second post', 'Draft' ]
> const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] })
> (await ada.data.posts.find()).data.length
1
```

Two names are in scope, and top-level `await` works:

| Name | What it is |
|---|---|
| `rebase` | What [`openRebase`](#openrebase) returns: `dataAsAdmin`, `sql`, `withAuth(user)` and `close()` |
| `collections` | The project's collections, loaded the way `rebase db push` loads them |

The console opens the project the way `rebase db push` does: the same `.env`,
the same database, and the same collections. A project on the managed
development database gets it started first. The history of what you typed is
kept in `.rebase/console_history`, which the scaffold's `.gitignore` already
leaves out.

### One snippet: `--eval`

<span class="since-badge" data-since="0.25">Since 0.25</span>

`rebase console -e "<code>"` runs one piece of code instead of the REPL. An
expression's value, or a function body's `return`, is awaited and printed as
JSON on stdout, so the output can be piped:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

What the database resolution has to say goes to stderr, so stdout holds the
result and nothing else. A snippet that throws prints the error on stderr and
exits `1`.

### Options

| Flag | What it does |
|---|---|
| `--eval`, `-e` | Run this code instead of the REPL, print its awaited result as JSON, and exit 1 if it throws |
| `--collections`, `-c` | Path to the collections directory, if not the project's own |
| `--database-url` | Open this database instead of the project's |
| `--docker` | Use the database from docker compose, starting it if needed |

## `openRebase`

<span class="since-badge" data-since="0.25">Since 0.25</span>

`openRebase` from `@rebasepro/server-postgres` is what the console calls. Use
it in a script, a seed, a data fix or a test. In a scaffolded project, put the
script under `backend/`, say `backend/scripts/publish-drafts.ts`: the backend
workspace is the one that depends on `@rebasepro/server-postgres`, and a script
in the root `scripts/` folder cannot import it.

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

Run it from `backend/`. `rebase db url` prints the URL of the database the
project uses, the managed development one included:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Member | What it does |
|---|---|
| `dataAsAdmin` | Every collection, read and written as the server's service identity (`{ uid: "service", roles: ["admin"] }`): admin, and still evaluated by your RLS policies, exactly like `rebase.dataAsAdmin` in a function |
| `sql(query, { params })` | Raw SQL on the owner connection, with the same calling convention as `rebase.sql` in a function |
| `withAuth(user)` | Resolves to `{ data }`: the collections as that user sees them. Every read and write runs as them, filtered by row-level security, as an HTTP request from that user would be |
| `collections` | The collections it was opened with |
| `close()` | Ends the connection pool `openRebase` created. Safe to call twice |

Its options:

| Option | What it does |
|---|---|
| `databaseUrl` | The database to open. `openRebase` creates the pool and `close()` ends it |
| `connection` | A Drizzle connection you already hold (`createPostgresDatabaseConnection(url).db`), instead of `databaseUrl`. It stays yours: `close()` leaves it open |
| `collections` | The project's collections. An empty array reads them from the database instead, as a server with no collection files does, and serves them read-only |
| `pool` | Pool settings, with `databaseUrl` |
| `dataSourceKey` | The data source these collections are served from. Default `(default)` |

`openRebase` reads no environment variable. The `DATABASE_URL` above is read by
your script, and settings such as `REBASE_DB_POOL_MAX` or `REALTIME_CDC` change
nothing here.

### Checking what a user can see

<span class="since-badge" data-since="0.25">Since 0.25</span>

`withAuth` is the quickest way to test a security rule against real data:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
const { data } = await ada.data.posts.find();
console.log(data.every(post => post.author_id === "ada"));
```

A user is `{ uid, roles?, isAnonymous?, claims? }`; `claims` are what
`rebase.jwt()` reads in a policy.

`withAuth` runs as the restricted role a server boot creates (`rebase_user`).
Against a database no Rebase server has booted on, that role does not exist, and
`withAuth` requests fail with Postgres' unknown-role error rather than run
unfiltered. Run `rebase db push`, or boot the server once, first.

### In a test

<span class="since-badge" data-since="0.25">Since 0.25</span>

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

test("a user only sees their own posts", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data } = await ada.data.posts.find();
    assert.ok(data.every(post => post.author_id === "ada"));
});
```

Run it from `backend/` with Node's test runner, pointing `TEST_DATABASE_URL` at
a database a Rebase server has booted on:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

The same works under Vitest or Jest.

### Collections with history

<span class="since-badge" data-since="0.25">Since 0.25</span>

A write to a collection with [`history: true`](/docs/backend/history/) records
its entry the way a server write does. The entry is written in the row's own
transaction, so a write that rolls back leaves no entry. It is recorded as the
identity the write ran as: `service` for `dataAsAdmin`, the user's `uid` under
`withAuth`. Writes from `rebase console` are recorded the same way.

`openRebase` creates nothing to record into. If no backend with history has
booted on the database, the `rebase.entity_history` table is missing. A write to
a collection with history is then refused with
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) before
any of its callbacks run, and the message names what is missing. Reads work as
usual. Boot the backend once with history on (`rebase dev` does), and the writes
go through.

Entries are recorded, never pruned. Retention is a server setting a script
cannot see, so the server prunes them as usual: when it next writes the entity,
and in its hourly sweep.

### What it leaves out

<span class="since-badge" data-since="0.25">Since 0.25</span>

`openRebase` opens the data layer and nothing else. It starts no realtime, so
its writes are not announced to live queries. Storage, email, auth
administration and your functions are not on it.

When a script needs those too, build the backend without serving it:
`createRebaseBackend({ …, provision: false })` gives you `backend.rebase`, the
full in-process client, with nothing mounted and nothing started. See
[the backend without a server](/docs/backend/custom-server/#the-backend-without-a-server).
To test one collection callback without a database at all, call it with
[`createCallContext`](/docs/collections/callbacks/#testing-a-callback).

## Related

- [Custom Server Integration](/docs/backend/custom-server/) — the backend as public pieces
- [CLI reference](/docs/cli/) — every `rebase` command
- [Security Rules](/docs/collections/security-rules/) — what `withAuth` is filtered by
