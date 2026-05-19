---
title: Custom Server Integration
sidebar_label: Custom Server (Express)
description: How to embed Rebase Database and Realtime services into your own custom Node.js backend without using Hono or the Rebase coordinator.
---

# Custom Server Integration

Rebase was built to be completely modular. While the `initializeRebaseBackend` coordinator provides a full batteries-included backend using Hono, you can completely bypass it and embed the core **Database Adapter** and **Realtime WebSockets** directly into your own custom Node.js application (like Express, Fastify, or plain Node.js HTTP).

The `@rebasepro/server-postgresql` package is completely framework-agnostic. It depends only on Drizzle ORM and standard Node.js `http.Server`.

## Environment Configuration

Rebase provides a centralized `loadEnv()` utility in `@rebasepro/server-core` that validates your environment variables against a strict Zod schema. Call it **after** loading your `.env` file:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server-core";

dotenv.config({ path: "../../.env" });

// Basic — just Rebase env vars:
export const env = loadEnv();

// Extended — add your own typed vars:
import { z } from "zod";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string        (validated, required)
```

**Key behaviors:**
- Auto-generates ephemeral `JWT_SECRET` and `REBASE_SERVICE_KEY` in development so you can start without manual setup.
- Blocks auto-generated secrets in production — you must set them explicitly.
- Validates that `CORS_ORIGINS` or `FRONTEND_URL` is set in production.

See `.env.example` in the scaffolded app for the full list of supported variables.

## Using Rebase with Express

Here is a complete example of how to initialize the Rebase PostgreSQL adapter and Realtime WebSockets inside a standard Express application.

### 1. Install Dependencies

You'll need the Postgres server package along with Express:

```bash
npm install @rebasepro/server-postgresql @rebasepro/types express
```

### 2. Initialization Example

```typescript
import express from 'express';
import { createServer } from 'http';
import { createPostgresBootstrapper } from '@rebasepro/server-postgresql';

async function startServer() {
    const app = express();
    
    // 1. You MUST create the raw Node HTTP server so the WebSocket server can bind to it
    const server = createServer(app);

    // 2. Initialize the Postgres Bootstrapper directly
    const bootstrapper = createPostgresBootstrapper({
        connectionString: process.env.DATABASE_URL,
        // Optional: define any Drizzle schema here if you want typed relations/queries
        // schema: { tables: { ... } } 
    });

    // 3. Initialize the driver (connects to DB, starts logical replication listeners)
    const { driver, realtimeProvider } = await bootstrapper.initializeDriver({
        collections: [] // Pass your Rebase collections here if you're using them
    });

    // 4. Attach the Rebase WebSockets to your HTTP Server
    await bootstrapper.initializeWebsockets(
        server, 
        realtimeProvider, 
        driver
    );

    // --- Express Routes ---
    app.use(express.json());

    app.get('/', (req, res) => {
        res.send('Express server running with embedded Rebase!');
    });

    // You can interact directly with the Rebase driver anywhere in your Express routes
    app.post('/custom-data', async (req, res) => {
        try {
            // Use the raw Rebase Database Driver
            const result = await driver.saveEntity({
                collection: 'products',
                entity: req.body
            });
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 5. Start listening using the raw server instance (NOT app.listen)
    server.listen(3000, () => {
        console.log('Express and Rebase Realtime running on port 3000');
    });
}

startServer();
```

## Key Concepts

### Native HTTP Server
Because WebSockets require an HTTP `Upgrade` request, you **must** bind Rebase to the native Node.js `http.Server` instance. If you just call `app.listen(3000)` in Express, you won't have access to the underlying server object needed by `initializeWebsockets()`.

### Bypassing Hono
By directly invoking `createPostgresBootstrapper()` and manually calling `initializeDriver()` and `initializeWebsockets()`, you are bypassing the Rebase coordinator (`initializeRebaseBackend`) entirely. This means no Hono dependencies are loaded, and the auto-generated REST APIs, Admin UI routes, and Auth endpoints are not mounted. 

This gives you total control over your API surface while still leveraging Rebase's powerful logical-replication WebSocket engine and Drizzle-powered driver.
