---
title: Typed SDK — Getting Started
sidebar_label: Getting Started
description: Install and configure the Rebase typed SDK to interact with your backend from any JavaScript or TypeScript application.
---

## Overview

The `@rebasepro/client` package provides a type-safe JavaScript SDK for interacting with your Rebase backend. It handles:

- **Data operations** — CRUD with filtering, sorting, and pagination
- **Relation fetching** — Include related entities with `.include()`
- **Real-time subscriptions** — WebSocket-based live updates
- **Offline & local-first sync** — Opt-in local row database, instant offline writes, live queries
- **Authentication** — Token management, login, signup, OAuth
- **Storage** — File upload, download, and management
- **Custom functions** — Call custom server endpoints

## Installation

```bash
pnpm add @rebasepro/client
```

## Creating a Client

`rebase dev` derives a free port from the project's path rather than using a
fixed one, so **read `baseUrl` from the URL it printed** — there is no port
every project shares. In a Vite frontend that is the `VITE_API_URL` the scaffold
writes into `.env`; in a script, an environment variable of your own.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

The `websocketUrl` is derived automatically from `baseUrl` (`http → ws`, `https → wss`). You can override it explicitly if needed:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | Backend URL. Read it from what `rebase dev` printed, or from your deployment |
| `websocketUrl` | `string` | WebSocket URL — auto-derived from `baseUrl` if omitted |
| `token` | `string` | Static JWT token for server-to-server calls |
| `apiPath` | `string` | API prefix (default: `"/api"`) |
| `fetch` | `typeof fetch` | Custom fetch implementation (e.g. for SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Custom 401 handler — return `true` to retry |
| `realtime` | `boolean \| RealtimeClientOptions` | Open the WebSocket (default `true`) — set `false` in one-shot scripts. `{ affinity }` [names the group the socket belongs to](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `tables` | `Record<string, string>` | <span class="since-badge" data-since="0.31">Since 0.31</span> Maps accessor names to table slugs — the generated `tablesDictionary` |
| `offline` | `boolean \| OfflineConfig` | [Local-first sync](/docs/sdk/offline) — off by default |
| `impersonate` | `string` | Run every request as this user, by uid, to check what one user can see. Only an administrator's session may: the data API, functions and realtime run as that user, and every other route refuses |
| `debug` | `boolean` | Log the realtime connection's progress with `console.debug` (default `false`) — see [Connection logging](#connection-logging) |

### Connection logging

The client prints nothing about its realtime connection by default, so a public page says nothing about its backend in a visitor's console. Warnings and errors are always printed. To see the connection open, sign in, drop and redial, pass `debug: true`, or turn it on in one browser without changing the site by running this in its console:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

It applies from the next line the client logs, so a page that is already connected does not need a reload. Outside a browser, set `globalThis.__REBASE_DEBUG__ = true`. Browsers show `console.debug` only at the Verbose level.

## Typed SDK Generation

<span class="since-badge" data-since="0.31">Since 0.31</span>

Generate a fully typed client from your tables:

```bash
rebase generate-sdk
```

While `rebase dev` is running you do not need to: it regenerates the types in
`generated/sdk/` on start and on every save under `backend/schema/`. Run the
command yourself in CI, in a frontend repository that has no tables of its own
(`rebase generate-sdk --from link`), or anywhere `rebase dev` is not running.
`generate-sdk` reads the tables `backend/schema/index.ts` exports, through the
same loader the backend boots from; `--from` reads the `tables` of a running
backend's `/api/meta/contract` instead.

Then pass the `Database` type parameter to `createRebaseClient` for full autocomplete:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full autocomplete on table names and field types
const { data } = await client.data.products.find();
```

When `Database` is supplied, `createRebaseClient` returns a `CreateRebaseClientResult<DB>` instance. This maps camelCase table accessors directly on `client.data` to their corresponding types, giving you full autocomplete on table operations and types (e.g. `client.data.products.find()`).

`tablesDictionary` maps each accessor back to the slug the wire uses. The generated module also exports `TableName`, the union of every slug, and the `TablesDictionary` type. **`tables` is required for a typed client.** The types offer every accessor whether you pass it or not, but without it `client.data.myNotes` is sent to `/data/my_notes`, the accessor in snake_case, so a slug like `my-notes` or a renamed accessor answers 404. The client warns once, naming the accessor and the fix. With the dictionary, an accessor that is not in it throws a `RebaseClientError` with code `UNKNOWN_TABLE` and a suggestion. A later version will make `tables` required in the types when `Database` is supplied.

A few names on `client.data` are taken: `table` is the dynamic `table(slug)` function, `batch` is [`client.batch`](/docs/sdk/writing/#writing-across-tables), and `then`, `toJSON` and `$$typeof` are left alone for promise and serialisation checks. A table whose accessor would be `table`, `then`, `toJSON` or `$$typeof` is generated as `<name>Table` — the `table` slug is `client.data.tableTable` — and `generate-sdk` prints a warning naming both. `client.data.table("table")` reaches it too, and is how a table whose accessor would be `batch` is reached. `data.table(slug)` refuses a slug with a `.` or `..` segment, which would leave `/data`, with `INVALID_TABLE_PATH`.

### Field names

**A field's name on the wire is its column key**, and the API is camelCase throughout. A `createdAt` column stored as `created_at` is `row.createdAt`, and a relation's foreign key is `authorId` even though the column stays `author_id`. `where` and `orderBy` are keyed off the same `Row` type, so what compiles is what the backend answers to.

A column key *you* wrote is your key, whatever its shape — nothing renames a name you chose. The two keys that are derived rather than declared, a relation's foreign key and a column read back by introspection, are camelCase.

`Row` describes a read, `Insert` a `create()` and `Update` an `update()` — they are not the same shape. A column that is not required is `T | null` on all three, so a write can clear it; the primary key is always present on a read and never settable on an update; a `belongsTo` target can be written either as the relation (`{ author: 5 }`) or as its foreign key (`{ authorId: 5 }`), and a required one is satisfied by either; a `hasOne` is written by naming the target row (`{ profile: 9 }`), or `null` to unlink it; a single-hop `via` is written as the kind it stands in for (to-one: the target's id or `null`; to-many: a list of ids), and a multi-hop one is read-only and on neither; and a `hasMany` or `manyToMany` membership is written as a list of target ids or `{ id }` objects (`{ tags: ["t-1"] }`), each carrying a `_pivot` when the junction declares payload columns. A field nobody may write (`.access({ write: [] })`) is on neither `Insert` nor `Update`. A `date` column reads as an ISO string, and a write takes either that string or a `Date`.

## Quick Example

```typescript
// Create
const product = await client.data.products.create({
    name: "Camera",
    price: 299,
});

// Query with filters
const { data } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();

// Real-time subscription
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] } },
    (response) => console.log("Updated:", response.data)
);
```

## Using with React

In a Rebase frontend, the client is created once and shared via context:

```tsx no-verify
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL });

<Rebase client={client} ...>
```

Access it from any component:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // client.data, client.auth, client.storage, client.functions
}
```

## Next Steps

- **[Querying Data](/docs/sdk/querying)** — CRUD, filters, pagination, and relations
- **[Authentication](/docs/sdk/authentication)** — Sign in, sign up, OAuth, sessions
- **[Realtime Subscriptions](/docs/sdk/realtime)** — Live data with WebSockets
- **[Offline & Local-First Sync](/docs/sdk/offline)** — Work without a connection, and sync when it returns
- **[Storage & Files](/docs/sdk/storage)** — Upload, download, and manage files
