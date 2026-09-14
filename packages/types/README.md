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

Provides the canonical type definitions used across all Rebase packages — both client-side and server-side. It has no runtime dependencies, but it is not types-only: it also exports the constants and small runtime helpers those packages share (`ADMIN_PROPERTY_KEYS`, `GeoPoint`, `declaredDataSources`, …). Every other `@rebasepro/*` package depends on it.

## Key Exports

### Collection & Entity Types

| Export | Description |
|--------|-------------|
| `CollectionConfig` | Full collection definition (name, slug, properties, callbacks, security rules, views) |
| `Property` | Union type for all property configurations (text, number, date, reference, array, map, etc.) |
| `Entity` | Generic entity record type |
| `CollectionCallbacks` | Lifecycle hooks (`afterRead`, `beforeSave`, `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete`) |
| `EntityValues` | Record of property values for an entity |
| `SecurityRule` | RLS-style access control rule for a collection |

### Backend & Driver Interfaces

| Export | Description |
|--------|-------------|
| `DataDriver` | Abstract interface for database drivers (`fetchCollection`, `fetchOne`, `save`, `delete`, etc.) |
| `DatabaseAdapter` | Pluggable database adapter interface (used by `server`) |
| `BackendBootstrapper` | Lifecycle interface for initializing database drivers, auth, history, and realtime |
| `DatabaseAdmin` | Admin operations interface (SQL execution, collection stats, table metadata) |
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
| `CollectionRegistryInterface` | Collection lookup and registration |

### Other

| Export | Description |
|--------|-------------|
| `CronJobDefinition` | Cron job configuration type |
| `CollectionCallbacks` | Lifecycle callbacks for entity CRUD operations |
| `WebSocketMessage` | WebSocket protocol message types |

The admin panel's own types — `AuthController`, the plugin type `RebasePlugin`, `Locale` — live in `@rebasepro/cms-types`.

## Quick Start

```typescript
import type {
  CollectionConfig,
  DataDriver,
  DatabaseAdapter,
  User,
  Property,
} from "@rebasepro/types";
```

## Related Packages

Every `@rebasepro/*` package depends on this one. Key consumers:

| Package | Uses |
|---------|------|
| `@rebasepro/server` | `DataDriver`, `DatabaseAdapter`, `BackendBootstrapper`, `AuthAdapter` |
| `@rebasepro/server-postgres` | `BackendBootstrapper`, `InitializedDriver`, `RealtimeProvider` |
| `@rebasepro/server-mongo` | `BackendBootstrapper`, `DataDriver`, `CollectionConfig` |
| `@rebasepro/client` | `RebaseClient`, `StorageSource` |
| `@rebasepro/cms` | `CollectionConfig`, `Property`, controller interfaces |
