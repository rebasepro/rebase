/**
 * `claim` against a real Postgres (PGlite): a worker claims only the tasks it
 * has handlers for.
 *
 * A claim spends an attempt. During a rolling deploy the instances still on
 * older code poll the same `rebase.jobs` as the updated ones, and when their
 * claim took every runnable row, a job whose task only the new code
 * implements was dead-lettered by the old pods — "No handler registered" —
 * before an updated peer got to it. The worker's unit tests use an in-memory
 * store; whether the filter reaches the SQL and binds is the database's
 * answer, so it is asked of one here.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { createJobStore, type JobStore } from "../../server/src/jobs";

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

async function enqueue(task: string): Promise<string> {
    const id = await store.insert({ task, payload: null, runAt: new Date(Date.now() - 1_000), maxAttempts: 3 });
    if (!id) throw new Error("insert returned no id");
    return id;
}

describe("claiming by task", () => {
    it("takes only the tasks named, and leaves the rest untouched", async () => {
        const future = await enqueue("topic:orders:email");
        const known = await enqueue("send-welcome");

        const claimed = await store.claim(10, "old-pod", ["send-welcome"]);

        expect(claimed.map(j => j.id)).toEqual([known]);
        const left = await store.fetch(future);
        expect(left?.status).toBe("pending");
        expect(left?.attempts).toBe(0);
    });

    it("binds every task named, however many", async () => {
        const ids = [];
        for (let i = 0; i < 12; i++) ids.push(await enqueue(`task-${i}`));

        const tasks = Array.from({ length: 12 }, (_, i) => `task-${i}`);
        const claimed = await store.claim(20, "worker", tasks);

        expect(claimed.map(j => j.id).sort()).toEqual([...ids].sort());
    });

    it("claims nothing for a worker with no tasks", async () => {
        const id = await enqueue("send-welcome");

        expect(await store.claim(10, "idle-pod", [])).toEqual([]);
        expect((await store.fetch(id))?.attempts).toBe(0);
    });

    it("still claims any task when none are named", async () => {
        const id = await enqueue("anything");

        expect((await store.claim(10, "worker")).map(j => j.id)).toEqual([id]);
    });
});
