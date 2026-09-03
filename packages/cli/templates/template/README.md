# {{PROJECT_NAME}}

A [Rebase](https://rebase.pro) project with a PostgreSQL backend.

## Quick Start

`rebase init` already generated a `.env` for you with a real `JWT_SECRET`, a
database password, and a free local database port. **Don't run
`cp .env.example .env`** — that would overwrite those generated values.
`.env.example` is a reference for the variables you can set, not a starting
point for this project.

### Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io) or [npm](https://www.npmjs.com) (v7+)
- [Docker](https://www.docker.com) (to run the included PostgreSQL container),
  or your own PostgreSQL database

### Run it

1. Install dependencies (skip if `init` already did this):

```bash
pnpm install   # or: npm install
```

2. Start the PostgreSQL database container:

```bash
docker compose up -d db
```

3. Create the database tables from your collections:

```bash
pnpm run db:push   # or: npm run db:push
```

4. Start the dev servers:

```bash
pnpm dev   # or: npm run dev
```

`rebase dev` prints the two URLs it actually bound and opens the admin panel
there. The first account you register becomes the admin.

Ports are **derived from this project's path**, not fixed at 3001/5173, so
several Rebase projects can run at once without colliding. That is why the URL
in your terminal is the one to trust — and why the `PORT` and `VITE_API_URL` in
`.env` are ignored by `rebase dev` (they apply to `rebase start`, the production
server). Pin a port with `rebase dev --port 3001` if you need a stable one.

> The `db:push` step is what creates the tables for the example `posts`,
> `authors`, and `tags` collections. Skip it and the admin panel still opens,
> but those collections will be empty and their API calls will fail until the
> tables exist.

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

Call from the client SDK: `client.call("functions/hello", { name: "World" })`

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

- **Backend**: loads via `dotenv` from `../../.env` (relative to `backend/src/`)
- **Frontend**: Vite reads `VITE_*` variables via `envDir` pointing to the project root
- **Scripts**: load via `dotenv` from the project root

`init` already generated your `.env`. See the comments in `.env.example` for details on each variable, and edit `.env` directly to change any of them.

## Self-hosting

Two containers: PostgreSQL, and the Rebase runtime with your built project
mounted into it. There is no application image to build.

The runtime creates its auth tables at boot but **not** your collection tables —
a container restart must not be able to change a schema as a side effect — so
push the schema once, while the database is up.

```bash
# 1. Build your project into ./dist-bundle
pnpm run build          # or: npm run build

# 2. Start the database and create the tables from your collections
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

To upgrade Rebase, set `REBASE_VERSION` in `.env` and restart. Your bundle is
untouched.

> `docker compose` reads the generated `.env` as-is. Set production values
> (a strong `DATABASE_PASSWORD`, `JWT_SECRET`, storage credentials, …) by
> editing `.env` directly — see `.env.example` for the full list. Do not
> `cp .env.example .env`; that discards the values `init` generated.

## Documentation

- [Rebase Docs](https://rebase.pro/docs)
- [GitHub](https://github.com/rebasepro/rebase)
