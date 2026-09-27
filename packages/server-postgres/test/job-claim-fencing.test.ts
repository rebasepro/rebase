/**
 * A job's outcome belongs to the claim that ran it.
 *
 * The visibility timeout is what recovers a job from a worker that died holding
 * it, and it cannot tell a dead worker from a slow one: a handler still running
 * when it expires has its job handed to a second worker. The first one then
 * finishes and writes its outcome over the second's claim — `succeeded` while
 * attempt 2 is still running, and attempt 2's failure then puts a finished job
 * back to `pending` for a third run. Asked of a real Postgres (PGlite), because
 * whether a stale write is a no-op is the database's answer.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { createJobQueue, createJobStore, type JobStore } from "../../server/src/jobs";

/** Parameterised statements through the extended protocol, DDL through the simple one. */
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

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    store = createJobStore(pgliteDriver(db))!;
    await store.ensureTable();
});

afterEach(async () => {
    await db.close();
});

async function enqueue(task: string, maxAttempts = 5): Promise<string> {
    const id = await store.insert({ task, payload: null, runAt: new Date(Date.now() - 1_000), maxAttempts });
    if (!id) throw new Error("insert returned no id");
    return id;
}

/** Age every running claim past any visibility timeout, and reap. */
async function expireClaims(): Promise<void> {
    await db.query("UPDATE rebase.jobs SET locked_at = now() - interval '1 hour' WHERE status = 'running'");
    await store.reapExpired(60_000);
}

async function row(id: string) {
    const r = (await db.query<{ status: string; attempts: number; locked_by: string | null }>(
        "SELECT status, attempts, locked_by FROM rebase.jobs WHERE id = $1", [id])).rows[0];
    return { status: r.status, attempts: Number(r.attempts), lockedBy: r.locked_by };
}

describe("outcome writes are fenced by the claim", () => {
    it("ignores the completion of an attempt whose claim was reclaimed", async () => {
        const id = await enqueue("export");
        await store.claim(1, "worker-A");
        await expireClaims();
        await store.claim(1, "worker-B");

        // Attempt 1 finishes while attempt 2 is running.
        await store.complete(id, { workerId: "worker-A", attempt: 1 });

        expect(await row(id)).toEqual({ status: "running", attempts: 2, lockedBy: "worker-B" });
    });

    it("does not let a stale failure send a finished job back for another run", async () => {
        const id = await enqueue("export");
        await store.claim(1, "worker-A");
        await expireClaims();
        await store.claim(1, "worker-B");

        await store.complete(id, { workerId: "worker-B", attempt: 2 });
        await store.fail(id, "boom", new Date(Date.now() - 1_000), { workerId: "worker-A", attempt: 1 });

        expect(await row(id)).toEqual({ status: "succeeded", attempts: 2, lockedBy: null });
        expect(await store.claim(1, "worker-C")).toEqual([]);
    });

    it("tells two attempts on the same worker apart", async () => {
        // A worker's own reaper can hand its job back to it in another slot.
        const id = await enqueue("export");
        await store.claim(1, "worker-A");
        await expireClaims();
        await store.claim(1, "worker-A");

        await store.fail(id, "boom", null, { workerId: "worker-A", attempt: 1 });

        expect(await row(id)).toEqual({ status: "running", attempts: 2, lockedBy: "worker-A" });
    });

    it("still records the outcome of the claim that holds the job", async () => {
        const id = await enqueue("export");
        await store.claim(1, "worker-A");

        await store.fail(id, "boom", null, { workerId: "worker-A", attempt: 1 });

        expect(await row(id)).toEqual({ status: "failed", attempts: 1, lockedBy: null });
    });
});

describe("a handler that outlives the visibility timeout", () => {
    it("keeps its claim while it runs, so no second worker starts it", async () => {
        const id = await enqueue("slow");
        let runs = 0;
        const queue = createJobQueue(store, {
            pollIntervalMs: 20,
            // Reaped after ~1s without a renewal; the reaper runs every 250ms.
            visibilityTimeoutMs: 1_000,
            tasks: {
                slow: async () => {
                    runs++;
                    await new Promise(resolve => setTimeout(resolve, 2_500));
                }
            }
        });
        queue.start();
        try {
            const deadline = Date.now() + 10_000;
            while ((await row(id)).status !== "succeeded" && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        } finally {
            await queue.stop(5_000);
        }

        expect(runs).toBe(1);
        expect(await row(id)).toEqual({ status: "succeeded", attempts: 1, lockedBy: null });
    });
});
