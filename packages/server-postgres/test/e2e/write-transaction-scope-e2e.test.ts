/**
 * E2E: what a write's callbacks hand off commits with the write, or not at all.
 *
 * `jobs.md`, `hooks.md` and the queue and topic handles all promised that "a
 * job enqueued in a transaction that rolls back was never enqueued". It was
 * not true. The job store wrote through the default driver's own pool
 * connection, in autocommit, so a job enqueued from an `afterSave` that then
 * threw stayed queued for a row that was never written — and another
 * connection, which is all a worker is, could see and claim it before the row
 * committed. History had the same defect: a batch that rolled back after its
 * first row left that row's entry behind. Both were proved against this
 * container before anything was changed.
 *
 * The fix routes both through the write's own transaction (see
 * `write-transaction-scope.ts`), which runs as the restricted request role —
 * revoked from `rebase.jobs` and `rebase.entity_history` on purpose — so each
 * goes through a narrow `SECURITY DEFINER` function. This suite runs the way
 * production runs: a superuser connection, `ensureAppRole`, `rlsUserRole` set,
 * so every write here is `SET LOCAL ROLE rebase_user`.
 *
 * Requires Docker. Needs a real pool: PGlite is one connection, and "another
 * connection sees the job early" cannot be asked of it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { CollectionCallbacks, CollectionConfig } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { HistoryService } from "../../src/history/HistoryService.js";
import { ensureHistoryTableExists } from "../../src/history/ensure-history-table.js";
import { currentWriteScope } from "../../src/services/write-transaction-scope.js";
import { ensureAppRole, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";
import { createJobQueue, createJobStore } from "../../../server/src/jobs/index.js";

const widgetsTable = pgTable("widgets", { id: varchar("id").primaryKey(), name: varchar("name") });
const notesTable = pgTable("notes", { id: varchar("id").primaryKey(), body: varchar("body") });

/** What the widgets callbacks do on the next write. */
let plan: {
    enqueue?: { task: string; idempotencyKey?: string };
    thenThrow?: boolean;
    enqueueOnRead?: boolean;
};
/** What they saw. */
let seen: {
    enqueued?: string | null;
    jobsVisibleToAnotherConnection?: number;
    role?: unknown;
};

let container: PgContainer;
let pool: pg.Pool;
let observer: pg.Client;
let driver: PostgresBackendDriver;
let queue: ReturnType<typeof createJobQueue>;

async function count(sqlText: string, params: unknown[] = []): Promise<number> {
    return (await observer.query(sqlText, params)).rows[0].c as number;
}

const widgetCallbacks: CollectionCallbacks = {
    afterSave: async () => {
        if (plan.enqueue) {
            seen.enqueued = await queue.enqueue(plan.enqueue.task, { hello: 1 }, { idempotencyKey: plan.enqueue.idempotencyKey });
            // A worker is only another connection.
            seen.jobsVisibleToAnotherConnection = await count(
                "SELECT count(*)::int AS c FROM rebase.jobs WHERE task = $1", [plan.enqueue.task]
            );
            seen.role = (await currentWriteScope()?.exec("SELECT current_user AS u"))?.[0]?.u;
        }
        if (plan.thenThrow) throw new Error("the write must not survive this");
    },
    afterRead: async ({ row }) => {
        if (plan.enqueueOnRead) await queue.enqueue("read-notify", { row: row.id });
        return row;
    }
};

describe("a write's hand-offs share its transaction (E2E)", () => {
    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                observer = new pg.Client({ connectionString: container.connectionString });
                await observer.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        await observer.query(`
            CREATE SCHEMA IF NOT EXISTS rebase;
            CREATE TABLE public.widgets (id varchar PRIMARY KEY, name varchar);
            CREATE TABLE public.notes (id varchar PRIMARY KEY, body varchar);
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);

        // Boot order, as the bootstrapper runs it: the restricted role first,
        // then history, then the job queue.
        await ensureAppRole(async (text) => (await pool.query(text)).rows as Record<string, unknown>[], ["public", "rebase"]);
        const historyInTransaction = await ensureHistoryTableExists(db as never);
        expect(historyInTransaction).toBe(true);

        const registry = new PostgresCollectionRegistry();
        const prop = (name: string) => ({ name, type: "string" });
        registry.registerMultiple([
            { slug: "widgets", name: "W", table: "widgets", properties: { id: { ...prop("ID"), isId: true }, name: prop("N") }, callbacks: widgetCallbacks } as unknown as CollectionConfig,
            { slug: "notes", name: "N", table: "notes", history: true, properties: { id: { ...prop("ID"), isId: true }, body: prop("B") } } as unknown as CollectionConfig
        ]);
        registry.registerTable(widgetsTable, "widgets");
        registry.registerTable(notesTable, "notes");

        driver = new PostgresBackendDriver(
            db as never, new RealtimeService(db as never, registry) as never, registry,
            undefined, undefined, new HistoryService(db as never, undefined, { inTransaction: historyInTransaction })
        );
        driver.rlsUserRole = REBASE_USER_ROLE;

        const store = createJobStore(driver)!;
        await store.ensureTable();
        queue = createJobQueue(store, {});
    }, 120_000);

    afterAll(async () => {
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    beforeEach(() => {
        plan = {};
        seen = {};
    });

    async function saveWidget(id: string) {
        const scoped = await driver.withAuth({ uid: "u1", roles: ["editor"] } as never);
        return scoped.save({ path: "widgets", values: { id, name: "x" }, status: "new" } as never)
            .then(() => null, (e: unknown) => e);
    }

    it("runs the write as the request role, which has no access to rebase.jobs", async () => {
        plan = { enqueue: { task: "role-check" } };
        expect(await saveWidget("w-role")).toBeNull();

        expect(seen.role).toBe(REBASE_USER_ROLE);
        expect(await count(
            `SELECT count(*)::int AS c WHERE has_table_privilege('${REBASE_USER_ROLE}', 'rebase.jobs', 'INSERT')`
        )).toBe(0);
    });

    it("does not queue a job whose write rolled back", async () => {
        plan = { enqueue: { task: "rolled-back" }, thenThrow: true };
        expect(await saveWidget("w-rollback")).toBeTruthy();

        expect(await count("SELECT count(*)::int AS c FROM public.widgets WHERE id = 'w-rollback'")).toBe(0);
        expect(await count("SELECT count(*)::int AS c FROM rebase.jobs WHERE task = 'rolled-back'")).toBe(0);
    });

    it("queues it once the write commits, and not a moment before", async () => {
        plan = { enqueue: { task: "committed" } };
        expect(await saveWidget("w-commit")).toBeNull();

        expect(typeof seen.enqueued).toBe("string");
        expect(seen.jobsVisibleToAnotherConnection).toBe(0);
        expect(await count("SELECT count(*)::int AS c FROM rebase.jobs WHERE task = 'committed'")).toBe(1);
    });

    it("answers an idempotency clash with null and still commits the write", async () => {
        // Queued earlier, outside any write, and still unfinished.
        expect(await queue.enqueue("digest", {}, { idempotencyKey: "digest:u7" })).toEqual(expect.any(String));

        plan = { enqueue: { task: "digest", idempotencyKey: "digest:u7" } };
        expect(await saveWidget("w-idem")).toBeNull();

        expect(seen.enqueued).toBeNull();
        expect(await count("SELECT count(*)::int AS c FROM public.widgets WHERE id = 'w-idem'")).toBe(1);
        expect(await count("SELECT count(*)::int AS c FROM rebase.jobs WHERE idempotency_key = 'digest:u7'")).toBe(1);
    });

    it("leaves an enqueue outside any write committing at once", async () => {
        await queue.enqueue("cron-work", {});
        expect(await count("SELECT count(*)::int AS c FROM rebase.jobs WHERE task = 'cron-work'")).toBe(1);
    });

    it("does not take a read for a write: an afterRead's enqueue commits on its own", async () => {
        await observer.query("INSERT INTO public.widgets (id, name) VALUES ('w-read', 'r') ON CONFLICT DO NOTHING");
        plan = { enqueueOnRead: true };
        const scoped = await driver.withAuth({ uid: "u1", roles: ["editor"] } as never);
        // A READ ONLY transaction would refuse the insert with 25006.
        await scoped.fetchCollection({ path: "widgets" } as never);
        expect(await count("SELECT count(*)::int AS c FROM rebase.jobs WHERE task = 'read-notify'")).toBeGreaterThan(0);
    });

    it("records history once for a committed write", async () => {
        const scoped = await driver.withAuth({ uid: "u1", roles: ["editor"] } as never);
        await scoped.save({ path: "notes", values: { id: "n-ok", body: "a" }, status: "new" } as never);

        expect(await count("SELECT count(*)::int AS c FROM rebase.entity_history WHERE entity_id = 'n-ok'")).toBe(1);
    });

    it("keeps no history for a batch that rolled back after its first row", async () => {
        const scoped = await driver.withAuth({ uid: "u1", roles: ["editor"] } as never);
        const err = await scoped.saveMany({ path: "notes", rows: [{ id: "n-dup", body: "a" }, { id: "n-dup", body: "b" }] } as never)
            .then(() => null, (e: unknown) => e);
        expect(err).toBeTruthy();

        expect(await count("SELECT count(*)::int AS c FROM public.notes WHERE id = 'n-dup'")).toBe(0);
        expect(await count("SELECT count(*)::int AS c FROM rebase.entity_history WHERE entity_id = 'n-dup'")).toBe(0);
    });
});
