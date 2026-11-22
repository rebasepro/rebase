/**
 * The database half of `backend/sql/*.sql` (see `sql-files.ts`), shared by the
 * two things that apply the files: `rebase db push` (`applySqlFiles` in
 * `cli-helpers.ts`) and a provisioning boot (the bootstrapper's
 * `ensureSqlFiles`, which is how a Cloud deploy applies them).
 *
 * ## Several instances at once
 *
 * A deploy boots every replica of the new revision together, against one
 * database, and each of them provisions. Each file runs in its own transaction
 * that first takes `pg_advisory_xact_lock` on {@link SQL_FILES_LOCK_KEY}, then
 * reads the file's ledger row again: an instance that waited behind another
 * finds the file recorded at its hash and runs nothing. So a file runs once per
 * content however many instances start, and a `db push` started during a
 * deploy queues behind it on the same key rather than racing it.
 *
 * A transaction lock, not a session one, for the reason the auth path gives
 * (`rebase_auth_functions_init`): behind a transaction-mode pooler a session
 * lock is released on whichever server connection the unlock lands on, which
 * may not hold it. The commit or rollback releases this one where it is held.
 * The boot's table DDL takes no lock of its own — each statement is idempotent
 * and a lost race is retried — so this key is the files' own, not one shared
 * with the rest of boot.
 *
 * ## The session
 *
 * A file holds many statements, so it must be sent as one simple-protocol
 * query: a `pg` client's `query(text)` with no parameters, or PGlite's
 * `exec`. Drizzle's `execute` speaks the extended protocol and refuses a
 * multi-statement string, which is why this takes a {@link SqlFilesSession}
 * rather than the boot's drizzle handle — and why the ledger row is written
 * with quoted literals rather than parameters. One connection for the whole
 * run: `BEGIN` … `COMMIT` must reach the same backend.
 *
 * A file must not contain its own `BEGIN`/`COMMIT`, nor a statement that cannot
 * run in a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`): it already runs
 * in one.
 */
import { planSqlFiles, SQL_FILES_LEDGER_SQL, type SqlFile, type SqlFilesPlan } from "./sql-files";

/** One connection, simple query protocol: a multi-statement string runs whole. */
export interface SqlFilesSession {
    query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A session holding a connection of its own, handed back with `release`. */
export interface OpenedSqlFilesSession extends SqlFilesSession {
    release(): void | Promise<void>;
}

/** The advisory-lock key every applier of `backend/sql` takes, push and boot alike. */
export const SQL_FILES_LOCK_KEY = "hashtext('rebase_sql_files')";

/**
 * `statement_timeout` for each file's transaction, `SET LOCAL` so it ends with
 * it. The pool's own (30 s) is a budget for a request; a file is a migration,
 * and the instances queued behind it on the lock wait for as long as it runs —
 * under the pool's budget the second replica of a deploy whose file took 31 s
 * failed its boot, blaming a file that had just been applied. Long enough for
 * any honest migration, short enough that a file stuck on a lock is not a boot
 * that never ends.
 */
export const SQL_FILE_STATEMENT_TIMEOUT = "15min";

/**
 * The client-side read timeout for each query on a `pg` connection: above the
 * server's budget, so the server's cancel (a clean error, the transaction
 * rolled back) always comes first. The pool's own is 60 s, which would cut a
 * replica off while it waits for the lock, leaving its connection mid-transaction.
 */
const SQL_FILE_READ_TIMEOUT_MS = 16 * 60 * 1000;

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const recordSql = (file: SqlFile): string =>
    "INSERT INTO rebase.sql_files (name, hash, applied_at) " +
    `VALUES (${quote(file.name)}, ${quote(file.hash)}, now()) ` +
    "ON CONFLICT (name) DO UPDATE SET hash = EXCLUDED.hash, applied_at = EXCLUDED.applied_at";

/** Thrown for a file that failed. Its transaction was rolled back; the files before it stay applied. */
export class SqlFileError extends Error {
    constructor(readonly file: string, cause: unknown) {
        super(
            `backend/sql/${file} failed, and was rolled back: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause }
        );
        this.name = "SqlFileError";
    }
}

async function readLedger(session: SqlFilesSession): Promise<Map<string, string> | undefined> {
    const { rows } = await session.query("SELECT to_regclass('rebase.sql_files') IS NOT NULL AS present");
    if (rows[0]?.present !== true) return undefined;
    const ledger = new Map<string, string>();
    for (const row of (await session.query("SELECT name, hash FROM rebase.sql_files")).rows) {
        if (typeof row.name === "string" && typeof row.hash === "string") ledger.set(row.name, row.hash);
    }
    return ledger;
}

/**
 * Apply `files` (already read and filtered, in order) through `session`: each
 * new or changed one in its own transaction, under {@link SQL_FILES_LOCK_KEY},
 * recorded in `rebase.sql_files`. Throws a {@link SqlFileError} for the first
 * file that fails, which was rolled back; nothing after it runs.
 *
 * Returns what THIS call did: `apply` lists the files it ran, and a file
 * another instance applied while this one waited for the lock is reported as
 * `unchanged`. With `dryRun` nothing is written (an absent ledger reads as
 * empty) and `apply` is what would run.
 */
export async function applySqlFilesOn(
    session: SqlFilesSession,
    files: readonly SqlFile[],
    options: { dryRun?: boolean } = {}
): Promise<SqlFilesPlan> {
    const ledger = await readLedger(session);
    if (files.length === 0 && ledger === undefined) return { apply: [], unchanged: [], removed: [] };
    const plan = planSqlFiles([...files], ledger ?? new Map());
    if (options.dryRun || plan.apply.length === 0) return plan;

    const ran: SqlFilesPlan["apply"] = [];
    const unchanged = [...plan.unchanged];
    let ledgerExists = ledger !== undefined;
    for (const file of plan.apply) {
        await session.query("BEGIN");
        try {
            await session.query(`SET LOCAL statement_timeout = '${SQL_FILE_STATEMENT_TIMEOUT}'`);
            await session.query(`SELECT pg_advisory_xact_lock(${SQL_FILES_LOCK_KEY})`);
            // Under the lock, so two instances creating it at once do not
            // collide on the catalogue (`CREATE … IF NOT EXISTS` is not atomic).
            // Only when it was missing: `CREATE SCHEMA` checks the privilege
            // to create one even when the schema is there.
            if (!ledgerExists) {
                for (const statement of SQL_FILES_LEDGER_SQL) await session.query(statement);
                ledgerExists = true;
            }
            const { rows } = await session.query(`SELECT hash FROM rebase.sql_files WHERE name = ${quote(file.name)}`);
            if (rows[0]?.hash === file.hash) {
                // Another instance applied this content while we waited.
                await session.query("COMMIT");
                unchanged.push(file.name);
                continue;
            }
            try {
                await session.query(file.sql);
            } catch (err) {
                throw new SqlFileError(file.name, err);
            }
            await session.query(recordSql(file));
            await session.query("COMMIT");
            ran.push(file);
        } catch (err) {
            await session.query("ROLLBACK").catch(() => undefined);
            throw err instanceof SqlFileError ? err : new SqlFileError(file.name, err);
        }
    }
    return { apply: ran, unchanged: unchanged.sort(), removed: plan.removed };
}

/**
 * What a `pg` client (or a client checked out of a pool) offers: `query` with
 * a config, simple protocol when it carries no values.
 */
interface PgLikeClient {
    query(config: { text: string; query_timeout?: number }): Promise<{ rows: Record<string, unknown>[] }>;
}

const pgQuery = (client: PgLikeClient) => async (text: string) =>
    ({ rows: (await client.query({ text, query_timeout: SQL_FILE_READ_TIMEOUT_MS })).rows });

/** PGlite: `exec` runs a multi-statement string and answers one result per statement. */
interface ExecClient {
    exec(text: string): Promise<Array<{ rows: Record<string, unknown>[] }>>;
}

/** A `pg.Pool`: `connect()` checks a client out. A `pg.Client` has `connect()` too, but no `totalCount`. */
interface PoolLike {
    connect(): Promise<PgLikeClient & { release(): void }>;
}

const isPoolLike = (value: unknown): value is PoolLike =>
    typeof value === "object" && value !== null && "connect" in value && typeof value.connect === "function" && "totalCount" in value;

const isExecClient = (value: unknown): value is ExecClient =>
    typeof value === "object" && value !== null && "exec" in value && typeof value.exec === "function";

const isPgLikeClient = (value: unknown): value is PgLikeClient =>
    typeof value === "object" && value !== null && "query" in value && typeof value.query === "function";

/** A session on a `pg` client the caller owns (the CLI's). */
export function pgClientSqlFilesSession(client: PgLikeClient): SqlFilesSession {
    return { query: pgQuery(client) };
}

/**
 * A session on the connection a driver was opened with — `db.$client` under
 * drizzle: a client checked out of a `pg.Pool` (released afterwards), PGlite
 * through `exec`, or an application's own `pg.Client` as it is. `undefined`
 * for a handle that is none of these.
 *
 * Behind a transaction-mode pooler a checked-out client is not one backend
 * between transactions, but within one it is, and every statement this runs
 * after `BEGIN` is inside the file's transaction — the lock included.
 */
export async function openSqlFilesSession(client: unknown): Promise<OpenedSqlFilesSession | undefined> {
    if (isPoolLike(client)) {
        const checkedOut = await client.connect();
        return {
            query: pgQuery(checkedOut),
            release: () => checkedOut.release()
        };
    }
    if (isExecClient(client)) {
        return {
            query: async (text) => {
                const results = await client.exec(text);
                return { rows: results[results.length - 1]?.rows ?? [] };
            },
            release: () => undefined
        };
    }
    if (isPgLikeClient(client)) return { ...pgClientSqlFilesSession(client), release: () => undefined };
    return undefined;
}
