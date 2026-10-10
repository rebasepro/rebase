import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";
import { currentAmbientTransaction } from "../db/ambient-transaction.js";
import type { JobClaim, JobStore } from "./job-store.js";
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

/**
 * The longest an idle worker goes without looking for work.
 *
 * An idle worker used to claim every 2 seconds, forever: about 45,000 round
 * trips a day per pod, each with a pool checkout, and a database that could
 * never suspend. Now it is woken instead — by `NOTIFY` when another process
 * enqueues, by its own enqueues, retries and delayed jobs — and this is the
 * safety poll behind that. Where the database cannot notify it, it backs off
 * from `pollIntervalMs` to this, doubling after each look that found nothing.
 */
const IDLE_POLL_MAX_MS = 30_000;

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

/**
 * How often a worker deletes finished jobs past retention. Hourly keeps the
 * table near its retention size on a pod that is never redeployed; each sweep
 * reads only the finished rows, through `idx_jobs_finished`.
 */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60_000;

/**
 * Thrown by a handler for a failure no retry can change — a destination that
 * is refused, a receiver that redirects. The job is dead-lettered on this
 * attempt, with the message as its `last_error`, instead of spending its
 * remaining attempts proving the same thing. Returning normally is not the
 * alternative: that records the job as succeeded.
 */
export class PermanentJobError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "PermanentJobError";
    }
}

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

    // Identifies this process in `locked_by`: "which pod had it when it
    // stopped" is the first question anyone asks of a stuck job, and with the
    // attempt it is the claim an outcome is written under (see `JobClaim`).
    const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

    let timer: NodeJS.Timeout | null = null;
    /** When {@link timer} fires (epoch ms), so a later wake never postpones an earlier one. */
    let timerDue = Infinity;
    /**
     * The wait after a look that found nothing. Doubles to {@link idleCeilingMs}
     * while the worker polls on its own; back to `pollIntervalMs` whenever
     * there is work or a wake. Fixed at the ceiling while notifications wake it.
     */
    const idleCeilingMs = Math.max(IDLE_POLL_MAX_MS, pollIntervalMs);
    let idleIntervalMs = pollIntervalMs;
    /** Notifications from the database wake this worker — see `JobStore.subscribe`. */
    let listening = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    /** A wake arrived while a claim was in flight: claim again once it is done. */
    let rerun = false;
    let reapTimer: NodeJS.Timeout | null = null;
    let sweepTimer: NodeJS.Timeout | null = null;
    let sweeping = false;
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

    /**
     * Renew `claim` while its handler runs, at a third of the visibility
     * timeout, so the reaper only ever takes a job from a worker that stopped
     * renewing — a dead one — and never from one that is merely slow. Returns
     * the stop.
     */
    function keepClaim(job: JobRecord, claim: JobClaim): () => void {
        if (!store.heartbeat) return () => undefined;
        const renew = store.heartbeat.bind(store);
        const interval = setInterval(() => {
            renew(job.id, claim).then((held) => {
                if (held) return;
                clearInterval(interval);
                logger.warn(
                    `[jobs] "${job.task}" lost its claim on attempt ${claim.attempt} while running; ` +
                    "its outcome will not be recorded", { jobId: job.id }
                );
            }).catch((error: unknown) => {
                logger.warn(`[jobs] Could not renew the claim on "${job.task}"`, { jobId: job.id, error });
            });
        }, Math.max(1, Math.floor(visibilityTimeoutMs / 3)));
        interval.unref?.();
        return () => clearInterval(interval);
    }

    async function runJob(job: JobRecord): Promise<void> {
        const handler = handlers.get(job.task);
        const claim: JobClaim = { workerId, attempt: job.attempts };

        if (!handler) {
            // Only reachable through a store that ignores the `tasks` filter on
            // `claim` — the one that ships never hands this worker a task it
            // has no handler for. Give the row back for a peer that has one.
            // The attempt the claim spent is not undone, so a task nobody in
            // the fleet implements dead-letters with an error naming it rather
            // than cycling through such a store forever.
            logger.warn(`[jobs] No handler registered for task "${job.task}" — returning the job to the queue`);
            const retryAt = job.attempts < job.maxAttempts ? new Date(Date.now() + backoff(job.attempts)) : null;
            await store.fail(job.id, `No handler registered for task "${job.task}"`, retryAt, claim);
            if (retryAt) wake(retryAt.getTime());
            return;
        }

        const releaseClaim = keepClaim(job, claim);
        try {
            try {
                await handler({
                    id: job.id,
                    task: job.task,
                    payload: job.payload as never,
                    attempt: job.attempts,
                    maxAttempts: job.maxAttempts
                } as never);
            } finally {
                releaseClaim();
            }
            await store.complete(job.id, claim);
        } catch (error) {
            const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
            const permanent = error instanceof PermanentJobError;
            const willRetry = !permanent && job.attempts < job.maxAttempts;

            // Truncated, because `last_error` holds a stack and a queue that
            // accumulates megabytes of them is its own outage.
            const retryAt = willRetry ? new Date(Date.now() + backoff(job.attempts)) : null;
            await store.fail(job.id, message.slice(0, 4_000), retryAt, claim);
            // This worker knows when the retry is due; nobody will notify it.
            if (retryAt) wake(retryAt.getTime());

            if (willRetry) {
                logger.warn(`[jobs] "${job.task}" failed on attempt ${job.attempts}/${job.maxAttempts}; retrying`, { jobId: job.id });
            } else if (permanent) {
                logger.error(`[jobs] "${job.task}" failed permanently on attempt ${job.attempts}; not retrying`, { jobId: job.id, error: message });
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
            // Revived jobs are runnable now, and nothing notified anyone.
            if (await store.reapExpired(visibilityTimeoutMs) > 0) wake();
        } catch (error) {
            logger.error("[jobs] Failed to reclaim expired jobs", { error });
        } finally {
            reaping = false;
        }
    }

    /**
     * Delete finished jobs past retention. On the worker, on its own timer:
     * the sweep used to run only in the boot path, awaited before the server
     * served, so a pod that lived for weeks never pruned and the next boot
     * paid for all of it at once.
     */
    async function sweep(): Promise<void> {
        if (sweeping || !store.sweepExpired) return;
        sweeping = true;
        try {
            const deleted = await store.sweepExpired();
            if (deleted > 0) logger.info(`[jobs] Removed ${deleted} finished job(s) past retention`);
        } catch (error) {
            logger.warn("[jobs] The retention sweep failed; it runs again within the hour", { error });
        } finally {
            sweeping = false;
        }
    }

    /** Claim as many jobs as there are free slots and start each one on its own. */
    async function claimAndStart(): Promise<Promise<void>[]> {
        const free = concurrency - active.size;
        if (free <= 0) return [];

        // Only the tasks this worker can run. During a rolling deploy an
        // instance on older code shares the table with jobs whose task only
        // the newer code implements, and a claim spends an attempt: claiming
        // them here would dead-letter them before an updated peer got to them.
        // A handler registered after `start()` joins the next claim.
        if (handlers.size === 0) return [];
        const jobs = await store.claim(free, workerId, [...handlers.keys()]);
        backlog = jobs.length >= free;
        // Found work: look again soon if it runs out. Found none: wait longer.
        if (jobs.length > 0) idleIntervalMs = pollIntervalMs;

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

    /** Look for work in `delayMs` — unless a look is already due sooner. */
    function schedule(delayMs: number): void {
        if (!running) return;
        const due = Date.now() + delayMs;
        if (timer && timerDue <= due) return;
        if (timer) clearTimeout(timer);
        timerDue = due;
        timer = setTimeout(() => {
            timer = null;
            timerDue = Infinity;
            void tick();
        }, delayMs);
        // Never hold the process open. A queue with nothing to do should not be
        // the reason `rebase dev` will not exit.
        timer.unref?.();
    }

    /**
     * Work may be runnable at `runAtMs` (now, when absent): a job was enqueued
     * — here, or in another process that notified — or a retry or a reclaimed
     * job came due. Resets the back-off.
     */
    function wake(runAtMs?: number): void {
        if (!running) return;
        idleIntervalMs = pollIntervalMs;
        const delay = runAtMs === undefined ? 0 : Math.max(0, runAtMs - Date.now());
        if (delay === 0 && active.size >= concurrency) {
            // Every slot is busy: the next one to free claims at once.
            backlog = true;
            return;
        }
        schedule(delay);
    }

    async function tick(): Promise<void> {
        if (!running) return;
        // A claim already in progress looks again when it finishes — the wake
        // may be for a row its snapshot did not see.
        if (claiming) {
            rerun = true;
            return;
        }
        const work = claimAndStart().catch((error) => {
            logger.error("[jobs] Poll failed", { error });
            backlog = false;
        });
        claiming = work;
        await work;
        claiming = null;

        // A full claim with a slot still free — a job already finished — means
        // go straight back, and so does a wake that came in mid-claim.
        // Otherwise sleep; a job finishing during a backlog wakes the loop
        // early, and so does anything that calls `wake`.
        if ((backlog && active.size < concurrency) || rerun) {
            rerun = false;
            schedule(0);
            return;
        }
        if (listening) {
            schedule(idleCeilingMs);
            return;
        }
        schedule(idleIntervalMs);
        idleIntervalMs = Math.min(idleIntervalMs * 2, idleCeilingMs);
    }

    /** Be woken by the database when another process enqueues — where it can. */
    function listen(): void {
        if (!store.subscribe) return;
        store.subscribe(
            (runAtMs) => wake(runAtMs),
            // Notifications sent while the connection was down are gone.
            () => wake()
        ).then((stop) => {
            if (!running) {
                void stop().catch(() => undefined);
                return;
            }
            unsubscribe = stop;
            listening = true;
            logger.info(`[jobs] Woken by the database on enqueue; looking every ${idleCeilingMs / 1000}s besides`);
        }).catch((error: unknown) => {
            logger.info(
                `[jobs] Not woken by the database (${error instanceof Error ? error.message : String(error)}); ` +
                `polling instead, from every ${pollIntervalMs}ms up to every ${idleCeilingMs / 1000}s while idle`
            );
        });
    }

    async function drain(): Promise<void> {
        await claiming;
        await Promise.allSettled([...active]);
    }

    return {
        start(): void {
            if (running) return;
            running = true;
            idleIntervalMs = pollIntervalMs;
            logger.info(`[jobs] Worker started (concurrency ${concurrency}, poll ${pollIntervalMs}ms, up to ${idleCeilingMs}ms while idle)`);
            void reap();
            reapTimer = setInterval(() => { void reap(); }, visibilityTimeoutMs * REAP_INTERVAL_FACTOR);
            reapTimer.unref?.();
            void sweep();
            sweepTimer = setInterval(() => { void sweep(); }, RETENTION_SWEEP_INTERVAL_MS);
            sweepTimer.unref?.();
            listen();
            schedule(0);
        },

        async stop(timeoutMs?: number): Promise<void> {
            running = false;
            if (timer) {
                clearTimeout(timer);
                timer = null;
                timerDue = Infinity;
            }
            listening = false;
            const stopListening = unsubscribe;
            unsubscribe = null;
            if (stopListening) {
                await stopListening().catch((error: unknown) => {
                    logger.warn("[jobs] Could not close the notification connection", { error });
                });
            }
            if (reapTimer) {
                clearInterval(reapTimer);
                reapTimer = null;
            }
            if (sweepTimer) {
                clearInterval(sweepTimer);
                sweepTimer = null;
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
            const runAt = new Date(Date.now() + (enqueueOptions.delayMs ?? 0));
            // Read before the insert, which may await: inside a write the row
            // is invisible until that write commits, so that is when to look.
            const ambient = currentAmbientTransaction();
            const id = await store.insert({
                task,
                payload: payload ?? null,
                runAt,
                maxAttempts: enqueueOptions.maxAttempts ?? defaultMaxAttempts,
                idempotencyKey: enqueueOptions.idempotencyKey
            });
            // This process's own worker needs no notification to hear about it.
            if (id !== null && running) {
                if (ambient) ambient.afterCommit(() => wake(runAt.getTime()));
                else wake(runAt.getTime());
            }
            return id;
        }
    };
}
