import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createJobQueue, defaultBackoff } from "../src/jobs";
// From the package root, the way a job handler reaches it: a handler that
// cannot name the class cannot dead-letter a job on the spot.
import { PermanentJobError } from "../src/index";
import type { JobRecord } from "../src/jobs";
import type { JobStore } from "../src/jobs";
import { logger } from "../src/utils/logger";

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

    it("is dead-lettered on the spot when it throws a PermanentJobError", async () => {
        // A failure no retry can change — a refused destination, a redirect —
        // must not spend the remaining attempts proving it, nor be reported as
        // a success because the handler chose not to throw.
        const store = fakeStore();
        const handler = jest.fn(() => { throw new PermanentJobError("the receiver redirects"); });
        const queue = createJobQueue(store, { backoff: () => 0, tasks: { deliver: handler as never } });

        await queue.enqueue("deliver", null, { maxAttempts: 5 });
        await queue.runOnce();
        await queue.runOnce();

        const job = await store.fetch("1");
        expect(handler).toHaveBeenCalledTimes(1);
        expect(job?.status).toBe("failed");
        expect(job?.attempts).toBe(1);
        expect(job?.lastError).toContain("the receiver redirects");
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

    it("fails the attempt at timeoutMs, aborts the handler's signal, and frees the slot", async () => {
        const store = fakeStore();
        let signal: AbortSignal | undefined;
        const queue = createJobQueue(store, {
            timeoutMs: 30,
            backoff: () => 60_000,
            tasks: {
                stuck: (ctx) => {
                    signal = ctx.signal;
                    return hang();
                }
            }
        });

        await queue.enqueue("stuck");
        // runOnce settles only once every job it claimed has settled — so it
        // returning at all is the slot coming free.
        expect(await queue.runOnce()).toBe(1);

        const job = store.jobs[0];
        expect(job.status).toBe("pending");
        expect(job.lastError).toMatch(/timed out after 30ms/);
        expect(signal?.aborted).toBe(true);
    });

    it("dead-letters a job that timed out on its last attempt", async () => {
        const store = fakeStore();
        const queue = createJobQueue(store, { timeoutMs: 10, maxAttempts: 1, tasks: { stuck: hang } });

        await queue.enqueue("stuck");
        await queue.runOnce();

        expect(store.jobs[0].status).toBe("failed");
    });

    it("gives every handler a signal that stays live when it finishes in time", async () => {
        const store = fakeStore();
        let signal: AbortSignal | undefined;
        const queue = createJobQueue(store, { tasks: { quick: (ctx) => { signal = ctx.signal; } } });

        await queue.enqueue("quick");
        await queue.runOnce();

        expect(signal).toBeDefined();
        expect(signal?.aborted).toBe(false);
        expect(store.jobs[0].status).toBe("succeeded");
    });

    it("refuses a timeoutMs that is negative or not a number", () => {
        for (const timeoutMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => createJobQueue(fakeStore(), { timeoutMs })).toThrow(/timeoutMs/);
        }
    });

    // Calls 2026-10-12 (P4): a handler that never settles used to hold its slot
    // for the life of the process unless `jobs.timeoutMs` was set. The default
    // is now 15 minutes; `0` is the explicit opt-out.
    it("fails an attempt at 15 minutes when timeoutMs is left out", async () => {
        jest.useFakeTimers();
        try {
            const store = fakeStore();
            let signal: AbortSignal | undefined;
            const queue = createJobQueue(store, {
                backoff: () => 60 * 60_000,
                tasks: { stuck: (ctx) => { signal = ctx.signal; return hang(); } }
            });
            await queue.enqueue("stuck");
            let settled = false;
            const run = queue.runOnce().then(() => { settled = true; });

            await jest.advanceTimersByTimeAsync(15 * 60_000 - 1);
            expect(settled).toBe(false);
            expect(signal?.aborted).toBe(false);

            await jest.advanceTimersByTimeAsync(1);
            await run;
            expect(signal?.aborted).toBe(true);
            expect(store.jobs[0].status).toBe("pending");
            expect(store.jobs[0].lastError).toMatch(/timed out after 900000ms/);
        } finally {
            jest.useRealTimers();
        }
    });

    it("sets no limit when timeoutMs is 0", async () => {
        jest.useFakeTimers();
        try {
            const store = fakeStore();
            let signal: AbortSignal | undefined;
            const queue = createJobQueue(store, {
                timeoutMs: 0,
                tasks: { stuck: (ctx) => { signal = ctx.signal; return hang(); } }
            });
            await queue.enqueue("stuck");
            let settled = false;
            void queue.runOnce().then(() => { settled = true; });

            await jest.advanceTimersByTimeAsync(24 * 60 * 60_000);
            expect(settled).toBe(false);
            expect(signal?.aborted).toBe(false);
            expect(store.jobs[0].status).toBe("running");
        } finally {
            jest.useRealTimers();
        }
    });

    it("names the default timeout once at start, and only when it applies", async () => {
        const info = jest.spyOn(logger, "info").mockImplementation(() => undefined);
        const defaulted = createJobQueue(fakeStore(), { pollIntervalMs: 60 * 60_000 });
        const explicit = createJobQueue(fakeStore(), { pollIntervalMs: 60 * 60_000, timeoutMs: 1_000 });
        const unlimited = createJobQueue(fakeStore(), { pollIntervalMs: 60 * 60_000, timeoutMs: 0 });
        try {
            defaulted.start();
            const lines = () => info.mock.calls.filter(([message]) => /jobs\.timeoutMs/.test(message)).length;
            expect(lines()).toBe(1);
            expect(info.mock.calls.find(([message]) => /jobs\.timeoutMs/.test(message))?.[0]).toMatch(/15 minutes/);
            explicit.start();
            unlimited.start();
            expect(lines()).toBe(1);
        } finally {
            await Promise.all([defaulted.stop(0), explicit.stop(0), unlimited.stop(0)]);
            info.mockRestore();
        }
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

describe("the retention sweep", () => {
    it("runs on the worker every hour, not only at boot", async () => {
        // It used to run once, inside `ensureTable`, awaited in the boot path:
        // a worker that lived for weeks never pruned, and the next boot paid
        // for all of it — six seconds of sequential scan over two million rows
        // before the server would serve.
        jest.useFakeTimers();
        const store = fakeStore();
        const sweepExpired = jest.fn(async () => 0);
        const queue = createJobQueue({ ...store, sweepExpired }, {
            pollIntervalMs: 60 * 60_000,
            visibilityTimeoutMs: 60 * 60_000
        });
        try {
            queue.start();
            await jest.advanceTimersByTimeAsync(0);
            expect(sweepExpired).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(3 * 60 * 60_000);
            expect(sweepExpired).toHaveBeenCalledTimes(4);

            await queue.stop();
            await jest.advanceTimersByTimeAsync(3 * 60 * 60_000);
            expect(sweepExpired).toHaveBeenCalledTimes(4);
        } finally {
            await queue.stop();
            jest.useRealTimers();
        }
    });

    it("keeps the worker running when a sweep fails", async () => {
        jest.useFakeTimers();
        const store = fakeStore();
        const sweepExpired = jest.fn(async () => { throw new Error("statement timeout"); });
        const queue = createJobQueue({ ...store, sweepExpired }, { pollIntervalMs: 60 * 60_000 });
        try {
            queue.start();
            await jest.advanceTimersByTimeAsync(60 * 60_000);
            expect(sweepExpired).toHaveBeenCalledTimes(2);
            expect(queue.isRunning()).toBe(true);
        } finally {
            await queue.stop();
            jest.useRealTimers();
        }
    });
});

/**
 * An idle worker used to claim every 2 seconds, forever: 43,200 claims a day
 * per pod, plus the reaper, each a pool checkout and a round trip, and a
 * database that could never suspend. Topics and queues force the worker on, so
 * a project that declared one paid it whether or not anything was queued.
 */
describe("an idle worker", () => {
    const TEN_MINUTES = 10 * 60_000;

    /** A store that counts claims and, when asked, lets the test play the database's NOTIFY. */
    function countingStore(options: { notifies?: boolean; subscribeFails?: boolean } = {}) {
        const store = fakeStore();
        let claims = 0;
        const claim = store.claim.bind(store);
        store.claim = async (...args) => { claims++; return claim(...args); };
        const wakes: { onWake?: (runAtMs?: number) => void; onReconnect?: () => void; stopped: boolean } = { stopped: false };
        if (options.notifies || options.subscribeFails) {
            store.subscribe = async (onWake, onReconnect) => {
                if (options.subscribeFails) throw new Error("no session connection");
                wakes.onWake = onWake;
                wakes.onReconnect = onReconnect;
                return async () => { wakes.stopped = true; };
            };
        }
        return { store, claims: () => claims, wakes };
    }

    afterEach(() => {
        jest.useRealTimers();
    });

    it("backs off to one look every 30 seconds when nothing notifies it", async () => {
        jest.useFakeTimers();
        const { store, claims } = countingStore();
        const queue = createJobQueue(store, { tasks: { work: () => undefined } });
        queue.start();
        try {
            await jest.advanceTimersByTimeAsync(TEN_MINUTES);
            // 2, 4, 8, 16 s, then every 30 s: 24 looks, where it used to be 301.
            expect(claims()).toBeLessThanOrEqual(25);
        } finally {
            await queue.stop();
        }
    });

    it("runs a job this process enqueues at once, and looks often again after it", async () => {
        jest.useFakeTimers();
        const { store, claims } = countingStore();
        const ran: string[] = [];
        const queue = createJobQueue(store, { tasks: { work: (ctx) => { ran.push(ctx.id); } } });
        queue.start();
        try {
            await jest.advanceTimersByTimeAsync(TEN_MINUTES);
            const before = claims();
            const id = await queue.enqueue("work");
            await jest.advanceTimersByTimeAsync(0);
            expect(ran).toEqual([id]);
            expect(claims()).toBe(before + 1);
            // The back-off starts over: the next look is 2 s away, not 30.
            await jest.advanceTimersByTimeAsync(2_000);
            expect(claims()).toBe(before + 2);
        } finally {
            await queue.stop();
        }
    });

    it("looks every 30 seconds while the database notifies it, and at once when it does", async () => {
        jest.useFakeTimers();
        const { store, claims, wakes } = countingStore({ notifies: true });
        const ran: string[] = [];
        const queue = createJobQueue(store, { tasks: { work: (ctx) => { ran.push(ctx.id); } } });
        queue.start();
        try {
            await jest.advanceTimersByTimeAsync(TEN_MINUTES);
            // The first look, then the safety poll.
            expect(claims()).toBe(21);

            // Another process enqueues: a row appears, and the notification.
            const id = await store.insert({ task: "work", payload: null, runAt: new Date(), maxAttempts: 3 });
            wakes.onWake?.(Date.now());
            await jest.advanceTimersByTimeAsync(0);
            expect(ran).toEqual([id]);

            // A delayed job is looked for when it comes due, not 30 s later.
            const later = await store.insert({ task: "work", payload: null, runAt: new Date(Date.now() + 5_000), maxAttempts: 3 });
            wakes.onWake?.(Date.now() + 5_000);
            await jest.advanceTimersByTimeAsync(5_000);
            expect(ran).toEqual([id, later]);

            // A reconnect may have missed some: look now.
            const missed = await store.insert({ task: "work", payload: null, runAt: new Date(), maxAttempts: 3 });
            wakes.onReconnect?.();
            await jest.advanceTimersByTimeAsync(0);
            expect(ran).toEqual([id, later, missed]);
        } finally {
            await queue.stop();
        }
        expect(wakes.stopped).toBe(true);
    });

    it("retries a failed job when its backoff ends, not at the next safety poll", async () => {
        jest.useFakeTimers();
        const { store, wakes } = countingStore({ notifies: true });
        let attempts = 0;
        const queue = createJobQueue(store, {
            tasks: { flaky: () => { attempts++; if (attempts === 1) throw new Error("once"); } }
        });
        queue.start();
        try {
            await jest.advanceTimersByTimeAsync(0);
            await store.insert({ task: "flaky", payload: null, runAt: new Date(), maxAttempts: 3 });
            wakes.onWake?.();
            await jest.advanceTimersByTimeAsync(0);
            expect(attempts).toBe(1);
            // defaultBackoff(1) is 1 s.
            await jest.advanceTimersByTimeAsync(1_000);
            expect(attempts).toBe(2);
        } finally {
            await queue.stop();
        }
    });

    it("claims as soon as a slot frees when it is woken with every slot busy", async () => {
        jest.useFakeTimers();
        const { store, wakes } = countingStore({ notifies: true });
        let release: () => void = () => undefined;
        const ran: string[] = [];
        const queue = createJobQueue(store, {
            concurrency: 1,
            tasks: {
                slow: () => new Promise<void>(resolve => { release = resolve; }),
                work: (ctx) => { ran.push(ctx.id); }
            }
        });
        queue.start();
        try {
            await jest.advanceTimersByTimeAsync(0);
            await queue.enqueue("slow");
            await jest.advanceTimersByTimeAsync(0);
            const id = await store.insert({ task: "work", payload: null, runAt: new Date(), maxAttempts: 3 });
            wakes.onWake?.();
            await jest.advanceTimersByTimeAsync(0);
            expect(ran).toEqual([]);
            release();
            await jest.advanceTimersByTimeAsync(0);
            expect(ran).toEqual([id]);
        } finally {
            await queue.stop();
        }
    });

    it("polls with back-off when the database cannot notify it", async () => {
        jest.useFakeTimers();
        const { store, claims } = countingStore({ subscribeFails: true });
        const queue = createJobQueue(store, { tasks: { work: () => undefined } });
        queue.start();
        try {
            await jest.advanceTimersByTimeAsync(TEN_MINUTES);
            expect(claims()).toBeGreaterThan(20);
            expect(claims()).toBeLessThanOrEqual(25);
        } finally {
            await queue.stop();
        }
    });
});
