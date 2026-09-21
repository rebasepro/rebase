---
title: Rebase doesn't do X
sidebar_label: Extending the server
description: The server-side extension ladder — declaration, collection callback, custom function, your own routes, your own server, eject — with what each one can and cannot reach.
---

## Overview

Something you need is not in the collection config. This page is the order to
try things in, and — more useful — what each rung *cannot* reach, so you stop
climbing at the first one that can do the job.

There is a matching page for the admin panel:
[Extending Rebase](/docs/frontend/extending) covers plugins, slots, component
overrides and custom views. This one is the server.

The rule the ladder encodes: **each rung costs you something the one below it
kept.** A declaration is portable, upgradeable and understood by the schema
planner, the generated SDK and the admin panel. By the time you reach
`rebase eject` you own the boot sequence, and platform runtime upgrades no
longer reach your project. So climb only as far as you have to.

## The ladder

| # | Rung | Reaches | Does **not** reach | Cost of being here |
|---|---|---|---|---|
| 1 | **Declaration** — a property, a relation, an index, a `search` block, a security rule | The schema, the generated SDK, the admin panel, the migration planner | Anything that has to run code | None. This is the supported path |
| 2 | **Collection callback** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Every read and write of one collection, on every transport, inside the request's own transaction | Requests that touch no collection; the response envelope; anything asynchronous to the write | Runs on the hot path, holding the transaction open |
| 3 | **Custom function** — a Hono app in `functions/` | Its own URL, with auth resolved, the driver scoped to the caller and `rebase` in hand | The built-in `/api/data` routes. It sits *beside* them, not in front | One more surface to authorize; no SDK method is generated for it |
| 4 | **Your own routes and middleware** on the Hono app | Anything HTTP, including paths that run *before* Rebase's routers | The driver and the caller's identity, unless you guard the route yourself | Outside every Rebase router: no auth middleware has run |
| 5 | **Your own server** — embed the driver in Express, Fastify or plain `http` | The data adapter and realtime, in a process you wrote | Everything `initializeRebaseBackend` wires up: auth routes, storage, jobs, cron, admin API, the MCP server | You assemble the backend. Rebase is a library here, not a coordinator |
| 6 | **`rebase eject`** | The entrypoint and the `Dockerfile`, in your repository | — | **Platform runtime upgrades stop reaching this project.** CORS, auth wiring, storage and shutdown become yours |

:::tip[Two rungs are commonly skipped for no reason]
`beforeQuery` (rung 2) narrows a read *before it is compiled*, which is the
thing people usually reach rung 3 or 5 for. And a `search` block with
`mode: "hybrid"` (rung 1) is what people usually reach for raw SQL for. Both are
new enough that older answers on the internet do not mention them.
:::

## 1. Declaration

Most of what a backend needs is a declaration on the collection, because a
declaration is the only rung the rest of the system can read. The schema planner
turns it into DDL, the code generator turns it into SDK methods, the admin panel
renders it, and `rebase doctor` compares it to the live database.

| I want to… | Declare | Reference |
|---|---|---|
| Add a column | a property | [Properties](/docs/collections/properties) |
| Link two collections | a `relation` property | [Relations](/docs/collections/relations) |
| Make a query fast | `indexes` | [Indexes](/docs/backend/indexes) |
| Decide who may read or write a row | `securityRules` | [Authentication](/docs/backend/authentication) |
| Search text properly — accents, JSONB, ranking, substrings | a `search` block | [Search](/docs/backend/search) |
| Find rows by meaning | a `vector` property | [Search](/docs/backend/search) |
| Keep deleted rows | `softDelete` | [Writes](/docs/backend/writes) |
| Record who changed what | `history` | [History](/docs/backend/history) |
| Run something on a schedule | a cron job file | [Cron Jobs](/docs/backend/cron-jobs) |
| Run something after a write, out of band | a job | [Jobs](/docs/backend/jobs) |

**What it cannot reach:** anything that has to make a decision at request time.
A declaration is data. If the answer depends on who is asking, go to rung 2.

## 2. Collection callbacks

**Scope:** one collection, or every collection when registered globally on
`initializeRebaseBackend({ callbacks })`.

Callbacks fire on **every** data path — REST, the SDK, WebSocket subscriptions
and server-side writes through `rebase.dataAsAdmin` — and each runs inside the
transaction opened for that request. That is the whole value: there is no way to
reach a collection's rows that goes around them.

| Callback | Fires | Use it for |
|---|---|---|
| `beforeQuery` | before a read is compiled | narrowing **which rows** a read asks for |
| `afterRead` | per row, after it is fetched | redaction, PII masking, computed fields |
| `beforeSave` | after validation, before the write | defaults, derived columns, refusing a write |
| `afterSave` | after the write, before the commit | side effects that must be undone with it |
| `afterSaveError` | when a save throws | reporting; `props.error` is what it threw |
| `beforeDelete` | before the delete | refusing it |
| `afterDelete` | after the delete, before the commit | cascading cleanup |

→ [Per-collection callbacks](/docs/collections/callbacks) ·
[Global hooks](/docs/backend/hooks)

### Narrowing a read with `beforeQuery`

`afterRead` sees rows that have already been fetched, so it can redact a value
but cannot stop the row being read. `beforeQuery` runs earlier: it is handed the
parsed query and returns conditions to **AND** into it.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Three properties are worth knowing before you rely on it:

- **It can only narrow.** The return value is a filter to AND in, and there is
  no shape it can return that widens the read. That is deliberate: a hook handed
  the query and asked to return one could drop a condition, and on a
  row-level-security data plane a dropped condition returns every row the
  policies happen to allow.
- **It fires on every read path.** The listing, the single get, the count, the
  aggregate, the search, the vector read, a nested-path listing, the realtime
  refetch that builds subscription frames, and the rows loaded for a relation or
  an `?include=` — where it is the **target** collection's hook that applies.
  A hook honoured by the listing and not by the count is a page that says
  "1 of 4 results".
- **A filter it cannot compile refuses the request.** Naming a column the table
  does not have is a 400, not a dropped condition, whatever
  `configureUnknownFilterFields` is set to.

One read is deliberately *not* narrowed: the uniqueness check behind
`validation: { unique: true }`. It asks whether a value exists anywhere in the
table, and narrowed it would answer "unique" for a value a hidden row already
holds — leaving the insert to fail on the constraint instead.

`beforeQuery` is implemented by `@rebasepro/server-postgres`. A collection served
by another engine that declares one **fails at boot**, by name, rather than being
served with the hook silently inert. So does a global one beside a data source
that is not Postgres. Redaction that works on every engine is `afterRead`.

**What callbacks cannot reach:**

- A request that touches no collection. There is nothing for the callback to
  hang off.
- The response envelope — status code, headers, pagination shape. A callback
  returns values, not a response.
- Work that must outlive the transaction. `afterSave` runs *before* the commit,
  so a throw there rolls the write back. Anything that must survive the write
  being undone is not part of the write: put it on the
  [job queue](/docs/backend/jobs).
- Slow work, in practice. A callback holds the transaction open and a pooled
  connection with it. Anything that talks to a third party belongs on the queue.

## 3. Custom functions

**Scope:** one URL under `/api/functions`.

A Hono app in `backend/functions/`, discovered by filename the way collections
and cron jobs are. Auth middleware has already run when your handler is reached,
the driver is scoped to the caller, and `rebase` is in hand for storage, email,
jobs and `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.collection("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Custom Functions](/docs/backend/custom-functions)

**What it cannot reach:** the built-in `/api/data` routes. A function sits
*beside* them, not in front of them, so it cannot change how a listing is
filtered, paged or shaped — that is rung 2. It also gets no generated SDK
method; callers reach it with `client.functions.invoke(...)` or plain `fetch`.

## 4. Your own routes and middleware

**Scope:** the Hono app, before Rebase touches it.

`initializeRebaseBackend` takes the app you pass it, so anything you register on
that app *before* calling it runs before every Rebase router — see
[Route Registration Order](/docs/backend/custom-functions#route-registration-order)
for the shape.

:::caution[No auth middleware has run there]
A route registered this way is **outside** every Rebase router, so
`getDriver(c)` is unset and nothing has verified a token. Guard it with
`requireAuth` / `requireAdmin` imported from **`@rebasepro/server`** — the
package root — which verify the token themselves. The guards exported from
`@rebasepro/server/functions` read an identity a Rebase router has already
resolved, and answer 500 rather than pretend one exists.
:::

One Hono trap worth stating, because it is silent: `app.use("/*", guard)` covers
only the routes declared *below* it. A route appended later — at the bottom of
the file, months from now — is unprotected. Put guards in the route's own
middleware slot.

**What it cannot reach:** the identity, the scoped driver, and the error envelope
— unless you wire each up yourself. Everything a Rebase router gives a handler is
a thing a Rebase router did.

## 5. Your own server

**Scope:** the process.

`@rebasepro/server-postgres` is framework-agnostic: it depends on Drizzle and
Node's `http.Server` and nothing else. So you can embed the data adapter and
realtime into Express, Fastify or plain Node and skip the coordinator entirely.

→ [Custom Server Integration](/docs/backend/custom-server)

**What it cannot reach:** everything `initializeRebaseBackend` wires up, which
is most of the backend — the auth routes and token refresh, storage, the job
queue, cron, the admin API the Studio talks to, the MCP server, the error
envelope, the middleware stack. Each of those is available to assemble by hand;
none of them assembles itself. Rebase is a library at this rung, not a
coordinator.

Reach for it when you have an existing server that must stay the entrypoint. If
what you actually want is one custom route, that is rung 3 or 4, at a fraction
of the surface.

## 6. `rebase eject`

**Scope:** the repository.

Writes the backend entrypoint and a `Dockerfile` into the project and flips its
backend over, so the repository builds its own image instead of running the
published runtime.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**What it costs:** **platform runtime upgrades no longer reach the project.**
CORS, auth wiring, storage and shutdown become yours to configure and yours to
keep working. This is the only rung on the ladder that is hard to walk back.

Preview it first. `--force` replaces an existing `backend/src/index.ts` or
`env.ts`, keeping the current file as `<name>.bak`.

## When none of these is the answer

Two cases are worth naming, because the ladder does not fit them.

**Raw SQL.** You do not need to leave the framework to write a query the query
builder cannot express. Narrow `driver.admin` with `isSQLAdmin` and use
`executeSql`, from a custom function or a callback:

```typescript
import { isSQLAdmin, type DataDriver } from "@rebasepro/types";

async function topSellers(driver: DataDriver, since: string) {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) throw new Error("Native SQL is not available on this driver.");
    return admin.executeSql(
        "select product_id, sum(qty) from order_lines where created_at > $1 group by 1",
        { params: [since] }
    );
}
```

`driver` is what a custom function's context hands you (`c.get("driver")`), or
`context.driver` inside a callback. Narrow it with `isSQLAdmin` rather than
casting: the guard is the difference between a driver that cannot run SQL saying
so and one throwing `admin.executeSql is not a function` at the call site.

**Something the framework should do and does not.** If you find yourself
patching `@rebasepro/server-postgres`, or ejecting for one behaviour, that is
worth an issue rather than a fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
`beforeQuery` and `search.mode: "hybrid"` both exist because a patched driver
was the only alternative.

## Related

- [Extending Rebase (frontend)](/docs/frontend/extending) — the same ladder for the admin panel
- [Per-collection callbacks](/docs/collections/callbacks)
- [Global hooks](/docs/backend/hooks)
- [Custom Functions](/docs/backend/custom-functions)
- [Custom Server Integration](/docs/backend/custom-server)
- [Search](/docs/backend/search)
- [Endpoint index](/docs/backend/endpoints) — every route the server mounts
