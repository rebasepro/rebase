import type { CronJobLogEntry } from "@rebasepro/types";
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { logger } from "../utils/logger.js";
import { createDdlBootstrapper, hasInCauseChain } from "../boot/ddl-bootstrap.js";

/**
 * Persistence layer for cron: the run history (`rebase.cron_logs`), the slot
 * claims that keep replicas from running the same slot twice
 * (`rebase.cron_claims`), and each job's shared state — the enabled override
 * and the run lease — in `rebase.cron_job_state`.
 *
 * Uses the DataDriver's `admin.executeSql` capability. Falls back gracefully if
 * the driver doesn't support SQL (e.g. MongoDB) — in that case, no persistence
 * occurs, and a pause or a trigger's "already executing" is per process.
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
     * Throws when the store cannot tell — a missing or unreadable claims
     * table, a dropped connection. What that means is the caller's decision,
     * and the scheduler's two callers decide differently: a scheduled run
     * fails open, so a broken claims table degrades to uncoordinated execution
     * rather than silently never running jobs; a catch-up fails closed, so it
     * does not re-run the last slot on every boot of every replica.
     *
     * Optional so custom stores written against the pre-claims interface
     * keep working — the scheduler treats a missing implementation as
     * uncoordinated (always run).
     */
    tryClaimRun?(jobId: string, slot: string): Promise<boolean>;

    // ─── Fleet-wide job state ────────────────────────────────────────
    //
    // Everything below lives in `rebase.cron_job_state`, one row per job that
    // has ever been paused, resumed or run under a lease. It exists because the
    // alternative — each process's memory — is per process: a pause served by
    // one replica stopped only that replica, and on a split deployment the
    // process serving the admin API is not the one whose timers fire, so a
    // pause there stopped nothing at all.
    //
    // Optional, like `tryClaimRun`, so a custom store written against the
    // older interface keeps working: without them a pause is local to the
    // process that served it and a manual trigger is guarded only in-process.

    /**
     * Persist a job's enabled override: `true` or `false`, or `null` to hand the
     * decision back to the code's own `enabled`. Survives restarts and
     * redeploys — that is the point. Throws when the write fails.
     */
    saveEnabledOverride?(jobId: string, enabled: boolean | null, updatedBy?: string): Promise<void>;

    /**
     * The persisted state of the jobs asked about. A job with no row has no
     * override. `runningBy` is set only while a lease is live.
     *
     * Throws when the store cannot tell. The scheduler falls back to the code's
     * `enabled` then — a scheduled run fails open — and a listing falls back to
     * what this process knows.
     */
    fetchJobStates?(jobIds: readonly string[]): Promise<Map<string, CronJobPersistedState>>;

    /**
     * Take the job's run lease unless another process holds a live one.
     *
     * The cross-process half of "already executing": a manual trigger, a
     * scheduled run and a catch-up all take it, so none of them overlaps a run
     * another replica — or the worker, from the api role — is making. The lease
     * expires on its own after `ttlSeconds`, which is what frees a job whose
     * holder crashed.
     *
     * Throws when the store cannot tell.
     */
    tryAcquireRunLease?(jobId: string, holder: string, ttlSeconds: number): Promise<CronRunLease>;

    /** Release a lease taken with {@link tryAcquireRunLease} — only if `holder` still holds it. */
    releaseRunLease?(jobId: string, holder: string): Promise<void>;

    /**
     * Run count, failure count and last run of each job, read from
     * `cron_logs` — for a process whose scheduler is not started (the `api`
     * role), which runs nothing and so counts nothing of its own.
     */
    fetchRunSummaries?(jobIds: readonly string[]): Promise<Map<string, CronJobRunSummary>>;
}

/** One job's row in `rebase.cron_job_state`, as the scheduler reads it. */
export interface CronJobPersistedState {
    /** The override, or `null` to follow the code's `enabled`. */
    enabled: boolean | null;
    /** Who holds the run lease, when a live one is held. */
    runningBy?: string;
}

/** The outcome of {@link CronStore.tryAcquireRunLease}. */
export type CronRunLease =
    | { acquired: true }
    | { acquired: false; holder?: string };

/** A job's run history in brief, read from `cron_logs`. */
export interface CronJobRunSummary {
    totalRuns: number;
    totalFailures: number;
    lastRunAt?: string;
    lastDurationMs?: number;
    lastSuccess?: boolean;
    lastError?: string;
}

// ─── SQL-based implementation ────────────────────────────────────────

const TABLE = "rebase.cron_logs";
const CLAIMS_TABLE = "rebase.cron_claims";
const STATE_TABLE = "rebase.cron_job_state";

/** `$1, $2, …` for `count` values, starting at `$first`. */
function placeholders(count: number, first = 1): string {
    return Array.from({ length: count }, (_, i) => `$${first + i}`).join(", ");
}

/**
 * Claims older than this are garbage-collected on startup — all but each
 * job's most recent one, which is kept however old it is; see the sweep in
 * `ensureTable`.
 */
const CLAIM_RETENTION_DAYS = 7;

/**
 * How far ahead a claim may legitimately sit. Slots are claimed as they fire,
 * so anything beyond this is a clock-skewed peer at best and a stranded claim
 * at worst; see the sweep in `ensureTable`.
 */
const FUTURE_CLAIM_SKEW_MINUTES = 2;

/**
 * Detect a unique-constraint violation anywhere in an error's cause chain.
 * Match the SQLSTATE code, never message text. Also covers SQLite
 * ("UNIQUE constraint failed") and MySQL (ER_DUP_ENTRY 1062) for future SQL
 * drivers.
 *
 * Distinct from `isConcurrentDdlRace` in `boot/ddl-bootstrap.ts`, which shares
 * the 23505 code but asks a different question — that one is about a losing
 * `CREATE`, this one is about a losing claim, and only the latter means
 * "another instance already has this slot".
 */
function isUniqueViolation(err: unknown): boolean {
    return hasInCauseChain(err, (e) =>
        e.code === "23505" ||
        e.errno === 1062 ||
        (typeof e.message === "string" && e.message.includes("UNIQUE constraint failed"))
    );
}

export function createCronStore(driver: DataDriver): Required<CronStore> | undefined {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) {
        logger.warn("⚠️ [cron-store] DataDriver does not support SQL admin — cron logs will not be persisted.");
        return undefined;
    }

    const exec = (sqlText: string, options?: { params?: unknown[] }) =>
        admin.executeSql(sqlText, options?.params ? { params: options.params } : undefined);

    const ddl = createDdlBootstrapper(exec, "cron-store");

    return {
        async ensureTable(): Promise<void> {
            // Creation. Every statement here is idempotent, so losing the race
            // to a peer that booted at the same moment is survivable — but only
            // if the loser retries rather than abandoning everything below it.
            // One step each, so a hard failure on any one of them does not take
            // the others with it. The claims table in particular must not be
            // lost because an index on the *logs* table could not be built.
            await ddl.ensureObject("Creating schema rebase", "CREATE SCHEMA IF NOT EXISTS rebase");

            await ddl.ensureObject(`Creating ${TABLE}`, `
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

            await ddl.ensureObject("Creating idx_cron_logs_job", `
                CREATE INDEX IF NOT EXISTS idx_cron_logs_job
                ON ${TABLE}(job_id, started_at DESC)
            `);

            // What a process whose scheduler is not started reads to show a
            // job's failure count. Partial, so it holds only the failed runs:
            // the count reads those and nothing else, and a healthy job's
            // inserts never touch it.
            await ddl.ensureObject("Creating idx_cron_logs_job_failures", `
                CREATE INDEX IF NOT EXISTS idx_cron_logs_job_failures
                ON ${TABLE}(job_id) WHERE NOT success
            `);

            await ddl.ensureObject(`Creating ${CLAIMS_TABLE}`, `
                CREATE TABLE IF NOT EXISTS ${CLAIMS_TABLE} (
                    job_id TEXT NOT NULL,
                    slot TIMESTAMPTZ NOT NULL,
                    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (job_id, slot)
                )
            `);

            // One row per job that has been paused, resumed or run under a
            // lease. `enabled` NULL means "follow the code"; `updated_at` and
            // `updated_by` say who last set it, and stay NULL on a row that has
            // only ever held a lease. Created here rather than by a migration,
            // so a database that predates it gains it on its next boot.
            await ddl.ensureObject(`Creating ${STATE_TABLE}`, `
                CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
                    job_id TEXT PRIMARY KEY,
                    enabled BOOLEAN,
                    updated_at TIMESTAMPTZ,
                    updated_by TEXT,
                    running_until TIMESTAMPTZ,
                    running_by TEXT
                )
            `);

            // Everything from here is keyed on what actually exists, not on
            // whether *this* instance is the one that created it. A single
            // failure above used to abandon the rest of this method, which meant
            // the loser of a boot race skipped the sweeps and — far worse — the
            // privilege revocation, leaving the claims table writable by end
            // users on an instance that reported nothing but a warning about
            // log persistence.
            const [logsReady, claimsReady, stateReady] = await Promise.all([
                ddl.isReadable(TABLE),
                ddl.isReadable(CLAIMS_TABLE),
                ddl.isReadable(STATE_TABLE)
            ]);

            if (claimsReady) {
                // Drop claims for slots that have not happened yet. A slot is
                // claimed at the moment it fires, so a future one can only come
                // from a timer that woke early — and because claims are
                // permanent, that claim would silently skip the real run when it
                // finally came due. The margin keeps a legitimate claim made
                // moments early by a clock-skewed peer.
                await ddl.step("Future-slot claim sweep", async () => {
                    const stranded = await exec(
                        `DELETE FROM ${CLAIMS_TABLE}
                         WHERE slot > now() + make_interval(mins => $1)
                         RETURNING job_id, slot`,
                        { params: [FUTURE_CLAIM_SKEW_MINUTES] }
                    );
                    // A driver that does not honour RETURNING gives back
                    // nothing; the rows are only used to report, so treat that
                    // as "none".
                    for (const row of (stranded ?? []) as { job_id: string; slot: string }[]) {
                        logger.warn(
                            `[cron-store] Released a claim on the future slot ${new Date(row.slot).toISOString()} ` +
                            `for "${row.job_id}" — it was claimed by a timer that fired early, and would ` +
                            "otherwise have skipped that run"
                        );
                    }
                });

                // Garbage-collect old claims — except each job's most recent
                // one. A claim is also the record that a slot already ran, and
                // the catch-up at boot asks exactly that about the job's latest
                // slot, as far back as its `catchUpWindowSeconds` reaches —
                // which can be a month. Sweeping that claim after seven days
                // would make the boot that swept it re-run the slot. A claim
                // behind the latest answers for a slot no catch-up looks at,
                // since a catch-up considers only the most recent one.
                //
                // After the future-slot sweep, not before: a stranded future
                // claim would otherwise count as the job's latest, and the real
                // one behind it would be swept here and then released there.
                await ddl.step("Claim retention sweep", async () => {
                    await exec(
                        `DELETE FROM ${CLAIMS_TABLE} AS c
                         WHERE c.claimed_at < now() - make_interval(days => $1)
                           AND c.slot < (
                               SELECT max(latest.slot) FROM ${CLAIMS_TABLE} AS latest
                               WHERE latest.job_id = c.job_id
                           )`,
                        { params: [CLAIM_RETENTION_DAYS] }
                    );
                });
            }

            // Neither table is a collection, so neither carries RLS, while the
            // Postgres driver's schema-wide grant reaches both. Cron logs hold
            // job output — arbitrary application data — and a writable
            // `cron_claims` lets any signed-in user suppress a scheduled run by
            // claiming its slot. This is a security control, so it is re-applied
            // by every instance on every boot, whatever else went wrong.
            if (logsReady) {
                await ddl.step("Revoking end-user access to cron_logs", () =>
                    exec(revokeInternalTableSql("rebase", "cron_logs")));
            }
            if (claimsReady) {
                await ddl.step("Revoking end-user access to cron_claims", () =>
                    exec(revokeInternalTableSql("rebase", "cron_claims")));
            }
            // A writable `cron_job_state` would let any signed-in user pause a
            // job for the whole fleet, or hold its run lease so that nothing
            // runs it.
            if (stateReady) {
                await ddl.step("Revoking end-user access to cron_job_state", () =>
                    exec(revokeInternalTableSql("rebase", "cron_job_state")));
            }

            if (logsReady && claimsReady && stateReady) {
                logger.info("✅ Cron logs table ready");
                return;
            }
            // Say which capability is gone, and what it costs. "Continuing
            // without cron log persistence" undersold this: the claims table is
            // the only thing stopping every instance from running every job.
            if (!claimsReady) {
                logger.error(
                    `❌ [cron-store] ${CLAIMS_TABLE} is unavailable — scheduled runs cannot be coordinated. ` +
                    "With more than one app instance, every instance will now run every job on every tick."
                );
            }
            if (!logsReady) {
                logger.warn(`⚠️ [cron-store] ${TABLE} is unavailable — cron run history will not be persisted.`);
            }
            if (!stateReady) {
                logger.warn(
                    `⚠️ [cron-store] ${STATE_TABLE} is unavailable — pausing a job reaches only the process ` +
                    "that served the request, and jobs run as their code declares on every other one. " +
                    "A manual trigger is not kept off a run another process is making."
                );
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
                // Neither won nor lost: the store does not know, and says so.
                // Answering `true` here would decide "fail open" for every
                // caller, including the catch-up, whose whole safety rests on
                // failing closed.
                throw err;
            }
        },

        async saveEnabledOverride(jobId: string, enabled: boolean | null, updatedBy?: string): Promise<void> {
            await exec(
                `INSERT INTO ${STATE_TABLE} (job_id, enabled, updated_at, updated_by)
                 VALUES ($1, $2::boolean, now(), $3)
                 ON CONFLICT (job_id) DO UPDATE
                     SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = EXCLUDED.updated_by`,
                { params: [jobId, enabled, updatedBy ?? null] }
            );
        },

        async fetchJobStates(jobIds: readonly string[]): Promise<Map<string, CronJobPersistedState>> {
            const states = new Map<string, CronJobPersistedState>();
            if (jobIds.length === 0) return states;
            const rows = await exec(
                `SELECT job_id, enabled,
                        CASE WHEN running_until > now() THEN running_by END AS running_by
                 FROM ${STATE_TABLE}
                 WHERE job_id IN (${placeholders(jobIds.length)})`,
                { params: [...jobIds] }
            );
            for (const row of rows ?? []) {
                states.set(String(row.job_id), {
                    enabled: typeof row.enabled === "boolean" ? row.enabled : null,
                    runningBy: typeof row.running_by === "string" ? row.running_by : undefined
                });
            }
            return states;
        },

        async tryAcquireRunLease(jobId: string, holder: string, ttlSeconds: number): Promise<CronRunLease> {
            // One statement, always one row. The insert covers a job that has
            // no row yet; the conditional update covers one whose lease is
            // absent or expired, and does nothing over a live one — so of two
            // processes racing, the second waits on the first's row and then
            // finds it held. The outer SELECT sees the table as it was before
            // this statement, which is exactly the holder that refused us.
            const rows = await exec(
                `WITH attempt AS (
                     INSERT INTO ${STATE_TABLE} AS s (job_id, running_until, running_by)
                     VALUES ($1, now() + make_interval(secs => $2::double precision), $3)
                     ON CONFLICT (job_id) DO UPDATE
                         SET running_until = EXCLUDED.running_until, running_by = EXCLUDED.running_by
                         WHERE s.running_until IS NULL OR s.running_until <= now()
                     RETURNING s.job_id
                 )
                 SELECT EXISTS (SELECT 1 FROM attempt) AS acquired,
                        (SELECT running_by FROM ${STATE_TABLE}
                         WHERE job_id = $1 AND running_until > now()) AS holder`,
                { params: [jobId, ttlSeconds, holder] }
            );
            const row = rows?.[0];
            if (!row) {
                throw new Error(`The run lease for "${jobId}" got no answer from the database`);
            }
            if (row.acquired === true) return { acquired: true };
            return {
                acquired: false,
                holder: typeof row.holder === "string" ? row.holder : undefined
            };
        },

        async releaseRunLease(jobId: string, holder: string): Promise<void> {
            await exec(
                `UPDATE ${STATE_TABLE}
                 SET running_until = NULL, running_by = NULL
                 WHERE job_id = $1 AND running_by = $2`,
                { params: [jobId, holder] }
            );
        },

        async fetchRunSummaries(jobIds: readonly string[]): Promise<Map<string, CronJobRunSummary>> {
            const summaries = new Map<string, CronJobRunSummary>();
            if (jobIds.length === 0) return summaries;
            // Per job, never a GROUP BY over the whole table: each subquery
            // reads one job's range of `idx_cron_logs_job` (the failures, the
            // partial `idx_cron_logs_job_failures`), and the last run is one
            // index probe. Jobs no longer registered are never read at all.
            const rows = await exec(
                `SELECT j.job_id,
                        (SELECT count(*)::int FROM ${TABLE} l WHERE l.job_id = j.job_id) AS total_runs,
                        (SELECT count(*)::int FROM ${TABLE} l WHERE l.job_id = j.job_id AND NOT l.success) AS total_failures,
                        last.started_at, last.duration_ms, last.success, last.error
                 FROM (VALUES ${jobIds.map((_, i) => `($${i + 1}::text)`).join(", ")}) AS j(job_id)
                 LEFT JOIN LATERAL (
                     SELECT l.started_at, l.duration_ms, l.success, l.error
                     FROM ${TABLE} l
                     WHERE l.job_id = j.job_id
                     ORDER BY l.started_at DESC
                     LIMIT 1
                 ) AS last ON true`,
                { params: [...jobIds] }
            );
            for (const row of rows ?? []) {
                const summary: CronJobRunSummary = {
                    totalRuns: Number(row.total_runs ?? 0),
                    totalFailures: Number(row.total_failures ?? 0)
                };
                const lastRunAt = toIsoString(row.started_at);
                if (lastRunAt) {
                    summary.lastRunAt = lastRunAt;
                    summary.lastDurationMs = Number(row.duration_ms);
                    summary.lastSuccess = row.success === true;
                    if (typeof row.error === "string") summary.lastError = row.error;
                }
                summaries.set(String(row.job_id), summary);
            }
            return summaries;
        }
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** A TIMESTAMPTZ as the driver returned it — a `Date` or a string — in ISO form. */
function toIsoString(value: unknown): string | undefined {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" || typeof value === "number") return new Date(value).toISOString();
    return undefined;
}

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
