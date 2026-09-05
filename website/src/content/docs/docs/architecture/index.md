---
title: Architecture Overview
sidebar_label: Architecture
description: Understand how Rebase's backend, frontend, client SDK, and database integrate to form a complete Backend-as-a-Service.
---

## System Architecture

Rebase is a full-stack platform with four layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  React Admin UI  •  Custom Views  •  Plugins  •  Your App      │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### Database Adapter System

The backend initializes through a unified database adapter pattern. Database-specific logic is decoupled into its own package, and the adapter handles connection pooling, schema resolution, and real-time event routing automatically.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Collections automatically resolve against the configured adapter through the internal dependency injection registry.

:::tip
The `createPostgresAdapter` handles database connection pooling, schema resolution, and real-time `LISTEN/NOTIFY` setup automatically.
:::

### Collection Registry

The `BackendCollectionRegistry` is the runtime index of all collections, their PostgreSQL tables, enums, and Drizzle relations. It's populated at startup from your collection definitions.

### Realtime Service

Real-time sync uses PostgreSQL's native `LISTEN/NOTIFY` mechanism:

1. A data mutation happens (insert, update, delete)
2. The backend emits a `NOTIFY` on a channel
3. The `RealtimeService` receives the notification
4. It broadcasts the change to all connected WebSocket clients
5. React components re-render with the new data

For **multi-instance deployments** (e.g., Cloud Run with multiple replicas), provide a `connectionString` in your PostgresBootstrapper so all replicas share the same `LISTEN` connection.

### Storage Registry

Like drivers, storage backends are registered in a registry. You can have multiple storage providers (local, S3) and route different file fields to different backends using `storageId`.

## Package Map

| Package | Role | Used By |
|---------|------|---------|
| `@rebasepro/types` | TypeScript interfaces for collections, properties, entities, plugins | Everything |
| `@rebasepro/server` | Backend server initialization, REST API, auth, storage, WebSocket | Backend |
| `@rebasepro/client` | Client SDK — HTTP transport, WebSocket, auth | Frontend |
| `@rebasepro/app` | React framework — Scaffold, controllers, forms, routes, hooks | Frontend |
| `@rebasepro/ui` | Standalone UI component library (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Login views, auth controller hooks, user management | Frontend |
| `@rebasepro/studio` | Collection editor, SQL console, JS console, RLS editor, storage browser | Frontend |
| `@rebasepro/cli` | CLI for schema generation, DB migrations, SDK generation | Dev tooling |
| `@rebasepro/forms` | Lightweight React form state management | Frontend |
| `@rebasepro/plugin-ai` | AI-powered field autocompletion plugin | Frontend |
| `@rebasepro/plugin-data-import-export` | CSV/JSON/Excel import and export | Frontend |
| `@rebasepro/inference` | Auto-detect schema from existing database data | Backend/CLI |

## Data Flow

### Read Flow
1. User opens a collection in the admin UI
2. Client SDK sends `GET /api/data/:slug` + opens a WebSocket subscription
3. Backend queries PostgreSQL via Drizzle ORM
4. Data transformer deserializes database records into entity format
5. Response sent to frontend, components render
6. WebSocket keeps the view synced in real-time

### Write Flow
1. User edits an entity in the form
2. `beforeSave` callbacks run (validation, transformation)
3. Client SDK sends `PATCH /api/data/:slug/:id`
4. Backend serializes values, runs Drizzle `UPDATE`
5. `afterSave` callbacks run (side effects)
6. `NOTIFY` broadcast triggers WebSocket update to all clients
7. If history is enabled, a snapshot is recorded

## Next Steps

- **[Schema as Code](/docs/architecture/schema-as-code)** — The TypeScript-first approach
- **[Backend Overview](/docs/backend)** — Server configuration
- **[Collections](/docs/collections)** — Define your data schema
