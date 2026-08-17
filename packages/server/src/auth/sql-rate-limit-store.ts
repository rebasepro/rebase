/**
 * A rate-limit store every process in a deployment shares.
 *
 * {@link MemoryRateLimitStore} counts in one process's memory, so N replicas
 * enforce N times the limit between them. That is fine for the single container
 * almost every deployment runs, and wrong the moment a deployment splits — an
 * `api` pod and a `functions` pod each grant a caller the full allowance, and
 * nothing anywhere reports it. A limit that silently lets through 3× the traffic
 * is worse than no limit, because it is believed.
 *
 * So this keeps the counts in Postgres, on the same seam the cron store already
 * uses: `DataDriver.admin.executeSql`. No new dependency, no new service, and it
 * degrades on a driver with no SQL (Mongo) rather than failing to boot.
 *
 * ## Why two buckets rather than one row per hit
 *
 * The memory store keeps a timestamp per hit, which is exact and costs a row per
 * request here. This keeps **one row per key per window** and approximates the
 * same sliding behaviour by weighting the previous window by how much of it is
 * still in view:
 *
 *     estimate = current + previous × (1 − elapsed ÷ window)
 *
 * At the moment a window rolls over the previous bucket counts fully and decays
 * to nothing by the end, so the boundary burst a fixed window allows — spend the
 * whole allowance in the last second, spend it again in the first second of the
 * next — is bounded rather than free. This is the standard approximation and its
 * error is at most one window's distribution skew, which for a floor against
 * runaway clients is not a number worth a row per request.
 *
 * ## Why a denied hit is given back
 *
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` is atomic per row, which is what
 * the interface demands: two concurrent hits cannot both read `limit - 1` and
 * both be allowed. But it means the count is incremented *before* the decision,
 * so a request that turns out to be over the limit has already been charged for.
 *
 * The memory store does not charge denied hits, and a store whose semantics
 * differ from the default is a store nobody can safely switch to — the limit
 * would tighten for reasons an operator would attribute to their traffic. So a
 * denial issues a compensating decrement. That is a second statement, on the
 * path that is by definition the rare one; the allowed path stays at one.
 */
import type { DataDriver } from "@rebasepro/types";
import { isSQLAdmin } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { logger } from "../utils/logger.js";
import { createDdlBootstrapper } from "../boot/ddl-bootstrap.js";
import type { RateLimitDecision, RateLimitStore } from "./rate-limit-store.js";

const SCHEMA = "rebase";
const TABLE_NAME = "rate_limit_hits";
const TABLE = `${SCHEMA}.${TABLE_NAME}`;

/** How often expired buckets are deleted. */
const DEFAULT_SWEEP_MS = 5 * 60 * 1000;

export interface SqlRateLimitStoreOptions {
    /** How often to delete expired buckets. Defaults to 5 minutes. */
    sweepMs?: number;
    /**
     * Clock, for tests. Driving the window directly beats sleeping through half
     * of one — a real sleep overruns on a loaded machine and takes the hits it
     * expected to still be in the window with it.
     */
    now?: () => number;
}

/**
 * Build the store, or `undefined` if this driver cannot back it.
 *
 * Returning `undefined` rather than throwing matches `createCronStore`: a
 * deployment on a driver with no SQL admin should degrade to per-process counts
 * with a warning, not refuse to serve.
 */
export function createSqlRateLimitStore(
    driver: DataDriver,
    options: SqlRateLimitStoreOptions = {}
): RateLimitStore | undefined {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) {
        logger.warn(
            "⚠️ [rate-limit] The configured driver has no SQL admin, so rate-limit counts " +
            "cannot be shared between processes. Falling back to this process's memory — " +
            "each replica will enforce the limit independently."
        );
        return undefined;
    }

    const exec = (sqlText: string, options?: { params?: unknown[] }) =>
        admin.executeSql(sqlText, options?.params ? { params: options.params } : undefined);

    const ddl = createDdlBootstrapper(exec, "rate-limit-store");
    const now = options.now ?? Date.now;
    const sweepMs = options.sweepMs ?? DEFAULT_SWEEP_MS;

    let sweepTimer: ReturnType<typeof setInterval> | undefined;
    let ready: Promise<boolean> | undefined;

    /**
     * Create the table once, and remember whether it worked.
     *
     * Lazily rather than at boot because the store is constructed while routes
     * are being mounted, and an `await` there would put a database round trip on
     * the boot path of every deployment — including the ones that never take a
     * request. The first request pays for it.
     *
     * The result is cached even on failure: a store that cannot create its table
     * must not retry the DDL on every request, which would turn one broken
     * permission into a per-request query storm.
     *
     * Readiness is decided by reading the table, never by the DDL not throwing —
     * `ensureObject` routes through `step`, which logs a failure and returns
     * normally. Keying on the absence of an exception would report a table that
     * was never created as ready, and every later request would fall into the
     * per-request error path instead of the one-time fallback.
     */
    async function ensureReady(): Promise<boolean> {
        if (!ready) {
            ready = (async () => {
                try {
                    await ddl.ensureObject("Creating schema rebase", "CREATE SCHEMA IF NOT EXISTS rebase");
                    await ddl.ensureObject(`Creating ${TABLE}`, `
                        CREATE TABLE IF NOT EXISTS ${TABLE} (
                            key TEXT NOT NULL,
                            bucket BIGINT NOT NULL,
                            hits INTEGER NOT NULL DEFAULT 0,
                            expires_at TIMESTAMPTZ NOT NULL,
                            PRIMARY KEY (key, bucket)
                        )
                    `);
                    // The sweep's only access path. Without it a deployment with
                    // many distinct keys sweeps by sequential scan, which is the
                    // kind of cost that shows up as unexplained load long after
                    // anyone connects it to a rate limiter.
                    await ddl.ensureObject("Creating idx_rate_limit_hits_expiry", `
                        CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_expiry
                        ON ${TABLE}(expires_at)
                    `);

                    // Keyed on what exists, not on whether this instance created
                    // it — the loser of a boot race must still revoke, or an
                    // end-user role keeps write access to the table that decides
                    // its own limits.
                    const readable = await ddl.isReadable(TABLE);
                    if (readable) {
                        await ddl.step("Revoking end-user access to rate_limit_hits", () =>
                            exec(revokeInternalTableSql(SCHEMA, TABLE_NAME)));
                    } else {
                        logger.error(
                            "[rate-limit] The shared rate-limit table could not be created, so counts " +
                            "stay per-process. Every replica will enforce the limit independently."
                        );
                    }
                    return readable;
                } catch (err) {
                    logger.error(
                        "[rate-limit] Could not prepare the shared rate-limit table. Falling back " +
                        "to per-process counts for the life of this process.",
                        { error: err instanceof Error ? err.message : String(err) }
                    );
                    return false;
                }
            })();
        }
        return ready;
    }

    function startSweeping(): void {
        if (sweepTimer) return;
        sweepTimer = setInterval(() => {
            void exec(`DELETE FROM ${TABLE} WHERE expires_at < now()`).catch((err: unknown) => {
                // A failed sweep is not a failed request. Log and let the next
                // one try: the rows are harmless until they are many.
                logger.debug("[rate-limit] Bucket sweep failed", {
                    error: err instanceof Error ? err.message : String(err)
                });
            });
        }, sweepMs);
        // Never hold a process open for a garbage collection.
        sweepTimer.unref?.();
    }

    return {
        async hit(key: string, windowMs: number, limit: number): Promise<RateLimitDecision> {
            if (!(await ensureReady())) {
                // No table, so no shared count. Allowing is the right failure
                // direction for a *floor*: refusing every request because the
                // limiter's bookkeeping is broken turns a missing safety net
                // into an outage.
                return { allowed: true, remaining: limit, retryAfterMs: 0 };
            }
            startSweeping();

            const at = now();
            const bucket = Math.floor(at / windowMs);
            const elapsed = at - bucket * windowMs;
            // How much of the previous window is still in view. 1 at the instant
            // of rollover, 0 by the end of this one.
            const carry = 1 - elapsed / windowMs;
            const expiresAt = new Date((bucket + 2) * windowMs).toISOString();

            let current: number;
            let previous: number;
            try {
                const rows = await exec(
                    `WITH bumped AS (
                         INSERT INTO ${TABLE} AS r (key, bucket, hits, expires_at)
                         VALUES ($1, $2, 1, $3)
                         ON CONFLICT (key, bucket)
                         DO UPDATE SET hits = r.hits + 1, expires_at = EXCLUDED.expires_at
                         RETURNING hits
                     )
                     SELECT
                         (SELECT hits FROM bumped) AS current,
                         COALESCE((SELECT hits FROM ${TABLE} WHERE key = $1 AND bucket = $4), 0) AS previous`,
                    { params: [key, bucket, expiresAt, bucket - 1] }
                );
                const row = firstRow(rows);
                current = Number(row?.current ?? 1);
                previous = Number(row?.previous ?? 0);
            } catch (err) {
                logger.debug("[rate-limit] Shared count unavailable for this request", {
                    error: err instanceof Error ? err.message : String(err)
                });
                return { allowed: true, remaining: limit, retryAfterMs: 0 };
            }

            const estimate = current + previous * carry;

            if (estimate > limit) {
                // Give back the hit this request was charged, so the store agrees
                // with MemoryRateLimitStore about what a denial costs.
                void exec(
                    `UPDATE ${TABLE} SET hits = GREATEST(hits - 1, 0) WHERE key = $1 AND bucket = $2`,
                    { params: [key, bucket] }
                ).catch(() => { /* the bucket expires on its own; never fail a request on this */ });

                return {
                    allowed: false,
                    remaining: 0,
                    // When the oldest thing still counted against this caller
                    // leaves the window. With a bucketed window that is the end
                    // of the current bucket.
                    retryAfterMs: Math.max(0, (bucket + 1) * windowMs - at)
                };
            }

            return {
                allowed: true,
                remaining: Math.max(0, Math.floor(limit - estimate)),
                retryAfterMs: 0
            };
        },

        dispose(): void {
            if (sweepTimer) clearInterval(sweepTimer);
            sweepTimer = undefined;
        }
    };
}

/**
 * The first row of whatever shape this driver returns.
 *
 * `SqlExec` declares an array of rows, but drivers in this repository have also
 * returned a `{ rows }` envelope through the same escape hatch. Reading one
 * shape only is how a store silently counts nothing and reports every caller as
 * being on their first request — a limiter that never limits, with no error
 * anywhere. Tolerating both costs one line.
 */
function firstRow(result: unknown): Record<string, unknown> | undefined {
    if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined;
    const rows = (result as { rows?: unknown[] } | undefined)?.rows;
    return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}
