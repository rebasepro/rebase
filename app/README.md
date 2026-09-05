# Rebase reference application

The example this monorepo develops against: a backend, an admin panel, and the
collections both read. It is what `pnpm run dev` at the repository root starts,
and what the end-to-end suites drive.

Setting it up is part of the repository's setup — see
**[CONTRIBUTING.md](../CONTRIBUTING.md)**, which covers the clone, the install,
the database and the first run. This file describes the app itself.

## Layout

| Path | What it is |
|---|---|
| `frontend/` | The React admin panel, built with Vite |
| `backend/` | The Node server: Postgres via Drizzle, plus WebSocket realtime |
| `config/` | The collections, display config and locales both sides read |
| `rebase.json` | What the CLI reads: the two apps, and where each one's code lives |

`config/collections/` is the single definition. Adding a property there changes
the database schema, the admin panel and the generated SDK types together —
which is the point of the example.

## Running it

```bash
cp .env.example .env    # the compose credentials, ready to use
pnpm dev
```

`pnpm dev` is `rebase dev`. It starts the backend and the frontend together, and
applies the collections to the development database at boot, additively.

**It picks a free port per project rather than fixed ones**, and prints the
admin-panel and API URLs it settled on — read them from its output, they differ
between checkouts. The `PORT` and `VITE_API_URL` in `.env` apply to
`rebase start` (the production server), not to `rebase dev`.

## The scripts

Run from this directory.

| Command | What it does |
|---|---|
| `pnpm dev` | Backend and frontend, watching (`rebase dev`) |
| `pnpm build` | Builds `frontend`, `backend` and `config` |
| `pnpm start` | The production server, which also serves the built frontend |
| `pnpm run schema:generate` | Regenerate `backend/src/schema.generated.ts` from the collections |
| `pnpm run db:push` | Apply the collections to the development database (Atlas) |
| `pnpm run db:generate` | Write a SQL migration instead of pushing — the production path |
| `pnpm run db:migrate` | Run pending migrations |
| `pnpm run schema:introspect` | Read an existing database back into collection definitions |
| `pnpm run generate:sdk` | Regenerate the typed client SDK |
| `pnpm run deploy` | Deploy the demo (maintainers) |

`db:push` needs a real Postgres — it plans with Atlas, which needs a second
empty database to compare against, and the managed development database serves
exactly one. `.env.example` points at the compose database in
`backend/docker-compose.yml`, which is what the root CONTRIBUTING starts.

## Requirements

Node.js ≥ 22.22 and pnpm ≥ 11, the same floors as the repository. Postgres comes
from `backend/docker-compose.yml`; you do not need one installed.
