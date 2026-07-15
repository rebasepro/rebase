# @rebasepro/client-postgres

PostgreSQL data source client for Rebase — connects the Rebase admin panel to a PostgreSQL backend via WebSocket.

## Installation

```bash
pnpm add @rebasepro/client-postgres
```

**Peer dependencies:** `react >= 19.0.0`, `react-dom >= 19.0.0`

## What This Package Does

This package provides a `DataDriver` implementation that bridges Rebase's data layer to a PostgreSQL backend through `@rebasepro/client`'s WebSocket client. It supports full CRUD, realtime collection/snapshot listeners, unique field validation, snapshot counting, and admin operations (SQL execution, branch management, table introspection).

## Key Exports

| Export | Type | Description |
|---|---|---|
| `usePostgresClientDriver` | Hook | Creates a `PostgresDataDriver` from a `RebaseWebSocketClient` |
| `PostgresDataDriverConfig` | Type | Config object: `{ wsClient: RebaseWebSocketClient }` |
| `PostgresDataDriver` | Type | Extends `DataDriver` with a `client` reference and `admin` methods |

### `PostgresDataDriver` Methods

| Method | Description |
|---|---|
| `fetchCollection(props)` | Fetch a list of snapshots with filtering, sorting, pagination, and search |
| `fetchSnapshot(props)` | Fetch a single snapshot by path and ID |
| `saveSnapshot(props)` | Create or update a snapshot |
| `deleteSnapshot(props)` | Delete a snapshot |
| `checkUniqueField(path, name, value, snapshotId?, collection?)` | Check if a field value is unique |
| `countSnapshots(props)` | Count snapshots matching filter criteria |
| `listenCollection(props)` | Subscribe to realtime collection updates. Returns an unsubscribe function |
| `listenSnapshot(props)` | Subscribe to realtime snapshot updates. Returns an unsubscribe function |
| `isFilterCombinationValid()` | Always returns `true` — PostgreSQL supports complex filter combinations |

### Admin Methods (`driver.admin`)

| Method | Description |
|---|---|
| `executeSql(sql, options?)` | Execute raw SQL. Options: `{ database?, role? }` |
| `fetchAvailableDatabases()` | List available databases |
| `fetchAvailableRoles()` | List available roles |
| `fetchCurrentDatabase()` | Get the current database name |
| `fetchUnmappedTables(mappedPaths?)` | Find tables not yet mapped to collections |
| `fetchTableMetadata(tableName)` | Get column/constraint metadata for a table |
| `createBranch(name, options?)` | Create a database branch. Options: `{ source? }` |
| `deleteBranch(name)` | Delete a database branch |
| `listBranches()` | List all branches |

## Quick Start

```tsx
import { usePostgresClientDriver } from "@rebasepro/client-postgres";
import { RebaseWebSocketClient } from "@rebasepro/client";

const wsClient = new RebaseWebSocketClient({ url: "ws://localhost:4100" });

function App() {
    const driver = usePostgresClientDriver({ wsClient });

    // Pass to your Rebase app as the data driver
    return (
        <Rebase driver={driver} /* ...other props */ />
    );
}
```

## Related Packages

- `@rebasepro/client` — Provides `RebaseWebSocketClient` used for communication
- `@rebasepro/types` — Shared types (`DataDriver`, `Snapshot`, `CollectionConfig`, etc.)
