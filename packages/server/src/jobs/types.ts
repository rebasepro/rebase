/**
 * Background work that survives a restart.
 *
 * Rebase already had two ways to run something later, and neither is this one.
 * Cron runs work on a *schedule*, coordinated across instances by a claims
 * table. The webhook dispatcher runs work *soon*, from an array in memory — and
 * says so in its own docblock: "the queue is in-process and in-memory. A
 * crash…". Everything queued that way is gone on deploy, on a crash, and on the
 * pod being rescheduled, with no record that it existed.
 *
 * A job is a row. It is claimed by exactly one worker, retried on failure with
 * a widening delay, and left in the table when it finally gives up so somebody
 * can look at it. The table is the queue: there is nothing to install, nothing
 * to run alongside Postgres, and a job enqueued in a transaction that rolls
 * back was never enqueued.
 */

/** Where a job is in its life. */
export type JobStatus =
    /** Waiting for `runAt` to arrive and a worker to claim it. */
    | "pending"
    /** Claimed. `lockedAt` is when, which is what makes a dead worker recoverable. */
    | "running"
    /** Handler returned. Kept briefly so a caller can observe the outcome. */
    | "succeeded"
    /**
     * Out of attempts. Deliberately *kept* rather than deleted: a queue that
     * silently drops what it could not deliver is indistinguishable from one
     * with nothing to do.
     */
    | "failed";

/** A job as stored. */
export interface JobRecord<P = unknown> {
    id: string;
    /** Which handler runs it. */
    task: string;
    payload: P;
    status: JobStatus;
    /** Not before this instant. Bumped on each retry to implement backoff. */
    runAt: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
}

/** What a handler is given. */
export interface JobContext<P = unknown> {
    id: string;
    task: string;
    payload: P;
    /**
     * Which attempt this is, counting from 1.
     *
     * Worth branching on: the first attempt of a webhook delivery and its
     * fourth are the same call, but the fourth is the one where it is worth
     * logging loudly, or falling back to a different route.
     */
    attempt: number;
    maxAttempts: number;
}

/**
 * A handler. Throwing is how a job fails — there is no `return false`, because
 * a boolean would be silently ignored by every handler that forgot to return
 * one, and the failure path has to be the one you get by default.
 */
export type JobHandler<P = unknown> = (ctx: JobContext<P>) => Promise<void> | void;

/** Options for a single enqueue. */
export interface EnqueueOptions {
    /** Run no earlier than this many milliseconds from now. */
    delayMs?: number;
    /** Overrides the queue default (3). */
    maxAttempts?: number;
    /**
     * At most one *unfinished* job may hold a given key.
     *
     * The narrow scope is the point. Keying on the whole lifetime would mean a
     * key could never be reused — "send the nightly digest to user 7" would
     * work once, ever. Keying on unfinished work collapses a double-click, a
     * retried request, and two instances reacting to one event into a single
     * job, and still lets tomorrow's digest through.
     */
    idempotencyKey?: string;
}

/** How the worker behaves. */
export interface JobQueueOptions {
    /**
     * Off unless asked for. A worker polls the database forever, and turning
     * that on for every backend that happens to run on Postgres is not a
     * default anyone chose.
     */
    enabled?: boolean;
    /** Named handlers. A job whose `task` is not here is left alone, not failed — see the worker. */
    tasks?: Record<string, JobHandler<never>>;
    /** How many jobs one instance runs at once. Default 5. */
    concurrency?: number;
    /** How often to look for work when the last look found none. Default 2000ms. */
    pollIntervalMs?: number;
    /**
     * How long a claimed job may stay claimed before another worker may take
     * it. Default 5 minutes.
     *
     * This is the only thing that recovers work from a worker that died holding
     * it — a `SIGKILL`ed pod cannot release its own claim. It is therefore also
     * the interval after which a job that legitimately runs longer than this
     * gets a *second* worker running it concurrently, so it must exceed the
     * slowest handler.
     */
    visibilityTimeoutMs?: number;
    /** Attempts before a job is left `failed`. Default 3. */
    maxAttempts?: number;
    /**
     * Delay before attempt N+1, in milliseconds. Default: 1s, 5s, 25s, …
     * capped at an hour.
     */
    backoff?: (attempt: number) => number;
}

/** The enqueue side, as application code sees it. */
export interface JobQueueClient {
    /**
     * Add a job. Resolves with its id, or with `null` when an
     * `idempotencyKey` matched an unfinished job — the caller usually does not
     * care which, and the ones that do can tell.
     */
    enqueue<P = unknown>(task: string, payload?: P, options?: EnqueueOptions): Promise<string | null>;
}
