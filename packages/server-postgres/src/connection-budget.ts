/**
 * How many connections this process can open, against how many the database
 * will accept.
 *
 * A Postgres server takes `max_connections` clients, a few of them kept for
 * superusers, and every process of an app shares them. One Rebase process can
 * open a main pool of 20, plus a read replica's, a console session pool behind
 * a pooler, a pool per database the Studio reaches, and one connection per
 * `LISTEN` and WAL stream. Against a 25-connection database (a small managed
 * tier) one process can hold nearly all of it, and the second instance — or
 * the overlap of a rolling deploy, or `psql` — meets SQLSTATE 53300 "too many
 * clients" in front of a user. Nothing said so before that happened.
 *
 * So every pool and dedicated connection says what it may open when it is
 * created ({@link trackConnectionDemand}), the boot reads the database's
 * limits once ({@link readConnectionLimits}), and {@link watchConnectionBudget}
 * warns once, with both numbers, what makes up the demand, and the fix, when
 * one process may use more than half the slots. Demand added after the boot (a
 * Studio query against another database opens a pool) is weighed as it
 * arrives, against the limits already read.
 *
 * A warning, not a cap. A cap that sized itself would have to guess what this
 * process may not see: how many instances run, what else connects (a
 * migration job, a cron, a person with `psql`), how much of the demand is ever
 * used at once. Guessed low, it serializes a production server whose
 * database had room — the failure `poolMaxCeiling` is written to never cause.
 * `REBASE_DB_POOL_MAX` is the cap, and the warning computes the value to set.
 */

import { logger } from "@rebasepro/server";

/** One pool or dedicated connection, and what it may open. */
export interface ConnectionDemand {
    /** What it is, as the warning names it: `main pool`, `LISTEN rebase_cdc`. */
    label: string;
    /** Connections it may hold at once — a pool's `max` after `REBASE_DB_POOL_MAX`. */
    max: number;
    /**
     * The size asked for before `REBASE_DB_POOL_MAX`, for a pool the ceiling
     * applies to. Absent for a fixed demand: one dedicated connection, or a
     * pool opened without reading the ceiling. Used to work out the ceiling
     * that would fit.
     */
    requested?: number;
    /** The server it connects to — see {@link serverKeyOf}. */
    server: string;
    /**
     * Reaches the database through a transaction-mode pooler: its connections
     * are the pooler's clients, and the pooler's own pool size decides what
     * reaches the server. Not counted.
     */
    pooled: boolean;
}

interface TrackedDemand {
    demand: ConnectionDemand;
    /** Still able to open connections. A pool that was ended is not. */
    isActive: () => boolean;
}

/** Keyed by the owner (the pool, the listener), so it can be relabelled or released. */
const tracked = new Map<object, TrackedDemand>();

/**
 * Record what `owner` may open, until `isActive` turns false or the returned
 * function is called. Evaluated at once against a server whose limits a boot
 * already read.
 */
export function trackConnectionDemand(
    owner: object,
    demand: ConnectionDemand,
    isActive: () => boolean = () => true
): () => void {
    tracked.set(owner, { demand, isActive });
    reevaluate(demand.server);
    return () => {
        if (tracked.get(owner)?.demand === demand) tracked.delete(owner);
    };
}

/** Rename what `owner` is called in the warning — a direct pool opened as the console's session pool. */
export function labelConnectionDemand(owner: object, label: string): void {
    const entry = tracked.get(owner);
    if (entry) entry.demand = { ...entry.demand, label };
}

/** Every demand still active, the ended ones dropped. */
export function currentConnectionDemand(): ConnectionDemand[] {
    for (const [owner, entry] of tracked) {
        if (!entry.isActive()) tracked.delete(owner);
    }
    return Array.from(tracked.values(), entry => entry.demand);
}

/**
 * The server a connection string reaches, as `host:port` — what a
 * `max_connections` is counted against. A string that is not a URL (a
 * key/value DSN) is its own key: it then matches only itself, and is never
 * miscounted against another server.
 */
export function serverKeyOf(connectionString: string): string {
    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        return connectionString;
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return connectionString;
    // A unix socket is spelled `?host=/var/run/postgresql`.
    const host = (url.searchParams.get("host") || url.hostname || "localhost").toLowerCase();
    const port = url.searchParams.get("port") || url.port || "5432";
    return `${host}:${port}`;
}

/** What the database lets in, as read by {@link readConnectionLimits}. */
export interface DatabaseConnectionLimits {
    maxConnections: number;
    /** `superuser_reserved_connections`. */
    superuserReserved: number;
    /** `reserved_connections` (PG16+, for `pg_use_reserved_connections`); 0 before. */
    reserved: number;
    /** The connecting role's `rolconnlimit`; -1 for none. */
    roleLimit: number;
    /** The database's `datconnlimit`; -1 for none. */
    databaseLimit: number;
    /** A superuser is exempt from the role's and the database's limits. */
    superuser: boolean;
}

/** The query {@link readConnectionLimits} runs. Read-only: fine with `REBASE_PROVISION=false`. */
export const CONNECTION_LIMITS_SQL =
    "SELECT current_setting('max_connections') AS max_connections, " +
    "current_setting('superuser_reserved_connections') AS superuser_reserved, " +
    // Missing before PG16: `true` answers NULL instead of raising.
    "current_setting('reserved_connections', true) AS reserved, " +
    "r.rolconnlimit::text AS role_limit, r.rolsuper AS superuser, d.datconnlimit::text AS database_limit " +
    "FROM pg_roles r, pg_database d WHERE r.rolname = current_user AND d.datname = current_database()";

/** A whole number written as one, or a number that is one; anything else is unreadable. */
function wholeNumber(value: unknown, { allowNegativeOne = false } = {}): number | undefined {
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : undefined;
    if (text === undefined) return undefined;
    if (allowNegativeOne && text === "-1") return -1;
    if (!/^[0-9]+$/.test(text)) return undefined;
    return Number(text);
}

/**
 * {@link CONNECTION_LIMITS_SQL}'s row as limits, or `undefined` when any
 * value cannot be read for certain — a warning built on a misread number is
 * worse than none.
 */
export function parseConnectionLimits(row: Record<string, unknown> | undefined): DatabaseConnectionLimits | undefined {
    if (!row) return undefined;
    const maxConnections = wholeNumber(row.max_connections);
    const superuserReserved = wholeNumber(row.superuser_reserved);
    const reserved = row.reserved === null || row.reserved === undefined ? 0 : wholeNumber(row.reserved);
    const roleLimit = wholeNumber(row.role_limit, { allowNegativeOne: true });
    const databaseLimit = wholeNumber(row.database_limit, { allowNegativeOne: true });
    const superuser = row.superuser === true || row.superuser === "t" || row.superuser === "true";
    if (maxConnections === undefined || maxConnections < 1 || superuserReserved === undefined
        || reserved === undefined || roleLimit === undefined || databaseLimit === undefined) {
        return undefined;
    }
    return { maxConnections, superuserReserved, reserved, roleLimit, databaseLimit, superuser };
}

/** Run {@link CONNECTION_LIMITS_SQL}. `undefined` when it fails or answers something unreadable. */
export async function readConnectionLimits(
    query: (text: string) => Promise<Record<string, unknown>[]>
): Promise<DatabaseConnectionLimits | undefined> {
    try {
        return parseConnectionLimits((await query(CONNECTION_LIMITS_SQL))[0]);
    } catch (err) {
        logger.debug("[connections] Could not read the database's connection limits; not checking the pool sizes against them.", {
            detail: err instanceof Error ? err.message : String(err)
        });
        return undefined;
    }
}

/** How many connections ordinary clients share, and what sets that number. */
export interface UsableSlots {
    usable: number;
    /** The words that explain {@link usable}: `max_connections 25 − 3 reserved for superusers`. */
    explanation: string;
}

/**
 * The connections this app's clients can have between them: `max_connections`
 * less the slots reserved for superusers and for `pg_use_reserved_connections`
 * — kept out even for a superuser, whose app should not be the thing that
 * fills them — and no more than the role's or the database's own limit, which
 * bind everyone but a superuser.
 */
export function usableConnectionSlots(limits: DatabaseConnectionLimits): UsableSlots {
    const reservedTotal = limits.superuserReserved + limits.reserved;
    let usable = Math.max(0, limits.maxConnections - reservedTotal);
    let explanation = `max_connections ${limits.maxConnections}`;
    if (limits.superuserReserved > 0) explanation += ` − ${limits.superuserReserved} reserved for superusers`;
    if (limits.reserved > 0) explanation += ` − ${limits.reserved} reserved_connections`;
    if (!limits.superuser && limits.roleLimit >= 0 && limits.roleLimit < usable) {
        usable = limits.roleLimit;
        explanation = `the role's CONNECTION LIMIT ${limits.roleLimit}`;
    }
    if (!limits.superuser && limits.databaseLimit >= 0 && limits.databaseLimit < usable) {
        usable = limits.databaseLimit;
        explanation = `the database's CONNECTION LIMIT ${limits.databaseLimit}`;
    }
    return { usable, explanation };
}

/** The demands counted against `server`: the ones that reach it directly. */
export function demandOn(server: string, demands: readonly ConnectionDemand[]): ConnectionDemand[] {
    return demands.filter(demand => demand.server === server && !demand.pooled);
}

/** The total `demands` would come to were every pool the ceiling applies to capped at `ceiling`. */
export function demandUnderCeiling(demands: readonly ConnectionDemand[], ceiling: number): number {
    return demands.reduce((sum, demand) =>
        sum + (demand.requested !== undefined ? Math.min(demand.requested, ceiling) : demand.max), 0);
}

/**
 * The largest `REBASE_DB_POOL_MAX` that keeps `demands` within `budget`, or
 * `undefined` when not even 1 would (what no ceiling reaches is too much on
 * its own) or no pool follows the ceiling at all.
 */
export function suggestedPoolMax(demands: readonly ConnectionDemand[], budget: number): number | undefined {
    const capped = demands.filter(demand => demand.requested !== undefined);
    if (capped.length === 0) return undefined;
    const largest = Math.max(...capped.map(demand => demand.requested ?? 0));
    for (let ceiling = largest; ceiling >= 1; ceiling--) {
        if (demandUnderCeiling(demands, ceiling) <= budget) return ceiling;
    }
    return undefined;
}

/** What {@link assessConnectionBudget} found worth saying. */
export interface ConnectionBudgetAssessment {
    demand: number;
    usable: number;
    explanation: string;
    /** `label max` per demand, largest first, the same labels summed. */
    parts: string[];
    /** The ceiling that leaves room for a second instance, when one does. */
    suggestedPoolMax?: number;
    /** How many processes of this size fit, at least 0. */
    processesThatFit: number;
}

/**
 * Whether `demands` on one server take more than half of what `limits` leave
 * usable — the point past which a second instance, or the old and new
 * instances of a rolling deploy, can run the database out. `undefined` when
 * they fit.
 */
export function assessConnectionBudget(
    demands: readonly ConnectionDemand[],
    limits: DatabaseConnectionLimits
): ConnectionBudgetAssessment | undefined {
    const { usable, explanation } = usableConnectionSlots(limits);
    const demand = demands.reduce((sum, entry) => sum + entry.max, 0);
    if (demand * 2 <= usable) return undefined;

    const byLabel = new Map<string, number>();
    for (const entry of demands) byLabel.set(entry.label, (byLabel.get(entry.label) ?? 0) + entry.max);
    const parts = Array.from(byLabel, ([label, max]) => ({ label, max }))
        .sort((a, b) => b.max - a.max)
        .map(({ label, max }) => `${label} ${max}`);

    return {
        demand,
        usable,
        explanation,
        parts,
        suggestedPoolMax: suggestedPoolMax(demands, Math.floor(usable / 2)),
        processesThatFit: demand > 0 ? Math.floor(usable / demand) : 0
    };
}

/** The warning, as one block. `where` names the server — never its credentials. */
export function formatConnectionBudgetWarning(
    assessment: ConnectionBudgetAssessment,
    where: string,
    options: { behindPooler?: boolean } = {}
): string {
    const { demand, usable, explanation, parts, suggestedPoolMax: ceiling, processesThatFit } = assessment;
    const alone = demand >= usable
        ? `This process alone can take every slot: under load its own requests meet SQLSTATE 53300 "too many clients".`
        : processesThatFit === 1
            ? `A second instance — or the old and new ones overlapping in a rolling deploy, or a migration job, or psql — ` +
              `can run the database out of connections, and requests then fail with SQLSTATE 53300 "too many clients".`
            : `${processesThatFit} processes like this one fill the database; past that, requests fail with SQLSTATE 53300 "too many clients".`;
    const fixes: string[] = [];
    if (ceiling !== undefined) {
        fixes.push(`set REBASE_DB_POOL_MAX=${ceiling} (caps every pool in the process; leaves room for two instances)`);
    }
    fixes.push(`run fewer instances (with N instances, keep N × ${demand} at most ${usable})`);
    fixes.push("or move to a database tier with more connections");
    return (
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  ⚠️  This process can open ${demand} connections; PostgreSQL at ${where} accepts ${usable}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `\n` +
        `  ${usable} usable = ${explanation}.\n` +
        `  This process: ${parts.join(", ")}.\n` +
        (options.behindPooler
            ? `  (The main pool reaches the database through a pooler and is not counted: these are the connections that bypass it.)\n`
            : "") +
        `\n` +
        `  ${alone}\n` +
        `\n` +
        `  To fix it: ${fixes.join("; ")}.\n` +
        `\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    );
}

interface WatchedServer {
    limits: DatabaseConnectionLimits;
    where: string;
    behindPooler: boolean;
    warned: boolean;
}

/** The servers whose limits a boot has read, by {@link serverKeyOf}. */
const watched = new Map<string, WatchedServer>();

function reevaluate(server: string): void {
    const entry = watched.get(server);
    if (!entry || entry.warned) return;
    const assessment = assessConnectionBudget(demandOn(server, currentConnectionDemand()), entry.limits);
    if (!assessment) return;
    entry.warned = true;
    logger.warn(formatConnectionBudgetWarning(assessment, entry.where, { behindPooler: entry.behindPooler }));
}

/**
 * Weigh this process's demand on `connectionString`'s server against
 * `limits`, now and whenever a pool or connection to it is added later. Warns
 * at most once per server.
 */
export function watchConnectionBudget(
    connectionString: string,
    limits: DatabaseConnectionLimits,
    options: { behindPooler?: boolean } = {}
): void {
    const server = serverKeyOf(connectionString);
    // The host and port only: a key/value DSN that is not a URL may hold a password.
    const where = server === connectionString ? "this database" : server;
    const existing = watched.get(server);
    watched.set(server, { limits, where, behindPooler: options.behindPooler === true, warned: existing?.warned ?? false });
    reevaluate(server);
}

/** For tests: forget every demand and every server read. */
export function resetConnectionBudget(): void {
    tracked.clear();
    watched.clear();
}
