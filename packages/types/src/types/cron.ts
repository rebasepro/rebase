import type { RebaseClient } from "../controllers/client";

/**
 * Cron Job type definitions for Rebase.
 *
 * These types define the shape of cron job definitions, their runtime
 * status, and execution log entries — used across server-core, client,
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
     * The server-side {@link RebaseClient}. This is the **same singleton**
     * exposed as `rebase` (imported from `@rebasepro/server`) and as
     * `context` in collection callbacks — it is only named `client` here.
     *
     * Its data plane (`client.data`) runs with **admin privileges and bypasses
     * RLS** (`{ uid: "service", roles: ["admin"] }`). There is no per-request
     * user in a cron, so treat every query as fully trusted and scope your own
     * filters explicitly.
     */
    client: RebaseClient;
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
