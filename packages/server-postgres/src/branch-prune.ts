/**
 * What `rebase db branch prune` should remove, decided without a database.
 *
 * Branching had no cleanup story at all: no TTL, no prune, no `delete --all`,
 * and every branch is a **full-size copy** — `CREATE DATABASE ... TEMPLATE`
 * duplicates the files on disk, so five branches of a 100 GB database cost
 * 500 GB. The only way to reclaim any of it was to remember every name you had
 * ever typed.
 *
 * Three things drift apart, and they are not the same problem:
 *
 * 1. **Stale rows** — `rebase.branches` says a branch exists and its database
 *    is gone. Someone dropped it with plain SQL, or restored the cluster from
 *    a backup taken before it. The row is what `list` reads, so the branch goes
 *    on being reported forever; `switch` and `info` then fail against a
 *    database nothing can find.
 *
 * 2. **Orphan databases** — an `rb_*` database with no row. `createBranch`
 *    creates the database first and records it second, so a crash between the
 *    two leaves exactly this: disk consumed by something no Rebase command will
 *    ever mention again.
 *
 * 3. **Expired branches** — alive, registered, and older than you meant to keep.
 *    This is the ordinary case and the reason the command exists.
 *
 * Atlas's scratch databases are reported alongside but never removed by
 * default. `rebase db push` creates `<db>_dev_diff` to compute its diff against
 * and does not always clean it up, so they accumulate next to the branches and
 * look like them. They are not branches, and one may belong to an Atlas run
 * happening right now — so this names them and leaves the decision to a flag.
 */

/** A branch as `rebase.branches` records it. */
export interface BranchRow {
    name: string;
    dbName: string;
    createdAt: Date;
}

export interface PrunePlan {
    /** Registered, but the database is gone. Remove the row only. */
    staleRows: BranchRow[];
    /** An `rb_*` database with no row. Drop the database only. */
    orphanDatabases: string[];
    /** Alive, registered, older than the cutoff. Drop both. */
    expired: { branch: BranchRow; ageDays: number }[];
    /** Atlas scratch databases. Reported; removed only when asked. */
    devDiff: string[];
}

/** True when nothing at all needs doing. */
export function planIsEmpty(plan: PrunePlan, includeDevDiff: boolean): boolean {
    return plan.staleRows.length === 0
        && plan.orphanDatabases.length === 0
        && plan.expired.length === 0
        && (!includeDevDiff || plan.devDiff.length === 0);
}

/**
 * Age in whole days, floored.
 *
 * Floored rather than rounded so `--older-than 7` never catches something six
 * and a half days old: a prune that removes more than it said it would is worse
 * than one that waits another twelve hours.
 */
export function ageInDays(createdAt: Date, now: Date): number {
    return Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
}

/**
 * Parse `--older-than`. Accepts a bare number of days, or `7d` / `2w`.
 *
 * Returns null for anything else, so the caller refuses rather than guessing —
 * silently reading `--older-than 7h` as seven *days* would delete a week of
 * work.
 */
export function parseOlderThan(value: string): number | null {
    const match = /^(\d+)\s*([dw])?$/i.exec(value.trim());
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;

    return match[2]?.toLowerCase() === "w" ? amount * 7 : amount;
}

export function planPrune(
    input: {
        rows: readonly BranchRow[];
        /** Every database name on the server. */
        databases: readonly string[];
        branchPrefix: string;
    },
    options: { olderThanDays?: number | null; now?: Date } = {}
): PrunePlan {
    const now = options.now ?? new Date();
    const present = new Set(input.databases);
    const registered = new Set(input.rows.map((row) => row.dbName));

    const staleRows = input.rows.filter((row) => !present.has(row.dbName));

    const orphanDatabases = input.databases
        .filter((name) => name.startsWith(input.branchPrefix) && !registered.has(name))
        .sort();

    const expired = options.olderThanDays == null
        ? []
        : input.rows
            // A row whose database is already gone is a stale row, not an
            // expired branch — listing it under both would offer to drop a
            // database that does not exist.
            .filter((row) => present.has(row.dbName))
            .map((branch) => ({ branch, ageDays: ageInDays(branch.createdAt, now) }))
            .filter((entry) => entry.ageDays >= options.olderThanDays!)
            .sort((a, b) => b.ageDays - a.ageDays);

    const devDiff = input.databases.filter((name) => name.endsWith("_dev_diff")).sort();

    return { staleRows, orphanDatabases, expired, devDiff };
}
