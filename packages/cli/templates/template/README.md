# {{PROJECT_NAME}}

A [Rebase](https://rebase.pro) project with a PostgreSQL backend.

## Quick Start

### Option 1: Docker (recommended for production)

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET and DATABASE_URL (see comments for generators)

docker compose up -d
```

That's it. Your app is running:
- **Frontend**: http://localhost (port 80)
- **Backend API**: http://localhost:3001
- **PostgreSQL**: localhost:5432

### Option 2: Local Development

#### Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io) or [npm](https://www.npmjs.com) (v7+)
- A PostgreSQL database (you can start the included database container via `docker compose up -d db`)

#### Setup

1. Install dependencies:

```bash
pnpm install   # or: npm install
```

2. Configure environment:

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET
```

3. Generate schema and push to database:

```bash
pnpm run schema:generate   # or: npm run schema:generate
pnpm run db:push            # or: npm run db:push
```

4. Start the dev server:

```bash
pnpm dev   # or: npm run dev
```

Backend (Hono + PostgreSQL) on port 3001, frontend (Vite + React) on port 5173.

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

Copy `.env.example` to `.env` to get started. See the comments in `.env.example` for details on each variable.

## Production Deployment

```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f backend

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

## Documentation

- [Rebase Docs](https://rebase.pro/docs)
- [GitHub](https://github.com/rebasepro/rebase)
