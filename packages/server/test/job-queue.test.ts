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
 *  - an unknown task is neither: it is never claimed. During a rolling deploy
 *    the instance running old code shares the table with jobs belonging to new
 *    code, and a claim spends an attempt, so claiming them would dead-letter
 *    work the fleet is minutes away from being able to run;
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
        async claim(limit, _workerId, tasks) {
            const now = Date.now();
            const claimed = jobs
                .filter(j => j.status === "pending" && Date.parse(j.runAt) <= now)
                .filter(j => tasks === undefined || tasks.includes(j.task))
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
    it("is never claimed, so none of its attempts are spent", async () => {
        // The rolling-deploy case: this pod has not been updated yet, and the
        // job belongs to code its peers are already running. Claiming it here
        // spent an attempt each time, and an old pod polling through a
        // rollout dead-lettered the new code's jobs with "No handler
        // registered" before any updated peer got to them.
        const store = fakeStore();
        const queue = createJobQueue(store, { backoff: () => 0, tasks: { known: () => undefined } });

        await queue.enqueue("from-the-future", null, { maxAttempts: 3 });
        for (let i = 0; i < 5; i++) await queue.runOnce();

        const job = await store.fetch("1");
        expect(job?.status).toBe("pending");
        expect(job?.attempts).toBe(0);
        expect(job?.lastError).toBeNull();
    });

    it("is left for a peer that has the handler", async () => {
        const store = fakeStore();
        const oldPod = createJobQueue(store, { backoff: () => 0, tasks: {} });
        const ran: string[] = [];
        const newPod = createJobQueue(store, { tasks: { "from-the-future": (ctx) => { ran.push(ctx.id); } } });

        await oldPod.enqueue("from-the-future");
        await oldPod.runOnce();
        await newPod.runOnce();

        expect(ran).toEqual(["1"]);
        expect((await store.fetch("1"))?.attempts).toBe(1);
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

    it("does not crowd out the tasks this instance does know", async () => {
        // Queued first, so an unfiltered claim of one would take it every time.
        const store = fakeStore();
        const ran = jest.fn();
        const queue = createJobQueue(store, { concurrency: 1, tasks: { known: ran as never } });

        await queue.enqueue("from-the-future");
        await queue.enqueue("known");

        expect(await queue.runOnce()).toBe(1);
        expect(ran).toHaveBeenCalledTimes(1);
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

/** Resolves once `condition` holds, or rejects after `ms` saying what never happened. */
async function waitFor(condition: () => boolean, what: string, ms = 2_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

/**
 * The running loop, with a handler that never settles.
 *
 * A worker that waits for its whole batch before claiming again is held by its
 * slowest job: one handler awaiting a socket that never answers stopped every
 * other slot on the instance, the reaper with them — it only ran from inside
 * the poll — and then `stop()`, which waited for the same batch.
 */
describe("a job that never finishes", () => {
    const hang = () => new Promise<void>(() => { /* never settles */ });

    it("does not stop the worker claiming for its other slots", async () => {
        const store = fakeStore();
        const done: string[] = [];
        const queue = createJobQueue(store, {
            concurrency: 3,
            pollIntervalMs: 10,
            tasks: { stuck: hang, quick: (ctx) => { done.push(ctx.id); } }
        });

        await queue.enqueue("stuck");
        for (let i = 0; i < 6; i++) await queue.enqueue("quick");
        queue.start();
        try {
            // The first claim takes the stuck job and two quick ones; the other
            // four can only run if the two slots that came free are refilled.
            await waitFor(() => done.length === 6, "every quick job to run");
        } finally {
            void queue.stop(0);
        }
        expect(store.jobs.filter(j => j.task === "quick").every(j => j.status === "succeeded")).toBe(true);
        expect(store.jobs.find(j => j.task === "stuck")?.status).toBe("running");
    });

    it("does not stop the reaper", async () => {
        const store = fakeStore();
        let reaps = 0;
        const reapExpired = store.reapExpired.bind(store);
        store.reapExpired = async (ms) => { reaps++; return reapExpired(ms); };
        const queue = createJobQueue(store, {
            concurrency: 1,
            pollIntervalMs: 10,
            // A quarter of this is the reaper's cadence: every 25ms.
            visibilityTimeoutMs: 100,
            tasks: { stuck: hang }
        });

        await queue.enqueue("stuck");
        queue.start();
        try {
            await waitFor(() => reaps >= 3, "the reaper to run while a handler hangs");
        } finally {
            void queue.stop(0);
        }
    });

    it("does not hold stop() past the budget it is given", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, { pollIntervalMs: 10, tasks: { stuck: hang } });

        await queue.enqueue("stuck");
        queue.start();
        await waitFor(() => store.jobs[0].status === "running", "the job to be claimed");

        const started = Date.now();
        const outcome = await Promise.race([
            queue.stop(50).then(() => "stopped"),
            new Promise(resolve => setTimeout(() => resolve("still waiting"), 1_000))
        ]);

        expect(outcome).toBe("stopped");
        expect(Date.now() - started).toBeLessThan(1_000);
        // Left claimed, for the visibility timeout to recover.
        expect(store.jobs[0].status).toBe("running");
    });

    it("still waits for a job that does finish inside the budget", async () => {
        const store = fakeStore();
        let release: () => void = () => undefined;
        const queue = createJobQueue(store, {
            pollIntervalMs: 10,
            tasks: { slow: () => new Promise<void>(resolve => { release = resolve; }) }
        });

        await queue.enqueue("slow");
        queue.start();
        await waitFor(() => store.jobs[0].status === "running", "the job to be claimed");

        const stopping = queue.stop(5_000);
        setTimeout(() => release(), 30);
        await stopping;

        // Recorded before stop() returned — the point of waiting at all.
        expect(store.jobs[0].status).toBe("succeeded");
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
