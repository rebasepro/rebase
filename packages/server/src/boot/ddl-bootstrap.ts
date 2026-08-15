import { logger } from "../utils/logger.js";

/**
 * Helpers for the "create my internal table if it isn't there yet" bootstrap
 * that several stores run at boot.
 *
 * These all look trivially safe — every statement is `IF NOT EXISTS` — and they
 * are not, for two reasons that only show up with more than one app instance:
 *
 *  1. `CREATE … IF NOT EXISTS` reads the catalog and then writes to it, and
 *     those two steps are not one atomic operation. Instances starting together
 *     — a rolling deploy, a replica count going from 1 to N, a crash loop
 *     restarting the fleet — can both see "absent" and both try to create. The
 *     loser gets a duplicate key on a *catalog* index instead of the silent
 *     no-op the syntax appears to promise. Measured against Postgres 18: with
 *     five instances booting at once, 8 of 10 `ensureTable` calls hit it.
 *
 *  2. A bootstrap written as one long `try` block therefore abandons everything
 *     after the losing statement — including, in every store that has one, the
 *     `REVOKE` that takes the table back off the end-user role. That revoke is
 *     a security control and must not be collateral damage from a race.
 *
 * So: retry the race, contain each statement separately, and decide what to do
 * next from what actually exists rather than from who won.
 */

/** A driver's `executeSql`, narrowed to what a bootstrap needs. */
export type SqlExec = (sqlText: string, options?: { params?: unknown[] }) => Promise<Record<string, unknown>[]>;

/**
 * SQLSTATEs a *simultaneous boot* can raise from statements that are otherwise
 * idempotent. Retrying is always the right answer for these: the second attempt
 * finds the object present and does nothing.
 */
export const CONCURRENT_DDL_SQLSTATES = new Set([
    "23505", // unique_violation on pg_type / pg_class / pg_namespace
    "42P06", // duplicate_schema
    "42P07", // duplicate_table
    "42710", // duplicate_object — an index or a constraint
    "40P01" // deadlock_detected — two boots taking catalog locks in step
]);

/** Attempts per idempotent DDL statement, including the first. */
export const DDL_ATTEMPTS = 4;
const DDL_RETRY_BASE_MS = 40;

/**
 * Walk an error's `cause` chain, stopping at the first link `visit` accepts.
 * Drizzle wraps the driver error, so nothing useful is ever on the top level.
 */
export function hasInCauseChain(err: unknown, visit: (e: Record<string, unknown>) => boolean): boolean {
    let current: unknown = err;
    for (let depth = 0; depth < 10 && current; depth++) {
        if (typeof current !== "object") break;
        const e = current as Record<string, unknown>;
        if (visit(e)) return true;
        current = e.cause;
    }
    return false;
}

/**
 * Is this the loser of a race to create something that already exists?
 *
 * Deliberately narrow. A permission failure, an unreachable database or a typo
 * in the DDL must surface on the first attempt rather than being retried four
 * times and then reported as a race that never was.
 */
export function isConcurrentDdlRace(err: unknown): boolean {
    return hasInCauseChain(err, (e) =>
        (typeof e.code === "string" && CONCURRENT_DDL_SQLSTATES.has(e.code)) ||
        // SQLite and MySQL say it in words rather than in a shared SQLSTATE.
        (typeof e.message === "string" && /already exists/i.test(e.message))
    );
}

/**
 * SQLSTATEs that mean, unambiguously, *the object is already there*.
 *
 * A subset of {@link CONCURRENT_DDL_SQLSTATES} and a stricter question. The
 * broad set answers "should this be retried"; this one answers "is it safe to
 * carry on as though the statement had succeeded", which is a claim about the
 * end state rather than about the attempt. Deadlock is not in it — a deadlocked
 * statement did nothing and must be retried, not skipped.
 */
const DUPLICATE_OBJECT_SQLSTATES = new Set([
    "42P06", // duplicate_schema
    "42P07", // duplicate_table
    "42710" // duplicate_object — a type, an index, a constraint
]);

/**
 * Did this statement fail *because a peer already created the same object*?
 *
 * The narrow companion to {@link isConcurrentDdlRace}, for the one caller that
 * needs to tell "someone beat me to it" from "this genuinely failed": a loop
 * applying a schema plan, where treating every `23505` as a harmless race would
 * silently swallow the one that matters — a unique constraint that cannot be
 * added because the customer's existing rows violate it.
 *
 * `23505` is therefore only accepted when it names a `pg_catalog` index. That is
 * what a lost `CREATE TYPE`/`CREATE TABLE` race raises (`pg_type_typname_nsp_index`
 * is the one seen in practice); a unique violation on user data names the user's
 * own constraint and is left to the caller.
 */
export function isDuplicateObjectRace(err: unknown): boolean {
    return hasInCauseChain(err, (e) => {
        if (typeof e.code !== "string") return false;
        if (DUPLICATE_OBJECT_SQLSTATES.has(e.code)) return true;
        if (e.code !== "23505") return false;
        // node-postgres puts the violated index in `constraint`; some paths only
        // carry it in the detail text, so check both rather than miss the race.
        const constraint = typeof e.constraint === "string" ? e.constraint : "";
        const detail = typeof e.detail === "string" ? e.detail : "";
        return constraint.startsWith("pg_") || /\bpg_[a-z_]+_index\b/.test(detail);
    });
}

export interface DdlBootstrapper {
    /**
     * Run one idempotent statement — `CREATE … IF NOT EXISTS`, `ALTER TABLE …
     * ADD COLUMN IF NOT EXISTS` — retrying the catalog race a simultaneous boot
     * produces. Never throws: a statement that cannot be made to work is logged
     * and the caller carries on to the next one.
     */
    ensureObject(label: string, sqlText: string): Promise<void>;

    /** Contain one step's failure so that the steps after it still run. */
    step(label: string, run: () => Promise<unknown>): Promise<void>;

    /**
     * Is this table there and readable? Asked with a query any SQL dialect
     * answers, rather than `to_regclass`, so a future non-Postgres SQL driver
     * gets a real answer instead of a syntax error read as "missing".
     */
    isReadable(table: string): Promise<boolean>;
}

/**
 * @param exec   the driver's SQL escape hatch
 * @param scope  log prefix identifying the caller, e.g. `"cron-store"`
 */
export function createDdlBootstrapper(exec: SqlExec, scope: string): DdlBootstrapper {
    /** Jittered, so peers that collided once do not collide again in lockstep. */
    const backoff = (attempt: number) =>
        new Promise(resolve => setTimeout(resolve, DDL_RETRY_BASE_MS * attempt * (1 + Math.random())));

    const step: DdlBootstrapper["step"] = async (label, run) => {
        try {
            await run();
        } catch (err) {
            logger.error(`[${scope}] ${label} failed`, { error: err });
        }
    };

    return {
        step,

        ensureObject(label, sqlText) {
            return step(label, async () => {
                for (let attempt = 1; ; attempt++) {
                    try {
                        await exec(sqlText);
                        return;
                    } catch (err) {
                        if (!isConcurrentDdlRace(err) || attempt >= DDL_ATTEMPTS) throw err;
                        logger.debug(
                            `[${scope}] Lost a create race for ${label} with another instance ` +
                            `(attempt ${attempt}/${DDL_ATTEMPTS}) — retrying`
                        );
                        await backoff(attempt);
                    }
                }
            });
        },

        async isReadable(table) {
            try {
                await exec(`SELECT 1 FROM ${table} WHERE false`);
                return true;
            } catch {
                return false;
            }
        }
    };
}
