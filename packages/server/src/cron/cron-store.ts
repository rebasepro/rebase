import type { CronJobLogEntry } from "@rebasepro/types";
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { logger } from "../utils/logger.js";

/**
 * Persistence layer for cron job execution logs.
 *
 * Uses the DataDriver's `admin.executeSql` capability to store logs in a
 * `rebase.cron_logs` table. Falls back gracefully if the driver doesn't
 * support SQL (e.g. MongoDB) — in that case, no persistence occurs.
 */
export interface CronStore {
    /** Ensure the backing table exists. Called once on startup. */
    ensureTable(): Promise<void>;

    /** Persist a single log entry after execution. */
    insertLog(entry: CronJobLogEntry): Promise<void>;

    /**
     * Fetch the most recent logs for a job.
     * @param jobId  The job identifier
     * @param limit  Max entries to return (default 50)
     * @returns Logs sorted newest-first
     */
    fetchLogs(jobId: string, limit?: number): Promise<CronJobLogEntry[]>;

    /**
     * Fetch aggregate stats for all jobs (totalRuns, totalFailures, lastRunAt).
     * Used to seed in-memory counters on startup.
     */
    fetchJobStats(): Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>>;

    /**
     * Atomically claim a scheduled run slot for a job.
     *
     * `slot` is the *scheduled* fire time (ISO string) derived from the cron
     * expression — deterministic across instances regardless of timer drift,
     * so all instances contend on the same (jobId, slot) key. Exactly one
     * caller wins the insert against the unique constraint and executes;
     * the rest skip.
     *
     * Fails open (returns true) on unexpected store errors, so a broken
     * claims table degrades to uncoordinated execution rather than silently
     * never running jobs.
     *
     * Optional so custom stores written against the pre-claims interface
     * keep working — the scheduler treats a missing implementation as
     * uncoordinated (always run).
     */
    tryClaimRun?(jobId: string, slot: string): Promise<boolean>;
}

// ─── SQL-based implementation ────────────────────────────────────────

const TABLE = "rebase.cron_logs";
const CLAIMS_TABLE = "rebase.cron_claims";

/** Claims older than this are garbage-collected on startup. */
const CLAIM_RETENTION_DAYS = 7;

/**
 * How far ahead a claim may legitimately sit. Slots are claimed as they fire,
 * so anything beyond this is a clock-skewed peer at best and a stranded claim
 * at worst; see the sweep in `ensureTable`.
 */
const FUTURE_CLAIM_SKEW_MINUTES = 2;

/**
 * Detect a unique-constraint violation anywhere in an error's cause chain.
 * Drizzle wraps the PG error — match the SQLSTATE code, never message text.
 * Also covers SQLite ("UNIQUE constraint failed") and MySQL (ER_DUP_ENTRY 1062)
 * for future SQL drivers.
 */
function isUniqueViolation(err: unknown): boolean {
    let current: unknown = err;
    for (let depth = 0; depth < 10 && current; depth++) {
        if (typeof current === "object") {
            const e = current as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
            if (e.code === "23505" || e.errno === 1062) return true;
            if (typeof e.message === "string" && e.message.includes("UNIQUE constraint failed")) return true;
            current = e.cause;
        } else {
            break;
        }
    }
    return false;
}

export function createCronStore(driver: DataDriver): CronStore | undefined {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) {
        logger.warn("⚠️ [cron-store] DataDriver does not support SQL admin — cron logs will not be persisted.");
        return undefined;
    }

    const exec = (sqlText: string, options?: { params?: unknown[] }) =>
        admin.executeSql(sqlText, options?.params ? { params: options.params } : undefined);

    return {
        async ensureTable(): Promise<void> {
            try {
                await exec("CREATE SCHEMA IF NOT EXISTS rebase");
                await exec(`
                    CREATE TABLE IF NOT EXISTS ${TABLE} (
                        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                        job_id TEXT NOT NULL,
                        started_at TIMESTAMPTZ NOT NULL,
                        finished_at TIMESTAMPTZ NOT NULL,
                        duration_ms INTEGER NOT NULL,
                        success BOOLEAN NOT NULL DEFAULT true,
                        error TEXT,
                        result JSONB,
                        logs JSONB,
                        manual BOOLEAN NOT NULL DEFAULT false
                    )
                `);

                await exec(`
                    CREATE INDEX IF NOT EXISTS idx_cron_logs_job
                    ON ${TABLE}(job_id, started_at DESC)
                `);

                await exec(`
                    CREATE TABLE IF NOT EXISTS ${CLAIMS_TABLE} (
                        job_id TEXT NOT NULL,
                        slot TIMESTAMPTZ NOT NULL,
                        claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (job_id, slot)
                    )
                `);

                // Garbage-collect old claims — they are only needed while
                // instances could still contend on the same slot.
                await exec(
                    `DELETE FROM ${CLAIMS_TABLE} WHERE claimed_at < now() - make_interval(days => $1)`,
                    { params: [CLAIM_RETENTION_DAYS] }
                );

                // Drop claims for slots that have not happened yet. A slot is
                // claimed at the moment it fires, so a future one can only come
                // from a timer that woke early — and because claims are
                // permanent, that claim would silently skip the real run when it
                // finally came due. The margin keeps a legitimate claim made
                // moments early by a clock-skewed peer.
                const stranded = await exec(
                    `DELETE FROM ${CLAIMS_TABLE}
                     WHERE slot > now() + make_interval(mins => $1)
                     RETURNING job_id, slot`,
                    { params: [FUTURE_CLAIM_SKEW_MINUTES] }
                );
                // A driver that does not honour RETURNING gives back nothing;
                // the rows are only used to report, so treat that as "none".
                for (const row of (stranded ?? []) as { job_id: string; slot: string }[]) {
                    logger.warn(
                        `[cron-store] Released a claim on the future slot ${new Date(row.slot).toISOString()} ` +
                        `for "${row.job_id}" — it was claimed by a timer that fired early, and would ` +
                        "otherwise have skipped that run"
                    );
                }

                logger.info("✅ Cron logs table ready");
            } catch (err) {
                logger.error("❌ Failed to create cron logs table", { error: err });
                logger.warn("⚠️ Continuing without cron log persistence.");
            }
        },

        async insertLog(entry: CronJobLogEntry): Promise<void> {
            try {
                const resultJson = entry.result !== undefined ? JSON.stringify(entry.result) : null;
                const logsJson = entry.logs.length > 0 ? JSON.stringify(entry.logs) : null;

                await exec(
                    `INSERT INTO ${TABLE} (job_id, started_at, finished_at, duration_ms, success, error, result, logs, manual)
                     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
                    { params: [
                        entry.jobId,
                        entry.startedAt,
                        entry.finishedAt,
                        entry.durationMs,
                        entry.success,
                        entry.error || null,
                        resultJson,
                        logsJson,
                        entry.manual
                    ]}
                );
            } catch (err) {
                // Non-blocking — log persistence should never crash the scheduler
                logger.error(`[cron-store] Failed to persist log for "${entry.jobId}"`, { error: err });
            }
        },

        async fetchLogs(jobId: string, limit = 50): Promise<CronJobLogEntry[]> {
            try {
                const rows = await exec(
                    `SELECT job_id, started_at, finished_at, duration_ms, success, error, result, logs, manual
                     FROM ${TABLE}
                     WHERE job_id = $1
                     ORDER BY started_at DESC
                     LIMIT $2`,
                    { params: [jobId, limit] }
                );

                return rows.map(rowToLogEntry);
            } catch (err) {
                logger.error(`[cron-store] Failed to fetch logs for "${jobId}"`, { error: err });
                return [];
            }
        },

        async fetchJobStats(): Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>> {
            const stats = new Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>();
            try {
                const rows = await exec(`
                    SELECT
                        job_id,
                        COUNT(*)::int AS total_runs,
                        COUNT(*) FILTER (WHERE NOT success)::int AS total_failures,
                        MAX(started_at) AS last_run_at
                    FROM ${TABLE}
                    GROUP BY job_id
                `);

                for (const row of rows) {
                    stats.set(row.job_id as string, {
                        totalRuns: row.total_runs as number,
                        totalFailures: row.total_failures as number,
                        lastRunAt: row.last_run_at ? new Date(row.last_run_at as string).toISOString() : undefined
                    });
                }
            } catch (err) {
                logger.error("[cron-store] Failed to fetch job stats", { error: err });
            }
            return stats;
        },

        async tryClaimRun(jobId: string, slot: string): Promise<boolean> {
            try {
                const rows = await exec(
                    `INSERT INTO ${CLAIMS_TABLE} (job_id, slot)
                     VALUES ($1, $2)
                     ON CONFLICT (job_id, slot) DO NOTHING
                     RETURNING job_id`,
                    { params: [jobId, slot] }
                );
                return rows.length > 0;
            } catch (err) {
                if (isUniqueViolation(err)) {
                    // Another instance won the race for this slot
                    return false;
                }
                // Fail open: better to risk a duplicate run than to have a
                // broken claims table silently stop all cron execution.
                logger.warn(`[cron-store] Claim check failed for "${jobId}" — running uncoordinated`, { error: err });
                return true;
            }
        }
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function rowToLogEntry(row: Record<string, unknown>): CronJobLogEntry {
    return {
        jobId: row.job_id as string,
        startedAt: new Date(row.started_at as string).toISOString(),
        finishedAt: new Date(row.finished_at as string).toISOString(),
        durationMs: row.duration_ms as number,
        success: row.success as boolean,
        error: (row.error as string) ?? undefined,
        result: row.result ?? undefined,
        logs: Array.isArray(row.logs) ? row.logs : (row.logs ? (() => { try { return JSON.parse(row.logs as string); } catch { return []; } })() : []),
        manual: row.manual as boolean
    };
}
