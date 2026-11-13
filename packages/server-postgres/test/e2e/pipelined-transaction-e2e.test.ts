/**
 * E2E: a request's transaction opened in the same round trip as its first
 * query (`pipelined-transaction.ts`), and everything about row-level security
 * that must not move because of it.
 *
 * The opening — `BEGIN`, the caller's GUCs, the switch to the restricted role
 * — used to be statements of their own, each a round trip. Now they ride in a
 * batch with the first query, and a lone read at READ COMMITTED runs in a
 * batch of its own with no `BEGIN` or `COMMIT` at all. What is pinned here:
 *
 * - a user's read and write are filtered and checked by their policies, and
 *   `rebase.uid()` reads the caller inside the batch;
 * - a role the connection may not assume fails the request with the same
 *   error `SET ROLE` raises, before the query runs, and nothing runs as the
 *   connection owner;
 * - a read-only transaction cannot write, batch or not;
 * - nothing outlives the request on the pooled connection: no GUC, no role,
 *   no open transaction;
 * - savepoints held back until the next statement still nest: a failed
 *   nested write is undone alone;
 * - the round trips: one for a lone read, one for a lone write (its `COMMIT`
 *   rides behind its statement), one for a createMany of a thousand rows; a
 *   write that fails there rolls back whole, and one that matched nothing
 *   still says why.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { runPipelinedTransaction, pipelineTarget } from "../../src/pipelined-transaction.js";
import { authContextStatement, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";
import { tablesFromCollections } from "../helpers/tables.js";

const notes: LegacyCollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" },
        { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        title: { name: "Title", type: "string" },
        createdAt: { name: "Created", type: "date", autoValue: "on_create" },
        updatedAt: { name: "Updated", type: "date", autoValue: "on_update" }
    }
};

/** Round trips sent by any pooled client while counting, a batch being one. */
let counting = false;
let roundTrips = 0;
const originalQuery = pg.Client.prototype.query;
// The prototype every pooled client shares, seen as the one method this file wraps.
const clientPrototype: { query: unknown } = pg.Client.prototype;
clientPrototype.query = function (this: unknown, ...args: unknown[]) {
    if (counting) roundTrips += 1;
    return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
};

async function tripsOf<T>(run: () => Promise<T>): Promise<{ result: T; trips: number }> {
    roundTrips = 0;
    counting = true;
    try {
        const result = await run();
        return { result, trips: roundTrips };
    } finally {
        counting = false;
    }
}

async function provision(url: string): Promise<void> {
    const conn = createPostgresDatabaseConnection(url);
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
        const driverResult = await bootstrapper.initializeDriver({ collections: [notes], tables: tablesFromCollections([notes]).tables, realtime: { subscribe: false, provision: false } });
        await bootstrapper.ensureTableSchema!(tablesFromCollections([notes]).tables, driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await bootstrapper.ensureTablePolicies!(tablesFromCollections([notes]).tables, driverResult);
        await bootstrapper.finalizeSecurityPosture!(driverResult);
    } finally {
        await conn.pool.end();
    }
}

describe("pipelined transactions (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    let observer: pg.Client;
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        );
        await provision(container.connectionString);
        // One connection, so every request reuses the one the last one released.
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [notes], tables: tablesFromCollections([notes]).tables, pool: { max: 1 } });
        observer = new pg.Client({ connectionString: container.connectionString });
        await observer.connect();
        await rebase.sql("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'hers'), ('bob', 'his')");
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        await observer?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("filters a user's read by their policies, in one round trip", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        const { result, trips } = await tripsOf(() => ada.data.notes.find({ count: "none" }));
        expect(result.data.map(row => row.title)).toEqual(["hers"]);
        expect(trips).toBe(1);

        const byId = await tripsOf(() => ada.data.notes.findById(1));
        expect(byId.result?.title).toBe("hers");
        expect(byId.trips).toBe(1);
        expect(await ada.data.notes.findById(2)).toBeUndefined();
    });

    it("checks a user's write against their policies, and an update is one statement in one round trip", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        await expect(ada.data.notes.create({ ownerId: "bob", title: "forged" })).rejects.toMatchObject({ statusCode: 403 });
        expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title = 'forged'")).toEqual([{ n: 0 }]);

        const updated = await tripsOf(() => ada.data.notes.update(1, { title: "hers, edited" }));
        expect(updated.result.title).toBe("hers, edited");
        expect(updated.trips).toBe(1);

        // A row the caller cannot see is a 404 without the read that used to say so.
        await expect(ada.data.notes.update(2, { title: "taken" })).rejects.toMatchObject({ statusCode: 404 });
        expect(await rebase.sql("SELECT title FROM public.notes WHERE id = 2")).toEqual([{ title: "his" }]);
        // A row that is not there, likewise.
        await expect(ada.data.notes.update(999, { title: "nobody" })).rejects.toMatchObject({ statusCode: 404 });
    });

    it("creates, upserts and deletes a row in one round trip each, and commits each", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        const created = await tripsOf(() => ada.data.notes.create({ ownerId: "ada", title: "one trip" }));
        expect(created.trips).toBe(1);
        const upserted = await tripsOf(() => ada.data.notes.upsert({ id: created.result.id, ownerId: "ada", title: "one trip, again" }));
        expect(upserted.trips).toBe(1);
        expect((await observer.query("SELECT title FROM public.notes WHERE id = $1", [created.result.id])).rows).toEqual([{ title: "one trip, again" }]);

        const deleted = await tripsOf(() => ada.data.notes.delete(created.result.id as number));
        expect(deleted.trips).toBe(1);
        expect((await observer.query("SELECT count(*)::int AS n FROM public.notes WHERE id = $1", [created.result.id])).rows).toEqual([{ n: 0 }]);
    });

    it("answers a delete that matched nothing as before: 404 for a missing row, 404 for another's", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        await expect(ada.data.notes.delete(999)).rejects.toMatchObject({ statusCode: 404 });
        await expect(ada.data.notes.delete(2)).rejects.toMatchObject({ statusCode: 404 });
        expect(await rebase.sql("SELECT title FROM public.notes WHERE id = 2")).toEqual([{ title: "his" }]);
        // And the connection is clean after it: the read that explained the 404 ran as the caller.
        const [state] = await rebase.sql("SELECT current_user AS role, current_setting('app.uid', true) AS uid") as Record<string, unknown>[];
        expect(state.uid).toBe("");
        expect(state.role).not.toBe(REBASE_USER_ROLE);
    });

    it("keeps a batch whole when its last row matches nothing: nothing before it commits", async () => {
        const [kept] = await rebase.dataAsAdmin.notes.createMany([{ ownerId: "service", title: "kept by the batch" }]);
        await expect(rebase.dataAsAdmin.notes.deleteMany([kept.id as number, 999_999])).rejects.toMatchObject({ statusCode: 404 });
        expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title = 'kept by the batch'")).toEqual([{ n: 1 }]);
    });

    it("rolls a one-trip write back whole when its statement fails", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        // A NOT NULL column set to null: the statement fails, the COMMIT behind it is skipped.
        // Untyped on purpose: a null the column refuses.
        await expect(Reflect.apply(ada.data.notes.update, ada.data.notes, [1, { ownerId: null }])).rejects.toBeDefined();
        expect(await rebase.sql("SELECT owner_id FROM public.notes WHERE id = 1")).toEqual([{ owner_id: "ada" }]);
        const [state] = await rebase.sql("SELECT current_setting('transaction_read_only') AS ro, now() = statement_timestamp() AS fresh") as Record<string, unknown>[];
        expect(state).toEqual({ ro: "off", fresh: true });
    });

    it("writes a thousand rows in one round trip, defaults and stamps applied, each row answered", async () => {
        const rows = Array.from({ length: 1000 }, (_, i) => ({ ownerId: "service", title: `bulk ${i}` }));
        const { result, trips } = await tripsOf(() => rebase.dataAsAdmin.notes.createMany(rows));
        expect(trips).toBe(1);
        expect(result).toHaveLength(1000);
        expect(result[999].title).toBe("bulk 999");
        expect(typeof result[0].createdAt).toBe("string");
        expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title LIKE 'bulk %' AND created_at IS NOT NULL")).toEqual([{ n: 1000 }]);
    });

    it("names the row a batch fails on, and writes none of it", async () => {
        const rows = [{ ownerId: "service", title: "ok 1" }, { ownerId: "service", title: "ok 2", id: 1 }, { ownerId: "service", title: "ok 3" }];
        await expect(rebase.dataAsAdmin.notes.createMany(rows)).rejects.toThrow(/^Row 1 of 3 \(id 1\) failed/);
        expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title LIKE 'ok %'")).toEqual([{ n: 0 }]);
    });

    it("leaves the pooled connection as it found it: no GUC, no role, no transaction", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        await ada.data.notes.find({ count: "none" });
        await ada.data.notes.update(1, { title: "hers again" });
        const [state] = await rebase.sql(
            "SELECT current_user AS role, current_setting('app.uid', true) AS uid, current_setting('transaction_read_only') AS ro, now() = statement_timestamp() AS fresh"
        ) as Record<string, unknown>[];
        expect(state).toEqual({ role: expect.not.stringMatching(new RegExp(`^${REBASE_USER_ROLE}$`)), uid: "", ro: "off", fresh: true });
    });

    describe("on a raw pool", () => {
        let conn: ReturnType<typeof createPostgresDatabaseConnection>;
        const target = () => pipelineTarget(conn.db)!;
        const context = (uid: string, role?: string) => authContextStatement({ uid, roles: ["user"], isAnonymous: false }, role);

        beforeAll(() => {
            conn = createPostgresDatabaseConnection(container.connectionString, undefined, { max: 1 }, {});
        });

        afterAll(async () => {
            await conn?.pool.end();
        });

        it("refuses a role the connection may not assume before the query runs, with SET ROLE's error", async () => {
            const { db, pool } = target();
            await expect(runPipelinedTransaction(db, pool, [context("ada", "no_such_role")], { accessMode: "read write" },
                tx => tx.execute("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'as owner')")
            )).rejects.toMatchObject({ cause: { code: "22023" } });
            expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title = 'as owner'")).toEqual([{ n: 0 }]);
        });

        it("runs a read-only transaction read-only, in a batch of its own or in a block", async () => {
            const { db, pool } = target();
            for (const config of [{ accessMode: "read only" as const }, { accessMode: "read only" as const, isolationLevel: "repeatable read" as const }]) {
                await expect(runPipelinedTransaction(db, pool, [context("ada", REBASE_USER_ROLE)], config,
                    tx => tx.execute("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'read only')")
                )).rejects.toMatchObject({ cause: { code: "25006" } });
            }
        });

        it("sets the caller's context for every statement of a read, each in its own batch", async () => {
            const { db, pool } = target();
            const seen = await runPipelinedTransaction(db, pool, [context("ada", REBASE_USER_ROLE)], { accessMode: "read only" }, async tx => {
                const first = await tx.execute("SELECT current_setting('app.uid') AS uid, current_user AS role");
                const second = await tx.execute("SELECT count(*)::int AS n FROM public.notes");
                return [first.rows[0], second.rows[0]];
            });
            expect(seen).toEqual([{ uid: "ada", role: REBASE_USER_ROLE }, { n: 1 }]);
        });

        it("keeps a nested savepoint's failure to itself", async () => {
            const { db, pool } = target();
            const titles = await runPipelinedTransaction(db, pool, [context("ada", REBASE_USER_ROLE)], { accessMode: "read write" }, async tx => {
                await tx.execute("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'kept')");
                await expect(tx.transaction(async nested => {
                    await nested.execute("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'undone')");
                    await nested.execute("SELECT 1 / 0");
                })).rejects.toMatchObject({ cause: { code: "22012" } });
                // A savepoint nothing ran inside is undone without a round trip.
                await expect(tx.transaction(async () => { throw new Error("before any statement"); })).rejects.toThrow("before any statement");
                return (await tx.execute("SELECT title FROM public.notes WHERE title IN ('kept', 'undone')")).rows;
            });
            expect(titles).toEqual([{ title: "kept" }]);
            expect(await rebase.sql("SELECT title FROM public.notes WHERE title IN ('kept', 'undone')")).toEqual([{ title: "kept" }]);
        });

        it("commits nothing when nothing was sent, and rolls back a failed write whole", async () => {
            const { db, pool } = target();
            const before = (await observer.query("SELECT xact_commit FROM pg_stat_database WHERE datname = current_database()")).rows[0].xact_commit;
            await runPipelinedTransaction(db, pool, [context("ada", REBASE_USER_ROLE)], { accessMode: "read write" }, async () => "nothing");
            await expect(runPipelinedTransaction(db, pool, [context("ada", REBASE_USER_ROLE)], { accessMode: "read write" }, async tx => {
                await tx.execute("INSERT INTO public.notes (owner_id, title) VALUES ('ada', 'rolled back')");
                throw new Error("after the write");
            })).rejects.toThrow("after the write");
            expect(await rebase.sql("SELECT count(*)::int AS n FROM public.notes WHERE title = 'rolled back'")).toEqual([{ n: 0 }]);
            const after = (await observer.query("SELECT xact_commit FROM pg_stat_database WHERE datname = current_database()")).rows[0].xact_commit;
            // The observer's own two reads are the only commits in between.
            expect(Number(after) - Number(before)).toBeLessThanOrEqual(2);
        });
    });
});
