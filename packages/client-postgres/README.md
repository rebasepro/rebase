# @rebasepro/client-postgres

PostgreSQL data source client for Rebase — connects the Rebase admin panel to a PostgreSQL backend via WebSocket.

## Installation

```bash
pnpm add @rebasepro/client-postgres
```

**Peer dependencies:** `react >= 19.0.0`, `react-dom >= 19.0.0`

## What This Package Does

This package provides a `DataDriver` implementation that bridges Rebase's data layer to a PostgreSQL backend through `@rebasepro/client`'s WebSocket client. It supports full CRUD, realtime collection and single-row listeners, unique field validation, row counting, and admin operations (SQL execution, branch management, table introspection).

Every method returns **flat rows** (`Record<string, unknown>`), the same shape the REST pipeline serves — not snapshots.

Note that this is *not* a direct PostgreSQL connection: the data path is the Rebase backend, over the WebSocket protocol, and RLS applies exactly as it does on the REST path. Most apps do not need this package at all — a Postgres source is server-mediated and rides `client.data`, and a frontend `DataDriver` is what `direct`/`custom` sources need.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `usePostgresClientDriver` | Hook | Creates a `PostgresDataDriver` from a `RebaseWebSocketClient` |
| `PostgresDataDriverConfig` | Type | Config object: `{ wsClient?: RebaseWebSocketClient, getAuthToken?: () => Promise<string \| null> }` |
| `PostgresDataDriver` | Type | Extends `DataDriver` with a `client` reference, a display `name`, and `admin` methods |

### `PostgresDataDriver` Methods

| Method | Description |
|---|---|
| `fetchCollection(props)` | Fetch rows with filtering (`filter` + `logical`), sorting, pagination (`limit`/`offset`), search and vector search |
| `fetchOne(props)` | Fetch a single row by path and id |
| `save(props)` | Create or update a row (`upsert` supported) |
| `delete(props)` | Delete a row |
| `checkUniqueField(path, name, value, id?, collection?)` | Check if a field value is unique |
| `count(props)` | Count rows matching the same query `fetchCollection` was given |
| `listenCollection(props)` | Subscribe to realtime collection updates. Returns an unsubscribe function |
| `listenOne(props)` | Subscribe to realtime updates for one row. Returns an unsubscribe function |
| `isFilterCombinationValid()` | Always returns `true` — PostgreSQL supports complex filter combinations |

### Admin Methods (`driver.admin`)

| Method | Description |
|---|---|
| `executeSql(sql, options?)` | Execute raw SQL. Options: `{ database?, role? }` |
| `fetchAvailableDatabases()` | List available databases |
| `fetchAvailableRoles()` | List available roles |
| `fetchApplicationRoles()` | List the roles the application defines |
| `fetchCurrentDatabase()` | Get the current database name |
| `fetchUnmappedTables(mappedPaths?)` | Find tables not yet mapped to collections |
| `fetchTableMetadata(tableName)` | Get column/constraint metadata for a table |
| `createBranch(name, options?)` | Create a database branch. Options: `{ source? }` |
| `deleteBranch(name)` | Delete a database branch |
| `listBranches()` | List all branches |

Admin methods are server-side admin-gated; `driver.admin` is a `DatabaseAdmin`, so narrow it with the guards from `@rebasepro/types` (`isSQLAdmin`, `isSchemaAdmin`, `isBranchAdmin`) before calling.

## Quick Start

Reuse the socket `createRebaseClient()` already builds — it carries the signed-in
session's token, so reads run as the user rather than as `anon`:

```tsx
import { createRebaseClient } from "@rebasepro/client";
import { usePostgresClientDriver } from "@rebasepro/client-postgres";
import { Rebase } from "@rebasepro/app";
import { RebaseAdmin, RebaseShell } from "@rebasepro/admin";

const rebaseClient = createRebaseClient({ baseUrl: "http://localhost:3000" });

function App() {
    const driver = usePostgresClientDriver({ wsClient: rebaseClient.ws });

    // The driver is registered as a data source — there is no `driver` prop.
    // A `"(default)"` entry replaces `client.data` as the default source;
    // any other key is opted into per collection with `dataSource: "<key>"`.
    return (
        <Rebase
            client={rebaseClient}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}
        >
            <RebaseAdmin collections={[/* your collections */]} />
            <RebaseShell title="Admin" />
        </Rebase>
    );
}
```

A hand-built socket authenticates only if it is given a token getter. Without one
the driver still *works* — as `anon`, returning whatever the anonymous policies
allow — so pass `getAuthToken` rather than debugging an empty collection:

```tsx
import { RebaseWebSocketClient } from "@rebasepro/client";
import { usePostgresClientDriver } from "@rebasepro/client-postgres";

// `websocketUrl` is the backend origin (plus its mount path, if any) — the same
// value `createRebaseClient` derives from `baseUrl`.
const wsClient = new RebaseWebSocketClient({ websocketUrl: "ws://localhost:3000" });

function useDriver() {
    // Equivalent to passing `getAuthToken` to the socket's constructor; this is
    // for a socket you were handed and cannot configure at construction.
    return usePostgresClientDriver({
        wsClient,
        getAuthToken: async () => localStorage.getItem("access_token")
    });
}
```

## Related Packages

- `@rebasepro/client` — Provides `RebaseWebSocketClient` used for communication
- `@rebasepro/types` — Shared types (`DataDriver`, `FetchCollectionProps`, `CollectionConfig`, `DatabaseAdmin`, etc.)
