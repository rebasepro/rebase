---
name: rebase-local-env-setup
description: Bare minimum INITIAL setup for getting started with Rebase — Node.js and pnpm, and nothing else. Use ONLY for first-time setup. For updating or troubleshooting an existing environment, use the rebase-basics skill instead.
---

# Rebase Local Environment Setup

Everything a Rebase project needs to run is **Node.js and pnpm**. There is no
database to install, no Docker to start and no connection string to write:
`rebase dev` starts a managed PostgreSQL for the project when `DATABASE_URL` is
unset, which is how `rebase init` leaves it.

> **IMPORTANT FOR AGENTS:** This skill is for INITIAL setup only. For day-to-day
> development, CLI commands, the schema workflow and troubleshooting, use the
> `rebase-basics` skill instead.

> **IMPORTANT FOR AGENTS:** Do not install PostgreSQL, start a Docker container
> or write a `DATABASE_URL` "to get started". Every one of those is a step the
> managed database exists to remove, and a `DATABASE_URL` you set is never
> overridden — so writing one is how a project ends up pointed at a database
> nobody meant to use.

## What a scaffolded project looks like

`rebase init <name>` writes a pnpm workspace. There is no monorepo to clone and
no `app/` directory:

```
<project-root>/
├── frontend/             # React admin panel (Vite)
├── backend/
│   ├── functions/        # Custom backend functions, one file per function
│   └── crons/            # Scheduled jobs, one file per job
├── config/               # Collections and storageAuthorize, shared by both
│   └── collections/
├── scripts/              # Standalone SDK scripts
├── .rebase/              # Dev-server state and the managed database's data
├── rebase.json           # Which apps this project deploys, and how
├── .env                  # Written by `rebase init`; DATABASE_URL commented out
├── .env.example          # Every variable, documented inline
├── docker-compose.yml    # Optional PostgreSQL container — not needed by default
├── pnpm-workspace.yaml
└── package.json
```

## 1. Verify Node.js

- **Action**: Run `node --version`.
- **Required**: Node.js **>= 22.22.0** — what a scaffolded project's `engines` declares and
  what `.nvmrc` pins. Not a recommendation: an older runtime fails at install.
- **Handling**: If Node.js is missing or below that:

  **Recommended: Use a Node Version Manager**

  **For macOS or Linux:**
  1. Guide the user to the [official nvm repository](https://github.com/nvm-sh/nvm#installing-and-updating).
  2. Request the user to manually install `nvm` and reply when finished. **Stop and wait** for the user's confirmation.
  3. Make `nvm` available in the current terminal session:
     ```bash
     source ~/.zshrc   # For Zsh
     source ~/.bashrc  # For Bash
     ```
  4. Install Node.js:
     ```bash
     nvm install 22
     nvm use 22
     ```

  **For Windows:**
  1. Guide the user to download and install [nvm-windows](https://github.com/coreybutler/nvm-windows/releases).
  2. Request the user to manually install and reply when finished.

## 2. Verify pnpm

Rebase uses pnpm exclusively as its package manager. Never use npm or yarn.

- **Action**: Run `pnpm --version`.
- **Handling**: If pnpm is not installed:
  ```bash
  npm install -g pnpm
  ```
- **Verify**: Run `pnpm --version` again to confirm.

## 3. The database — there is nothing to do

With `DATABASE_URL` unset, `rebase dev` starts a **managed PostgreSQL (PGlite)**
for this project, with its data under `.rebase/`. It then generates the Drizzle
schema from the project's collections and creates the missing tables at boot.
The first run needs no schema command.

**Do not run `rebase db push` on it.** `db push` plans changes with
[Atlas](https://atlasgo.io/), which needs a second empty database to compare
against, and the managed one serves exactly one — the command refuses, by
design. Boot's additive apply is the development loop; see `rebase-basics` for
what it deliberately leaves alone.

`rebase db url` prints whichever database is in use, managed or not.

### Only if the user asks for their own PostgreSQL

Uncomment `DATABASE_URL` in `.env` and point it at a database you run:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

A `DATABASE_URL` that is set always wins, and one pointing anywhere other than
this machine is left alone entirely. With your own database you also get the
migration commands the managed one cannot offer (`rebase db push`,
`rebase db generate && rebase db migrate`).

The scaffold ships a `docker-compose.yml` if a container is what the user wants:

```bash
docker compose up -d db
```

> The compose service uses `pgvector/pgvector`, not stock `postgres`. It is the
> Postgres image with the `vector` extension built in, and a
> `{ type: "vector" }` property compiles to `VECTOR(n)`, which stock Postgres
> answers with `type "vector" does not exist` — a boot failure whose cause is an
> image.

`rebase dev --docker` uses that container instead of the managed database;
`rebase dev --no-db` starts neither and expects you to set `DATABASE_URL`.

## 4. Environment variables

`rebase init` already wrote `.env` from `.env.example`, with `DATABASE_URL`
commented out. Nothing else is required for a first run — `JWT_SECRET` and the
ports have working development defaults.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | **Leave it unset** for the managed database. Set it and yours wins, always. |
| `JWT_SECRET` | Must be ≥ 32 characters. Left empty, dev mode auto-generates an ephemeral one — **every session is invalidated on each restart**. Set an explicit value for persistent sessions. |
| `PORT` / `VITE_API_URL` | Configure `rebase start`, the production server. `rebase dev` derives its ports from the project path and ignores them. |
| `FRONTEND_URL` | Used in password-reset and verification emails. |

> **WARNING FOR AGENTS:** `rebase dev` binds ports **derived from the project's
> path**, not 3001/5173, so several Rebase projects can run side by side. Use the
> two URLs `rebase dev` prints. Pin one with `rebase dev --port 3001`.

## 5. Install dependencies

From the project root:

```bash
pnpm install
```

That installs the workspace: `frontend`, `backend` and `config`.

## 6. Start the development server

```bash
pnpm run dev
```

This is `rebase dev`. It starts the managed database (if `DATABASE_URL` is
unset), applies the schema, and runs both halves with hot reload:

- **Backend** — REST API, auth, storage, WebSocket
- **Frontend** — the Rebase admin panel

The project's other scripts are `pnpm run build`, `pnpm run start`,
`pnpm run schema:generate`, `pnpm run db:push`, `pnpm run db:generate`,
`pnpm run db:migrate`, `pnpm run generate:sdk`, `pnpm run skills:install` and
`pnpm run example`.

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **Env reference:** the project's own `.env.example`, written by `rebase init`
- **CLI reference:** `rebase --help`, and the tables in the `rebase-basics` skill
