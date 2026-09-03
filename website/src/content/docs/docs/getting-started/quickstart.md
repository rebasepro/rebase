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
- **pnpm** (recommended) or npm

No database to install, and no Docker. `rebase dev` runs a managed PostgreSQL for the project, with its data under `.rebase/`. See [Bring your own PostgreSQL](#bring-your-own-postgresql) if you would rather supply one — a local install, Neon, Supabase, or the container this scaffold ships.

## Your Environment Is Already Configured

`init` generates a ready-to-run `.env` at the project root with a real `JWT_SECRET`, a database password, and a free local database port. You don't need to create or edit anything to get started.

:::caution
Don't run `cp .env.example .env`. `.env.example` is a reference for the available variables — copying it over your `.env` discards the generated secrets and points `DATABASE_URL` at a database that doesn't exist. Edit `.env` directly if you want to change a value.
:::

## Start the Dev Servers

```bash
pnpm install   # only if you declined the install `init` offered
pnpm dev
```

That is the whole first run — there is no database to start and no schema step to remember. `rebase dev` does three things before it serves:

1. Generates `backend/src/schema.generated.ts` from `config/collections/`.
2. Starts a managed PostgreSQL for this project, with its data under `.rebase/`.
3. Applies your collections to it, so the example `posts`, `authors` and `tags` tables exist.

Then it starts both halves together:

- **Backend** — REST API, auth, storage, WebSocket
- **Frontend** — the Rebase admin panel
- **Hot reload** for both — changes take effect instantly

Both ports are **derived from this project's path** rather than fixed, so several
Rebase projects can run side by side. `rebase dev` prints the two URLs it bound —
use those, not `localhost:3001`/`localhost:5173`. (`PORT` and `VITE_API_URL` in
`.env` configure `rebase start`, the production server, and are ignored here.)
Pin a port with `rebase dev --port 3001`.

## Bring Your Own PostgreSQL

`DATABASE_URL` is commented out in `.env` on purpose — that is what makes the managed database the default. Set it to any PostgreSQL you like (a local install, Neon, Supabase) and it wins over the managed one:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

The scaffold also ships a `docker-compose.yml` with a PostgreSQL service, and the URL already in `.env` points at it. Uncomment that line, then:

```bash
docker compose up -d db
pnpm run db:push
pnpm dev
```

`db:push` is what creates your collection tables on a database Rebase does not manage for you.

:::caution
`db:push`, `db:generate` and `db:migrate` plan their changes with [Atlas](https://atlasgo.io), which diffs your schema against a second, empty database. The managed development database serves exactly one, so all three refuse to run against it and say so rather than failing part-way. You do not need them there — `rebase dev` applies your collections at boot. Reach for them once you are on a PostgreSQL of your own, and for migrations, column drops and renames.
:::

## Introspect an Existing Database (Optional)

If you are connecting to an existing database with pre-existing tables, you can introspect it to automatically generate your TypeScript collection files:

```bash
pnpm rebase schema introspect
```

This will analyze your database tables and generate corresponding TypeScript files in `config/collections/` so you don't have to write them manually.

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

Restart `rebase dev`. It regenerates the schema from your collections and applies the new table before it serves, so **Products** appears in the navigation.

On a PostgreSQL of your own, that is `db:push`'s job instead:

```bash
pnpm run db:push
```

## Database Commands Reference

| Command | Description |
|---------|-------------|
| `rebase schema generate` | Generate the Drizzle schema from your TypeScript collections. No database needed — `rebase dev` runs it for you |
| `rebase schema introspect` | Generate TypeScript collections from an existing database |
| `rebase db push` | Push schema changes directly to the database. Needs your own PostgreSQL |
| `rebase db generate` | Generate SQL migration files. Needs your own PostgreSQL |
| `rebase db migrate` | Run pending migrations. Needs your own PostgreSQL |

## What's Next

- **[Project Structure](/docs/getting-started/project-structure)** — Understand the generated code
- **[Collections](/docs/collections)** — Deep dive into schema definition
- **[Environment & Configuration](/docs/getting-started/configuration)** — All configuration options
- **[Deployment](/docs/getting-started/deployment)** — Deploy to production
