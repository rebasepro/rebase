import type { CronJobLogEntry } from "@rebasepro/types";
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { REBASE_USER_ROLE, revokeInternalTableSql } from "@rebasepro/common";
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
    /**
     * Ensure the backing tables exist and are locked away from end users. Runs
     * once per process per database, however many stores ask: concurrent
     * callers share the attempt in flight, and an attempt that fell short is
     * made again on the next call.
     */
    ensureTable(): Promise<void>;

    /** Persist a single log entry after execution. */
    insertLog(entry: CronJobLogEntry): Promise<void>;

    /**
     * Fetch the most recent logs for a job.
     *
     * Throws when the history cannot be read. An empty array is a claim — the
     * job has no recorded runs — and a caller shows it as "never ran".
     *
     * @param jobId  The job identifier
     * @param limit  Max entries to return (default 50)
     * @returns Logs sorted newest-first
     */
    fetchLogs(jobId: string, limit?: number): Promise<CronJobLogEntry[]>;

    /**
     * Fetch aggregate stats for all jobs (totalRuns, totalFailures, lastRunAt).
     * Used to seed in-memory counters on startup. The SQL store reads them from
     * the all-time counters on `cron_job_state`, not from the history.
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
     * Run count, failure count and last run of each job — every process's
     * runs, where the scheduler's own counters hold only the ones it made. The
     * SQL store keeps them as all-time counters on `cron_job_state`, so they
     * outlive the history's retention.
     */
    fetchRunSummaries?(jobIds: readonly string[]): Promise<Map<string, CronJobRunSummary>>;

    /**
     * Delete slot claims past retention — all but each job's most recent one —
     * in batches. Resolves with how many went. The scheduler runs it on a
     * timer while it is started; a store without it keeps every claim.
     */
    sweepClaims?(): Promise<number>;

    /**
     * Delete run history past retention, and count into the job counters any
     * run that is not counted yet — a history written before the counters
     * existed, or by an older server during a rolling deploy. Both in batches.
     * The scheduler runs it with {@link sweepClaims}; a store without it keeps
     * every run.
     */
    sweepLogs?(): Promise<CronLogSweep>;
}

/** What one {@link CronStore.sweepLogs} did. */
export interface CronLogSweep {
    /** History rows deleted past retention. */
    deleted: number;
    /** Runs counted into the job counters that were not counted before. */
    counted: number;
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
 * Claims older than this are garbage-collected — all but each job's most
 * recent one, which is kept however old it is; see `sweepClaims`.
 */
const CLAIM_RETENTION_DAYS = 7;

/** Claims one retention statement deletes; a sweep repeats it until a batch comes back short. */
const CLAIM_SWEEP_BATCH = 5_000;

/**
 * How far ahead a claim may legitimately sit. Slots are claimed as they fire,
 * so anything beyond this is a clock-skewed peer at best and a stranded claim
 * at worst; see the sweep in `ensureTable`.
 */
const FUTURE_CLAIM_SKEW_MINUTES = 2;

/**
 * How long a run stays in `cron_logs`, which is what the history panel and
 * `GET /api/admin/cron/:id/logs` show. The run and failure counts do not
 * shrink with it: they are kept on `cron_job_state` for all time.
 *
 * Nothing used to delete from `cron_logs`: twelve ordinary jobs wrote 1.5M rows
 * and 617 MB a year, and the counts were `count(*)` over all of it on every
 * poll of the Studio panel.
 */
const LOG_RETENTION_DAYS = 30;

/** History rows one retention or counting statement handles; a sweep repeats it until a batch comes back short. */
const LOG_SWEEP_BATCH = 5_000;

/**
 * Whether the run being folded in is at least as recent as the job's last
 * one. The last-run fields only move forward: a long run is logged when it
 * ends, after the skip that started while it ran, and a counting batch can
 * hold any run of the job's history.
 */
const IS_NEWER_RUN = "(s.last_run_at IS NULL OR EXCLUDED.last_run_at >= s.last_run_at)";

/**
 * Add a set of runs to their jobs' counters on `cron_job_state`, as one
 * `INSERT … ON CONFLICT`. `runs` names a relation of the runs —
 * `job_id, started_at, duration_ms, success, error` — and becomes one row per
 * job: how many, how many failed, and the most recent of them.
 *
 * Ordered by job, so two statements folding the same jobs lock their rows in
 * the same order and cannot deadlock.
 */
function foldIntoCounters(runs: string): string {
    return `
        INSERT INTO ${STATE_TABLE} AS s
            (job_id, total_runs, total_failures, last_run_at, last_duration_ms, last_success, last_error)
        SELECT tally.job_id, tally.runs, tally.failures,
               latest.started_at, latest.duration_ms, latest.success, latest.error
        FROM (
            SELECT job_id, count(*) AS runs, count(*) FILTER (WHERE NOT success) AS failures
            FROM ${runs} GROUP BY job_id
        ) AS tally
        JOIN (
            SELECT DISTINCT ON (job_id) job_id, started_at, duration_ms, success, error
            FROM ${runs} ORDER BY job_id, started_at DESC
        ) AS latest ON latest.job_id = tally.job_id
        ORDER BY tally.job_id
        ON CONFLICT (job_id) DO UPDATE SET
            total_runs = s.total_runs + EXCLUDED.total_runs,
            total_failures = s.total_failures + EXCLUDED.total_failures,
            last_run_at = CASE WHEN ${IS_NEWER_RUN} THEN EXCLUDED.last_run_at ELSE s.last_run_at END,
            last_duration_ms = CASE WHEN ${IS_NEWER_RUN} THEN EXCLUDED.last_duration_ms ELSE s.last_duration_ms END,
            last_success = CASE WHEN ${IS_NEWER_RUN} THEN EXCLUDED.last_success ELSE s.last_success END,
            last_error = CASE WHEN ${IS_NEWER_RUN} THEN EXCLUDED.last_error ELSE s.last_error END`;
}

/**
 * SQLSTATEs that mean the counters are not there to write to — a column or
 * table a failed boot did not create, or a privilege it did not get. A log
 * insert that meets one is written without its count; the next sweep counts
 * it. Anything else is not retried, because a statement that failed after it
 * committed would then be logged — and counted — twice.
 */
const COUNTERS_MISSING_SQLSTATES = new Set(["42703", "42P01", "42501"]);
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

/**
 * The setup each database is going through right now, in this process. The
 * scheduler, the expired-token sweep and the history retention sweep each make
 * a store on the same driver, and three setups at once ran the same REVOKEs
 * concurrently — which Postgres can answer with "tuple concurrently updated",
 * failing a security control at boot. Keyed on the driver, so a second
 * database gets a setup of its own.
 *
 * Only the attempt in flight is shared. A later call runs the setup again —
 * every statement in it is idempotent — because the tables can be gone by
 * then: a database reset under a running server, or a suite that drops the
 * schema between tests. A process that remembered "set up" would never bring
 * them back.
 */
const setUpsInFlight = new WeakMap<DataDriver, Promise<void>>();

/** Databases this process has already said "ready" for, so it says so once. */
const announcedReady = new WeakSet<DataDriver>();

function ensureSharedInFlight(driver: DataDriver, setUp: () => Promise<boolean>): Promise<void> {
    const current = setUpsInFlight.get(driver);
    if (current) return current;
    const attempt = setUp().then(() => undefined).finally(() => {
        if (setUpsInFlight.get(driver) === attempt) setUpsInFlight.delete(driver);
    });
    setUpsInFlight.set(driver, attempt);
    return attempt;
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

    /** Whether `rebase.<table>` has `column`. False when it cannot tell, so the idempotent ALTER still runs. */
    const hasColumn = async (table: string, column: string): Promise<boolean> => {
        try {
            const rows = await exec(
                `SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'rebase' AND table_name = $1 AND column_name = $2`,
                { params: [table, column] }
            );
            return (rows ?? []).length > 0;
        } catch {
            return false;
        }
    };

    /**
     * Whether a boot has nothing to do: the three tables, the three indexes and
     * the run-counter columns are there, the dropped index is gone, and the
     * end-user role holds no privilege on any of the tables. One catalogue
     * read, where every boot used to run eleven statements — `CREATE … IF NOT
     * EXISTS` takes its table's lock before it finds the object there, and a
     * `REVOKE` rewrites the table's catalogue row even when nothing is granted.
     * Anything missing, or a read that fails, and the boot runs them all.
     */
    const bootIsCurrent = async (): Promise<boolean> => {
        const objects = ["cron_logs", "cron_claims", "cron_job_state", "idx_cron_logs_job", "idx_cron_logs_uncounted", "idx_cron_logs_started"];
        const columns = ["cron_logs.counted", ...["total_runs", "total_failures", "last_run_at", "last_duration_ms", "last_success", "last_error"].map(c => `cron_job_state.${c}`)];
        const quoted = (names: string[]) => names.map(name => `'${name}'`).join(", ");
        try {
            const rows = await exec(`
                WITH objects AS (
                    SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relacl FROM pg_class c
                    WHERE c.relnamespace = to_regnamespace('rebase')
                ), target AS (
                    SELECT oid FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}'
                )
                SELECT
                    (SELECT count(*) FROM objects WHERE relname IN (${quoted(objects)}))::int AS present,
                    (SELECT count(*) FROM objects WHERE relname = 'idx_cron_logs_job_failures')::int AS stale,
                    (SELECT count(*) FROM information_schema.columns
                     WHERE table_schema = 'rebase' AND table_name || '.' || column_name IN (${quoted(columns)}))::int AS columns,
                    (SELECT count(*) FROM objects o
                     WHERE o.relkind = 'r' AND o.relname IN ('cron_logs', 'cron_claims', 'cron_job_state')
                       AND NOT o.relrowsecurity AND EXISTS (SELECT 1 FROM target)
                       AND (o.relacl IS NULL OR EXISTS (
                           SELECT 1 FROM aclexplode(o.relacl) a WHERE a.grantee = (SELECT oid FROM target)
                       )))::int AS granted
            `);
            const row = rows?.[0];
            return Number(row?.present) === objects.length && Number(row?.stale) === 0
                && Number(row?.columns) === columns.length && Number(row?.granted) === 0;
        } catch {
            return false;
        }
    };

    /**
     * Drop claims for slots that have not happened yet. A slot is claimed at
     * the moment it fires, so a future one can only come from a timer that
     * woke early — and because claims are permanent, that claim would silently
     * skip the real run when it finally came due. The margin keeps a legitimate
     * claim made moments early by a clock-skewed peer.
     */
    const releaseFutureClaims = () => ddl.step("Future-slot claim sweep", async () => {
        const stranded = await exec(
            `DELETE FROM ${CLAIMS_TABLE}
             WHERE slot > now() + make_interval(mins => $1)
             RETURNING job_id, slot`,
            { params: [FUTURE_CLAIM_SKEW_MINUTES] }
        );
        // A driver that does not honour RETURNING gives back nothing; the
        // rows are only used to report, so treat that as "none".
        for (const row of (stranded ?? []) as { job_id: string; slot: string }[]) {
            logger.warn(
                `[cron-store] Released a claim on the future slot ${new Date(row.slot).toISOString()} ` +
                `for "${row.job_id}" — it was claimed by a timer that fired early, and would ` +
                "otherwise have skipped that run"
            );
        }
    });

    /** Run one sweep statement until a batch comes back short. Resolves with the total of `column`. */
    const inBatches = async (sqlText: string, params: unknown[], column: string): Promise<number> => {
        let total = 0;
        for (;;) {
            const rows = await exec(sqlText, { params });
            const done = Number((rows?.[0] as Record<string, unknown> | undefined)?.[column] ?? 0);
            total += done;
            if (done < LOG_SWEEP_BATCH) return total;
        }
    };

    /**
     * The boot setup. Resolves with whether every table came up and was locked
     * away; anything short of that has been reported, and is worth another try.
     */
    const announceReady = (): void => {
        if (announcedReady.has(driver)) return;
        announcedReady.add(driver);
        logger.info("✅ Cron logs table ready");
    };

    const setUp = async (): Promise<boolean> => {
        // A warm boot: everything is there and locked away. The future
        // claims are about the slots this boot is about to fire, so they
        // are released either way.
        if (await bootIsCurrent()) {
            await releaseFutureClaims();
            announceReady();
            return true;
        }

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

        // Whether a run is in its job's counters. A run logged by this
        // server is counted in the statement that logs it; NULL is a run
        // written before the counters existed, or by an older server
        // during a rolling deploy, which `sweepLogs` counts. Asked of the
        // catalog first: `ADD COLUMN IF NOT EXISTS` takes an ACCESS
        // EXCLUSIVE lock on the table even when the column is there.
        if (!(await hasColumn("cron_logs", "counted"))) {
            await ddl.ensureObject(`Adding ${TABLE}.counted`, `
                ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS counted BOOLEAN
            `);
        }

        // The runs not counted yet — every row of a history that predates
        // the counters, then nothing. What the counting sweep walks, and
        // what a listing adds to the counters until it has.
        await ddl.ensureObject("Creating idx_cron_logs_uncounted", `
            CREATE INDEX IF NOT EXISTS idx_cron_logs_uncounted
            ON ${TABLE}(job_id, started_at DESC) WHERE counted IS NULL
        `);

        // The retention sweep's index: it deletes the oldest rows first,
        // whatever job wrote them.
        await ddl.ensureObject("Creating idx_cron_logs_started", `
            CREATE INDEX IF NOT EXISTS idx_cron_logs_started
            ON ${TABLE}(started_at)
        `);

        // It held the failed runs, for a failure count over the whole
        // history on every listing. The count is a counter now.
        await ddl.ensureObject("Dropping idx_cron_logs_job_failures",
            "DROP INDEX IF EXISTS rebase.idx_cron_logs_job_failures");

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

        // Each job's all-time run counts and its last run, kept in the
        // statement that logs the run, so a listing is one row per job
        // however long the history — and outlives its retention.
        if (!(await hasColumn("cron_job_state", "total_runs"))) {
            await ddl.ensureObject(`Adding the run counters to ${STATE_TABLE}`, `
                ALTER TABLE ${STATE_TABLE}
                    ADD COLUMN IF NOT EXISTS total_runs BIGINT NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS total_failures BIGINT NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS last_duration_ms INTEGER,
                    ADD COLUMN IF NOT EXISTS last_success BOOLEAN,
                    ADD COLUMN IF NOT EXISTS last_error TEXT
            `);
        }

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
            await releaseFutureClaims();

            // The retention sweep is not here any more: it ran at boot
            // and only at boot, so a scheduler that lived for months kept
            // every claim it made — 525,000 a year for one per-minute job
            // — until the next deploy deleted them in the boot path. The
            // scheduler runs `sweepClaims` on a timer instead.
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
            announceReady();
            return true;
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
        return false;
    };

    return {
        ensureTable: () => ensureSharedInFlight(driver, setUp),

        async sweepClaims(): Promise<number> {
            // Garbage-collect old claims — except each job's most recent one.
            // A claim is also the record that a slot already ran, and the
            // catch-up at boot asks exactly that about the job's latest slot,
            // as far back as its `catchUpWindowSeconds` reaches — which can be
            // a month. Sweeping that claim after seven days would make the
            // next boot re-run the slot. A claim behind the latest answers for
            // a slot no catch-up looks at, since a catch-up considers only the
            // most recent one.
            //
            // "Most recent" counts only slots that have happened (give or take
            // the skew margin). A stranded future claim — the boot's
            // future-slot sweep releases those — would otherwise count as the
            // job's latest, and the real one behind it would be swept here and
            // the future one released there, leaving the job with neither.
            // That used to be guarded by running this after that sweep; it
            // now runs on a timer, so the query guards itself.
            let total = 0;
            for (;;) {
                const rows = await exec(
                    `WITH swept AS (
                         DELETE FROM ${CLAIMS_TABLE}
                         WHERE (job_id, slot) IN (
                             SELECT c.job_id, c.slot FROM ${CLAIMS_TABLE} AS c
                             WHERE c.claimed_at < now() - make_interval(days => $1)
                               AND c.slot < (
                                   SELECT max(latest.slot) FROM ${CLAIMS_TABLE} AS latest
                                   WHERE latest.job_id = c.job_id
                                     AND latest.slot <= now() + make_interval(mins => $2)
                               )
                             LIMIT $3
                             FOR UPDATE SKIP LOCKED
                         )
                         RETURNING 1
                     )
                     SELECT count(*)::int AS deleted FROM swept`,
                    { params: [CLAIM_RETENTION_DAYS, FUTURE_CLAIM_SKEW_MINUTES, CLAIM_SWEEP_BATCH] }
                );
                const deleted = Number((rows?.[0] as { deleted?: number } | undefined)?.deleted ?? 0);
                total += deleted;
                if (deleted < CLAIM_SWEEP_BATCH) return total;
            }
        },

        async sweepLogs(): Promise<CronLogSweep> {
            // Retention first, so a history that predates the counters is
            // not marked counted row by row only to be deleted after. A row
            // deleted uncounted is counted in the statement that deletes it:
            // retention never takes a run out of the totals.
            //
            // Both statements take their rows `FOR UPDATE SKIP LOCKED`, so
            // replicas sweeping at once divide the rows between them, and a
            // row another sweep has just counted fails the `counted IS NULL`
            // recheck instead of being counted twice. Each batch is its own
            // short transaction: on a table that has grown for years this is
            // many of them, off the boot path, and never one long lock.
            const deleted = await inBatches(
                `WITH gone AS (
                     DELETE FROM ${TABLE}
                     WHERE id IN (
                         SELECT id FROM ${TABLE}
                         WHERE started_at < now() - make_interval(days => $1)
                         ORDER BY started_at
                         LIMIT $2
                         FOR UPDATE SKIP LOCKED
                     )
                     RETURNING job_id, counted, started_at, duration_ms, success, error
                 ), uncounted AS (
                     SELECT job_id, started_at, duration_ms, success, error FROM gone WHERE counted IS NULL
                 ), folded AS (
                     ${foldIntoCounters("uncounted")}
                     RETURNING 1
                 )
                 SELECT count(*)::int AS deleted FROM gone`,
                [LOG_RETENTION_DAYS, LOG_SWEEP_BATCH],
                "deleted"
            );

            // Then the rest of the uncounted runs, newest first per job.
            const counted = await inBatches(
                `WITH batch AS (
                     SELECT id FROM ${TABLE}
                     WHERE counted IS NULL
                     ORDER BY job_id, started_at DESC
                     LIMIT $1
                     FOR UPDATE SKIP LOCKED
                 ), marked AS (
                     UPDATE ${TABLE} AS l SET counted = true
                     FROM batch WHERE l.id = batch.id
                     RETURNING l.job_id, l.started_at, l.duration_ms, l.success, l.error
                 ), folded AS (
                     ${foldIntoCounters("marked")}
                     RETURNING 1
                 )
                 SELECT count(*)::int AS counted FROM marked`,
                [LOG_SWEEP_BATCH],
                "counted"
            );

            return { deleted, counted };
        },

        async insertLog(entry: CronJobLogEntry): Promise<void> {
            const resultJson = entry.result !== undefined ? JSON.stringify(entry.result) : null;
            const logsJson = entry.logs.length > 0 ? JSON.stringify(entry.logs) : null;
            const params = [
                entry.jobId,
                entry.startedAt,
                entry.finishedAt,
                entry.durationMs,
                entry.success,
                entry.error || null,
                resultJson,
                logsJson,
                entry.manual
            ];
            const columns = "job_id, started_at, finished_at, duration_ms, success, error, result, logs, manual";
            const values = "$1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9";
            try {
                try {
                    // The run and its count in one statement, so neither is
                    // ever written without the other. Every run counts — a
                    // skip too, as it always has: it is a row of the history.
                    await exec(
                        `WITH logged AS (
                             INSERT INTO ${TABLE} (${columns}, counted)
                             VALUES (${values}, true)
                             RETURNING job_id, started_at, duration_ms, success, error
                         )
                         ${foldIntoCounters("logged")}`,
                        { params }
                    );
                } catch (err) {
                    if (!hasInCauseChain(err, (e) => typeof e.code === "string" && COUNTERS_MISSING_SQLSTATES.has(e.code))) {
                        throw err;
                    }
                    // The counters are not there to write to. Keep the run
                    // anyway, uncounted: a listing adds it to the counts, and
                    // the next sweep counts it.
                    await exec(`INSERT INTO ${TABLE} (${columns}) VALUES (${values})`, { params });
                }
            } catch (err) {
                // Non-blocking — log persistence should never crash the scheduler
                logger.error(`[cron-store] Failed to persist log for "${entry.jobId}"`, { error: err });
            }
        },

        async fetchLogs(jobId: string, limit = 50): Promise<CronJobLogEntry[]> {
            const rows = await exec(
                `SELECT job_id, started_at, finished_at, duration_ms, success, error, result, logs, manual
                 FROM ${TABLE}
                 WHERE job_id = $1
                 ORDER BY started_at DESC
                 LIMIT $2`,
                { params: [jobId, limit] }
            );

            return rows.map(rowToLogEntry);
        },

        async fetchJobStats(): Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>> {
            const stats = new Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>();
            try {
                // The counters, one row per job — not a GROUP BY over the
                // whole history, which every start used to run. Runs not
                // counted yet are left to the sweep the scheduler starts with;
                // a listing adds them meanwhile.
                const rows = await exec(`
                    SELECT job_id, total_runs, total_failures, last_run_at
                    FROM ${STATE_TABLE}
                    WHERE total_runs > 0
                `);

                for (const row of rows ?? []) {
                    stats.set(String(row.job_id), {
                        totalRuns: Number(row.total_runs),
                        totalFailures: Number(row.total_failures),
                        lastRunAt: toIsoString(row.last_run_at)
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
            // One primary-key read of the counters per job. It used to be two
            // `count(*)` over the job's whole history, on every 15-second poll
            // of the Studio panel: 64–132 ms at a year of twelve jobs, and
            // doubling every year.
            //
            // Plus the runs not counted yet, so the answer is exact while the
            // counting sweep has not caught up: a history from before the
            // counters, or a run an older server logged during a rolling
            // deploy. Both read only `idx_cron_logs_uncounted`, which is empty
            // once the sweep has run.
            const rows = await exec(
                `SELECT j.job_id,
                        COALESCE(s.total_runs, 0) + COALESCE(pending.runs, 0) AS total_runs,
                        COALESCE(s.total_failures, 0) + COALESCE(pending.failures, 0) AS total_failures,
                        CASE WHEN newer.later THEN pending_last.started_at ELSE s.last_run_at END AS started_at,
                        CASE WHEN newer.later THEN pending_last.duration_ms ELSE s.last_duration_ms END AS duration_ms,
                        CASE WHEN newer.later THEN pending_last.success ELSE s.last_success END AS success,
                        CASE WHEN newer.later THEN pending_last.error ELSE s.last_error END AS error
                 FROM (VALUES ${jobIds.map((_, i) => `($${i + 1}::text)`).join(", ")}) AS j(job_id)
                 LEFT JOIN ${STATE_TABLE} AS s ON s.job_id = j.job_id
                 LEFT JOIN LATERAL (
                     SELECT count(*) AS runs, count(*) FILTER (WHERE NOT l.success) AS failures
                     FROM ${TABLE} l
                     WHERE l.job_id = j.job_id AND l.counted IS NULL
                 ) AS pending ON true
                 LEFT JOIN LATERAL (
                     SELECT l.started_at, l.duration_ms, l.success, l.error
                     FROM ${TABLE} l
                     WHERE l.job_id = j.job_id AND l.counted IS NULL
                     ORDER BY l.started_at DESC
                     LIMIT 1
                 ) AS pending_last ON true
                 CROSS JOIN LATERAL (
                     SELECT pending_last.started_at IS NOT NULL
                        AND (s.last_run_at IS NULL OR pending_last.started_at >= s.last_run_at) AS later
                 ) AS newer`,
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
