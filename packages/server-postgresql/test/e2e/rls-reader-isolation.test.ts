/**
 * E2E: read isolation enforces multi-tenant RLS against a real Postgres.
 *
 * Rebase gates reads with RLS and writes with app-layer callbacks. A
 * privileged connection (superuser / BYPASSRLS / table owner) bypasses RLS,
 * so at boot the framework detects that posture, provisions the restricted
 * `rebase_reader` role, and downgrades every authenticated read to it via
 * `SET LOCAL ROLE` — exactly the flow exercised here with the REAL modules:
 * `detectConnectionPosture` → `ensureReaderRole` → driver/realtime enforcement.
 *
 * Proves:
 *   1. Posture detection flags a superuser connection as privileged.
 *   2. Baseline bug: without isolation, cross-tenant rows leak.
 *   3. With isolation: driver reads see only the caller's rows.
 *   4. The realtime refetch path (previously missed surface) is isolated too.
 *   5. Writes still succeed (they never switch role).
 *   6. Default privileges self-heal: tables created AFTER provisioning are
 *      readable by the reader without re-granting.
 *   7. Fail closed: a broken reader role aborts reads instead of leaking.
 *
 * Requires Docker. Spins up a throwaway Postgres container.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import {
    detectConnectionPosture,
    ensureReaderRole,
    REBASE_READER_ROLE,
    type RawSqlRunner
} from "../../src/security/read-isolation.js";

// A collection with a per-owner `select` rule — the common multi-tenant shape.
const tasksCollection: CollectionConfig = {
    name: "Tasks",
    slug: "tasks",
    table: "tasks",
    properties: {
        id: { name: "ID", type: "string", isId: true, validation: { required: true } },
        title: { name: "Title", type: "string" },
        owner_id: { name: "Owner", type: "string" }
    }
} as unknown as CollectionConfig;

const tasksTable = pgTable("tasks", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    owner_id: varchar("owner_id")
});

function buildRegistry(): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([tasksCollection]);
    registry.registerTable(tasksTable, "tasks");
    return registry;
}

describe("Read isolation (E2E)", () => {
    let container: PgContainer;
    let adminClient: pg.Client;   // superuser: setup + raw assertions
    let pool: pg.Pool;            // the app's connection (superuser, worst case)
    let driver: PostgresBackendDriver;
    let realtime: RealtimeService;
    let runSql: RawSqlRunner;

    /** Count rows visible to `uid` through the real authenticated driver path. */
    async function countAs(uid: string): Promise<number> {
        const authed = await driver.withAuth({ uid, roles: [] } as never);
        return authed.count({ path: "tasks", collection: tasksCollection } as never);
    }

    /** Rows visible to `uid` through the realtime refetch path. */
    async function realtimeFetchAs(uid: string): Promise<unknown[]> {
        return (realtime as unknown as {
            fetchCollectionWithAuth(path: string, req: Record<string, unknown>, auth?: { userId: string; roles: string[] }): Promise<unknown[]>;
        }).fetchCollectionWithAuth("tasks", {}, { userId: uid, roles: [] });
    }

    beforeAll(async () => {
        container = await startPgContainer();

        // Retry connect while the container settles (fresh Client per attempt).
        for (let i = 0; ; i++) {
            try {
                adminClient = new pg.Client({ connectionString: container.connectionString });
                await adminClient.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // ── auth schema + helper functions (mirrors src/cli.ts) ──
        await adminClient.query(`
            CREATE SCHEMA IF NOT EXISTS auth;
            CREATE SCHEMA IF NOT EXISTS rebase;
            CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$
                SELECT NULLIF(current_setting('app.user_id', true), '');
            $$ LANGUAGE sql STABLE;
            CREATE OR REPLACE FUNCTION auth.roles() RETURNS text AS $$
                SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
            $$ LANGUAGE sql STABLE;
        `);

        // ── table + per-owner select policy (ENABLE, non-auth collection) ──
        await adminClient.query(`
            CREATE TABLE public.tasks (
                id       VARCHAR(255) PRIMARY KEY,
                title    VARCHAR(255),
                owner_id VARCHAR(255)
            );
            ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tasks_select ON public.tasks
                AS PERMISSIVE FOR SELECT TO public
                USING (owner_id = auth.uid());
            INSERT INTO public.tasks (id, title, owner_id) VALUES
                ('t-a', 'A task', 'user-a'),
                ('t-b', 'B task', 'user-b');
        `);

        // The app pool connects as the container superuser — the worst-case
        // posture the isolation must contain.
        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = buildRegistry();
        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        runSql = async (text) => {
            const res = await pool.query(text);
            return res.rows as Record<string, unknown>[];
        };
    }, 120_000);

    afterAll(async () => {
        if (pool) await pool.end().catch(() => {});
        if (adminClient) await adminClient.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("detects a superuser connection as privileged", async () => {
        const posture = await detectConnectionPosture(runSql);
        expect(posture.superuser).toBe(true);
        expect(posture.privileged).toBe(true);
    });

    it("leaks cross-tenant rows while isolation is not active (the baseline bug)", async () => {
        // No readIsolationRole set yet — superuser bypasses RLS everywhere.
        expect(await countAs("user-b")).toBe(2);
        expect((await realtimeFetchAs("user-b")).length).toBe(2);
    });

    it("provisions the reader role and isolates driver reads per owner", async () => {
        // Exactly what the bootstrapper does at boot.
        await ensureReaderRole(runSql, ["public", "rebase", "auth"]);
        driver.readIsolationRole = REBASE_READER_ROLE;
        realtime.readIsolationRole = REBASE_READER_ROLE;

        expect(await countAs("user-a")).toBe(1);
        expect(await countAs("user-b")).toBe(1);

        // Data intact — isolation is a read-time view, not deletion.
        const total = await adminClient.query("SELECT count(*)::int AS c FROM public.tasks");
        expect(total.rows[0].c).toBe(2);
    });

    it("isolates the realtime refetch path (the previously-missed surface)", async () => {
        const rowsA = await realtimeFetchAs("user-a") as Array<{ id: string }>;
        expect(rowsA.length).toBe(1);
        expect(rowsA[0].id).toBe("t-a");

        const rowsB = await realtimeFetchAs("user-b") as Array<{ id: string }>;
        expect(rowsB.length).toBe(1);
        expect(rowsB[0].id).toBe("t-b");
    });

    it("still allows writes (writes never switch role)", async () => {
        const authed = await driver.withAuth({ uid: "user-a", roles: [] } as never);
        await authed.save({
            path: "tasks",
            collection: tasksCollection,
            values: { id: "t-a2", title: "A second task", owner_id: "user-a" }
        } as never);

        const raw = await adminClient.query("SELECT owner_id FROM public.tasks WHERE id = 't-a2'");
        expect(raw.rows.length).toBe(1);

        // Owner sees the new row through the isolated read path; the other
        // tenant remains isolated from it.
        expect(await countAs("user-a")).toBe(2);
        expect(await countAs("user-b")).toBe(1);
    });

    it("covers tables created after provisioning via default privileges (self-healing grants)", async () => {
        // Simulates a later migration adding a table — run by the same
        // connection role, as migrations are.
        await pool.query(`
            CREATE TABLE public.notes (id VARCHAR(255) PRIMARY KEY, owner_id VARCHAR(255));
            ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
            CREATE POLICY notes_select ON public.notes
                AS PERMISSIVE FOR SELECT TO public USING (owner_id = auth.uid());
            INSERT INTO public.notes (id, owner_id) VALUES ('n-a', 'user-a');
        `);

        // No re-grant, no re-provision: the reader must already have SELECT.
        const rows = await pool.query(`
            BEGIN;
            SELECT set_config('app.user_id', 'user-a', true);
            SET LOCAL ROLE ${REBASE_READER_ROLE};
            SELECT * FROM public.notes;
        `);
        // node-postgres returns an array of results for multi-statement queries
        const selectResult = (rows as unknown as pg.QueryResult[])[3] ?? rows;
        expect(selectResult.rows.length).toBe(1);
        await pool.query("COMMIT");
    });

    it("is idempotent across repeated provisioning (boot + migrate both run it)", async () => {
        await ensureReaderRole(runSql, ["public", "rebase", "auth"]);
        await ensureReaderRole(runSql, ["public", "rebase", "auth"]);
        expect(await countAs("user-a")).toBe(2);
    });

    it("fails closed when the reader role is broken", async () => {
        driver.readIsolationRole = "role_that_does_not_exist";
        await expect(countAs("user-a")).rejects.toBeTruthy();
        driver.readIsolationRole = REBASE_READER_ROLE;
    });
});
