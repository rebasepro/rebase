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

Open **http://localhost:5173** — the admin panel. The first account you
register becomes the admin. The backend API (Hono + PostgreSQL) runs on
port 3001; the frontend (Vite + React) on port 5173.

> The `db:push` step is what creates the tables for the example `posts`,
> `authors`, and `tags` collections. Skip it and the admin panel still opens,
> but those collections will be empty and their API calls will fail until the
> tables exist.

## Project Structure

```
├── frontend/           # React frontend (Vite)
│   ├── Dockerfile      # Production build → nginx
│   └── nginx.conf      # SPA routing + compression
├── backend/            # Hono backend with PostgreSQL
│   ├── Dockerfile      # Multi-stage production build
│   ├── functions/      # Custom API endpoints (auto-discovered)
│   └── src/
├── config/             # Shared collection definitions
│   └── collections/    # Schema-as-Code TypeScript files
├── docker-compose.yml  # Production stack (Postgres + Backend + Frontend)
├── .env.example        # Environment variable reference
└── package.json        # Root workspace config
```

### Custom Functions

Drop a Hono app in `backend/functions/` and it's auto-mounted at `/api/functions/<name>`:

```typescript
// backend/functions/hello.ts
import { Hono } from "hono";
const app = new Hono();
app.post("/", async (c) => {
    const body = await c.req.json();
    return c.json({ message: `Hello, ${body.name}!` });
});
export default app;
```

Call from the client SDK: `client.call("functions/hello", { name: "World" })`

### Shared Collections

Collections are defined once in `config/collections/` and used by both the frontend and backend. This ensures your schema stays in sync across the stack.

## Environment Configuration

All configuration is managed through a single `.env` file in the project root. Both the backend and frontend read from this file:

- **Backend**: loads via `dotenv` from `../../.env` (relative to `backend/src/`)
- **Frontend**: Vite reads `VITE_*` variables via `envDir` pointing to the project root
- **Scripts**: load via `dotenv` from the project root

`init` already generated your `.env`. See the comments in `.env.example` for details on each variable, and edit `.env` directly to change any of them.

## Production Deployment

The full stack — PostgreSQL, backend, and frontend — runs from
`docker compose`. The backend image builds and boots, but it does **not**
create your collection tables on its own, so push the schema once the
database is up before (or right after) starting the rest of the stack.

```bash
# 1. Start the database and create the tables from your collections
docker compose up -d db
pnpm run db:push        # or: npm run db:push

# 2. Build and start the backend + frontend
docker compose up -d --build

# View logs
docker compose logs -f backend

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

> `docker compose` reads the generated `.env` as-is. Set production values
> (a strong `DATABASE_PASSWORD`, `JWT_SECRET`, storage credentials, …) by
> editing `.env` directly — see `.env.example` for the full list. Do not
> `cp .env.example .env`; that discards the values `init` generated.

## Documentation

- [Rebase Docs](https://rebase.pro/docs)
- [GitHub](https://github.com/rebasepro/rebase)
