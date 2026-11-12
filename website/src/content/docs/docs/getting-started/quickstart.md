---
title: Quickstart
sidebar_label: Quickstart
description: Create a new Rebase project and get it running locally in under 2 minutes.
---

## Create a New Project

```bash
pnpm dlx @rebasepro/cli init my-app
```

This scaffolds a project with two packages. If any of *table*, *collection*,
*Studio*, *managed runtime*, *bundle* or *resource* is new, the box on
[Project Structure](/docs/getting-started/project-structure/) defines them.

| Folder | Description |
|--------|-------------|
| `backend/` | Your tables (`backend/schema/`), what the runtime reads beside them (`resources.ts`, `storage.ts`), your functions and crons, and the generated Drizzle schema. There is no server file — the published runtime boots the project |
| `frontend/` | React SPA — Vite + TypeScript with the Rebase admin UI, and its table customizations in `src/cms/` |

## Prerequisites

- **Node.js** 22.22+ — every scaffold, headless included, declares `"node": ">=22.22.0"`
- **pnpm** (recommended) or npm

No database to install, and no Docker. `rebase dev` runs a managed PostgreSQL for the project, with its data under `.rebase/`. See [Variant: use your own PostgreSQL](#variant-use-your-own-postgresql) if you would rather supply one — a local install, Neon, Supabase, or the container this scaffold ships.

## Your Environment Is Already Configured

`init` generates a ready-to-run `.env` at the project root with a real `JWT_SECRET`, a database password, and a free local database port. You don't need to create or edit anything to get started.

:::caution
Don't run `cp .env.example .env`. `.env.example` is a reference for the available variables — copying it over your `.env` discards the generated secrets — `JWT_SECRET`, the service key, the database password and the first-admin credentials, all blank or commented out there. Edit `.env` directly if you want to change a value.
:::

## Start the Dev Servers

```bash
cd my-app
pnpm install
pnpm run dev
```

That is the whole first run. There is no database to install and no schema step:
with no `DATABASE_URL` set, `rebase dev` starts a **managed PostgreSQL (PGlite)**
in the project directory, generates the Drizzle schema from your tables, and
creates the tables at boot — including the example `posts`, `authors` and `tags`.

It starts both halves together:

- **Backend** — REST API, auth, storage, WebSocket
- **Frontend** — the panel: Rebase CMS and Rebase Studio
- **Hot reload** for both

Both ports are **derived from this project's path** rather than fixed, so several
Rebase projects can run side by side. `rebase dev` prints the two URLs it bound —
**use those**, not `localhost:3001` / `localhost:5173`. (`PORT` and `VITE_API_URL`
in `.env` configure `rebase start`, which runs the built bundle, and are ignored here.)
Pin a port with `rebase dev --port 3001`.

### Flags worth knowing

| Flag | On | What it does |
|---|---|---|
| `--yes` | `init` | Never prompt. **Required when there is no terminal to answer**, such as CI. It skips git init and dependency install — the interactive defaults say yes to both, so pass `--git` / `--install` if you want them |
| `--headless` | `init` | A backend with no `backend/schema/` and no UI, serving your database's own tables — see [Backend only](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Start from a template other than the default |
| `--install` / `--no-install` | `init` | Run the package manager for you, or leave it |
| `--docker` | `dev` | Use PostgreSQL in a container instead of the managed one. The other commands follow it until `rebase dev` runs without it. A `DATABASE_URL` outranks it: then it starts nothing, and says so |
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

The migration commands plan changes with [Atlas](https://atlasgo.io/), the
schema-migration engine Rebase plans with, which needs a second empty database to
compare against. On your own database Rebase makes one beside it; on the managed
one, which serves exactly one database, it starts a throwaway PGlite for the
length of the command.
Either way:

```bash
pnpm run db:push
```

Boot already creates missing tables — and their
[RLS](/docs/collections/security-rules/) policies, PostgreSQL's row-level
security, which is how Rebase enforces who may read a row — additively, so
`db push` is for what it deliberately leaves alone: any change that is not
purely additive — a renamed column, a narrowed type, a removed field.

The scaffold also ships a `docker-compose.yml` with a PostgreSQL service, if you
want a container rather than an installed Postgres:

```bash
docker compose up -d db
```

## Introspect an Existing Database (Optional)

<span class="since-badge" data-since="0.31">Since 0.31</span>

If you are connecting to an existing database with pre-existing tables, you can introspect it to generate a `defineTable` file for each one:

```bash
pnpm rebase schema introspect
```

This reads every table, column, foreign key and row-level security policy and writes `backend/schema/<table>.ts` and the `index.ts` that exports them, so you don't have to write them by hand. See [`schema introspect`](/docs/cli/schema/#rebase-schema-introspect).

## First Login

When you open the frontend URL `rebase dev` printed, you'll see the login screen. The **first user** to register automatically becomes an admin — this is the bootstrap flow.

1. The screen opens on **Welcome!**, the form for that first account
2. Enter your email and password, then click **Create account**
3. You're in — with full admin access

`rebase init` also wrote `REBASE_ADMIN_EMAIL` and a generated `REBASE_ADMIN_PASSWORD` into `.env`. Those are not your credentials here: `rebase dev` ignores them and says so at boot. They belong to a production boot — `docker compose up`, or anything with `NODE_ENV=production` — where this bootstrap window is closed, because the server answers on a hostname before you have typed anything. See [Your first admin](/docs/getting-started/deployment#your-first-admin).

## Define Your First Table

<span class="since-badge" data-since="0.31">Since 0.31</span>

Create a file in `backend/schema/`:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        name:        col.text().notNull(),
        price:       col.numeric().notNull().validate({ min: 0 }),
        description: col.text(),
        active:      col.boolean().default(true),
        createdAt:   col.timestamptz().onCreateNow(),
    },
    // Takes the defaultRls the scaffold's index.ts exports: everyone reads, admins write.
    rls: "inherit",
});
```

Then export it from `backend/schema/index.ts`. The index is what the backend,
the CLI and the SDK generator read: a `defineTable` it does not export refuses
the boot, naming the file.

```typescript title="backend/schema/index.ts"
// ...existing exports
export { products } from "./products";
```

## Create the Table

<span class="since-badge" data-since="0.31">Since 0.31</span>

Save the file. That is the whole step: `rebase dev` regenerates
`backend/src/schema.generated.ts` and the SDK types in `generated/sdk/` from your
tables, restarts the backend, and boot creates the new table and its row-level
security policies — and **Products** appears in the admin panel's navigation,
with a list, a form and filters derived from the columns.

The same is true of a column added to a table you already have: save, and the
column is there.

To change how the table looks in the panel — a multi-line editor for
`description`, an icon, a group — add a file to `frontend/src/cms/` and pass it
to `<RebaseCMS tableCustomizations>` in `App.tsx`:

```tsx title="frontend/src/cms/products.tsx"
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "ShoppingCart",
    fields: {
        description: { multiline: true },
    },
});
```

See [Customizing a table](/docs/frontend/customize-table/).

`rebase db push` is for the changes boot deliberately leaves alone — a renamed
column, a narrowed type, a removed field:

```bash
pnpm run db:push
```

It runs on the
managed database as on your own.

## Database Commands Reference

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Command | Description |
|---------|-------------|
| `rebase schema generate` | Generate the Drizzle schema from your tables. No database needed — `rebase dev` runs it for you |
| `rebase schema introspect` | Write `defineTable` files from an existing database |
| `rebase db push` | Push schema changes directly to the database, the managed one included |
| `rebase db generate` | Generate SQL migration files |
| `rebase db migrate` | Run pending migrations |

The three `db`
commands work on the managed database.

## What's Next

- **[Project Structure](/docs/getting-started/project-structure)** — Understand the generated code
- **[Tables](/docs/schema/)** — Deep dive into schema definition
- **[Environment & Configuration](/docs/getting-started/configuration)** — All configuration options
- **[Deployment](/docs/getting-started/deployment)** — Deploy to production
