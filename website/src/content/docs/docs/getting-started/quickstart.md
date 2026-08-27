---
title: Quickstart
sidebar_label: Quickstart
description: Create a new Rebase project and get it running locally in under 2 minutes.
---

## Create a New Project

```bash
pnpm dlx @rebasepro/cli init my-app
```

This scaffolds a project with three packages:

| Folder | Description |
|--------|-------------|
| `frontend/` | React SPA — Vite + TypeScript with the Rebase admin UI |
| `backend/` | Node.js server — Hono, PostgreSQL via Drizzle ORM, WebSocket |
| `config/` | Config files and collection definitions shared by both sides |

## Prerequisites

- **Node.js** 18+
- **Docker** — to run the included PostgreSQL container. (Or bring your own PostgreSQL: local install, Neon, Supabase, etc.)
- **pnpm** (recommended) or npm

## Your Environment Is Already Configured

`init` generates a ready-to-run `.env` at the project root with a real `JWT_SECRET`, a database password, and a free local database port. You don't need to create or edit anything to get started.

:::caution
Don't run `cp .env.example .env`. `.env.example` is a reference for the available variables — copying it over your `.env` discards the generated secrets and points `DATABASE_URL` at a database that doesn't exist. Edit `.env` directly if you want to change a value.
:::

If you'd rather point at your own PostgreSQL instead of the bundled container, edit `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

## Start the Database

The scaffold ships a `docker-compose.yml` with a PostgreSQL service. Start it:

```bash
docker compose up -d db
```

(Skip this if you pointed `DATABASE_URL` at your own database.)

## Create the Tables

Push your collections to the database. This creates the tables for the example `posts`, `authors`, and `tags` collections:

```bash
pnpm run db:push
```

Without this step the admin panel still opens, but every collection is empty and its API calls fail until the tables exist.

## Introspect an Existing Database (Optional)

If you are connecting to an existing database with pre-existing tables, you can introspect it to automatically generate your TypeScript collection files:

```bash
pnpm rebase schema introspect
```

This will analyze your database tables and generate corresponding TypeScript files in `config/collections/` so you don't have to write them manually.

## Start the Dev Servers

```bash
pnpm dev
```

This starts both together:
- **Backend** — REST API, auth, storage, WebSocket
- **Frontend** — the Rebase admin panel
- **Hot reload** for both — changes take effect instantly

Both ports are **derived from this project's path** rather than fixed, so several
Rebase projects can run side by side. `rebase dev` prints the two URLs it bound —
use those, not `localhost:3001`/`localhost:5173`. (`PORT` and `VITE_API_URL` in
`.env` configure `rebase start`, the production server, and are ignored here.)
Pin a port with `rebase dev --port 3001`.

## First Login

When you open the frontend URL `rebase dev` printed, you'll see the login screen. The **first user** to register automatically becomes an admin — this is the bootstrap flow.

1. Click **Sign Up**
2. Enter your email and password
3. You're in — with full admin access

## Define Your First Collection

Open `config/collections/` and create a new file. Export the collection as the **default export** — that's how the registry picks it up:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    singularName: "Product",
    table: "products",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
});

export default productsCollection;
```

Then register it in `config/collections/index.ts` so both the backend and the admin panel know about it:

```typescript title="config/collections/index.ts" {2,5}
// ...existing imports
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Create the Table

Push the new collection to the database:

```bash
pnpm run db:push
```

This regenerates the schema from your collections and applies it. Restart the dev servers and your new **Products** collection appears in the navigation.

## Database Commands Reference

| Command | Description |
|---------|-------------|
| `rebase schema generate` | Generate Drizzle schema from your TypeScript collections |
| `rebase schema introspect` | Generate TypeScript collections from an existing database |
| `rebase db push` | Push schema changes directly to the database (dev only) |
| `rebase db generate` | Generate SQL migration files |
| `rebase db migrate` | Run pending migrations |

## What's Next

- **[Project Structure](/docs/getting-started/project-structure)** — Understand the generated code
- **[Collections](/docs/collections)** — Deep dive into schema definition
- **[Environment & Configuration](/docs/getting-started/configuration)** — All configuration options
- **[Deployment](/docs/getting-started/deployment)** — Deploy to production
