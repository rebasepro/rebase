# {{PROJECT_NAME}}

A [Rebase](https://rebase.pro) project with a PostgreSQL backend.

## Quick Start

### Option 1: Docker (recommended for production)

```bash
cp .env.template .env
# Edit .env — set POSTGRES_PASSWORD and JWT_SECRET (see comments for generators)

docker compose up -d
```

That's it. Your app is running:
- **Frontend**: http://localhost (port 80)
- **Backend API**: http://localhost:3001
- **PostgreSQL**: localhost:5432

### Option 2: Local Development

#### Prerequisites

- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io)
- A PostgreSQL database

#### Setup

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment:

```bash
cp .env.template .env
# Edit .env — set DATABASE_URL, JWT_SECRET
```

3. Generate schema and push to database:

```bash
rebase schema generate
rebase db push
```

4. Start the dev server:

```bash
pnpm dev
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
├── .env.template       # Environment variable template
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
