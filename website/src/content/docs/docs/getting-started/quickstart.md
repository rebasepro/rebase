---
title: Quickstart
sidebar_label: Quickstart
description: Create a new Rebase project and get it running locally in under 2 minutes.
---

## Create a New Project

```bash
pnpm dlx @rebasepro/cli init my-app
```

This scaffolds a project with three packages. If any of *collection*, *Studio*,
*managed runtime*, *bundle* or *resource* is new, the five-word box on
[Project Structure](/docs/getting-started/project-structure/) defines them.



| Folder | Description |
|--------|-------------|
| `frontend/` | React SPA — Vite + TypeScript with the Rebase admin UI |
| `backend/` | Your custom functions and crons, plus the generated Drizzle schema. There is no server file — the published runtime boots the project |
| `config/` | Config files and collection definitions shared by both sides |

## Prerequisites

- **Node.js** 22.22+, the version in `.nvmrc` (a headless `--headless` project needs only 20)
- **pnpm** (recommended) or npm

No database to install, and no Docker. `rebase dev` runs a managed PostgreSQL for the project, with its data under `.rebase/`. See [Variant: use your own PostgreSQL](#variant-use-your-own-postgresql) if you would rather supply one — a local install, Neon, Supabase, or the container this scaffold ships.

## Your Environment Is Already Configured

`init` generates a ready-to-run `.env` at the project root with a real `JWT_SECRET`, a database password, and a free local database port. You don't need to create or edit anything to get started.

:::caution
Don't run `cp .env.example .env`. `.env.example` is a reference for the available variables — copying it over your `.env` discards the generated secrets and points `DATABASE_URL` at a database that doesn't exist. Edit `.env` directly if you want to change a value.
:::

## Start the Dev Servers

```bash
pnpm install
pnpm run dev
```

That is the whole first run. There is no database to install and no schema step:
with no `DATABASE_URL` set, `rebase dev` starts a **managed PostgreSQL (PGlite)**
in the project directory, generates the Drizzle schema from your collections, and
creates the tables at boot — including the example `posts`, `authors` and `tags`.

It starts both halves together:

- **Backend** — REST API, auth, storage, WebSocket
- **Frontend** — the Rebase admin panel
- **Hot reload** for both

Both ports are **derived from this project's path** rather than fixed, so several
Rebase projects can run side by side. `rebase dev` prints the two URLs it bound —
**use those**, not `localhost:3001` / `localhost:5173`. (`PORT` and `VITE_API_URL`
in `.env` configure `rebase start`, the production server, and are ignored here.)
Pin a port with `rebase dev --port 3001`.

### Flags worth knowing

| Flag | On | What it does |
|---|---|---|
| `--yes` | `init` | Accept every default. **Required when there is no terminal to prompt**, such as CI |
| `--headless` | `init` | A backend with no collection files and no UI — see [Backend only](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Start from a template other than the default |
| `--install` / `--no-install` | `init` | Run the package manager for you, or leave it |
| `--docker` | `dev` | Use PostgreSQL in a container instead of the managed one |
| `--no-db` | `dev` | Start no database at all — not the container and not the managed one. Set `DATABASE_URL` yourself |

## Variant: use your own PostgreSQL

The managed database is a convenience, not a requirement. To point the project at
a Postgres you run, uncomment `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Then start the dev servers as above. A `DATABASE_URL` that is set is never
touched, and one pointing anywhere other than this machine is left alone
entirely.

With your own database you also get the migration commands, which the managed one
cannot offer — they plan changes with [Atlas](https://atlasgo.io/), the schema-migration engine
Rebase plans with, which needs a second empty database
to compare against, and PGlite serves exactly one:

```bash
pnpm run db:push
```

Boot already creates missing tables additively, so `db push` is for the two
things it deliberately leaves alone: junction-table
[RLS](/docs/collections/security-rules/) — PostgreSQL's row-level security, which is
how Rebase enforces who may read a row — on many-to-many
relations, and any change that is not purely additive — a renamed column, a
narrowed type, a removed field.

The scaffold also ships a `docker-compose.yml` with a PostgreSQL service, if you
want a container rather than an installed Postgres:

```bash
docker compose up -d db
```

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

<span class="since-badge" data-since="0.18">Since 0.18</span>

`rebase init` also wrote `REBASE_ADMIN_EMAIL` and a generated `REBASE_ADMIN_PASSWORD` into `.env`. Those are not your credentials here: `rebase dev` ignores them and says so at boot. They belong to a production boot — `docker compose up`, or anything with `NODE_ENV=production` — where this bootstrap window is closed, because the server answers on a hostname before you have typed anything. See [Your first admin](/docs/getting-started/deployment#your-first-admin).

## Define Your First Collection

Open `config/collections/` and create a new file. Export the collection as the **default export** — that's how the registry picks it up. The table name is optional: it defaults to the slug, so set it only when they differ:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
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

Save the file. That is the whole step: `rebase dev` regenerates
`backend/src/schema.generated.ts` from your collections, restarts the backend,
and boot creates the new table — so your **Products** collection appears in the
navigation.

The same is true of a property added to a collection you already have: save,
and the column is there.

`rebase db push` is for the changes boot deliberately leaves alone — a renamed
column, a narrowed type, a removed field, and junction-table RLS on
many-to-many relations. It needs your own PostgreSQL:

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
