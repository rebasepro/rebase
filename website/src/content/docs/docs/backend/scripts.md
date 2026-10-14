---
title: Scripts and the Console
sidebar_label: Scripts and the Console
description: Open a project's data from a script, a test or a REPL with openRebase, or from the terminal with rebase console. No server, no schema changes.
---

## Overview

On 0.24 there is
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

Run it in your project:

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

Input piped in runs one line at a time, each after the previous line's `await`
has settled, so the transcript above works as
`printf '…\n…\n' | rebase console`. Anything after `.exit` is ignored, and
values are coloured only on a terminal. Everything the console logs goes to
stderr.

### One snippet: `--eval`

`rebase console -e "<code>"` runs one piece of code instead of the REPL. An
expression's value, or a function body's `return`, is awaited and printed as
JSON on stdout, so the output can be piped:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Everything the console logs, whatever `LOG_LEVEL` says, goes to stderr, so
stdout holds the result and nothing else. A snippet that throws prints the error
on stderr and exits `1`.

A database the
console cannot open is reported once, and it exits `1`: the "Cannot connect to
PostgreSQL" banner the `db` commands print, or, on the managed development
database, that it has no free connection. That database accepts only a few
connections at a time and a running `rebase dev` holds some, so close another
client or stop `rebase dev` and run it again. On 0.24 the banner came twice,
under an empty `❌ [ERROR]` line, and a full managed database printed
`read ECONNRESET` with its stack as one line of JSON.

### Options

| Flag | What it does |
|---|---|
| `--eval`, `-e` | Run this code instead of the REPL, print its awaited result as JSON, and exit 1 if it throws |
| `--collections`, `-c` | Path to the collections directory, if not the project's own |
| `--database-url` | Open this database instead of the project's |
| `--docker` | Use the database from docker compose, starting it if needed |

## `openRebase`

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

Opening logs
nothing at `info`, so a script's stdout holds what the script prints, and
`tsx scripts/report.ts > report.json` writes only its JSON. Warnings and errors
go to stderr in development. The note on how requests are isolated (`RLS
enforcement active`) is logged at `debug`; a server's boot still prints it at
`info`. A database it cannot reach rejects the open with one error,
`Cannot connect to PostgreSQL at <host>:<port>: <reason>.`, and logs nothing:
what to print is the script's call. On 0.24 that note opened a script's stdout,
and an unreachable database logged a banner before the error.

Its accessors are typed by the `Database` that `rebase generate-sdk --register`
registers, as a function's `rebase` is, so a misspelled collection, field or
enum value in a script is a type error. The scaffold's `backend/tsconfig.json`
includes `scripts/`, so `tsc --noEmit` in `backend/` reports it. Without a registration, name it per call
with `openRebase<Database>({ … })`; `OpenedRebase<Database>` is the type to give
a helper that takes one. With neither, rows are untyped, which is why the first
example converts `draft.id` with `String()`.

### Checking what a user can see

`withAuth` is the quickest way to test a security rule against real data. The
blog scaffold, `rebase init`'s default, gives every collection the
`defaultSecurityRules` in `config/collections/index.ts`: every signed-in user
reads every post, and only an admin writes one. This checks both halves, as
`backend/scripts/ada-check.ts`:

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

Run it the way the first script runs, and it prints `true` twice:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

A rule that filters rows by owner is checked the same way: compare each row's
owner field with the `uid` you passed. On the blog scaffold no rule does, and
`authorId` on a post is the id of an author row, not of a user.

A user is `{ uid, roles?, isAnonymous?, claims? }`; `claims` are what
`rebase.jwt()` reads in a policy.

`withAuth` runs as the restricted role a server boot creates (`rebase_user`).
Against a database no Rebase server has booted on, that role does not exist, and
`withAuth` requests fail with Postgres' unknown-role error rather than run
unfiltered. Run `rebase db push`, or boot the server once, first.

### In a test

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

Save it as `backend/scripts/posts.test.ts` and run it from `backend/` with
Node's test runner, pointing `TEST_DATABASE_URL` at a database a Rebase server
has booted on:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

The same works under Vitest or Jest.

### Collections with history

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
