# @rebasepro/types

Shared TypeScript type definitions and interfaces for the Rebase ecosystem.

## Installation

```bash
pnpm add @rebasepro/types
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## What This Package Does

Provides the canonical type definitions used across all Rebase packages — both client-side and server-side. It has no runtime dependencies, but it is not types-only: it also exports the constants and small runtime helpers those packages share (`declaredDataSources`, `bucket`, …). Every other `@rebasepro/*` package depends on it.

## Key Exports

### Tables

| Export | Description |
|--------|-------------|
| `defineTable`, `defineAuthTable`, `defineView` | Declare a table, the users table, or a SQL view. `rls` is required on every table. Re-exported by `@rebasepro/server/schema`, the entry a `backend/schema` file imports. New in 0.31. |
| `col`, `rel`, `json`, `policy` | The column, relation, JSON-shape and policy-expression builders. New in 0.31. |
| `TableDescriptor`, `ColumnDescriptor`, `RelationDescriptor`, `RlsDescriptor` | The compiled form of a table: what the backend serves at `GET /api/schema/tables` and the SDK generator reads. New in 0.31. |
| `TableHooks` | A table's lifecycle hooks (`beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete`). New in 0.31. |
| `InferRow`, `InferInsert`, `InferUpdate`, `DatabaseOf` | Row types inferred from a table, and a typed `Database` from a schema module. New in 0.31. |
| `TablePatch` | The schema editor's edits, as a typed list of operations. New in 0.31. |
| `SecurityRule` | One rule of a table's `rls` |
| `Register` | Augmented by a project to type server-side data: `database` (generated) or `tables` (the schema module) |

### Backend & Driver Interfaces

| Export | Description |
|--------|-------------|
| `DataDriver` | Abstract interface for database drivers (`fetchCollection`, `fetchOne`, `save`, `delete`, etc.). Reads return the row `GET /api/data/<table>` returns, with a relation only when `include` names it. |
| `DatabaseAdapter` | Pluggable database adapter interface (used by `server`) |
| `BackendBootstrapper` | Lifecycle interface for initializing database drivers, auth, history, and realtime |
| `DatabaseAdmin` | Admin operations interface (SQL execution, table stats, table metadata) |
| `RealtimeProvider` | Interface for realtime subscription providers |
| `BackendConfig` / `BackendInstance` | Abstract backend configuration and instance types |
| `HealthCheckResult` | Return type for health check operations |
| `InitializedDriver` | Result of driver initialization (driver, realtime, registry, internals) |
| `BootstrappedAuth` | Result of auth initialization (user service, role service, email service) |

### Auth & User Types

| Export | Description |
|--------|-------------|
| `AuthAdapter` | Pluggable auth adapter interface (for Clerk, Auth0, custom auth) |
| `User` | User record type |

### Controller Interfaces

| Export | Description |
|--------|-------------|
| `RebaseClient` | Top-level client interface (data, auth, storage, email) |
| `RebaseServerClient` | The server-side `rebase` singleton: `RebaseClient` without `data`, plus `dataAsAdmin` |
| `StorageSource` | File storage interface |

### Other

| Export | Description |
|--------|-------------|
| `CronJobDefinition` | Cron job configuration type |
| `WebSocketMessage` | WebSocket protocol message types |

The admin panel's own types — `AuthController`, the plugin type `RebasePlugin`, `Locale`, and the collection and property view model it draws (`CollectionConfig`, `StringProperty` and every `…Property`, `CollectionCallbacks`) — live in `@rebasepro/cms-types`.

## Quick Start

```typescript
import type {
  TableDescriptor,
  DataDriver,
  DatabaseAdapter,
  User,
} from "@rebasepro/types";
```

## Related Packages

Every `@rebasepro/*` package depends on this one. Key consumers:

| Package | Uses |
|---------|------|
| `@rebasepro/server` | the table builders, `DataDriver`, `DatabaseAdapter`, `BackendBootstrapper`, `AuthAdapter` |
| `@rebasepro/server-postgres` | `BackendBootstrapper`, `InitializedDriver`, `RealtimeProvider` |
| `@rebasepro/client` | `RebaseClient`, `StorageSource` |
| `@rebasepro/cms` | `TableDescriptor`, controller interfaces |
