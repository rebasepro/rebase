---
title: Client SDK — Getting Started
sidebar_label: Getting Started
description: Install and configure the Rebase Client SDK to interact with your backend from any JavaScript or TypeScript application.
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

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
});
```

The `websocketUrl` is derived automatically from `baseUrl` (`http → ws`, `https → wss`). You can override it explicitly if needed:

```typescript
const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001",
});
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | Backend URL (e.g. `http://localhost:3001`) |
| `websocketUrl` | `string` | WebSocket URL — auto-derived from `baseUrl` if omitted |
| `token` | `string` | Static JWT token for server-to-server calls |
| `apiPath` | `string` | API prefix (default: `"/api"`) |
| `fetch` | `typeof fetch` | Custom fetch implementation (e.g. for SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Custom 401 handler — return `true` to retry |
| `realtime` | `boolean` | Open the WebSocket (default `true`) — set `false` in one-shot scripts |
| `collections` | `Record<string, string>` | Maps accessor names to collection slugs |
| `offline` | `boolean \| OfflineConfig` | [Local-first sync](/docs/sdk/offline) — off by default |

## Typed SDK Generation

Generate a fully typed client from your collection definitions:

```bash
rebase generate-sdk
```

Then pass the `Database` type parameter to `createRebaseClient` for full autocomplete:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
});

// Full autocomplete on collection names and field types
const { data } = await client.data.products.find();
```

When `Database` is supplied, `createRebaseClient` returns a `CreateRebaseClientResult<DB>` instance. This maps camelCase collection accessors directly on `client.data` to their corresponding types, giving you full autocomplete on collection operations and types (e.g. `client.data.products.find()`).

`collectionsDictionary` maps each accessor back to the slug the wire uses. Pass it whenever a slug is not already a valid property name — `my-notes` is reachable as `client.data.myNotes` only because the dictionary says so.

### Field names

**A field's name on the wire is its property key**, and the API is camelCase throughout. A `createdAt` property stored in a `created_at` column is `row.createdAt`, and a relation's foreign key is `authorId` even though the column stays `author_id`. `where` and `orderBy` are keyed off the same `Row` type, so what compiles is what the backend answers to.

A property key *you* wrote is your key, whatever its shape — nothing renames a name you chose. The two keys that are derived rather than declared, a relation's foreign key and a column read back by introspection, are camelCase.

`Row` describes a read, `Insert` a `create()` and `Update` an `update()` — they are not the same shape. Nullable columns are `T | null` on `Row`, the primary key is always present on a read and never settable on an update, and a `belongsTo` target can be written either as the relation (`{ author: 5 }`) or as its foreign key (`{ authorId: 5 }`).

## Quick Example

<!-- docs-verify: W4-03 owns this — `listen` is optional on `SDKCollectionClient`. -->
```typescript no-verify
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
