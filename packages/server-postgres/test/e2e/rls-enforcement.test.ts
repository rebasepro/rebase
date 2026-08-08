/**
 * E2E: unified RLS enforcement against a real Postgres.
 *
 * Model: authenticated (user-context) requests run as the restricted
 * `rebase_user` role, so RLS binds EVERY statement — reads and writes. The
 * server context (owner connection / auth flows / `rebase.sql`) bypasses. A
 * collection's securityRules are the whole authorization model.
 *
 * `rebase.dataAsAdmin` is NOT in that list, though this header used to say it
 * was: `init.ts` scopes it with `withAuth({ uid: "service", roles: ["admin"] })`,
 * so it is user context with the admin role, not the owner connection. Nothing
 * here exercises it — the object only exists after `initializeRebaseBackend`.
 * `packages/server/test/functions-data-as-admin.test.ts` pins what it is.
 *
 * Exercised through the REAL modules (detectConnectionPosture → ensureAppRole
 * → driver.withAuth().count()/save()/delete()). Proves:
 *   1. Posture detection flags a superuser connection as privileged.
 *   2. Reads are isolated per owner.
 *   3. A user WRITE that satisfies the policy succeeds.
 *   4. A user WRITE that violates the policy is DENIED by RLS (WITH CHECK).
 *   5. A user cannot UPDATE/DELETE another tenant's row (USING).
 *   6. The server context (owner connection) bypasses RLS for writes.
 *   7. Locked-by-default: with no policy, a user cannot read or write.
 *   8. Realtime refetch path is isolated.
 *   9. Fail closed when the role is broken.
 *
 * Requires Docker.
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
    ensureAppRole,
    REBASE_USER_ROLE,
    type RawSqlRunner
} from "../../src/security/rls-enforcement.js";

// Per-owner rules for BOTH read and write — the multi-tenant shape.
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

// A locked collection: RLS enabled, no user-facing policy at all.
const secretsTable = pgTable("secrets", {
    id: varchar("id").primaryKey(),
    value: varchar("value")
});
const secretsCollection: CollectionConfig = {
    name: "Secrets", slug: "secrets", table: "secrets",
    properties: { id: { name: "ID", type: "string", isId: true }, value: { name: "V", type: "string" } }
} as unknown as CollectionConfig;

// Carries the injected default-read policy shape (null-server-or-admin).
const docsTable = pgTable("docs", { id: varchar("id").primaryKey(), owner_id: varchar("owner_id") });
const docsCollection: CollectionConfig = {
    name: "Docs", slug: "docs", table: "docs",
    properties: { id: { name: "ID", type: "string", isId: true }, owner_id: { name: "O", type: "string" } }
} as unknown as CollectionConfig;

function buildRegistry(): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([tasksCollection, secretsCollection, docsCollection]);
    registry.registerTable(tasksTable, "tasks");
    registry.registerTable(secretsTable, "secrets");
    registry.registerTable(docsTable, "docs");
    return registry;
}

describe("Unified RLS enforcement (E2E)", () => {
    let container: PgContainer;
    let adminClient: pg.Client;   // superuser: setup + raw assertions
    let pool: pg.Pool;            // the app's connection (superuser worst case)
    let driver: PostgresBackendDriver;
    let realtime: RealtimeService;
    let runSql: RawSqlRunner;

    async function userDriver(uid: string) {
        return driver.withAuth({ uid, roles: [] } as never);
    }
    async function countAs(uid: string): Promise<number> {
        return (await userDriver(uid)).count({ path: "tasks", collection: tasksCollection } as never);
    }
    async function realtimeFetchAs(uid: string): Promise<unknown[]> {
        return (realtime as unknown as {
            fetchCollectionWithAuth(path: string, req: Record<string, unknown>, auth?: { uid: string; roles: string[] }): Promise<unknown[]>;
        }).fetchCollectionWithAuth("tasks", {}, { uid, roles: [] });
    }
    async function rawCount(table: string, where = ""): Promise<number> {
        const r = await adminClient.query(`SELECT count(*)::int AS c FROM public.${table} ${where}`);
        return r.rows[0].c;
    }

    beforeAll(async () => {
        container = await startPgContainer();
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

        // tasks: per-owner policies for ALL commands (select/insert/update/delete).
        await adminClient.query(`
            CREATE TABLE public.tasks (
                id VARCHAR(255) PRIMARY KEY, title VARCHAR(255), owner_id VARCHAR(255)
            );
            ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
            CREATE POLICY tasks_select ON public.tasks FOR SELECT TO public
                USING (owner_id = auth.uid());
            CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO public
                WITH CHECK (owner_id = auth.uid());
            CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO public
                USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
            CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO public
                USING (owner_id = auth.uid());
            INSERT INTO public.tasks (id, title, owner_id) VALUES
                ('t-a', 'A task', 'user-a'),
                ('t-b', 'B task', 'user-b');

            -- docs: carries the INJECTED default-read policy shape
            -- (auth.uid() IS NULL = server context, OR admin) plus a per-owner
            -- rule. This is where an empty user id could escalate to server.
            CREATE TABLE public.docs (id VARCHAR(255) PRIMARY KEY, owner_id VARCHAR(255));
            ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY;
            CREATE POLICY docs_default_read ON public.docs FOR SELECT TO public
                USING (auth.uid() IS NULL OR (string_to_array(auth.roles(), ',') && ARRAY['admin']));
            CREATE POLICY docs_own ON public.docs FOR SELECT TO public
                USING (owner_id = auth.uid());
            INSERT INTO public.docs (id, owner_id) VALUES ('d-a', 'user-a'), ('d-b', 'user-b');

            -- secrets: RLS on, NO policy → locked to everyone but the owner/server.
            CREATE TABLE public.secrets (id VARCHAR(255) PRIMARY KEY, value VARCHAR(255));
            ALTER TABLE public.secrets ENABLE ROW LEVEL SECURITY;
            INSERT INTO public.secrets (id, value) VALUES ('s1', 'classified');
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = buildRegistry();
        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        runSql = async (text) => (await pool.query(text)).rows as Record<string, unknown>[];

        // Provision + activate exactly as the bootstrapper does.
        await ensureAppRole(runSql, ["public", "rebase", "auth"]);
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.rlsUserRole = REBASE_USER_ROLE;
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

    it("isolates reads to the owner", async () => {
        expect(await countAs("user-a")).toBe(1);
        expect(await countAs("user-b")).toBe(1);
    });

    it("allows a user write that satisfies the policy", async () => {
        const a = await userDriver("user-a");
        await a.save({
            path: "tasks", collection: tasksCollection,
            values: { id: "t-a2", title: "A second", owner_id: "user-a" }
        } as never);

        expect(await rawCount("tasks", "WHERE id = 't-a2'")).toBe(1);
        expect(await countAs("user-a")).toBe(2);
        expect(await countAs("user-b")).toBe(1);
    });

    it("DENIES a user write that violates the policy (WITH CHECK: forging another owner)", async () => {
        const a = await userDriver("user-a");
        await expect(a.save({
            path: "tasks", collection: tasksCollection,
            values: { id: "t-forged", title: "spoof", owner_id: "user-b" }
        } as never)).rejects.toBeTruthy();

        // Nothing was written.
        expect(await rawCount("tasks", "WHERE id = 't-forged'")).toBe(0);
    });

    it("DENIES a user from updating another tenant's row (USING makes it invisible)", async () => {
        const a = await userDriver("user-a");
        // Update targeting user-b's row: RLS makes the row invisible to user-a,
        // so the UPDATE matches nothing — user-b's row is untouched.
        await a.save({
            path: "tasks", collection: tasksCollection, id: "t-b", status: "existing",
            values: { title: "hijacked" }
        } as never).catch(() => { /* invisible row */ });
        const bTitle = await adminClient.query("SELECT title FROM public.tasks WHERE id = 't-b'");
        expect(bTitle.rows[0].title).toBe("B task");
    });

    it("DENIES a user from deleting another tenant's row (USING)", async () => {
        const a = await userDriver("user-a");
        await a.delete({ row: { id: "t-b", path: "tasks" }, collection: tasksCollection } as never)
            .catch(() => { /* invisible row */ });
        expect(await rawCount("tasks", "WHERE id = 't-b'")).toBe(1);
    });

    it("locks a policy-less collection to users (no read, no write)", async () => {
        const a = await userDriver("user-a");
        // Read: user sees nothing.
        expect(await a.count({ path: "secrets", collection: secretsCollection } as never)).toBe(0);
        // Write: denied by default-deny (no permissive policy).
        await expect(a.save({
            path: "secrets", collection: secretsCollection, values: { id: "s2", value: "x" }
        } as never)).rejects.toBeTruthy();
        expect(await rawCount("secrets")).toBe(1);
    });

    it("lets the server context (owner connection) bypass RLS for writes", async () => {
        // The BASE driver is the server context — it never switches role.
        // Scope note: this proves it about the base driver ONLY. It says
        // nothing about `rebase.dataAsAdmin`, which is a *different object* —
        // the base driver wrapped in `withAuth(SERVICE_IDENTITY)`.
        await driver.save({
            path: "secrets", collection: secretsCollection, values: { id: "s-server", value: "ok" }
        } as never);
        expect(await rawCount("secrets", "WHERE id = 's-server'")).toBe(1);
    });

    it("isolates the realtime refetch path", async () => {
        const rowsA = await realtimeFetchAs("user-a") as Array<{ id: string }>;
        expect(rowsA.map(r => r.id).sort()).toEqual(["t-a", "t-a2"]);
        const rowsB = await realtimeFetchAs("user-b") as Array<{ id: string }>;
        expect(rowsB.map(r => r.id)).toEqual(["t-b"]);
    });

    /**
     * `context.data` inside a collection callback inherits the privilege of
     * whatever triggered the callback. It is not a fixed trust level.
     *
     * This is pinned because the documentation asserted the opposite — that
     * callbacks "run through the base `PostgresBackendDriver` — not the
     * authenticated wrapper" and so have "full database access regardless of
     * the triggering user's permissions", in all six locales — and nothing
     * tested it either way.
     *
     * The code says otherwise, and so does this. `AuthenticatedPostgresBackendDriver
     * .withTransaction` builds a *fresh base driver bound to the RLS-scoped
     * transaction* (`new PostgresBackendDriver(tx, …)`) after `applyAuthContext`
     * has downgraded the role, then runs the operation on it. `buildCallContext`
     * therefore closes over a `this.data` that speaks through `tx`, so a callback
     * on a user request is user-scoped. A callback triggered by `dataAsAdmin`
     * runs on the owner connection and is not.
     *
     * The distinction matters in the unsafe direction: a developer told
     * "callbacks see everything" writes one that reads a row it cannot actually
     * see, and gets silence rather than an error.
     */
    it("scopes context.data to the caller when a callback runs on a user request", async () => {
        const seen: Array<{ trigger: string; visible: string[] }> = [];

        const withCallback = {
            ...tasksCollection,
            callbacks: {
                afterSave: async ({ context }: { context: { data: Record<string, { findAll(): Promise<Array<{ id: string }>> }> } }) => {
                    const rows = await context.data.tasks.findAll();
                    seen.push({ trigger: "pending", visible: rows.map(r => r.id).sort() });
                }
            }
        } as unknown as CollectionConfig;

        // user-a's own write. The callback must see only user-a's rows.
        const a = await userDriver("user-a");
        await a.save({
            path: "tasks", collection: withCallback,
            values: { id: "t-a-cb", title: "cb", owner_id: "user-a" }
        } as never);

        expect(seen).toHaveLength(1);
        expect(seen[0].visible).not.toContain("t-b");
        expect(seen[0].visible).toContain("t-a-cb");

        // The same callback on a server-context write sees everything, because
        // the base driver never switches role.
        seen.length = 0;
        await driver.save({
            path: "tasks", collection: withCallback,
            values: { id: "t-server-cb", title: "cb", owner_id: "user-b" }
        } as never);

        expect(seen).toHaveLength(1);
        expect(seen[0].visible).toContain("t-b");
        expect(seen[0].visible).toContain("t-a-cb");
    });

    it("fails closed when the user role is broken", async () => {
        driver.rlsUserRole = "role_that_does_not_exist";
        await expect(countAs("user-a")).rejects.toBeTruthy();
        driver.rlsUserRole = REBASE_USER_ROLE;
    });

    // Regression guard: an EMPTY user id must not be read as `auth.uid() IS NULL`
    // (the server-context sentinel) — that would escalate a user request to
    // server privileges. applyAuthContext coerces empty → "anonymous". The
    // realtime path calls it directly, bypassing the driver's own guard, so
    // exercise it there against the default-read (null-or-admin) policy.
    it("does not escalate an empty user id to server context (realtime refetch)", async () => {
        const rtDocs = (auth: { uid: string; roles: string[] }) =>
            (realtime as unknown as {
                fetchCollectionWithAuth(p: string, r: Record<string, unknown>, a?: { uid: string; roles: string[] }): Promise<unknown[]>;
            }).fetchCollectionWithAuth("docs", {}, auth);

        // Empty uid → coerced to "anonymous" → auth.uid() is NON-null → the
        // null-server default policy does NOT match → sees 0, not all rows.
        expect((await rtDocs({ uid: "", roles: [] })).length).toBe(0);
        expect((await rtDocs({ uid: "   ", roles: [] })).length).toBe(0);
        // Sanity: a real user sees only their own; an admin sees all via default read.
        expect((await rtDocs({ uid: "user-a", roles: [] })).length).toBe(1);
        expect((await rtDocs({ uid: "admin1", roles: ["admin"] })).length).toBe(2);
    });

    // A table created AFTER provisioning, using auto-generated ids. Proves the
    // sequence grants (for SERIAL) reach rebase_user via ALTER DEFAULT
    // PRIVILEGES with no re-provision, and that uuid/identity defaults work too.
    // Run as role-scoped raw SQL (exactly what applyAuthContext sets up) so the
    // grant/sequence layer is exercised directly, independent of the registry.
    it("lets rebase_user INSERT with auto-generated ids (serial + uuid + identity), self-healing grants", async () => {
        await adminClient.query(`
            CREATE TABLE public.notes (
                seq_id   SERIAL PRIMARY KEY,
                uuid_id  UUID NOT NULL DEFAULT gen_random_uuid(),
                ident_id INTEGER GENERATED BY DEFAULT AS IDENTITY,
                owner_id VARCHAR(255),
                body     VARCHAR(255)
            );
            ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
            CREATE POLICY notes_ins ON public.notes FOR INSERT TO public
                WITH CHECK (owner_id = auth.uid());
            CREATE POLICY notes_sel ON public.notes FOR SELECT TO public
                USING (owner_id = auth.uid());
        `);

        // No ensureAppRole() re-run: default privileges must already cover the
        // new table AND its SERIAL sequence. Insert relying on all three id
        // defaults, as rebase_user, with the RLS context set.
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.user_id', 'user-a', true)");
            await client.query(`SET LOCAL ROLE ${REBASE_USER_ROLE}`);
            const ins = await client.query(
                "INSERT INTO public.notes (owner_id, body) VALUES ('user-a', 'hi') RETURNING seq_id, uuid_id, ident_id"
            );
            expect(ins.rows[0].seq_id).toBe(1);       // SERIAL → needs sequence USAGE
            expect(ins.rows[0].uuid_id).toBeTruthy(); // uuid default
            expect(ins.rows[0].ident_id).toBe(1);     // IDENTITY

            // Owner sees the row; forging another owner_id is rejected by WITH CHECK.
            const own = await client.query("SELECT count(*)::int AS c FROM public.notes");
            expect(own.rows[0].c).toBe(1);
            await expect(
                client.query("INSERT INTO public.notes (owner_id, body) VALUES ('user-b', 'x')")
            ).rejects.toBeTruthy();
            await client.query("ROLLBACK");
        } finally {
            client.release();
        }

        // Other tenant sees none of it.
        const other = await pool.connect();
        try {
            await other.query("BEGIN");
            await other.query("SELECT set_config('app.user_id', 'user-b', true)");
            await other.query(`SET LOCAL ROLE ${REBASE_USER_ROLE}`);
            const seen = await other.query("SELECT count(*)::int AS c FROM public.notes");
            expect(seen.rows[0].c).toBe(0);
            await other.query("ROLLBACK");
        } finally {
            other.release();
        }
    });
});
