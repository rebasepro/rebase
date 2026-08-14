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
    stop(): Promise<void>;
    /** Run one poll's worth of work and return how many jobs ran. For tests and for `/jobs/drain`. */
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
    let running = false;
    let draining = false;
    /** Resolves when the in-flight poll finishes, so `stop()` can wait for it. */
    let inFlight: Promise<unknown> = Promise.resolve();
    let lastReapAt = 0;

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

    async function poll(): Promise<number> {
        // The reaper, on its own cadence.
        const now = Date.now();
        if (now - lastReapAt > visibilityTimeoutMs * REAP_INTERVAL_FACTOR) {
            lastReapAt = now;
            try {
                await store.reapExpired(visibilityTimeoutMs);
            } catch (error) {
                logger.error("[jobs] Failed to reclaim expired jobs", { error });
            }
        }

        const jobs = await store.claim(concurrency, workerId);
        if (jobs.length === 0) return 0;

        // Settled, not `all`: `runJob` handles its own errors, but a store
        // write failing inside it must not abandon this batch's siblings.
        await Promise.allSettled(jobs.map(runJob));
        return jobs.length;
    }

    function schedule(delayMs: number): void {
        if (!running) return;
        timer = setTimeout(() => {
            void tick();
        }, delayMs);
        // Never hold the process open. A queue with nothing to do should not be
        // the reason `rebase dev` will not exit.
        timer.unref?.();
    }

    async function tick(): Promise<void> {
        if (!running) return;
        const work = (async () => {
            try {
                return await poll();
            } catch (error) {
                logger.error("[jobs] Poll failed", { error });
                return 0;
            }
        })();
        inFlight = work;
        const count = await work;

        // A full batch means there is probably more waiting, so go straight
        // back rather than sleeping through a backlog.
        schedule(count >= concurrency ? 0 : pollIntervalMs);
    }

    return {
        start(): void {
            if (running) return;
            running = true;
            logger.info(`[jobs] Worker started (concurrency ${concurrency}, poll ${pollIntervalMs}ms)`);
            schedule(0);
        },

        async stop(): Promise<void> {
            running = false;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (draining) return;
            draining = true;
            // Jobs in flight keep their claim until they finish or the
            // visibility timeout expires, so waiting here is what turns a
            // graceful shutdown into "no job runs twice".
            await inFlight.catch(() => undefined);
            draining = false;
        },

        runOnce(): Promise<number> {
            return poll();
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
