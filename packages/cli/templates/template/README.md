# {{PROJECT_NAME}}

A [Rebase](https://rebase.pro) project with a PostgreSQL backend.

## Quick Start

`rebase init` already generated a `.env` for you with a real `JWT_SECRET`, a
database password, and a free local database port. **Don't run
`cp .env.example .env`** — that would overwrite those generated values.
`.env.example` is a reference for the variables you can set, not a starting
point for this project.

### Prerequisites

- [Node.js](https://nodejs.org) >= 22.22
- [pnpm](https://pnpm.io) or [npm](https://www.npmjs.com) (v7+)

That is the whole list. There is no database to install: with no `DATABASE_URL`
set, `rebase dev` starts a managed PostgreSQL (PGlite) inside this project, and
the runtime creates your collections' tables at boot.

### Run it

1. Install dependencies (skip if `init` already did this):

```bash
pnpm install   # or: npm install
```

2. Start the dev servers:

```bash
pnpm dev   # or: npm run dev
```

That is the whole first run. `rebase dev` generates the Drizzle schema from
`config/collections`, starts the database, creates the tables — including the
example `posts`, `authors` and `tags` — and serves the API and the admin panel.

`rebase dev` prints the two URLs it actually bound. The first account you
register becomes the admin. `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` in
`.env` are ignored here and read by the production boot below, where that window
is shut — see [Self-hosting](#self-hosting-with-docker).

Ports are **derived from this project's path**, not fixed at 3001/5173, so
several Rebase projects can run at once without colliding. That is why the URL
in your terminal is the one to trust — and why the `PORT` and `VITE_API_URL` in
`.env` are ignored by `rebase dev` (they apply to `rebase start`, the production
server). Pin a port with `rebase dev --port 3001` if you need a stable one.

### Variant: your own PostgreSQL

Uncomment `DATABASE_URL` in `.env` and run `pnpm dev` again. Nothing else
changes. A `DATABASE_URL` that is already set is never touched.

With your own database you also get the migration commands, which the managed
one cannot offer — they plan changes with Atlas, which needs a second empty
database to compare against, and PGlite serves exactly one:

```bash
pnpm run db:push
```

Boot already creates missing tables and columns additively, so `db push` is for
what it deliberately leaves alone: junction-table RLS on many-to-many relations,
and any change that is not purely additive — a renamed column, a narrowed type,
a removed field.

The `docker-compose.yml` in this project runs PostgreSQL in a container if you
would rather not install one:

```bash
docker compose up -d db
```

## Project Structure

```
├── frontend/           # Your admin panel (React + Vite)
├── backend/            # Server code
│   ├── functions/      # Custom API endpoints (auto-discovered)
│   └── src/            # Generated database schema
├── config/             # Shared collection definitions
│   └── collections/    # Schema-as-Code TypeScript files
├── rebase.json         # Which apps this repository contains
├── docker-compose.yml  # Self-hosting stack (Postgres + the Rebase runtime)
├── .env.example        # Environment variable reference
└── package.json        # Root workspace config
```

There is no Dockerfile, and that is deliberate: `rebase build` produces a
**bundle** — your compiled collections, functions, crons and admin assets — and
the published `rebasepro/server` image boots it. The artifact you self-host is
the artifact Rebase Cloud runs, so moving between them changes nothing in this
repository.

If you would rather run your own server process, `rebase eject` writes the
entrypoint, a Dockerfile and a compose file that builds them.

### Custom Functions

Drop a Hono app in `backend/functions/` and it's auto-mounted at `/api/functions/<name>`:

```typescript
// backend/functions/hello.ts
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Deliberately public — anyone can call this.
    app.get("/", (c) => c.json({ status: "ok" }));

    // 401 without a valid token.
    app.post("/", requireAuth, async (c) => {
        const body = await c.req.json();
        return c.json({ message: `Hello, ${body.name}!` });
    });

    // 401 anonymous, 403 without the `admin` role. Order matters.
    app.get("/stats", requireAuth, requireAdmin, (c) => c.json({ ok: true }));
});
```

Call from the client SDK: `client.functions.invoke("hello", { name: "World" })`.
It sends POST by default — for the GET route above, pass
`{ method: "GET" }` as the third argument.

**Functions are not authenticated for you.** The functions router parses the
caller's token into the request context but does not reject anonymous requests —
webhook receivers have no token to send. So every route here is public until a
guard says otherwise, and reading `c.get("user")` is not a guard: an anonymous
caller simply gets `undefined` and the handler runs. Put `requireAuth` /
`requireAdmin` in the route's own middleware slot rather than in `app.use()`,
which only covers routes declared below it.

### Shared Collections

Collections are defined once in `config/collections/` and used by both the frontend and backend. This ensures your schema stays in sync across the stack.

## Environment Configuration

All configuration is managed through a single `.env` file in the project root. Both the backend and frontend read from this file:

- **Backend**: the runtime loads the project root's `.env` before it boots
- **Frontend**: Vite reads `VITE_*` variables via `envDir` pointing to the project root
- **Scripts**: load via `dotenv` from the project root

`init` already generated your `.env`. See the comments in `.env.example` for details on each variable, and edit `.env` directly to change any of them.

## Self-hosting

Two containers: PostgreSQL, and the Rebase runtime with your built project
mounted into it. There is no application image to build.

This is the [variant above](#variant-your-own-postgresql), packaged: the
compose database is a database of your own, so step 0 is the same one line.

```bash
# 0. Point the project at the compose database: uncomment DATABASE_URL in .env
#    (the line whose host is 127.0.0.1 and whose password matches
#    DATABASE_PASSWORD — `rebase init` wrote it there, commented out)

# 1. Build your project into ./dist-bundle
pnpm run build          # or: npm run build

# 2. Start the database. Boot creates the tables from your collections;
#    `db:push` is for what it leaves alone — junction-table RLS, and any
#    change that is not purely additive.
docker compose up -d db
pnpm run db:push        # or: npm run db:push

# 3. Start the runtime
docker compose up -d

# View logs
docker compose logs -f api

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

One container now serves the API at `/api` and the admin at `/` — same origin,
so there is no CORS between them and no second web server to run.

Sign in as `REBASE_ADMIN_EMAIL` with `REBASE_ADMIN_PASSWORD`, both in `.env`.
This stack runs with `NODE_ENV=production`, where the first-account-becomes-admin
window is shut — it has to be, because the container answers on a hostname
before you have typed anything, so whoever reached the sign-up form first would
own the deployment. The runtime creates that one account while the user table is
empty and never again. Change the email to yours before the first boot, and
change the password after signing in.

To upgrade Rebase, set `REBASE_VERSION` in `.env` and restart. Your bundle is
untouched.

> `docker compose` reads the generated `.env` as-is. Set production values
> (a strong `DATABASE_PASSWORD`, `JWT_SECRET`, storage credentials, …) by
> editing `.env` directly — see `.env.example` for the full list. Do not
> `cp .env.example .env`; that discards the values `init` generated.

## Documentation

- [Rebase Docs](https://rebase.pro/docs)
- [GitHub](https://github.com/rebasepro/rebase)
