---
title: Project Structure
sidebar_label: Project Structure
description: Understand the structure of a Rebase project — frontend, backend, and collections configuration.
---

:::note[Five words this page uses]
Every one of them means something specific here, and four of them mean something
else elsewhere in the industry.

- **Collection** — one table, described in TypeScript. The schema, the API and
  the admin screen all come from the same file.
- **Studio** — the developer half of the admin panel: schema editor, SQL
  console, policy browser. The same app your content team uses, behind a toggle.
- **Managed runtime** — the published `rebasepro/server` image boots your
  project. You write no server file, and you get runtime upgrades without a
  rebuild. The alternative is `rebase eject`, below.
- **Bundle** — what `rebase build` produces: your collections, functions and
  crons, compiled, with a manifest saying where each one is. It is what the
  managed runtime boots.
- **Resource** — something the project needs from wherever it runs: a database,
  a bucket, a topic. Declared in `config/resources.ts`, bound by environment
  variables.
:::

A Rebase starter project has three interconnected packages:

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
│
├── config/                 # Shared by the backend and the admin panel
│   ├── index.ts            # Re-exports what the runtime reads (collections, storageAuthorize)
│   ├── collections/        # Your data model
│   │   ├── index.ts        # Exports `collections` and the default security rules
│   │   ├── posts.ts        # Example collections
│   │   └── users.ts        # The auth collection
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files
│   └── cms.d.ts            # One line that makes the `admin` block legal here
│
├── backend/
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your collections
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/App.tsx
    ├── src/main.tsx
    └── vite.config.ts
```

:::note[There is no `backend/src/index.ts`]
And no `Dockerfile`. A scaffolded project declares `runtime: "managed"` in
`rebase.json`, which means the **published `rebasepro/server` image boots your
project as a bundle** — the same artifact whether you self-host it or deploy it
to Rebase Cloud. You configure the server through `rebase.json`, `config/` and
environment variables rather than by writing an entry point.

If you want to own the process — your own middleware, your own routes, your own
auth wiring — `rebase eject` writes the entry point, a Dockerfile and a compose
file that builds them. See [Custom Server Integration](/docs/backend/custom-server).
:::

## Frontend (`frontend/`)

The frontend is a standard **Vite + React + TypeScript** application. The key file is `App.tsx`, which wires together all Rebase controllers:

```typescript title="frontend/src/App.tsx"
import React from "react";

import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL,
        // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
        // localStorage. The backend issues it via `auth.cookieAuth`.
        auth: { authFlowMode: "cookie" }
    }), []);

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
                <RebaseAuth />
                <RebaseCMS
                    collections={collections}
                />
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

- **`createRebaseClient`** — Creates the SDK client that handles HTTP requests, WebSocket connections, and auth token management
- **`virtual:rebase-collections`** — A Vite plugin that auto-imports your shared collections at build time
- **`useRebaseAuthController`** — Holds the signed-in user and the token lifecycle, and is what `<Rebase>` distributes to everything below it

## Backend (`backend/`)

There is no server file to read, and that is the design: a scaffolded project
declares `runtime: "managed"`, so the published `rebasepro/server` image boots
your project. What `backend/` holds is the code the runtime picks up:

| Path | What it is |
|---|---|
| `backend/functions/` | Custom routes, auto-mounted at `/api/functions/<filename>` |
| `backend/crons/` | Scheduled jobs, discovered the same way (create it when you want one) |
| `backend/src/schema.generated.ts` | The Drizzle schema, regenerated from your collections on every `rebase dev` and `rebase build` |

The runtime sets up:

- **REST API** at `/api/data/*` — generated CRUD for every collection
- **Auth** at `/api/auth/*` — signup, login, refresh, OAuth
- **Storage** at `/api/storage/*` — upload and download
- **WebSocket** — realtime sync over Postgres LISTEN/NOTIFY
- **Your functions and crons**, from the directories above

Configuration comes from `rebase.json`, the `config/` directory and environment
variables. See [Environment & Configuration](/docs/getting-started/configuration).

`rebase build` turns all of it into a **bundle** — the compiled collections,
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

## Collections (`config/collections/`)

Collections are the **single source of truth** for your data model. They are defined as TypeScript and consumed by both the frontend (for UI generation) and the backend (for schema generation and API routing).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});

// The default export is what the registry picks up — every collection in the
// scaffold is written this way.
export default productsCollection;
```

The `slug` becomes the URL path in the admin UI and the REST API endpoint (`/api/data/products`), and the PostgreSQL table name defaults to it. Add `table` only when they differ.

## How They Connect

1. **You define** collections in `config/collections/`
2. **The backend** reads them to generate Drizzle schemas and mount REST routes
3. **The frontend** reads them (via Vite plugin) to render tables, forms, and navigation
4. **The CLI** reads them to generate migration files with `rebase schema generate`

While `rebase dev` is running, saving a file under `config/collections/`
regenerates `backend/src/schema.generated.ts` and restarts the backend, and boot
creates the tables and columns that are missing. Outside `rebase dev` the same
step is `rebase schema generate`.

## Next Steps

- **[Quickstart](/docs/getting-started/quickstart)** — Get started with a new Rebase project
- **[Configuration](/docs/getting-started/configuration)** — All environment variables and options
