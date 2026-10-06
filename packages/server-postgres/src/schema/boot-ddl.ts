/**
 * How boot DDL waits for a table lock, and how it applies several statements as
 * one.
 *
 * ## Why boot DDL has a lock budget at all
 *
 * Every statement that changes a table — `ALTER TABLE`, `CREATE`/`DROP POLICY`,
 * `DROP TRIGGER` — needs a lock that conflicts with readers. While it *waits*
 * for that lock it sits in the table's lock queue, and every query that arrives
 * after it queues behind it, however short. A boot that happened to start while
 * a report, a long transaction or a `pg_dump` held a table stalled every live
 * read of that table for as long as it waited — up to the pool's
 * `statement_timeout` (30 s), per statement, one table after another.
 *
 * `lock_timeout` turns that wait into a short, bounded attempt. Measured on
 * Postgres 18: a reader holding one table for 5 s held a live `SELECT
 * count(*)` behind the boot for 4.4 s; with the budget below it is held for at
 * most {@link BOOT_LOCK_TIMEOUT_MS}, and the queue drains between attempts.
 *
 * ## The budget
 *
 * 1 s per attempt. An uncontended `ACCESS EXCLUSIVE` on a healthy table is
 * granted in well under a millisecond — the wait is for the statements already
 * running on it to finish — so a second is three orders of magnitude of
 * headroom and never fires on a database that is merely busy. It fires only
 * when something holds the table for longer than any interactive query should,
 * and then the cost to live traffic is one second, which sits inside every
 * client timeout this framework ships with. Longer budgets buy nothing a retry
 * does not buy better: the queue behind a waiting lock grows for as long as it
 * waits, and drains as soon as it gives up.
 *
 * ## Applying several statements as one
 *
 * {@link atomicBatch} joins statements into one simple-protocol query string.
 * Postgres runs a multi-statement query as a single implicit transaction: every
 * statement commits or none does, the `SET LOCAL` applies to that transaction
 * only, and a failure rolls it back on its own — the connection goes back to the
 * pool clean, which an explicit `BEGIN` in the string would not guarantee. It is
 * one round trip and one commit instead of one of each per statement.
 *
 * A handle that speaks only the extended protocol (PGlite in-process, used by
 * tests) refuses the string before running any of it; {@link
 * isMultiStatementRefusal} recognises that so the caller can fall back to one
 * statement at a time.
 */
import { extractPgError } from "../utils/pg-error-utils";

/** `lock_timeout` for each attempt at a boot DDL statement or batch. See the module comment. */
export const BOOT_LOCK_TIMEOUT_MS = 1_000;

/** Attempts per table, including the first, before a contended table is given up on. */
export const BOOT_LOCK_ATTEMPTS = 3;

/**
 * The most lock waiting one boot step spends on *retries*, in total.
 *
 * Without a cap, a holder that covers the whole database — a `pg_dump` takes
 * `ACCESS SHARE` on every table it dumps, for as long as it runs — costs
 * tables × attempts × timeout: four minutes at 240 tables. Retrying is for the
 * holder that is about to finish (a report, a transaction), and ten seconds is
 * plenty to wait that out; past it, waiting longer only delays the boot.
 */
export const BOOT_LOCK_RETRY_BUDGET_MS = 10_000;

export interface BootLockOptions {
    /** Per-attempt `lock_timeout`, ms. Default {@link BOOT_LOCK_TIMEOUT_MS}. */
    lockTimeoutMs?: number;
    /** Attempts per table, including the first. Default {@link BOOT_LOCK_ATTEMPTS}. */
    attempts?: number;
    /** Total retry waiting per step, ms. Default {@link BOOT_LOCK_RETRY_BUDGET_MS}. */
    retryBudgetMs?: number;
    /** Pause before retry round `round` (1-based), ms. Default: jittered, growing. */
    backoffMs?: (round: number) => number;
}

export interface ResolvedBootLockOptions {
    lockTimeoutMs: number;
    attempts: number;
    retryBudgetMs: number;
    backoffMs: (round: number) => number;
}

export const resolveBootLockOptions = (options: BootLockOptions = {}): ResolvedBootLockOptions => ({
    lockTimeoutMs: options.lockTimeoutMs ?? BOOT_LOCK_TIMEOUT_MS,
    attempts: Math.max(1, options.attempts ?? BOOT_LOCK_ATTEMPTS),
    retryBudgetMs: options.retryBudgetMs ?? BOOT_LOCK_RETRY_BUDGET_MS,
    // Jittered so two replicas booting together do not retry in lockstep.
    backoffMs: options.backoffMs ?? (round => 500 * round * (1 + Math.random()))
});

/** `55P03 lock_not_available` — what `lock_timeout` raises. */
export const isLockTimeout = (err: unknown): boolean => extractPgError(err)?.code === "55P03";

/**
 * `42601` "cannot insert multiple commands into a prepared statement": the
 * handle runs every query over the extended protocol, which carries exactly one
 * statement. Raised before anything runs, so nothing needs undoing.
 */
export const isMultiStatementRefusal = (err: unknown): boolean => {
    const pg = extractPgError(err);
    return pg?.code === "42601" && /multiple commands/i.test(pg.message ?? "");
};

/**
 * `SET LOCAL lock_timeout`, then the statements: one string, one implicit
 * transaction. See the module comment for why this and not `BEGIN … COMMIT`.
 */
export const atomicBatch = (statements: readonly string[], lockTimeoutMs: number): string =>
    [
        `SET LOCAL lock_timeout = '${Math.max(1, Math.round(lockTimeoutMs))}ms';`,
        ...statements.map(statement => {
            const trimmed = statement.trim();
            return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
        })
    ].join("\n");

export const sleep = (ms: number): Promise<void> =>
    ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
