---
title: Client SDK — Getting Started
sidebar_label: Getting Started
description: Install and configure the Rebase Client SDK to interact with your backend from any JavaScript or TypeScript application.
---

## Overview

The `@rebasepro/client` package provides a type-safe JavaScript SDK for interacting with your Rebase backend. It handles:

- **Data operations** — CRUD with filtering, sorting, and pagination
- **Relation fetching** — Include related entitys with `.include()`
- **Real-time subscriptions** — WebSocket-based live updates
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

## Typed SDK Generation

Generate a fully typed client from your collection definitions:

```bash
rebase generate-sdk
```

Then pass the `Database` type parameter to `createRebaseClient` for full autocomplete:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import type { Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
});

// Full autocomplete on collection names and field types
const { data } = await client.data.products.find();
```

When `Database` is supplied, `createRebaseClient` returns a `CreateRebaseClientResult<DB>` instance. This maps camelCase collection accessors directly on `client.data` to their corresponding types, giving you full autocomplete on collection operations and types (e.g. `client.data.products.find()`).

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
    .orderBy("created_at", "desc")
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

```tsx
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL });

<Rebase client={client} ...>
```

Access it from any component:

```tsx
import { useRebaseClient } from "@rebasepro/core";

function MyComponent() {
    const client = useRebaseClient();
    // client.data, client.auth, client.storage, client.functions
}
```

## Next Steps

- **[Querying Data](/docs/sdk/querying)** — CRUD, filters, pagination, and relations
- **[Authentication](/docs/sdk/authentication)** — Sign in, sign up, OAuth, sessions
- **[Realtime Subscriptions](/docs/sdk/realtime)** — Live data with WebSockets
- **[Storage & Files](/docs/sdk/storage)** — Upload, download, and manage files
