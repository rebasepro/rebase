---
name: rebase-local-env-setup
description: Bare minimum INITIAL setup for getting started with Rebase (Node.js, pnpm, PostgreSQL, Docker). Use ONLY for first-time setup. For updating or troubleshooting an existing environment, use the rebase-basics skill instead.
---

# Rebase Local Environment Setup

This skill documents the bare minimum setup required for a full Rebase development experience. Before starting to use any Rebase features, you MUST verify that each of the following steps has been completed.

> **IMPORTANT FOR AGENTS:** This skill is for INITIAL setup only. For day-to-day development, CLI commands, schema workflow, and troubleshooting, use the `rebase-basics` skill instead.

## Monorepo Structure

Rebase is a **pnpm monorepo**. Understanding the layout is essential before setup:

```
rebase/
├── app/                        # The main application
│   ├── .env.example            # Full env var reference — copy to .env
│   ├── .env                    # Your local env config (git-ignored)
│   ├── backend/                # Hono API server (runs on port 3001)
│   ├── frontend/               # Vite + React UI (runs on port 5173)
│   ├── config/
│   │   └── collections/        # Collection definitions (schema-as-code)
│   └── generated/              # Auto-generated SDK, Drizzle schema, etc.
├── packages/                   # Shared libraries (workspace packages)
│   ├── cli/                    # @rebasepro/cli — provides the `rebase` binary
│   ├── server/                 # Core server framework, env loading
│   ├── server-postgres/        # PostgreSQL adapter (Drizzle ORM)
│   ├── studio/                 # Studio admin panel
│   ├── ui/                     # @rebasepro/ui component library
│   ├── client/                 # Client SDK
│   └── ...                     # Other packages (auth, types, utils, etc.)
├── pnpm-workspace.yaml         # Workspace configuration
└── package.json                # Root package.json
```

## 1. Verify Node.js

- **Action**: Run `node --version`.
- **Required**: Node.js **22 LTS** (the version used in the production Dockerfile). Node >= 20 works but 22 is recommended.
- **Handling**: If Node.js is missing or < v22:

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

## 3. Verify PostgreSQL

Rebase's backend requires a PostgreSQL database (v14+).

### Option A: Docker (Recommended)

> **IMPORTANT FOR AGENTS:** Docker requires **Docker Desktop** (macOS/Windows) or an alternative like **colima** (macOS). If `docker info` fails, guide the user to install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or run `brew install colima && colima start`.

```bash
# Check if Docker is running
docker info

# Start a PostgreSQL container
docker run --name rebase-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rebase \
  -p 5432:5432 \
  -d postgres:17
```

### Option B: Local Installation

- **macOS**: `brew install postgresql@17 && brew services start postgresql@17`
  - If 17 is unavailable: `brew install postgresql@16 && brew services start postgresql@16`
- **Linux**: `sudo apt-get install postgresql` (installs the distro default, typically 14–16)
- **Windows**: Download from [postgresql.org](https://www.postgresql.org/download/)

### Verify Connection

```bash
psql -h localhost -U postgres -d rebase -c "SELECT 1;"
```

## 4. Configure Environment Variables

Rebase ships an `.env.example` in the `app/` directory with every variable documented. The recommended approach:

```bash
cp app/.env.example app/.env
```

Then edit `app/.env` with your local values. The **minimum** required variables for local dev:

| Variable | Example Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/rebase` | **Required.** Must be a valid URL. |
| `JWT_SECRET` | *(any string ≥ 32 characters)* | If left blank, an ephemeral secret is auto-generated in dev mode — **sessions are invalidated on every server restart**. Set an explicit value for persistent sessions. |
| `VITE_API_URL` | `http://localhost:3001` | Must match the backend URL. The backend defaults to port `3001`. |
| `PORT` | `3001` | Backend listen port (default: `3001`). |
| `FRONTEND_URL` | `http://localhost:5173` | Used in password-reset / verification emails. |

> **WARNING FOR AGENTS:** `JWT_SECRET` must be ≥ 32 characters (enforced by Zod validation in `packages/server/src/env.ts`). In dev mode, if `JWT_SECRET` is empty the server auto-generates a random one — but this means **all user sessions are lost on every restart**. Always recommend setting an explicit value:
> ```env
> JWT_SECRET=change-me-to-a-random-string-at-least-32-chars-long!!
> ```

A minimal `.env` looks like:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rebase
JWT_SECRET=change-me-to-a-random-string-at-least-32-chars-long!!
VITE_API_URL=http://localhost:3001
```

## 5. Install Dependencies

From the monorepo root:

```bash
pnpm install
```

This installs all workspace packages (`packages/*`, `app/frontend`, `app/backend`).

## 6. The `rebase` CLI

The `rebase` command comes from the `@rebasepro/cli` package (`packages/cli`). After `pnpm install`, it is available via the workspace `node_modules/.bin/rebase` binary.

Run CLI commands from the **`app/`** directory (or monorepo root if configured):

```bash
# From the app/ directory:
rebase schema generate   # Generate Drizzle schema from collection definitions
rebase db push           # Push schema directly to the database (dev workflow)
rebase dev               # Start the dev server (frontend + backend)
rebase --help            # Show all available commands
```

## 7. Initialize the Database

```bash
rebase schema generate
rebase db push
```

## 8. Start the Development Server

```bash
pnpm run dev
```

This starts both:
- **Frontend** (Vite) at `http://localhost:5173`
- **Backend** (Hono) at `http://localhost:3001`

The frontend proxies API requests to the backend via `VITE_API_URL`.

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **Env reference:** `app/.env.example` (69 vars with inline documentation)
- **Env validation:** `packages/server/src/env.ts` (Zod schema + auto-generated secrets logic)
- **CLI source:** `packages/cli/src/cli.ts` (all commands and help text)
