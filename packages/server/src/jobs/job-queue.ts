import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";
import type { JobStore } from "./job-store.js";
import type { EnqueueOptions, JobHandler, JobQueueClient, JobQueueOptions, JobRecord } from "./types.js";

/**
 * The worker: claim, run, record, repeat.
 *
 * Everything difficult about running jobs concurrently is in `job-store.ts`,
 * where one `UPDATE … FOR UPDATE SKIP LOCKED` does the arbitration. What is
 * left here is a loop and the decisions around a handler that throws.
 */

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;

/** 1s, 5s, 25s, 125s … capped at an hour. */
export function defaultBackoff(attempt: number): number {
    return Math.min(1_000 * Math.pow(5, Math.max(0, attempt - 1)), 60 * 60_000);
}

/**
 * How often the reaper runs, relative to the visibility timeout.
 *
 * A quarter of it, so a stranded job waits at most 1.25× the timeout rather
 * than 2× — and so the sweep is not itself a per-poll query against a table
 * whose interesting rows are, almost always, none.
 */
const REAP_INTERVAL_FACTOR = 0.25;

export interface JobQueue extends JobQueueClient {
    start(): void;
    /**
     * Stop claiming, and wait for the jobs in flight — for at most `timeoutMs`
     * when given. A job still running when the budget runs out keeps its claim
     * and is recovered by the visibility timeout; waiting on it without a bound
     * would let one handler that never settles hold the whole shutdown.
     */
    stop(timeoutMs?: number): Promise<void>;
    /**
     * Claim what fits in the free slots, run it, and resolve with how many jobs
     * ran. For tests and for `/jobs/drain`; not meant to run beside `start()`.
     */
    runOnce(): Promise<number>;
    /** Registered after construction — how `tasks` from config and internal producers meet. */
    register<P = unknown>(task: string, handler: JobHandler<P>): void;
    isRunning(): boolean;
}

export function createJobQueue(store: JobStore, options: JobQueueOptions = {}): JobQueue {
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const visibilityTimeoutMs = options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
    const defaultMaxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const backoff = options.backoff ?? defaultBackoff;

    const handlers = new Map<string, JobHandler<never>>();
    for (const [task, handler] of Object.entries(options.tasks ?? {})) {
        handlers.set(task, handler);
    }

    // Identifies this process in `locked_by`. Purely diagnostic — the claim is
    // enforced by the row lock, not by this — but "which pod had it when it
    // stopped" is the first question anyone asks of a stuck job.
    const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

    let timer: NodeJS.Timeout | null = null;
    let reapTimer: NodeJS.Timeout | null = null;
    let running = false;
    /**
     * Every job this worker is running, tracked one by one rather than per
     * claimed batch: a batch would let its slowest job decide when the next
     * claim happens, so one handler that never settled would idle every other
     * slot — and hold `stop()` with it.
     */
    const active = new Set<Promise<void>>();
    /** The claim in progress, so `stop()` also waits for jobs it is about to hand out. */
    let claiming: Promise<unknown> | null = null;
    /** The last claim filled every free slot, so more work is probably waiting. */
    let backlog = false;
    let reaping = false;
    let draining: Promise<void> | null = null;

    async function runJob(job: JobRecord): Promise<void> {
        const handler = handlers.get(job.task);

        if (!handler) {
            // Not a failure. A rolling deploy runs old and new code at once, and
            // an instance that has not been updated yet must not burn the
            // attempts of a job belonging to one that has. Give the row back
            // and let a peer — or this process after its next deploy — take it.
            //
            // The attempt increment from the claim is deliberately not undone:
            // a task nobody in the fleet implements would otherwise cycle
            // forever, and this way it dead-letters after `maxAttempts` with an
            // error naming the task.
            logger.warn(`[jobs] No handler registered for task "${job.task}" — returning the job to the queue`);
            await store.fail(
                job.id,
                `No handler registered for task "${job.task}"`,
                job.attempts < job.maxAttempts ? new Date(Date.now() + backoff(job.attempts)) : null
            );
            return;
        }

        try {
            await handler({
                id: job.id,
                task: job.task,
                payload: job.payload as never,
                attempt: job.attempts,
                maxAttempts: job.maxAttempts
            } as never);
            await store.complete(job.id);
        } catch (error) {
            const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
            const willRetry = job.attempts < job.maxAttempts;

            // Truncated, because `last_error` holds a stack and a queue that
            // accumulates megabytes of them is its own outage.
            await store.fail(job.id, message.slice(0, 4_000), willRetry ? new Date(Date.now() + backoff(job.attempts)) : null);

            if (willRetry) {
                logger.warn(`[jobs] "${job.task}" failed on attempt ${job.attempts}/${job.maxAttempts}; retrying`, { jobId: job.id });
            } else {
                // The last attempt is an error, not a warning: nothing else will
                // touch this job, and if nobody looks at the table it is simply
                // lost work.
                logger.error(`[jobs] "${job.task}" failed permanently after ${job.attempts} attempts`, { jobId: job.id, error: message });
            }
        }
    }

    /**
     * Return jobs stranded by a dead worker. On its own timer, not inside the
     * poll: a poll can be skipped for as long as every slot is busy, and that
     * is exactly when a stranded job most needs a peer to take it back.
     */
    async function reap(): Promise<void> {
        if (reaping) return;
        reaping = true;
        try {
            await store.reapExpired(visibilityTimeoutMs);
        } catch (error) {
            logger.error("[jobs] Failed to reclaim expired jobs", { error });
        } finally {
            reaping = false;
        }
    }

    /** Claim as many jobs as there are free slots and start each one on its own. */
    async function claimAndStart(): Promise<Promise<void>[]> {
        const free = concurrency - active.size;
        if (free <= 0) return [];

        const jobs = await store.claim(free, workerId);
        backlog = jobs.length >= free;

        return jobs.map((job) => {
            const run: Promise<void> = runJob(job)
                .catch((error) => {
                    // `runJob` handles a throwing handler; this is a store
                    // write failing after it. The job keeps its claim, so the
                    // visibility timeout recovers it.
                    logger.error(`[jobs] Could not record the outcome of "${job.task}"`, { jobId: job.id, error });
                })
                .finally(() => {
                    active.delete(run);
                    // A slot just came free and there is work waiting: take the
                    // next job now, not a poll interval from now.
                    if (backlog) schedule(0);
                });
            active.add(run);
            return run;
        });
    }

    function schedule(delayMs: number): void {
        if (!running) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            void tick();
        }, delayMs);
        // Never hold the process open. A queue with nothing to do should not be
        // the reason `rebase dev` will not exit.
        timer.unref?.();
    }

    async function tick(): Promise<void> {
        // A claim already in progress reschedules when it finishes.
        if (!running || claiming) return;
        const work = claimAndStart().catch((error) => {
            logger.error("[jobs] Poll failed", { error });
            backlog = false;
        });
        claiming = work;
        await work;
        claiming = null;

        // A full claim with a slot still free — a job already finished — means
        // go straight back. Otherwise sleep; a job finishing during a backlog
        // wakes the loop early.
        schedule(backlog && active.size < concurrency ? 0 : pollIntervalMs);
    }

    async function drain(): Promise<void> {
        await claiming;
        await Promise.allSettled([...active]);
    }

    return {
        start(): void {
            if (running) return;
            running = true;
            logger.info(`[jobs] Worker started (concurrency ${concurrency}, poll ${pollIntervalMs}ms)`);
            void reap();
            reapTimer = setInterval(() => { void reap(); }, visibilityTimeoutMs * REAP_INTERVAL_FACTOR);
            reapTimer.unref?.();
            schedule(0);
        },

        async stop(timeoutMs?: number): Promise<void> {
            running = false;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (reapTimer) {
                clearInterval(reapTimer);
                reapTimer = null;
            }
            // Jobs in flight keep their claim until they finish or the
            // visibility timeout expires, so waiting here is what turns a
            // graceful shutdown into "no job runs twice".
            draining ??= drain().finally(() => { draining = null; });
            if (timeoutMs === undefined) {
                await draining;
                return;
            }
            let budget: NodeJS.Timeout | undefined;
            const finished = await Promise.race([
                draining.then(() => true),
                new Promise<false>((resolve) => {
                    budget = setTimeout(() => resolve(false), timeoutMs);
                    budget.unref?.();
                })
            ]);
            clearTimeout(budget);
            if (!finished) {
                logger.warn(
                    `[jobs] ${active.size} job(s) still running after ${timeoutMs}ms; stopping without them. ` +
                    "They keep their claim and are retried once the visibility timeout reclaims it."
                );
            }
        },

        async runOnce(): Promise<number> {
            const started = await claimAndStart();
            await Promise.allSettled(started);
            return started.length;
        },

        register<P = unknown>(task: string, handler: JobHandler<P>): void {
            if (handlers.has(task)) {
                logger.warn(`[jobs] Task "${task}" was already registered; the later handler wins`);
            }
            handlers.set(task, handler as JobHandler<never>);
        },

        isRunning(): boolean {
            return running;
        },

        async enqueue<P = unknown>(task: string, payload?: P, enqueueOptions: EnqueueOptions = {}): Promise<string | null> {
            return store.insert({
                task,
                payload: payload ?? null,
                runAt: new Date(Date.now() + (enqueueOptions.delayMs ?? 0)),
                maxAttempts: enqueueOptions.maxAttempts ?? defaultMaxAttempts,
                idempotencyKey: enqueueOptions.idempotencyKey
            });
        }
    };
}
