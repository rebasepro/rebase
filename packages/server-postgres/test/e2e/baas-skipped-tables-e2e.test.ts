/**
 * E2E: a project that declares no collections, over a database whose tables
 * all have row-level security off, says which tables it skipped and why.
 *
 * Boot already logged them, with the SQL. The data API did not: `/api/data/x`
 * answered `NO_COLLECTIONS` "the database has no tables to derive them from",
 * over a database holding two — so a developer reading the response went
 * looking for tables that were there, instead of enabling RLS on them.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";

const JWT_SECRET = "baas-skipped-tables-e2e-secret-that-is-long-enough-0123";

describe("a BaaS database whose tables have RLS off (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`
            CREATE TABLE public.customers (id serial PRIMARY KEY, name text NOT NULL);
            CREATE TABLE public.orders (id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES public.customers(id), total numeric);
            INSERT INTO public.customers (name) VALUES ('Ada');
        `);

        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            // None declared: the collections are derived from the database.
            collections: [],
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            }),
            auth: { jwtSecret: JWT_SECRET }
        });
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    async function errorAt(path: string): Promise<{ status: number; code?: string; message?: string; details?: { unprotectedTables?: string[] } }> {
        const response = await app.request(path);
        const body = await response.json() as { error?: { code?: string; message?: string; details?: { unprotectedTables?: string[] } } };
        return { status: response.status, ...body.error };
    }

    it("names the skipped tables and the fix on the data API, instead of saying there are none", async () => {
        const answer = await errorAt("/api/data/customers");
        expect(answer.status).toBe(404);
        expect(answer.code).toBe("NO_COLLECTIONS");
        expect(answer.message).not.toMatch(/has no tables/);
        expect(answer.message).toContain("public.customers");
        expect(answer.message).toContain("public.orders");
        expect(answer.message).toContain("ENABLE ROW LEVEL SECURITY");
        expect(answer.details?.unprotectedTables?.sort()).toEqual(["public.customers", "public.orders"]);
    });

    it("says the same on the docs", async () => {
        const answer = await errorAt("/api/docs");
        expect(answer.status).toBe(404);
        expect(answer.code).toBe("NO_COLLECTIONS");
        expect(answer.message).toContain("public.customers");
        expect(answer.message).not.toMatch(/has no tables/);
    });
});
