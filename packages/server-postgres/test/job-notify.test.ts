/**
 * The `NOTIFY` an enqueue sends, against a real Postgres (PGlite).
 *
 * Workers are woken by it instead of polling every 2 seconds, so it has to go
 * out exactly when the row becomes visible to them: on commit, with the job's
 * `run_at`, and not at all for a write that rolls back. Both inserts the store
 * makes are asked — its own statement, and the `SECURITY DEFINER` function an
 * enqueue inside somebody's write rides that write's transaction through.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { createJobStore, type JobStore } from "../../server/src/jobs";
import { JOBS_NOTIFY_CHANNEL } from "../../server/src/jobs/job-store";

function pgliteDriver(db: PGlite): DataDriver {
    return {
        key: "postgres",
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                if (options?.params) {
                    return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
                }
                const results = await db.exec(sql);
                return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
            }
        }
    } as unknown as DataDriver;
}

let db: PGlite;
let store: JobStore;
let heard: string[];

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    store = createJobStore(pgliteDriver(db))!;
    await store.ensureTable();
    heard = [];
    await db.listen(JOBS_NOTIFY_CHANNEL, (payload) => { heard.push(payload); });
});

afterEach(async () => {
    await db.close();
});

/** Let PGlite hand over the notifications it has queued. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe("an enqueue's notification", () => {
    it("carries the job's run_at, in epoch milliseconds", async () => {
        const runAt = new Date(Date.now() + 60_000);
        const id = await store.insert({ task: "report", payload: { n: 1 }, runAt, maxAttempts: 3 });
        await settle();

        expect(id).toBeTruthy();
        expect(heard).toEqual([String(runAt.getTime())]);
    });

    it("goes out from the definer function when its transaction commits, and not when it rolls back", async () => {
        const runAt = new Date();
        await db.exec("BEGIN");
        await db.query(
            "SELECT rebase.enqueue_job($1::text, $2::jsonb, $3::timestamptz, $4::integer, $5::text) AS id",
            ["report", "{}", runAt.toISOString(), 3, null]
        );
        await settle();
        expect(heard).toEqual([]);
        await db.exec("COMMIT");
        await settle();
        expect(heard).toEqual([String(runAt.getTime())]);

        await db.exec("BEGIN");
        await db.query(
            "SELECT rebase.enqueue_job($1::text, $2::jsonb, $3::timestamptz, $4::integer, $5::text) AS id",
            ["report", "{}", runAt.toISOString(), 3, null]
        );
        await db.exec("ROLLBACK");
        await settle();
        expect(heard).toHaveLength(1);
    });
});

describe("subscribing", () => {
    it("is refused on a driver that cannot hold a LISTEN, so the worker polls", async () => {
        await expect(store.subscribe!(() => undefined, () => undefined)).rejects.toThrow(/no notifications/);
    });
});
