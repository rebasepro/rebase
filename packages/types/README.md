# @rebasepro/types

Shared TypeScript type definitions and interfaces for the Rebase ecosystem.

## Installation

```bash
pnpm add @rebasepro/types
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

## What This Package Does

Provides the canonical type definitions used across all Rebase packages — both client-side and server-side. This is a **types-only** package with no runtime dependencies. Every other `@rebasepro/*` package depends on it.

## Key Exports

### Collection & Snapshot Types

| Export | Description |
|--------|-------------|
| `CollectionConfig` | Full collection definition (name, slug, properties, callbacks, security rules, views) |
| `Property` | Union type for all property configurations (text, number, date, reference, array, map, etc.) |
| `Snapshot` | Generic snapshot record type |
| `CollectionCallbacks` | Lifecycle hooks (`onPreSave`, `onSaveSuccess`, `onDelete`, etc.) |
| `SnapshotValues` | Record of property values for a snapshot |
| `SecurityRule` | RLS-style access control rule for a collection |

### Backend & Driver Interfaces

| Export | Description |
|--------|-------------|
| `DataDriver` | Abstract interface for database drivers (`fetchCollection`, `saveSnapshot`, `deleteSnapshot`, etc.) |
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
| `AuthController` | Client-side auth controller interface |
| `RebaseUser` | User record type |
| `Role` | Role definition type |

### Controller Interfaces

| Export | Description |
|--------|-------------|
| `RebaseClient` | Top-level client interface (data, auth, storage, email) |
| `DataSourceDelegate` | Data operations interface for client-side data sources |
| `StorageSource` | File storage interface |
| `CollectionRegistryInterface` | Collection lookup and registration |
| `NavigationController` | App navigation interface |

### Other

| Export | Description |
|--------|-------------|
| `CronJobDefinition` | Cron job configuration type |
| `CollectionCallbacks` | Lifecycle callbacks for snapshot CRUD operations |
| `PluginConfig` | Plugin system types |
| `WebSocketMessage` | WebSocket protocol message types |
| `Locale` | Localization types |

## Quick Start

```typescript
import type {
  CollectionConfig,
  DataDriver,
  DatabaseAdapter,
  RebaseUser,
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
| `@rebasepro/client` | `RebaseClient`, `DataSourceDelegate`, `StorageSource` |
| `@rebasepro/cms` | `CollectionConfig`, `Property`, `PluginConfig`, controller interfaces |
