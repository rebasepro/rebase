---
title: Project Structure
sidebar_label: Project Structure
description: "The layout of a Rebase project — the tables in backend/schema, the backend modules the runtime reads, and the admin panel's customizations in frontend/src/cms — with and without the panel."
---

:::note[Six words this page uses]
Every one of them means something specific here, and most of them mean something
else elsewhere in the industry.

- **Table** — a Postgres table, declared in TypeScript with `defineTable` in
  `backend/schema/`. The SQL, the row-level security policies, the API, the
  SDK types and the admin panel's defaults all come from it.
- **Collection** — what the admin panel shows: a table rendered as a list and a
  form, customized in `frontend/src/cms/`, or a Firestore collection the panel
  reads directly.
- **Studio** — the developer half of the admin panel: schema editor, SQL
  console, policy browser. The same app your content team uses, behind a toggle.
- **Managed runtime** — the published `rebasepro/server` image boots your
  project. You write no server file, and you get runtime upgrades without a
  rebuild. The alternative is `rebase eject`, below.
- **Bundle** — what `rebase build` produces: your tables, functions and crons,
  compiled, with a manifest saying where each one is. It is what the managed
  runtime boots.
- **Resource** — something the project needs from wherever it runs: a database,
  a bucket, a topic. Declared in `backend/resources.ts`, bound by environment
  variables.
:::

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rebase init` scaffolds one of two layouts. Both have the same `backend/`; the
difference is whether the project has the admin panel.

**With the admin panel** (the default):

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # A health check and an SDK call to uncomment: `pnpm example`
│
├── backend/
│   ├── schema/             # Your tables
│   │   ├── index.ts        # Exports every table, and the optional defaultRls
│   │   ├── posts.ts        # defineTable("posts", …)
│   │   └── users.ts        # defineAuthTable("users", …)
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files (storageAuthorize)
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your tables
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── cms/            # How tables look in the panel: customizeTable(...)
    │       └── posts.tsx
    └── vite.config.ts
```

**Backend only** (`rebase init --headless`): the same `backend/`, with no
`frontend/` — and no `backend/schema/` either. The server reads the database's
own tables at boot and serves each one that has row-level security enabled. See
[Backend only](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Two more files appear when you want them, and the runtime reads both:
`backend/hooks.ts`, whose `hooks` export runs for every table
([Global hooks](/docs/backend/hooks/)), and `backend/crons/`, for scheduled
jobs. `rebase generate-sdk --register` adds `backend/generated/`.

`tsc --noEmit` at the root checks `scripts/`; in `backend/` or `frontend/` it
checks that workspace. There is no separate `config/` package: the frontend
imports a table from `backend/schema` as a type only (`import type`). A value
import of anything under `backend/` would ship server code — hooks, and the
secrets they read — to the browser, so `rebaseBackendGuard()` from
`@rebasepro/app/vitePlugin`, in the scaffold's `frontend/vite.config.ts`, fails
`vite build` and `vite dev` when anything resolves into `backend/`, naming the
importer, the import and the file. `rebase build` refuses a frontend without
it. To add it to an existing project, import it and add `rebaseBackendGuard()`
to `plugins` in `frontend/vite.config.ts`.

:::note[There is no `backend/src/index.ts`]
And no `Dockerfile`. A scaffolded project declares `runtime: "managed"` in
`rebase.json`, which means the **published `rebasepro/server` image boots your
project as a bundle** — the same artifact whether you self-host it or deploy it
to Rebase Cloud. You configure the server through `rebase.json`, the files in
`backend/` and environment variables rather than by writing an entry point.

If you want to own the process — your own middleware, your own routes, your own
auth wiring — `rebase eject` writes the entry point, a Dockerfile and a compose
file that builds them. See [Custom Server Integration](/docs/backend/custom-server).
:::

## Tables (`backend/schema/`)

<span class="since-badge" data-since="0.31">Since 0.31</span>

Tables are the **single source of truth** for your data model:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        price: col.numeric(),
    },
    rls: "admin-only",
});
```

The name becomes the REST endpoint (`/api/data/products`), the table name in
Postgres and the panel's route; `table` and `slug` override them. `rls` is
required. A table counts once `backend/schema/index.ts` exports it — a
`defineTable` the index leaves out refuses the boot. [Tables](/docs/schema/)
covers every option.

## Frontend (`frontend/`)

The frontend is a standard **Vite + React + TypeScript** application. The key file is `App.tsx`, which wires together all Rebase controllers:

```tsx title="frontend/src/App.tsx"
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { postsCms } from "./cms/posts";
import { authorsCms } from "./cms/authors";
import { tagsCms } from "./cms/tags";
import { usersCms } from "./cms/users";
// How the collection editor laid out the tables in development (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// One client for the page, created when this module loads. Inside a component,
// even in a `useMemo`, `<React.StrictMode>` builds a second one in development,
// and both restore the session and open their own connections.
const rebaseClient = createRebaseClient({
    baseUrl: API_URL,
    // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
    // localStorage. The backend issues it via `auth.cookieAuth`.
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                authController={authController}
            >
                {/* The sign-in screen. On its own this changes nothing —
                    it is where you pass `loginView` to replace it. */}
                <RebaseAuth />
                {/* Every table the backend serves gets an admin view with no
                    code. A file in ./cms changes how one of them looks:
                    labels, icons, enum colours, custom fields and actions. */}
                <RebaseCMS tableCustomizations={[postsCms, authorsCms, tagsCms, usersCms]} uiConfig={uiConfig} />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` mounts it under a `react-router` `basename` taken from
`import.meta.env.BASE_URL`, which `rebase build` sets from the `path` this app
declares in `rebase.json` — so the assets, the router and the server agree on
one value without it being written down three times.

### Key Concepts

<span class="since-badge" data-since="0.31">Since 0.31</span>

- **`createRebaseClient`** — Creates the SDK client that handles HTTP requests, WebSocket connections, and auth token management. Call it once, at module scope: inside a component, even in a `useMemo`, `<React.StrictMode>` builds a second client in development
- **`<RebaseCMS tableCustomizations>`** — the panel renders every table the backend serves at `GET /api/schema/tables`; the `customizeTable` objects from `frontend/src/cms/` change how some of them look, and `uiConfig` carries what the collection editor saved in development. See [Customizing a table](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Holds the signed-in user and the token lifecycle, and is what `<Rebase>` distributes to everything below it

## Backend (`backend/`)

There is no server file to read, and that is the design: a scaffolded project
declares `runtime: "managed"`, so the published `rebasepro/server` image boots
your project. What `backend/` holds is the code the runtime picks up:

| Path | What it is |
|---|---|
| `backend/schema/` | The tables, and the `defaultRls` their index exports |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Declared resources, `storageAuthorize`, and global table hooks |
| `backend/functions/` | Custom routes, auto-mounted at `/api/functions/<filename>` |
| `backend/crons/` | Scheduled jobs, discovered the same way (create it when you want one) |
| `backend/src/schema.generated.ts` | The Drizzle schema of your tables: written by `rebase init`, and regenerated on every `rebase dev` and `rebase build` |

The runtime sets up:

- **REST API** at `/api/data/*` — generated CRUD for every table
- **Auth** at `/api/auth/*` — signup, login, refresh, OAuth
- **Storage** at `/api/storage/*` — upload and download
- **WebSocket** — realtime sync over Postgres LISTEN/NOTIFY
- **Your functions and crons**, from the directories above

Configuration comes from `rebase.json`, the files in `backend/` and environment
variables. See [Environment & Configuration](/docs/getting-started/configuration).

`rebase build` turns all of it into a **bundle** — the compiled tables,
functions and crons plus a manifest — which the managed runtime boots. Nothing
about the bundle is written by hand; if you want to see one,
[Runtime & Bundles](/docs/architecture/runtime-and-bundles/) is what is in it.

The panel the frontend serves has two halves. **Studio** is the developer one —
the schema editor, the SQL console, the RLS policy browser — and it is behind
the toggle in the drawer, not a separate deployment. See [Studio](/docs/studio/).

To take ownership of the process instead — your own middleware, routes and auth
wiring — run `rebase eject`. **Everything below this paragraph is ejected-only**:
a scaffolded project has none of those files, and nothing in it calls
`initializeRebaseBackend`. It writes an entry point that calls
`initializeRebaseBackend` directly, plus a Dockerfile and a compose file that
builds it; from then on you maintain the server and platform runtime upgrades no
longer reach the project. That surface is documented in
[Custom Server Integration](/docs/backend/custom-server).

## How They Connect

<span class="since-badge" data-since="0.31">Since 0.31</span>

1. **You declare** tables in `backend/schema/`
2. **The backend** compiles them, creates the tables and policies, and mounts REST, realtime and MCP routes
3. **The admin panel** reads them from `GET /api/schema/tables` and renders a view for each, changed by the files in `frontend/src/cms/`
4. **The CLI** reads them to generate the Drizzle schema (`rebase schema generate`), the SDK types (`rebase generate-sdk`) and, from that schema, migration files (`rebase db generate`)

While `rebase dev` is running, saving a file under `backend/schema/`
regenerates `backend/src/schema.generated.ts` and the SDK types in
`generated/sdk/`, restarts the backend, and boot creates the tables and columns
that are missing. Outside `rebase dev` the same steps are `rebase schema generate`
and `rebase generate-sdk`.

A project from before 0.31 has a `config/collections/` directory instead. Every
command refuses it and names `rebase migrate collections-to-tables`, which moves
it — see [the upgrade guide](/docs/upgrading/0-30-to-0-31/).

## Next Steps

- **[Quickstart](/docs/getting-started/quickstart)** — Get started with a new Rebase project
- **[Tables](/docs/schema/)** — Declare your data model
- **[Configuration](/docs/getting-started/configuration)** — All environment variables and options
