/**
 * A BaaS backend, exactly as the docs describe it: point Rebase at a database
 * and it serves an API.
 *
 * No `as never` casts anywhere — the point is that the published types accept
 * this shape honestly. (`tooling/scripts/smoke-baas.ts` casts its config; that hides
 * exactly the kind of drift this fixture exists to catch.)
 */
import { Hono } from "hono";
import { createServer } from "node:http";

import { initializeRebaseBackend, type HonoEnv } from "@rebasepro/server";
import { createPostgresAdapter, createPostgresDatabaseConnection } from "@rebasepro/server-postgres";

const app = new Hono<HonoEnv>();
const server = createServer();

const { db } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

export async function start(): Promise<void> {
    await initializeRebaseBackend({
        server,
        app,
        database: createPostgresAdapter({
            connection: db,
            connectionString: process.env.DATABASE_URL!
        }),
        auth: {
            jwtSecret: process.env.JWT_SECRET!,
            serviceKey: process.env.SERVICE_KEY!
        }
    });

    server.listen(3001);
}
