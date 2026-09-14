# @rebasepro/server-mongo

MongoDB database driver for Rebase.

## Installation

```bash
pnpm add @rebasepro/server-mongo
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## What This Package Does

Implements the Rebase `BackendBootstrapper` and backend interfaces for MongoDB. Provides a complete data driver, change-stream-based realtime, entity history, auth repositories, and WebSocket support. Plug it into `@rebasepro/server` via `createMongoBootstrapper()`, or use the standalone `createMongoBackend()` factory for direct access.

## Key Exports

| Export | Description |
|--------|-------------|
| `createMongoBootstrapper(config)` | Creates a `BackendBootstrapper` for use with `initializeRebaseBackend({ bootstrappers: [...] })`. |
| `createMongoBackend(config)` | Standalone factory — returns a `MongoBackendInstance` with driver, data service, realtime, admin, and lifecycle methods. |
| `createMongoDelegate(db)` | Convenience factory for just the `MongoDriver` (DataDriver). |
| `createMongoRealtimeService(db)` | Creates a MongoDB change-stream-based realtime provider. |
| `createMongoEntityRepository(db)` | Creates a `DataRepository` for direct CRUD. |
| `createMongoDBConnection(url, dbName)` | Connects to MongoDB and returns a `MongoDBConnection` wrapper. |
| `MongoDBConnection` | `DatabaseConnection` implementation wrapping `MongoClient` + `Db`. |
| `MongoDriver` | The `DataDriver` implementation for MongoDB. |
| `MongoDataService` | Low-level entity CRUD service (the `DataRepository` implementation). |
| `MongoRealtimeService` | Change-stream-based `RealtimeProvider`. |
| `MongoCollectionRegistry` | In-memory collection registry. |
| `isMongoBackendConfig(config)` | Type guard for `MongoBackendConfig`. |

## Quick Start

### With server (recommended)

```typescript
import { MongoClient } from "mongodb";
import { createMongoBootstrapper } from "@rebasepro/server-mongo";
import { initializeRebaseBackend } from "@rebasepro/server";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();
const db = client.db("my_database");

const backend = await initializeRebaseBackend({
  app,
  server,
  bootstrappers: [
    createMongoBootstrapper({ connection: db, client }),
  ],
  collections,
  auth: { /* ... */ },
});
```

### Standalone (without server)

```typescript
import { MongoClient } from "mongodb";
import { createMongoBackend } from "@rebasepro/server-mongo";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

const backend = createMongoBackend({
  type: "mongodb",
  connection: client.db("my_database"),
  client,
  collections: myCollections,
});

// Use directly
const health = await backend.healthCheck?.();
const users = await backend.dataService.fetchCollection("users", {});

// Cleanup
await backend.destroy?.();
```

## Related Packages

| Package | Role |
|---------|------|
| `@rebasepro/server` | Backend orchestrator (peer dependency, optional) |
| `@rebasepro/types` | Shared interfaces (`BackendBootstrapper`, `DataDriver`, `RealtimeProvider`) |
| `@rebasepro/common` | Default collections and shared utilities |
