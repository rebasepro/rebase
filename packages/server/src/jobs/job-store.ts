import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { logger } from "../utils/logger.js";
import { createDdlBootstrapper, hasInCauseChain, type SqlExec } from "../boot/ddl-bootstrap.js";
import type { JobRecord } from "./types.js";

/**
 * The queue's storage, as SQL against `rebase.jobs`.
 *
 * Split from the worker for the same reason `cron-store` is split from
 * `cron-scheduler`: the interesting parts here are three statements that have
 * to be exactly right under concurrency, and they are much easier to reason
 * about — and to test — away from a polling loop.
 */

const TABLE = "rebase.jobs";

/** How long finished jobs are kept before the boot sweep removes them. */
const SUCCEEDED_RETENTION_DAYS = 3;
/**
 * Failures outlive successes by a lot. A dead-lettered job is evidence, and the
 * person who needs it is usually looking on Monday for something that happened
 * on Friday night.
 */
const FAILED_RETENTION_DAYS = 30;

/** A row as Postgres returns it. */
interface JobRow {
    id: string;
    task: string;
    payload: unknown;
    status: string;
    run_at: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

function toRecord(row: JobRow): JobRecord {
    return {
        id: row.id,
        task: row.task,
        payload: row.payload,
        status: row.status as JobRecord["status"],
        runAt: new Date(row.run_at).toISOString(),
        attempts: Number(row.attempts),
        maxAttempts: Number(row.max_attempts),
        lastError: row.last_error,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
    };
}

/** Same rule as `cron-store`: match the SQLSTATE, never the message. */
function isUniqueViolation(err: unknown): boolean {
    return hasInCauseChain(err, (e) => e.code === "23505");
}

export interface JobStore {
    ensureTable(): Promise<void>;
    /** Returns the new job's id, or `null` if an idempotency key matched unfinished work. */
    insert(job: {
        task: string;
        payload: unknown;
        runAt: Date;
        maxAttempts: number;
        idempotencyKey?: string;
    }): Promise<string | null>;
    /** Atomically take up to `limit` runnable jobs for this worker. */
    claim(limit: number, workerId: string): Promise<JobRecord[]>;
    complete(id: string): Promise<void>;
    /** Back to `pending` with a later `runAt`, or `failed` when out of attempts. */
    fail(id: string, error: string, retryAt: Date | null): Promise<void>;
    /** Return jobs stranded by a worker that died holding them. Resolves with how many. */
    reapExpired(visibilityTimeoutMs: number): Promise<number>;
    fetch(id: string): Promise<JobRecord | null>;
}

export function createJobStore(driver: DataDriver): JobStore | undefined {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) {
        logger.warn(
            "⚠️ [jobs] DataDriver does not support SQL admin — the durable job queue is unavailable. " +
            "Work that would have been queued runs inline instead."
        );
        return undefined;
    }

    // Two shapes of the same call: the bootstrapper's `SqlExec` takes an
    // options object, while everything below reads better with a positional
    // parameter array.
    const execRaw: SqlExec = (sqlText, options) =>
        admin.executeSql(sqlText, options?.params ? { params: options.params } : undefined);
    const exec = (sqlText: string, params?: unknown[]) =>
        execRaw(sqlText, params ? { params } : undefined);

    const ddl = createDdlBootstrapper(execRaw, "jobs");

    return {
        async ensureTable(): Promise<void> {
            await ddl.ensureObject("Creating schema rebase", "CREATE SCHEMA IF NOT EXISTS rebase");

            await ddl.ensureObject(`Creating ${TABLE}`, `
                CREATE TABLE IF NOT EXISTS ${TABLE} (
                    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                    task TEXT NOT NULL,
                    payload JSONB,
                    status TEXT NOT NULL DEFAULT 'pending',
                    run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 3,
                    locked_at TIMESTAMPTZ,
                    locked_by TEXT,
                    idempotency_key TEXT,
                    last_error TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            `);

            // The claim query's index. Partial, because the rows it has to find
            // fast are a shrinking minority of a table that also holds every
            // success and every dead letter.
            await ddl.ensureObject("Creating idx_jobs_runnable", `
                CREATE INDEX IF NOT EXISTS idx_jobs_runnable
                ON ${TABLE}(run_at, created_at)
                WHERE status = 'pending'
            `);

            // Finds jobs stranded by a dead worker.
            await ddl.ensureObject("Creating idx_jobs_running", `
                CREATE INDEX IF NOT EXISTS idx_jobs_running
                ON ${TABLE}(locked_at)
                WHERE status = 'running'
            `);

            // What makes `idempotencyKey` a guarantee rather than a
            // check-then-act race: two instances reacting to one event both
            // reach the INSERT, and the index decides. Partial on unfinished
            // work — see `EnqueueOptions.idempotencyKey` for why a key must be
            // reusable once its job is done.
            await ddl.ensureObject("Creating idx_jobs_idempotency", `
                CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency
                ON ${TABLE}(idempotency_key)
                WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'running')
            `);

            const ready = await ddl.isReadable(TABLE);

            if (ready) {
                await ddl.step("Job retention sweep", async () => {
                    await exec(
                        `DELETE FROM ${TABLE}
                         WHERE (status = 'succeeded' AND updated_at < now() - make_interval(days => $1))
                            OR (status = 'failed'    AND updated_at < now() - make_interval(days => $2))`,
                        [SUCCEEDED_RETENTION_DAYS, FAILED_RETENTION_DAYS]
                    );
                });

                // Payloads are arbitrary application data — a webhook body, a
                // user id, whatever was passed — and a writable queue lets any
                // signed-in user schedule work of their choosing under the
                // server's own authority. Same reasoning, and the same
                // unconditional re-application, as `cron_claims`.
                await ddl.step("Revoking end-user access to jobs", () =>
                    exec(revokeInternalTableSql("rebase", "jobs")));

                logger.info("✅ Job queue table ready");
            } else {
                logger.error(
                    `❌ [jobs] ${TABLE} is unavailable — nothing can be queued and nothing queued earlier ` +
                    "will run. Callers fall back to running the work inline."
                );
            }
        },

        async insert(job): Promise<string | null> {
            try {
                const rows = await exec(
                    `INSERT INTO ${TABLE} (task, payload, run_at, max_attempts, idempotency_key)
                     VALUES ($1, $2::jsonb, $3, $4, $5)
                     RETURNING id`,
                    [
                        job.task,
                        JSON.stringify(job.payload ?? null),
                        job.runAt.toISOString(),
                        job.maxAttempts,
                        job.idempotencyKey ?? null
                    ]
                );
                return (rows?.[0]?.id as string) ?? null;
            } catch (error) {
                // The losing side of an idempotency race. Not an error: the
                // work the caller wanted is already queued, which is the
                // outcome they asked for.
                if (isUniqueViolation(error)) return null;
                throw error;
            }
        },

        async claim(limit: number, workerId: string): Promise<JobRecord[]> {
            // `FOR UPDATE SKIP LOCKED` is the whole design. The inner select
            // takes row locks on the jobs it picks and *skips* any a concurrent
            // worker already holds, so N workers polling the same table divide
            // the work instead of contending for the head of it — and no job is
            // ever handed to two of them.
            //
            // `attempts` is incremented here, on claim, rather than on failure.
            // A worker that is killed mid-job never reports anything, so
            // counting on failure would let a job that crashes the process be
            // retried forever, once per restart, taking the process down each
            // time.
            const rows = await exec(
                `UPDATE ${TABLE} SET
                    status = 'running',
                    attempts = attempts + 1,
                    locked_at = now(),
                    locked_by = $2,
                    updated_at = now()
                 WHERE id IN (
                     SELECT id FROM ${TABLE}
                     WHERE status = 'pending' AND run_at <= now()
                     ORDER BY run_at, created_at
                     LIMIT $1
                     FOR UPDATE SKIP LOCKED
                 )
                 RETURNING *`,
                [limit, workerId]
            );
            return (rows as unknown as JobRow[]).map(toRecord);
        },

        async complete(id: string): Promise<void> {
            await exec(
                `UPDATE ${TABLE} SET status = 'succeeded', locked_at = NULL, locked_by = NULL,
                        last_error = NULL, updated_at = now()
                 WHERE id = $1`,
                [id]
            );
        },

        async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
            if (retryAt) {
                await exec(
                    `UPDATE ${TABLE} SET status = 'pending', run_at = $2, locked_at = NULL,
                            locked_by = NULL, last_error = $3, updated_at = now()
                     WHERE id = $1`,
                    [id, retryAt.toISOString(), error]
                );
                return;
            }
            await exec(
                `UPDATE ${TABLE} SET status = 'failed', locked_at = NULL, locked_by = NULL,
                        last_error = $2, updated_at = now()
                 WHERE id = $1`,
                [id, error]
            );
        },

        async reapExpired(visibilityTimeoutMs: number): Promise<number> {
            // A worker killed while holding a job cannot release it, so nothing
            // but a timeout will ever free the row. Jobs that still have
            // attempts left go back to `pending`; the rest are dead-lettered
            // with an error that says what happened, because "attempts: 3,
            // lastError: null" is otherwise a genuinely baffling row to find.
            const seconds = Math.max(1, Math.round(visibilityTimeoutMs / 1000));

            const revived = await exec(
                `UPDATE ${TABLE} SET status = 'pending', locked_at = NULL, locked_by = NULL,
                        last_error = 'Worker stopped responding; the job was reclaimed', updated_at = now()
                 WHERE status = 'running'
                   AND locked_at < now() - make_interval(secs => $1)
                   AND attempts < max_attempts
                 RETURNING id`,
                [seconds]
            );

            const buried = await exec(
                `UPDATE ${TABLE} SET status = 'failed', locked_at = NULL, locked_by = NULL,
                        last_error = 'Worker stopped responding on the final attempt', updated_at = now()
                 WHERE status = 'running'
                   AND locked_at < now() - make_interval(secs => $1)
                   AND attempts >= max_attempts
                 RETURNING id`,
                [seconds]
            );

            const count = (revived?.length ?? 0) + (buried?.length ?? 0);
            if (count > 0) {
                logger.warn(
                    `[jobs] Reclaimed ${count} job(s) from a worker that stopped responding ` +
                    `(${revived?.length ?? 0} retryable, ${buried?.length ?? 0} dead-lettered)`
                );
            }
            return count;
        },

        async fetch(id: string): Promise<JobRecord | null> {
            const rows = await exec(`SELECT * FROM ${TABLE} WHERE id = $1`, [id]);
            const row = (rows as unknown as JobRow[])[0];
            return row ? toRecord(row) : null;
        }
    };
}
