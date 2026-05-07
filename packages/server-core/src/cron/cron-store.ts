import type { CronJobLogEntry } from "@rebasepro/types";
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";

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
}

// ─── SQL-based implementation ────────────────────────────────────────

const TABLE = "rebase.cron_logs";

export function createCronStore(driver: DataDriver): CronStore | undefined {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) {
        console.warn("⚠️ [cron-store] DataDriver does not support SQL admin — cron logs will not be persisted.");
        return undefined;
    }

    const exec = admin.executeSql.bind(admin);

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

                console.log("✅ Cron logs table ready");
            } catch (err) {
                console.error("❌ Failed to create cron logs table:", err);
                console.warn("⚠️ Continuing without cron log persistence.");
            }
        },

        async insertLog(entry: CronJobLogEntry): Promise<void> {
            try {
                const resultJson = entry.result !== undefined ? JSON.stringify(entry.result) : null;
                const logsJson = entry.logs.length > 0 ? JSON.stringify(entry.logs) : null;
                const errorEscaped = entry.error ? entry.error.replace(/'/g, "''") : null;

                await exec(`
                    INSERT INTO ${TABLE} (job_id, started_at, finished_at, duration_ms, success, error, result, logs, manual)
                    VALUES (
                        '${entry.jobId}',
                        '${entry.startedAt}',
                        '${entry.finishedAt}',
                        ${entry.durationMs},
                        ${entry.success},
                        ${errorEscaped ? `'${errorEscaped}'` : "NULL"},
                        ${resultJson ? `'${resultJson.replace(/'/g, "''")}'::jsonb` : "NULL"},
                        ${logsJson ? `'${logsJson.replace(/'/g, "''")}'::jsonb` : "NULL"},
                        ${entry.manual}
                    )
                `);
            } catch (err) {
                // Non-blocking — log persistence should never crash the scheduler
                console.error(`[cron-store] Failed to persist log for "${entry.jobId}":`, err);
            }
        },

        async fetchLogs(jobId: string, limit = 50): Promise<CronJobLogEntry[]> {
            try {
                const rows = await exec(`
                    SELECT job_id, started_at, finished_at, duration_ms, success, error, result, logs, manual
                    FROM ${TABLE}
                    WHERE job_id = '${jobId}'
                    ORDER BY started_at DESC
                    LIMIT ${limit}
                `);

                return rows.map(rowToLogEntry);
            } catch (err) {
                console.error(`[cron-store] Failed to fetch logs for "${jobId}":`, err);
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
                console.error("[cron-store] Failed to fetch job stats:", err);
            }
            return stats;
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
        logs: Array.isArray(row.logs) ? row.logs : (row.logs ? JSON.parse(row.logs as string) : []),
        manual: row.manual as boolean
    };
}
