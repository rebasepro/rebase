import type { RebaseServerClient } from "../controllers/client";
import type { RebaseSdkData } from "../controllers/data";

/**
 * Cron Job type definitions for Rebase.
 *
 * These types define the shape of cron job definitions, their runtime
 * status, and execution log entries — used across server, client,
 * and studio packages.
 */

// =============================================================================
// CRON JOB DEFINITION (static, declared by the developer)
// =============================================================================

/**
 * A cron job definition file exports this shape as its default export.
 * See the example cron files in `app/backend/crons/` for usage.
 */
export interface CronJobDefinition {
    // Cron schedule expression, e.g. "0 3 * * *" for daily at 3 AM.
    schedule: string;

    /** Human-readable name shown in the Studio UI. */
    name: string;

    /** Optional description shown in the Studio UI. */
    description?: string;

    /**
     * Whether the job is enabled at startup. Defaults to `true`.
     * Can be toggled at runtime via the Admin API.
     */
    enabled?: boolean;

    /**
     * Maximum number of seconds the handler may run before being
     * considered timed-out. Default: 300 (5 min).
     */
    timeoutSeconds?: number;

    /**
     * How far back to look, on startup, for a slot that elapsed while no
     * instance was holding a timer for it. Off by default.
     *
     * The scheduler drives jobs with in-process `setTimeout` and computes the
     * next slot from *now* on every boot, so a slot only fires if some instance
     * happened to be alive and ticking when it came round. That is not a
     * scale-to-zero problem: a platform that recycles containers — Cloud Run
     * rotating an instance under `--min-instances 1`, a rolling deploy, a crash
     * loop — drops any slot that falls inside the changeover, and the
     * replacement schedules the slot *after* it. The run is skipped in silence.
     *
     * Set this to a window comfortably wider than a restart (a few minutes for
     * a frequent job; an hour or more for a daily one) and startup will run a
     * slot it finds unclaimed inside that window.
     *
     * Two deliberate limits:
     *
     * - **Only the most recent missed slot runs.** Booting after a six-hour
     *   outage catches an hourly job up once, not six times. Catch-up exists to
     *   stop a run going missing, not to replay history.
     * - **A claims-capable store is required.** Catch-up is skipped entirely
     *   when the store has no `tryClaimRun` (or no store is attached), because
     *   the claim is the only thing that distinguishes "this slot never ran"
     *   from "this slot already ran on the instance I am replacing". Without
     *   it, an instance recycled every 30 minutes would re-run the same hourly
     *   job every time it booted.
     *
     * @example catchUpWindowSeconds: 3600  // daily job: tolerate an hour of downtime
     */
    catchUpWindowSeconds?: number;

    /**
     * The handler function executed on each tick.
     * Receives a context object with the data driver and logger.
     * May return arbitrary JSON-serialisable data stored in the log.
     */
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}


/**
 * Context passed to each cron handler invocation.
 */
export interface CronJobContext {
    /** The job's unique ID (derived from filename). */
    jobId: string;

    /** The current scheduled tick timestamp. */
    scheduledAt: Date;

    /** A simple logger scoped to this job run. */
    log: (...args: unknown[]) => void;

    /**
     * The server-side Rebase singleton — the **same object** `import { rebase }
     * from "@rebasepro/server"` returns, and the same one `defineFunction`
     * hands its callback. Spelled the same way here so that one thing has one
     * name across every server-side authoring surface.
     *
     * Its data plane is {@link RebaseServerClient.dataAsAdmin}, which runs with
     * **admin privileges and bypasses RLS** (`{ uid: "service", roles:
     * ["admin"] }`). A cron has no per-request user, so there is no user-scoped
     * alternative here and no policy to fall back on: scope every query's
     * filters yourself.
     *
     * @example
     * export default defineCron({
     *     name: "Nightly cleanup",
     *     schedule: "0 3 * * *",
     *     async handler({ rebase, log }) {
     *         const expired = await rebase.dataAsAdmin.sessions.findAll({
     *             where: { expired: ["==", true] }
     *         });
     *         for (const session of expired) {
     *             await rebase.dataAsAdmin.sessions.delete(session.id as string);
     *         }
     *         log(`Deleted ${expired.length} expired sessions`);
     *     }
     * });
     */
    rebase: RebaseServerClient;

    /**
     * The same object as {@link rebase}, under the name this context used
     * before.
     *
     * @deprecated Use `rebase` instead. Two things made the old name a problem,
     * and neither was cosmetic. It contradicted every other server surface,
     * where the singleton is `rebase` — the previous docstring had to end with
     * *"it is only named `client` here"*. And typing it as `RebaseClient`
     * re-exposed `client.data`, the alias that {@link RebaseServerClient}
     * deliberately `Omit`s so the RLS-bypassing plane has exactly one name and
     * the privilege is visible at the call site. A reader who learned
     * `client.data` here carried it to a collection callback, where
     * `context.data` is the *user-scoped* plane — same spelling, opposite
     * privilege.
     *
     * Still the full server client at runtime, and `data` still resolves, so
     * existing cron files keep working and keep compiling. It will be removed
     * in the next major.
     */
    client: RebaseServerClient & {
        /** @deprecated Use `rebase.dataAsAdmin` — the name states the privilege. */
        data: RebaseSdkData;
    };
}

// =============================================================================
// CRON JOB RUNTIME STATUS (what the API returns)
// =============================================================================

export type CronJobRunState = "idle" | "running" | "success" | "error" | "disabled";

/**
 * Full runtime information about a registered cron job.
 */
export interface CronJobStatus {
    /** Unique identifier (derived from filename, e.g. "cleanup-sessions"). */
    id: string;

    /** Human-readable name from the definition. */
    name: string;

    /** Description from the definition. */
    description?: string;

    /** The cron schedule expression. */
    schedule: string;

    /** Whether the job is currently enabled. */
    enabled: boolean;

    /** Current run state. */
    state: CronJobRunState;

    /** ISO timestamp of the last execution start. */
    lastRunAt?: string;

    /** ISO timestamp of the next scheduled execution. */
    nextRunAt?: string;

    /** Duration of the last run in milliseconds. */
    lastDurationMs?: number;

    /** Error message from the last failed run. */
    lastError?: string;

    /** Total number of executions since server start. */
    totalRuns: number;

    /** Total number of failed executions since server start. */
    totalFailures: number;
}

// =============================================================================
// CRON JOB LOG ENTRY
// =============================================================================

export type CronLogLevel = "info" | "error" | "warn";

/**
 * A single execution log entry stored in the in-memory ring buffer.
 */
export interface CronJobLogEntry {
    /** The job ID this log belongs to. */
    jobId: string;

    /** ISO timestamp when execution started. */
    startedAt: string;

    /** ISO timestamp when execution finished. */
    finishedAt: string;

    /** Duration in milliseconds. */
    durationMs: number;

    /** Whether this run succeeded. */
    success: boolean;

    /** Error message if the run failed. */
    error?: string;

    /** Arbitrary result data returned by the handler. */
    result?: unknown;

    /** Captured log lines. */
    logs: string[];

    /** Whether this was a manual trigger. */
    manual?: boolean;
}
