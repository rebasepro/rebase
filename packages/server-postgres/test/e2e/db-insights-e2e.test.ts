/**
 * Real-PostgreSQL E2E for the Studio Database view's insights routes:
 *  1. `pg_stat_statements` status: `not_installed` → installed through
 *     `/catalog/extensions` → `ok` with the top queries; `not_preloaded` on a
 *     server that does not load the library
 *  2. Activity: a running query is listed with its duration, a session waiting
 *     on a lock names its blocker, and cancel / terminate reach the backend
 *  3. The security advisors load `@rebasepro/rls-check` as the server does
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { Hono } from "hono";
import pg from "pg";
import type { SQLAdmin } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { createDbInsightsRoutes } from "../../../server/src/baas/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";

const JWT_SECRET = "db-insights-real-pg-e2e-secret-at-least-32-chars!!";

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await read();
        if (value !== undefined) return value;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Condition did not become true within ${timeoutMs}ms`);
}

interface Session {
    pid: number;
    query: string;
    state: string | null;
    durationMs: number;
    waitEventType: string | null;
    blockedBy: number[];
}

describe("Database view insights over real PostgreSQL (E2E)", () => {
    let container: PgContainer;
    let conn: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;
    let headers: Record<string, string>;

    const api = async (path: string, init?: { method?: string; body?: unknown }) => {
        const res = await app.request(`/api/admin/db${path}`, {
            method: init?.method ?? "GET",
            headers,
            ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    const sessions = async (): Promise<Session[]> => (await api("/insights/activity")).body.sessions as Session[];

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer({ args: ["-c", "shared_preload_libraries=pg_stat_statements"] });
        conn = createPostgresDatabaseConnection(container.connectionString, undefined, { max: 4 });
        backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            database: createPostgresAdapter({
                connection: conn.db,
                connectionString: container.connectionString,
                directConnectionString: container.connectionString
            }),
            auth: { allowRegistration: true, jwtSecret: JWT_SECRET }
        });
        const reg = await app.request("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "founder@rebase.pro", password: "StrongPassword123!", displayName: "Founder" })
        });
        expect(reg.status).toBe(201);
        const { tokens } = await reg.json() as { tokens: { accessToken: string } };
        headers = { "Content-Type": "application/json", Authorization: `Bearer ${tokens.accessToken}` };
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(2_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await conn?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("reports pg_stat_statements as not installed, then lists the top queries once it is", async () => {
        const before = await api("/insights/queries");
        expect(before.status).toBe(200);
        expect(before.body).toMatchObject({ status: "not_installed", available: true, queries: [] });

        const install = await api("/catalog/extensions/pg_stat_statements", { method: "POST", body: {} });
        expect(install.status).toBe(200);

        const client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        try {
            for (let i = 0; i < 5; i++) await client.query("SELECT count(*) FROM pg_class WHERE relname <> $1", [`x${i}`]);
        } finally {
            await client.end();
        }

        const after = await api("/insights/queries?sort=calls&limit=50");
        expect(after.body.status).toBe("ok");
        const queries = after.body.queries as { query: string; calls: number; totalMs: number }[];
        const ours = queries.find(q => q.query.includes("FROM pg_class WHERE relname <>"));
        expect(ours?.calls).toBeGreaterThanOrEqual(5);
        expect(typeof ours?.totalMs).toBe("number");

        const preview = await api("/insights/queries/reset", { method: "POST", body: { dryRun: true } });
        expect(preview.body).toEqual({ dryRun: true, statements: ['SELECT "public".pg_stat_statements_reset();'] });
        const reset = await api("/insights/queries/reset", { method: "POST", body: {} });
        expect(reset.status).toBe(200);
    });

    it("lists a running query with its duration and blocker, and cancels and terminates sessions", async () => {
        await conn.pool.query("CREATE TABLE IF NOT EXISTS public.locked_rows (id int PRIMARY KEY)");

        const sleeper = new pg.Client({ connectionString: container.connectionString, application_name: "e2e-sleeper" });
        const holder = new pg.Client({ connectionString: container.connectionString, application_name: "e2e-holder" });
        const waiter = new pg.Client({ connectionString: container.connectionString, application_name: "e2e-waiter" });
        await Promise.all([sleeper.connect(), holder.connect(), waiter.connect()]);
        holder.on("error", () => {});
        try {
            const sleeping = sleeper.query("SELECT pg_sleep(30)").then(() => "finished", (err: { code?: string }) => err.code);
            const running = await waitFor(async () => (await sessions()).find(s => s.query.includes("pg_sleep(30)")));
            expect(running.state).toBe("active");

            const preview = await api(`/insights/activity/${running.pid}/cancel`, { method: "POST", body: { dryRun: true } });
            expect(preview.body).toEqual({ dryRun: true, statements: [`SELECT pg_cancel_backend(${running.pid});`] });
            const cancel = await api(`/insights/activity/${running.pid}/cancel`, { method: "POST", body: {} });
            expect(cancel.body).toMatchObject({ dryRun: false, signalled: true });
            // 57014: query_canceled — the statement stopped, the session lives on.
            expect(await sleeping).toBe("57014");
            expect((await sleeper.query("SELECT 1 AS one")).rows[0].one).toBe(1);

            await holder.query("BEGIN");
            await holder.query("LOCK TABLE public.locked_rows IN ACCESS EXCLUSIVE MODE");
            const holderPid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
            const waiting = waiter.query("SELECT * FROM public.locked_rows").then(() => "read", (err: { code?: string }) => err.code);
            const blocked = await waitFor(async () => (await sessions()).find(s => s.query.includes("FROM public.locked_rows") && s.blockedBy.length > 0));
            expect(blocked.blockedBy).toEqual([holderPid]);
            expect(blocked.waitEventType).toBe("Lock");
            expect((await sessions()).find(s => s.pid === holderPid)?.state).toBe("idle in transaction");

            const terminate = await api(`/insights/activity/${holderPid}/terminate`, { method: "POST", body: {} });
            expect(terminate.body).toMatchObject({ dryRun: false, signalled: true });
            // The lock went with the session, so the waiting read completes.
            expect(await waiting).toBe("read");
        } finally {
            await Promise.all([sleeper.end(), holder.end(), waiter.end()].map(p => p.catch(() => {})));
        }
    });

    it("runs the security advisors through the bundled rls-check", async () => {
        await conn.pool.query("CREATE TABLE public.audit_open (id serial PRIMARY KEY, note text)");
        await conn.pool.query("GRANT SELECT ON public.audit_open TO rebase_user");
        const res = await api("/insights/advisors");
        expect(res.status).toBe(200);
        expect(res.body.errors).toEqual([]);
        const findings = res.body.findings as { check: string; category: string; table?: string }[];
        expect(findings.find(f => f.check === "rls-disabled" && f.table === "public.audit_open")).toMatchObject({ category: "security" });
    });

    it("reports pg_stat_statements as not preloaded on a server that does not load it", async () => {
        const plain = await startPgContainer();
        const pool = new pg.Pool({ connectionString: plain.connectionString, max: 2 });
        try {
            const admin: SQLAdmin = {
                executeSql: async (sql, options) => (await pool.query(sql, options?.params)).rows
            };
            const routes = createDbInsightsRoutes({ admin, getServedTables: () => [] });
            await pool.query("CREATE EXTENSION pg_stat_statements");
            const res = await routes.request("/queries");
            expect(await res.json()).toMatchObject({ status: "not_preloaded", queries: [] });
        } finally {
            await pool.end().catch(() => {});
            await stopPgContainer(plain.containerName);
        }
    });
});
