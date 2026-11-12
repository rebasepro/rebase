---
title: Architecture Overview
sidebar_label: Architecture
description: Understand how Rebase's backend, frontend, typed SDK, and database integrate to form a complete Backend-as-a-Service.
---

## System Architecture

Rebase is a full-stack platform with four layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  Rebase CMS + Studio  •  Custom Views  •  Plugins  •  Your App │
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

Every table resolves against the configured adapter — the default database, or the one its `database` names in `backend/resources.ts`.

:::tip
The `createPostgresAdapter` handles database connection pooling, schema resolution, and real-time `LISTEN/NOTIFY` setup automatically.
:::

### Table descriptors

<span class="since-badge" data-since="0.31">Since 0.31</span>

At boot the backend compiles the tables `backend/schema/index.ts` exports into
**descriptors**: each column with its Postgres type, nullability, validation and
storage rules, the relations by slug, and the row-level security posture. A
problem in any table refuses the boot with one `SchemaDefinitionError` naming
every problem. The descriptors are what REST, realtime, MCP and the OpenAPI
document serve from, what the schema version is computed over, and what
`GET /api/schema/tables` hands the admin panel and the Studio, redacted per
caller. Hook code never leaves the server. A backend with no `backend/schema`
introspects the database into the same descriptors instead.

### Realtime Service

Real-time sync uses PostgreSQL's native `LISTEN/NOTIFY` mechanism:

1. A data mutation happens (insert, update, delete) — through the API, or anything else that writes the table: `psql`, a cron, the SQL editor
2. A trigger on the table emits a `NOTIFY` on a channel (where the trigger cannot be installed, the backend emits it, for writes made through the API only)
3. The `RealtimeService` receives the notification
4. It broadcasts the change to all connected WebSocket clients
5. React components re-render with the new data

For **multi-instance deployments** (e.g., Cloud Run with multiple replicas), every replica holds its own `LISTEN` connection to the same database, so a change reaches the subscribers of every replica. Behind a transaction-mode pooler such as PgBouncer, which does not keep a `LISTEN`, set `DATABASE_DIRECT_URL` to the database itself.

### Storage Registry

Like drivers, storage backends are registered in a registry. You can have multiple storage providers (local, S3) and route different storage columns to different backends with `col.storage({ source })`.

## Package Map

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Package | Role | Used By |
|---------|------|---------|
| `@rebasepro/types` | The table builders (`defineTable`, `col`, `rel`), the descriptors, and the interfaces every package shares | Everything |
| `@rebasepro/server` | Backend server initialization, REST API, auth, storage, WebSocket; re-exports the builders from `@rebasepro/server/schema`, an entry that loads no server code | Backend |
| `@rebasepro/server-postgres` | The Postgres driver: schema planning, migrations, RLS policies, realtime | Backend |
| `@rebasepro/codegen` | Typed SDK generation from the table descriptors | Dev tooling |
| `@rebasepro/client` | Typed SDK — HTTP transport, WebSocket, auth | Frontend |
| `@rebasepro/app` | React framework — Scaffold, controllers, forms, routes, hooks, login views, auth controller hooks | Frontend |
| `@rebasepro/ui` | Standalone UI component library (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/studio` | Schema visualizer and editor, SQL console, JS console, RLS editor, storage browser | Frontend |
| `@rebasepro/cli` | CLI for schema generation, DB migrations, SDK generation | Dev tooling |
| `@rebasepro/forms` | Lightweight React form state management | Frontend |
| `@rebasepro/plugin-ai` | AI-powered field autocompletion plugin | Frontend |
| `@rebasepro/cms` | The admin panel: a view per table from the descriptors, `customizeTable`, forms and routing, CSV/JSON/Excel import and export | Frontend |
| `@rebasepro/cms-types` | The panel's types: `customizeTable` options, field options, entity actions | Frontend |
| `@rebasepro/firebase` | Firestore as a source the panel reads directly: `defineFirestoreCollection` | Frontend |
| `@rebasepro/inference` | Infer fields from sample rows (the admin's "create from a file" import) | Frontend |

## Data Flow

### Read Flow
1. User opens a table in Rebase CMS
2. Typed SDK sends `GET /api/data/:slug` + opens a WebSocket subscription
3. Backend queries PostgreSQL via Drizzle ORM
4. The response carries the rows as the API serves them; the panel builds its form values from the row and the table's descriptor
5. Response sent to frontend, components render
6. WebSocket keeps the view synced in real-time

### Write Flow
1. User edits a row in the form
2. Typed SDK sends `PATCH /api/data/:slug/:id`
3. The backend validates the values against the table and runs the `beforeSave` hooks
4. It runs the `UPDATE` under the caller's row-level security
5. `afterSave` hooks run, in the same transaction
6. `NOTIFY` broadcast triggers WebSocket update to all clients
7. If history is enabled, a snapshot is recorded

## Next Steps

- **[Schema as Code](/docs/architecture/schema-as-code)** — The TypeScript-first approach
- **[Backend Overview](/docs/backend)** — Server configuration
- **[Tables](/docs/schema/)** — Define your data schema
