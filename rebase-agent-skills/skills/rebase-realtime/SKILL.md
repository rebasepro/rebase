---
name: rebase-realtime
description: Guide for the Rebase WebSocket realtime engine. Use this skill when the user needs real-time data synchronization, table change broadcasts, or live updates in their application.
---

# Rebase Realtime Engine

Rebase includes a built-in WebSocket-based realtime engine that broadcasts table changes to connected clients instantly.

## Overview

The realtime engine:
- Monitors database changes for all managed collections
- Broadcasts insert, update, and delete events via WebSocket
- Supports per-collection subscriptions
- Respects authentication and RLS policies

## Architecture

```
[Client] ←→ [WebSocket Server] ←→ [PostgreSQL LISTEN/NOTIFY]
```

The backend Hono server includes the WebSocket server on the same HTTP port. Changes are detected via PostgreSQL's LISTEN/NOTIFY mechanism and broadcast to subscribed clients.

## Server-Side Setup

The realtime engine is automatically initialized when you create the Rebase backend with a PostgreSQL bootstrapper that has `connectionString` set:

```typescript
import { initializeRebaseBackend, HonoEnv } from "@rebasepro/server-core";
import { createPostgresDatabaseConnection, createPostgresBootstrapper } from "@rebasepro/server-postgresql";

const { db, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

const backend = await initializeRebaseBackend({
    server,
    app,
    bootstrappers: [
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations },
            adminConnectionString: process.env.DATABASE_URL,
            // Pass connectionString to enable cross-instance realtime
            // via Postgres LISTEN/NOTIFY. Omit for single-instance mode.
            connectionString
        })
    ],
    // Realtime (WebSocket) is automatically enabled
});

// The WebSocket runs on the same HTTP server
server.listen(3001);
```

## Client-Side Subscription

### Rebase SDK (Recommended)

The `@rebasepro/client` SDK provides a high-level API with automatic reconnection, auth token management, and typed responses:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001"
});

// Subscribe to a collection — get called whenever data changes
const unsubscribe = client.data.listenCollection(
    "products",
    {
        filter: { active: ["==", true] },
        limit: 50
    },
    (entities) => {
        console.log("Products updated:", entities);
    }
);

// Subscribe to a single entity
const unsubscribe2 = client.data.listenEntity(
    "products",
    42,
    (entity) => {
        console.log("Product changed:", entity);
    }
);

// Unsubscribe when done
unsubscribe();
unsubscribe2();
```

### React Hooks

In a Rebase frontend, use the hooks from `@rebasepro/core`:

```typescript
import { useRebaseClient } from "@rebasepro/core";

function ProductList() {
    const client = useRebaseClient();
    // client.data.listenCollection(...) or client.data.fetchCollection(...)
}
```

### Raw WebSocket (Low-Level)

For environments where the SDK is not available:

```typescript
const ws = new WebSocket("ws://localhost:3001/ws");

ws.onopen = () => {
    // Subscribe to a collection
    ws.send(JSON.stringify({
        type: "subscribe",
        collection: "products",
        token: "<jwt-token>"  // Authentication required
    }));
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
        case "insert":
            console.log("New document:", message.data);
            break;
        case "update":
            console.log("Updated document:", message.data);
            break;
        case "delete":
            console.log("Deleted document ID:", message.id);
            break;
    }
};

// Unsubscribe
ws.send(JSON.stringify({
    type: "unsubscribe",
    collection: "products"
}));
```

### React Integration

In Rebase Studio, realtime is built into the data views. The spreadsheet, card, and kanban views automatically refresh when data changes.

## Message Types

### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `subscribe` | `{ collection, token }` | Subscribe to collection changes |
| `unsubscribe` | `{ collection }` | Unsubscribe from collection |
| `ping` | `{}` | Keep-alive heartbeat |

### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `insert` | `{ collection, data }` | New document created |
| `update` | `{ collection, id, data }` | Document updated |
| `delete` | `{ collection, id }` | Document deleted |
| `pong` | `{}` | Heartbeat response |
| `error` | `{ message }` | Error notification |

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
