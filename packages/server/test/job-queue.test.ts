import { describe, expect, it, jest } from "@jest/globals";
import { createJobQueue, defaultBackoff } from "../src/jobs";
import type { JobRecord } from "../src/jobs";
import type { JobStore } from "../src/jobs";

/**
 * The worker's decisions, away from Postgres.
 *
 * Arbitration between workers is one `UPDATE … FOR UPDATE SKIP LOCKED` in
 * `job-store.ts` and belongs to a database test. What lives here is everything
 * the loop decides once it is holding a job, and every one of those decisions
 * is a place where the obvious implementation is quietly wrong:
 *
 *  - a handler that throws with attempts left is a *retry*, and one without is
 *    a dead letter that stays in the table;
 *  - an unknown task is neither. During a rolling deploy the instance running
 *    old code will be handed jobs belonging to new code, and failing them
 *    outright would dead-letter work the fleet is minutes away from being able
 *    to run;
 *  - a job whose worker was killed is invisible to all of this — it reports
 *    nothing, ever — so only a timeout recovers it.
 */

/** A store that keeps jobs in an array, with the real one's semantics. */
function fakeStore() {
    const jobs: (JobRecord & { lockedAt: number | null })[] = [];
    let nextId = 1;

    const store: JobStore & { jobs: typeof jobs } = {
        jobs,
        ensureTable: async () => undefined,
        async insert(job) {
            if (job.idempotencyKey && jobs.some(j =>
                (j as unknown as { idempotencyKey?: string }).idempotencyKey === job.idempotencyKey &&
                (j.status === "pending" || j.status === "running")
            )) {
                return null;
            }
            const id = String(nextId++);
            jobs.push({
                id,
                task: job.task,
                payload: job.payload,
                status: "pending",
                runAt: job.runAt.toISOString(),
                attempts: 0,
                maxAttempts: job.maxAttempts,
                lastError: null,
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
                lockedAt: null,
                ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {})
            } as never);
            return id;
        },
        async claim(limit) {
            const now = Date.now();
            const claimed = jobs
                .filter(j => j.status === "pending" && Date.parse(j.runAt) <= now)
                .slice(0, limit);
            for (const job of claimed) {
                job.status = "running";
                job.attempts += 1;
                job.lockedAt = now;
            }
            return claimed.map(j => ({ ...j }));
        },
        async complete(id) {
            const job = jobs.find(j => j.id === id);
            if (job) {
                job.status = "succeeded";
                job.lockedAt = null;
            }
        },
        async fail(id, error, retryAt) {
            const job = jobs.find(j => j.id === id);
            if (!job) return;
            job.lastError = error;
            job.lockedAt = null;
            if (retryAt) {
                job.status = "pending";
                job.runAt = retryAt.toISOString();
            } else {
                job.status = "failed";
            }
        },
        async reapExpired(visibilityTimeoutMs) {
            const cutoff = Date.now() - visibilityTimeoutMs;
            let count = 0;
            for (const job of jobs) {
                if (job.status !== "running" || job.lockedAt === null || job.lockedAt >= cutoff) continue;
                count++;
                job.lockedAt = null;
                job.status = job.attempts < job.maxAttempts ? "pending" : "failed";
                job.lastError = "Worker stopped responding; the job was reclaimed";
            }
            return count;
        },
        async fetch(id) {
            return jobs.find(j => j.id === id) ?? null;
        }
    };
    return store;
}

describe("a job that succeeds", () => {
    it("runs its handler with the payload and is marked succeeded", async () => {
        const store = fakeStore();
        const seen: unknown[] = [];
        const queue = createJobQueue(store, { tasks: { greet: (ctx) => { seen.push(ctx.payload); } } });

        await queue.enqueue("greet", { name: "ada" });
        expect(await queue.runOnce()).toBe(1);

        expect(seen).toEqual([{ name: "ada" }]);
        expect((await store.fetch("1"))?.status).toBe("succeeded");
    });

    it("does not run again once it has succeeded", async () => {
        const store = fakeStore();
        const handler = jest.fn();
        const queue = createJobQueue(store, { tasks: { once: handler as never } });

        await queue.enqueue("once");
        await queue.runOnce();
        await queue.runOnce();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("tells the handler which attempt this is", async () => {
        const store = fakeStore();
        const attempts: number[] = [];
        const queue = createJobQueue(store, {
            backoff: () => 0,
            tasks: {
                flaky: (ctx) => {
                    attempts.push(ctx.attempt);
                    if (ctx.attempt < 3) throw new Error("not yet");
                }
            }
        });

        await queue.enqueue("flaky");
        await queue.runOnce();
        await queue.runOnce();
        await queue.runOnce();

        expect(attempts).toEqual([1, 2, 3]);
        expect((await store.fetch("1"))?.status).toBe("succeeded");
    });
});

describe("a job that throws", () => {
    it("goes back to pending with a later runAt while attempts remain", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, {
            backoff: () => 60_000,
            tasks: { boom: () => { throw new Error("nope"); } }
        });

        await queue.enqueue("boom");
        await queue.runOnce();

        const job = await store.fetch("1");
        expect(job?.status).toBe("pending");
        expect(Date.parse(job!.runAt)).toBeGreaterThan(Date.now() + 30_000);
        expect(job?.lastError).toContain("nope");
    });

    it("is not picked up again until its backoff has elapsed", async () => {
        const store = fakeStore();
        const handler = jest.fn(() => { throw new Error("nope"); });
        const queue = createJobQueue(store, { backoff: () => 60_000, tasks: { boom: handler as never } });

        await queue.enqueue("boom");
        await queue.runOnce();
        await queue.runOnce();

        // Without the delay this is a hot loop against the failing dependency
        // the retry is meant to be waiting for.
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("is dead-lettered, and kept, once attempts run out", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, {
            backoff: () => 0,
            tasks: { boom: () => { throw new Error("still nope"); } }
        });

        await queue.enqueue("boom", null, { maxAttempts: 2 });
        await queue.runOnce();
        await queue.runOnce();
        await queue.runOnce();

        const job = await store.fetch("1");
        // Kept, not deleted: a queue that silently drops what it could not
        // deliver looks exactly like one with nothing to do.
        expect(job?.status).toBe("failed");
        expect(job?.attempts).toBe(2);
        expect(job?.lastError).toContain("still nope");
    });

    it("records a non-Error throw rather than losing it", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, { backoff: () => 0, tasks: { boom: () => { throw "a string"; } } });

        await queue.enqueue("boom", null, { maxAttempts: 1 });
        await queue.runOnce();

        expect((await store.fetch("1"))?.lastError).toContain("a string");
    });
});

describe("a task this instance does not know", () => {
    it("is returned to the queue rather than failed", async () => {
        // The rolling-deploy case: this pod has not been updated yet, and the
        // job belongs to code its peers are already running.
        const store = fakeStore();
        const queue = createJobQueue(store, { backoff: () => 0, tasks: {} });

        await queue.enqueue("from-the-future");
        await queue.runOnce();

        expect((await store.fetch("1"))?.status).toBe("pending");
    });

    it("runs as soon as a handler is registered", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, { backoff: () => 0 });
        await queue.enqueue("later");
        await queue.runOnce();

        const handler = jest.fn();
        queue.register("later", handler as never);
        await queue.runOnce();

        expect(handler).toHaveBeenCalledTimes(1);
        expect((await store.fetch("1"))?.status).toBe("succeeded");
    });

    it("still dead-letters eventually, so it cannot cycle forever", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, { backoff: () => 0, tasks: {} });

        await queue.enqueue("nobody-implements-this", null, { maxAttempts: 2 });
        await queue.runOnce();
        await queue.runOnce();

        const job = await store.fetch("1");
        expect(job?.status).toBe("failed");
        expect(job?.lastError).toContain("No handler registered");
    });
});

describe("a worker that dies holding a job", () => {
    it("has its job reclaimed once the visibility timeout passes", async () => {
        const store = fakeStore();

        // Claimed and never reported on — exactly what a SIGKILLed pod leaves.
        await store.insert({ task: "orphan", payload: null, runAt: new Date(), maxAttempts: 3 });
        await store.claim(1, "dead-worker");
        expect((await store.fetch("1"))?.status).toBe("running");

        store.jobs[0].lockedAt = Date.now() - 10 * 60_000;
        expect(await store.reapExpired(5 * 60_000)).toBe(1);

        expect((await store.fetch("1"))?.status).toBe("pending");
    });

    it("is dead-lettered rather than revived when it died on its last attempt", async () => {
        const store = fakeStore();
        await store.insert({ task: "orphan", payload: null, runAt: new Date(), maxAttempts: 1 });
        await store.claim(1, "dead-worker");

        store.jobs[0].lockedAt = Date.now() - 10 * 60_000;
        await store.reapExpired(5 * 60_000);

        const job = await store.fetch("1");
        expect(job?.status).toBe("failed");
        // Otherwise this row reads as "3 attempts, no error" — a genuinely
        // baffling thing to find in a queue.
        expect(job?.lastError).toContain("stopped responding");
    });

    it("leaves a job alone while it is still within the timeout", async () => {
        const store = fakeStore();
        await store.insert({ task: "slow", payload: null, runAt: new Date(), maxAttempts: 3 });
        await store.claim(1, "busy-worker");

        expect(await store.reapExpired(5 * 60_000)).toBe(0);
        expect((await store.fetch("1"))?.status).toBe("running");
    });
});

describe("enqueue options", () => {
    it("holds a delayed job back until its time", async () => {
        const store = fakeStore();
        const handler = jest.fn();
        const queue = createJobQueue(store, { tasks: { later: handler as never } });

        await queue.enqueue("later", null, { delayMs: 60_000 });

        expect(await queue.runOnce()).toBe(0);
        expect(handler).not.toHaveBeenCalled();
    });

    it("collapses a duplicate idempotency key onto the queued job", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, { tasks: { send: () => undefined } });

        const first = await queue.enqueue("send", { to: "a" }, { idempotencyKey: "welcome:u1" });
        const second = await queue.enqueue("send", { to: "a" }, { idempotencyKey: "welcome:u1" });

        expect(first).toBe("1");
        // `null` rather than a throw: the work the caller wanted is queued,
        // which is the outcome they asked for.
        expect(second).toBeNull();
        expect(await queue.runOnce()).toBe(1);
    });

    it("lets the key be reused once its job has finished", async () => {
        // Otherwise "the nightly digest for user 7" is sendable exactly once,
        // ever.
        const store = fakeStore();
        const queue = createJobQueue(store, { tasks: { digest: () => undefined } });

        await queue.enqueue("digest", null, { idempotencyKey: "digest:u7" });
        await queue.runOnce();

        expect(await queue.enqueue("digest", null, { idempotencyKey: "digest:u7" })).toBe("2");
    });
});

describe("the batch", () => {
    it("claims no more than the configured concurrency at once", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, { concurrency: 2, tasks: { t: () => undefined } });

        for (let i = 0; i < 5; i++) await queue.enqueue("t");

        expect(await queue.runOnce()).toBe(2);
        expect(await queue.runOnce()).toBe(2);
        expect(await queue.runOnce()).toBe(1);
    });

    it("runs the rest of a batch when one job's handler throws", async () => {
        const store = fakeStore();
        const ok = jest.fn();
        const queue = createJobQueue(store, {
            concurrency: 5,
            backoff: () => 0,
            tasks: { bad: () => { throw new Error("x"); }, good: ok as never }
        });

        await queue.enqueue("bad");
        await queue.enqueue("good");
        await queue.enqueue("good");

        await queue.runOnce();

        expect(ok).toHaveBeenCalledTimes(2);
    });
});

describe("backoff", () => {
    it("widens with each attempt", () => {
        expect(defaultBackoff(1)).toBe(1_000);
        expect(defaultBackoff(2)).toBe(5_000);
        expect(defaultBackoff(3)).toBe(25_000);
    });

    it("is capped, so a long-failing job does not schedule itself past the heat death", () => {
        expect(defaultBackoff(50)).toBe(60 * 60_000);
    });
});
