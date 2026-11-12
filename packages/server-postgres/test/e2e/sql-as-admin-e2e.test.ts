/**
 * E2E: `sqlAsAdmin` — one statement as the service identity, under row-level
 * security — against a real Postgres.
 *
 * A function that enforces its own rules over admin-only tables had two kinds
 * of SQL: the caller's (`getSql(c)`), which would need those tables opened to
 * the caller and with them the public data API, and the owner's
 * (`rebase.sql`), which can run DDL and read the auth schema. What must hold
 * for the third:
 *
 * - it reads and writes what the admin policies admit, as `{ uid: "service",
 *   roles: ["admin"] }`, on the request role;
 * - it cannot run DDL, read the auth schema, or change the session
 *   (`SQL_NOT_ALLOWED`), and it is read-only unless `{ write: true }`;
 * - a lone read and a lone write cost one round trip each, as the owner's do.
 *
 * Requires Docker.
 */
import { createServer } from "node:http";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";
import { defaultUsersCollection } from "@rebasepro/common";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter, createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { defineFunction, initializeRebaseBackend, rebase as serverRebase, _resetRebaseMock } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { Hono } from "hono";
import { tablesFrom, tablesFromCollections } from "../helpers/tables.js";

const tickets: CollectionConfig = {
    name: "Tickets",
    slug: "tickets",
    table: "tickets",
    securityRules: [{ name: "admin_all", operations: ["select", "insert", "update", "delete"], roles: ["admin"] }],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        device: { name: "Device", type: "string" },
        plays: { name: "Plays", type: "number" }
    }
};

// Every query a pooled client sends while a capture is open; a pipelined
// batch is one round trip (see data-plane-budget-e2e).
let trips: number | undefined;
const originalQuery = pg.Client.prototype.query;
const counted = function (this: pg.Client, ...args: Parameters<pg.Client["query"]>) {
    if (trips !== undefined) trips += 1;
    return Reflect.apply(originalQuery, this, args);
};
Object.defineProperty(pg.Client.prototype, "query", { value: counted, writable: true, configurable: true });

async function roundTrips(run: () => Promise<unknown>): Promise<number> {
    trips = 0;
    try {
        await run();
        return trips;
    } finally {
        trips = undefined;
    }
}

describe("sqlAsAdmin (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "info").mockImplementation(() => undefined));
        const conn = createPostgresDatabaseConnection(container.connectionString);
        try {
            const bootstrapper = createPostgresBootstrapper({ connectionString: container.connectionString, connection: conn.db });
            const driverResult = await bootstrapper.initializeDriver({ collections: [tickets], tables: tablesFromCollections([tickets]).tables, realtime: { subscribe: false, provision: false } });
            await bootstrapper.ensureCollectionSchema!(tablesFromCollections([tickets]).tables, driverResult);
            await bootstrapper.ensureRlsRuntime!(driverResult);
            await bootstrapper.ensureCollectionPolicies!(tablesFromCollections([tickets]).tables, driverResult);
            await bootstrapper.finalizeSecurityPosture!(driverResult);
        } finally {
            await conn.pool.end();
        }
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [tickets], tables: tablesFromCollections([tickets]).tables });
        await rebase.sql("INSERT INTO public.tickets (device, plays) VALUES ('d1', 1), ('d2', 2)");
    }, 180_000);

    afterAll(async () => {
        Object.defineProperty(pg.Client.prototype, "query", { value: originalQuery, writable: true, configurable: true });
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("reads what the admin policies admit, as the service identity on the request role", async () => {
        const [who] = await rebase.sqlAsAdmin("SELECT current_user AS role, rebase.uid() AS uid, rebase.roles() AS roles");
        expect(who.role).not.toBe((await rebase.sql("SELECT current_user AS role"))[0].role);
        expect(who).toMatchObject({ uid: "service", roles: "admin" });
        const rows = await rebase.sqlAsAdmin("SELECT device FROM public.tickets WHERE plays >= $1 ORDER BY device", { params: [1] });
        expect(rows).toEqual([{ device: "d1" }, { device: "d2" }]);
        // A signed-in user without the admin role sees none of it.
        const user = await rebase.withAuth({ uid: "u1", roles: [] });
        expect(await user.sql("SELECT device FROM public.tickets")).toEqual([]);
    });

    it("writes only with { write: true }", async () => {
        // 25006: cannot execute UPDATE in a read-only transaction.
        await expect(rebase.sqlAsAdmin("UPDATE public.tickets SET plays = plays + 1 WHERE device = $1", { params: ["d1"] }))
            .rejects.toMatchObject({ cause: { code: "25006" } });
        const updated = await rebase.sqlAsAdmin(
            "UPDATE public.tickets SET plays = plays + 1 WHERE device = $1 RETURNING plays::int AS plays", { params: ["d1"], write: true });
        expect(updated).toEqual([{ plays: 2 }]);
        expect(await rebase.sql("SELECT plays::int AS plays FROM public.tickets WHERE device = 'd1'")).toEqual([{ plays: 2 }]);
    });

    it("cannot run DDL or change the session", async () => {
        await expect(rebase.sqlAsAdmin("CREATE TABLE public.sneaky (id int)", { write: true })).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
        await expect(rebase.sqlAsAdmin("SET ROLE postgres")).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
        await expect(rebase.sqlAsAdmin("SELECT 1; SELECT 2")).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    });

    it("costs the owner's round trips for a lone read and a lone write: one each", async () => {
        const read = "SELECT device, plays FROM public.tickets WHERE device = $1";
        const write = "UPDATE public.tickets SET plays = plays + 1 WHERE device = $1 RETURNING plays";
        // Warm the pool and the per-statement caches first.
        await rebase.sqlAsAdmin(read, { params: ["d2"] });
        await rebase.sqlAsAdmin(write, { params: ["d2"], write: true });
        await rebase.sql(read, { params: ["d2"] });

        const owner = { read: await roundTrips(() => rebase.sql(read, { params: ["d2"] })), write: await roundTrips(() => rebase.sql(write, { params: ["d2"] })) };
        const asAdmin = {
            read: await roundTrips(() => rebase.sqlAsAdmin(read, { params: ["d2"] })),
            write: await roundTrips(() => rebase.sqlAsAdmin(write, { params: ["d2"], write: true }))
        };
        expect(owner).toEqual({ read: 1, write: 1 });
        expect(asAdmin).toEqual(owner);
    });
});

describe("rebase.sqlAsAdmin in a function, on a backend with auth (E2E)", () => {
    let container: PgContainer;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const SERVICE_KEY = "sql-as-admin-e2e-service-key-0123456789abcdef";

    beforeAll(async () => {
        container = await startPgContainer();
        connection = createPostgresDatabaseConnection(container.connectionString);
        const probe = defineFunction((fn) => {
            fn.get("/", async (c) => {
                const sql = c.req.query("sql") ?? "";
                try {
                    return c.json({ rows: await serverRebase.sqlAsAdmin(sql) });
                } catch (error) {
                    const cause = (error as { cause?: { code?: string } }).cause;
                    return c.json({ code: (error as { code?: string }).code ?? cause?.code ?? "unknown" });
                }
            });
        });
        backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            ...tablesFrom([tickets]),
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: "sql-as-admin-e2e-secret-that-is-long-enough-0123", serviceKey: SERVICE_KEY },
            functions: { probe },
            cronPersistence: false
        });
        const repo = backend.auth?.authRepository as { createUser(data: { email: string; passwordHash: string }): Promise<unknown> } | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        await repo.createUser({ email: "someone@sql-as-admin.test", passwordHash: "x" });
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        await connection?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    const run = async (sql: string) => (await app.request(`/api/functions/probe?sql=${encodeURIComponent(sql)}`)).json();

    it("runs as the service identity, and nobody's SQL reads the auth store", async () => {
        expect(await run("SELECT rebase.uid() AS uid, rebase.roles() AS roles")).toEqual({ rows: [{ uid: "service", roles: "admin" }] });
        expect(await run("SELECT count(*)::int AS n FROM public.tickets")).toEqual({ rows: [{ n: 0 }] });
        // The auth store is not the service identity's to read.
        const opened = await openRebase({ databaseUrl: container.connectionString, collections: [tickets], tables: tablesFromCollections([tickets]).tables });
        const plain = await opened.withAuth({ uid: "00000000-0000-4000-8000-000000000001", roles: [] });
        const anon = await opened.withAuth({ uid: "anon", roles: ["anonymous"] });
        const seen = { plain: await plain.sql("SELECT email, password_hash FROM rebase.users").catch((e: { cause?: { code?: string } }) => e.cause?.code),
            anon: await anon.sql("SELECT email, password_hash FROM rebase.users").catch((e: { cause?: { code?: string } }) => e.cause?.code) };
        await opened.close();
        // 42501: permission denied. With no users collection to apply its
        // admin-only policies, the auth user table is withheld from the
        // request role: SQL run as anyone (the caller, or the service) cannot
        // read the addresses and password hashes.
        expect(seen).toEqual({ plain: "42501", anon: "42501" });
        expect(await run("SELECT email, password_hash FROM rebase.users")).toEqual({ code: "42501" });
        expect(await run("RESET ROLE")).toEqual({ code: "SQL_NOT_ALLOWED" });
    });
});

describe("the users collection, registered, keeps its grant and its policies (E2E)", () => {
    let container: PgContainer;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();

    beforeAll(async () => {
        container = await startPgContainer();
        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            ...tablesFrom([tickets, defaultUsersCollection]),
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: "sql-as-admin-e2e-secret-that-is-long-enough-0123", serviceKey: "sql-as-admin-e2e-service-key-0123456789abcdef" },
            cronPersistence: false
        });
        const repo = backend.auth?.authRepository as { createUser(data: { email: string; passwordHash: string }): Promise<unknown> } | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        await repo.createUser({ email: "someone@sql-as-admin.test", passwordHash: "x" });
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        await connection?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("leaves rebase.users granted under RLS: admins read it, others do not, and no hash comes out", async () => {
        const opened = await openRebase({ databaseUrl: container.connectionString, collections: [tickets, defaultUsersCollection], tables: tablesFromCollections([tickets, defaultUsersCollection]).tables });
        try {
            const [table] = await opened.sql(
                "SELECT c.relrowsecurity AS rls, has_table_privilege('rebase_user', c.oid, 'SELECT') AS granted FROM pg_class c WHERE c.oid = 'rebase.users'::regclass"
            );
            expect(table).toEqual({ rls: true, granted: true });
            const rows = await opened.sqlAsAdmin("SELECT * FROM rebase.users");
            expect(rows.map(row => row.email)).toEqual(["someone@sql-as-admin.test"]);
            expect(rows[0]).not.toHaveProperty("password_hash");
            const plain = await opened.withAuth({ uid: "00000000-0000-4000-8000-000000000001", roles: [] });
            expect(await plain.sql("SELECT email FROM rebase.users")).toEqual([]);
        } finally {
            await opened.close();
        }
    });
});
