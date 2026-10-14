/**
 * BranchService
 *
 * Manages database branching by creating/deleting PostgreSQL databases
 * using `CREATE DATABASE ... TEMPLATE`. Branch metadata is stored in the
 * `rebase.branches` table in the default (main) database, following the
 * same `rebase` schema convention used by entity_history, auth, etc.
 */

import { sql } from "drizzle-orm";
import { BranchInfo } from "@rebasepro/types";
import { revokeInternalTableSql } from "@rebasepro/common";
import { DrizzleClient } from "../interfaces";
import { BranchRow } from "../branch-prune";
import { DatabasePoolManager } from "../databasePoolManager";
import { extractPgError, extractCauseMessage } from "../utils/pg-error-utils";

/** Internal prefix applied to branch database names to avoid collisions. */
const BRANCH_DB_PREFIX = "rb_";

/** `duplicate_database` — the target database name is already taken. */
const PG_DUPLICATE_DATABASE = "42P04";

/** `object_in_use` — the database still has connections attached. */
const PG_OBJECT_IN_USE = "55006";

/** How many times `--force` disconnects the other sessions before it reports one still there. */
const FORCE_ATTEMPTS = 3;

/** The database every Postgres server has, from which another one can be closed and opened. */
const MAINTENANCE_DATABASE = "postgres";

/**
 * Describe a failed branch DDL statement in terms a user can act on.
 *
 * Drizzle reports failures as `Failed query: <sql> params:` and hides the real
 * PostgreSQL error in the `cause` chain, so matching on `err.message` never sees
 * the actual problem. Match on the PG error code instead — it survives wrapping
 * and, unlike the message text, is not locale-dependent.
 */
function describeBranchDdlError(err: unknown, fallbackContext: string): Error {
    const pgError = extractPgError(err);

    if (pgError?.code === PG_DUPLICATE_DATABASE) {
        return new Error(`Database "${fallbackContext}" already exists on the server. Choose a different branch name.`);
    }
    if (pgError?.code === PG_OBJECT_IN_USE) {
        return new Error(
            `Cannot complete the operation: the database "${fallbackContext}" has active connections. ` +
            "Close other clients or connections and try again."
        );
    }

    // Unknown failure: surface the real PG message rather than the Drizzle
    // wrapper, which would otherwise show the raw SQL and no reason at all.
    const detail = pgError?.message ?? extractCauseMessage(err);
    if (detail) return new Error(detail);
    return err instanceof Error ? err : new Error(String(err));
}

/** Fully-qualified metadata table in the rebase schema. */
const BRANCHES_TABLE = "rebase.branches";

/**
 * The connected server cannot branch, so nothing was done.
 *
 * A refusal, not a fault: typed so the transports can forward it intact.
 * `websocket.ts` answers it with its own code and message rather than letting
 * it fall into the generic handler, which suppresses the text in production —
 * and the text is the only part that says what to do instead.
 */
export class BranchingUnsupportedError extends Error {
    /** Wire code, forwarded verbatim to the client. */
    readonly code = "BRANCHING_UNSUPPORTED";

    constructor(message: string) {
        super(message);
        this.name = "BranchingUnsupportedError";
    }
}

/**
 * What to say when the server serves one database.
 *
 * Deliberately the same argument the CLI's `refuseBranchOnManagedDatabase`
 * makes, because it is the same refusal — it just used to be available only to
 * whoever came in through argv. One paragraph, because this one has to fit in a
 * toast as well as a terminal.
 */
const BRANCHING_UNSUPPORTED_MESSAGE =
    "Branching does not work on the managed development database. It copies a database with "
    + "CREATE DATABASE ... TEMPLATE, and the managed database is PGlite, which serves exactly one — "
    + "the copy would be the original, and every write you meant to sandbox would land in it. "
    + "Branching needs a real Postgres: run `rebase dev --docker`, or uncomment DATABASE_URL in .env "
    + "to point at your own.";

/**
 * Validate that a user-provided identifier only contains safe characters.
 * Throws if the value contains characters outside [a-zA-Z0-9_-].
 */
function validateIdentifier(value: string, label: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        throw new Error(`Invalid ${label}: only letters, digits, underscores, and hyphens are allowed.`);
    }
}

/**
 * Postgres truncates identifiers at NAMEDATALEN-1 = 63 bytes, and does it
 * silently. The prefix comes out of the same budget.
 */
const MAX_BRANCH_NAME_LENGTH = 63 - BRANCH_DB_PREFIX.length;

/**
 * Check a user-provided branch name, and otherwise leave it exactly as given.
 *
 * This used to strip everything outside [a-zA-Z0-9_], so `my-feature` was
 * quietly created as `myfeature`: the name you typed was not the name `list`
 * gave back. Nothing ever needed that. Every identifier this service builds is
 * double-quoted (see `CREATE DATABASE` below), which is what makes a hyphen
 * safe, and `validateIdentifier` has always accepted hyphens for the `--from`
 * source database — the two disagreed about the same character class.
 *
 * Refusing a name we cannot represent is better than representing a different
 * one, which is also why the length is checked here rather than left to
 * Postgres, whose answer to an over-long identifier is a silent rename.
 */
function assertValidBranchName(name: string): void {
    validateIdentifier(name, "branch name");
    if (name.length > MAX_BRANCH_NAME_LENGTH) {
        throw new Error(
            `Branch name "${name}" is too long: ${name.length} characters, maximum ${MAX_BRANCH_NAME_LENGTH}. ` +
            "Postgres truncates identifiers past 63 bytes, which would give the branch a name you did not choose."
        );
    }
}

/**
 * Convert a user-facing branch name to the actual PostgreSQL database name.
 */
function toBranchDbName(name: string): string {
    assertValidBranchName(name);
    return `${BRANCH_DB_PREFIX}${name}`;
}

/**
 * Where a server's branches are kept: the main database — what a branch is
 * copied from unless told otherwise, and what may never be dropped — and the
 * connection whose `rebase.branches` records them.
 */
export interface BranchHome {
    /** The main database's name. */
    database(): Promise<string>;
    /**
     * A connection on the database the registry is in. Asked for at each use:
     * a pool to the main database is closed before it is copied.
     */
    registry(): Promise<DrizzleClient>;
}

export class BranchService {
    private readonly home: BranchHome;

    /**
     * @param db    A connection on the server the branches are made on. Branch
     *              DDL runs here.
     * @param home  Where branches are kept. Without one, the database the
     *              pool manager's connection string names, and `db`'s registry.
     */
    constructor(
        private db: DrizzleClient,
        private poolManager: DatabasePoolManager,
        home?: BranchHome
    ) {
        this.home = home ?? {
            database: async () => poolManager.defaultDatabaseName,
            registry: async () => db
        };
    }

    /**
     * Refuse a branch mutation the connected server cannot honour.
     *
     * The check lives here rather than in the CLI's argv parsing because the
     * CLI is not the only caller: Studio reaches `createBranch` over the
     * websocket, and before this it got "Branch created successfully" and a
     * detail pane promising isolation for a database that is the parent.
     *
     * Reads only, and only mutations are guarded: `listBranches` on a managed
     * database is an honest empty list, and refusing it would turn the Branches
     * pane into a failure with a "Try again" that can never succeed.
     */
    private async assertBranchingSupported(): Promise<void> {
        if (await this.poolManager.servesOneDatabase()) {
            throw new BranchingUnsupportedError(BRANCHING_UNSUPPORTED_MESSAGE);
        }
    }

    /**
     * Whether the `rebase.branches` registry exists. A database that has never
     * had a branch made on it may not have it, and reading it there is an
     * empty answer, not an error — nor a reason to create it. The CLI's `list`
     * and `info` ask this rather than running the DDL that creates it.
     */
    async hasBranchRegistry(): Promise<boolean> {
        const result = await (await this.home.registry()).execute(
            sql`SELECT to_regclass('rebase.branches') IS NOT NULL AS present`
        );
        const [row] = result.rows;
        return row !== undefined && Reflect.get(row, "present") === true;
    }

    /**
     * Ensure the `rebase.branches` metadata table exists in the default database.
     * Idempotent — safe to call on every startup.
     */
    async ensureBranchMetadataTable(): Promise<void> {
        // Create the rebase schema (idempotent — may already exist from auth/history init)
        const registry = await this.home.registry();
        await registry.execute(sql`CREATE SCHEMA IF NOT EXISTS rebase`);

        await registry.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS ${BRANCHES_TABLE} (
                name         TEXT PRIMARY KEY,
                db_name      TEXT NOT NULL UNIQUE,
                parent_db    TEXT NOT NULL,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                metadata     JSONB DEFAULT '{}'
            );
        `));

        // Not a collection, so no RLS — and it names every branch database on
        // this server. The driver's schema-wide grant reaches it, so revoke.
        await registry.execute(sql.raw(revokeInternalTableSql("rebase", "branches")));
    }

    /**
     * Create a new branch database by templating the source database.
     *
     * Uses `CREATE DATABASE ... TEMPLATE` for an instant, full-fidelity copy
     * of both schema and data.
     *
     * @param name   User-facing branch name (e.g., "feature_auth")
     * @param options.source  Source database to clone; defaults to the main database.
     */
    async createBranch(
        name: string,
        options?: { source?: string; force?: boolean }
    ): Promise<BranchInfo> {
        await this.assertBranchingSupported();

        if (options?.source) {
            validateIdentifier(options.source, "source database name");
        }

        const dbName = toBranchDbName(name);
        const sourceDb = options?.source || await this.home.database();

        // Check if branch already exists
        const existing = await (await this.home.registry()).execute(
            sql`SELECT name FROM rebase.branches WHERE name = ${name} OR db_name = ${dbName}`
        );
        if ((existing.rows as unknown[]).length > 0) {
            throw new Error(`Branch "${name}" already exists.`);
        }

        // Disconnect any idle pools to the source DB so TEMPLATE works.
        // CREATE DATABASE ... TEMPLATE requires no other connections to the template.
        //
        // This only reaches pools inside *this* process. The CLI runs as its own
        // process, so a `rebase dev` holding the database open is untouched by
        // it — which is why the failure below has to name what is connected, and
        // why `--force` exists.
        await this.poolManager.disconnectDatabase(sourceDb);

        // Create the database using the source as a template.
        // Note: Identifiers must be double-quoted, not parameterized.
        const safeDbName = dbName.replace(/"/g, '""');
        const safeSourceDb = sourceDb.replace(/"/g, '""');
        const copy = async (): Promise<void> => {
            await this.db.execute(sql.raw(`CREATE DATABASE "${safeDbName}" TEMPLATE "${safeSourceDb}"`));
        };
        try {
            if (options?.force) {
                await this.whileClosedToNewConnections(sourceDb, () => this.disconnectingOthers(sourceDb, copy));
            } else {
                await copy();
            }
        } catch (err) {
            const pgError = extractPgError(err);
            if (pgError?.code === PG_OBJECT_IN_USE) {
                // The template — not the new database — is the one still in use.
                throw new Error(
                    `Cannot create branch: the source database "${sourceDb}" ${options?.force
                        ? "still had connections after they were disconnected"
                        : "has active connections"}.\n`
                    + await this.describeBlockingConnections(sourceDb, { forced: options?.force === true })
                );
            }
            throw describeBranchDdlError(err, dbName);
        }

        // Record metadata in the registry — asked for again, as copying the
        // main database closed any pool on it.
        const now = new Date();
        await (await this.home.registry()).execute(
            sql`INSERT INTO rebase.branches (name, db_name, parent_db, created_at)
                VALUES (${name}, ${dbName}, ${sourceDb}, ${now.toISOString()})`
        );

        return {
            name,
            database: dbName,
            parentDatabase: sourceDb,
            createdAt: now
        };
    }

    /**
     * Delete a branch database and remove its metadata.
     * Cannot delete the main/default database.
     */
    async deleteBranch(name: string, options?: { force?: boolean }): Promise<void> {
        await this.assertBranchingSupported();

        assertValidBranchName(name);

        // Safety, first pass: a request that would target the default database
        // is refused before any metadata is read, so the answer costs nothing
        // and cannot depend on what a row happens to say.
        const mainDatabase = await this.home.database();
        if (toBranchDbName(name) === mainDatabase) {
            throw new Error("Cannot delete the main database.");
        }

        // Verify the branch exists, and take the database name from the row
        // rather than deriving it again. A branch created before names stopped
        // being stripped is recorded as `rb_myfeature` while `my-feature` now
        // derives `rb_my-feature`; re-deriving would drop a database this row
        // never named — or, if that name happened to exist, somebody else's.
        // The stored value is the only one that is true by construction.
        const existing = await (await this.home.registry()).execute(
            sql`SELECT db_name FROM rebase.branches WHERE name = ${name}`
        );
        const existingRows = existing.rows as Record<string, unknown>[];
        if (existingRows.length === 0) {
            throw new Error(`Branch "${name}" not found.`);
        }
        const dbName = existingRows[0].db_name as string;

        // Safety, second pass: the first checked a name we derived, this checks
        // the one we are about to drop. They differ for any row written under
        // the old scheme, and it is this one that governs.
        if (dbName === mainDatabase) {
            throw new Error("Cannot delete the main database.");
        }

        // Disconnect any pools to this branch before dropping. Same limit as
        // `createBranch`: in-process pools only.
        await this.poolManager.disconnectDatabase(dbName);

        // Drop the database
        const safeDbName = dbName.replace(/"/g, '""');
        const drop = async (): Promise<void> => {
            await this.db.execute(sql.raw(`DROP DATABASE "${safeDbName}"`));
        };
        try {
            if (options?.force) await this.disconnectingOthers(dbName, drop);
            else await drop();
        } catch (err) {
            const pgError = extractPgError(err);
            if (pgError?.code === PG_OBJECT_IN_USE) {
                throw new Error(
                    `Cannot delete branch "${name}": the database ${options?.force
                        ? "still had connections after they were disconnected"
                        : "has active connections"}.\n`
                    + await this.describeBlockingConnections(dbName, { forced: options?.force === true })
                );
            }
            throw describeBranchDdlError(err, dbName);
        }

        // Remove metadata
        await (await this.home.registry()).execute(
            sql`DELETE FROM rebase.branches WHERE name = ${name}`
        );
    }

    /**
     * Who is holding the database open, in words a developer can act on.
     *
     * `CREATE DATABASE ... TEMPLATE` and `DROP DATABASE` both require that no
     * other session is connected, and the one thing the old message could not
     * say is the only thing worth knowing: *which* session. "Close other
     * clients or connections and try again" is advice you cannot follow when
     * you do not know there is a `rebase dev` in another terminal — and that is
     * the common case, because wanting a branch and running the app are the
     * same moment.
     *
     * `application_name` is the useful column: node-postgres sends none by
     * default, so a Rebase process shows as `(unnamed)` while DBeaver, pgAdmin
     * and psql all name themselves. Counting by it separates "my own dev
     * server" from "the GUI I forgot about" without any guessing.
     *
     * Best-effort by construction: this runs while reporting a failure, and a
     * diagnostic that throws would replace a real error with its own.
     */
    private async describeBlockingConnections(dbName: string, options: { forced?: boolean } = {}): Promise<string> {
        try {
            const result = await this.db.execute(sql`
                SELECT coalesce(nullif(application_name, ''), '(unnamed)') AS app,
                       count(*)::int AS n
                  FROM pg_stat_activity
                 WHERE datname = ${dbName}
                   AND pid <> pg_backend_pid()
                 GROUP BY 1
                 ORDER BY 2 DESC, 1
            `);
            const rows = result.rows as Record<string, unknown>[];
            if (rows.length === 0) {
                // The blocker went away between the failure and this query, or
                // it is a session Postgres does not attribute to this database.
                return "  Retry — whatever was connected has since disconnected.";
            }

            const listed = rows
                .map((row) => `    ${row.n} × ${String(row.app)}`)
                .join("\n");

            // With --force they were disconnected already, and came back: the
            // one thing left to say is what to stop, not to pass --force.
            return `  Connected right now:\n${listed}\n`
                + (options.forced
                    ? "  They reconnected as fast as they were disconnected. A running `rebase dev` is the\n"
                        + "  usual one — stop it, then run this again."
                    : "  A running `rebase dev` is the usual one — stop it, or re-run with --force to\n"
                        + "  disconnect them for you.");
        } catch {
            return options.forced
                ? "  Stop the clients connected to it — a running `rebase dev` is the usual one — then run this again."
                : "  Close other clients and connections, or re-run with --force.";
        }
    }

    /**
     * Run `operation` with no other session on `dbName`, disconnecting them
     * first: what `--force` asks for.
     *
     * Disconnected, a client that reconnects — a running `rebase dev`'s
     * realtime listener does — can be back before `CREATE DATABASE … TEMPLATE`
     * or `DROP DATABASE` counts the sessions, and it failed on one about once
     * in seven tries, saying to pass the `--force` that had been passed. So a
     * refusal on a session still connected is retried, disconnecting again, a
     * few times before it is reported.
     */
    private async disconnectingOthers(dbName: string, operation: () => Promise<void>): Promise<void> {
        for (let attempt = 1; ; attempt++) {
            const closed = await this.terminateConnections(dbName);
            if (closed > 0) {
                // Postgres reports the backend as gone before its slot is
                // actually free, and the operation then fails on a connection
                // that no longer exists. A short settle first.
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            try {
                await operation();
                return;
            } catch (err) {
                if (attempt >= FORCE_ATTEMPTS || extractPgError(err)?.code !== PG_OBJECT_IN_USE) throw err;
            }
        }
    }

    /**
     * Run `operation` with `dbName` refusing new connections, and open it
     * again after, whatever happens.
     *
     * A client disconnected from the source — a running `rebase dev` holds a
     * pool and a realtime listener — cannot then reconnect before the copy has
     * counted the sessions on it. Postgres refuses `ALLOW_CONNECTIONS false` on
     * the database a session is connected to, so both statements run from the
     * server's `postgres` database, and they need the database's owner. Where
     * either is missing, the retries of {@link disconnectingOthers} are what is
     * left. A database that already refused connections is left as it was.
     *
     * Interrupted (Ctrl-C) while closed, it opens the database again before
     * the process exits; one it could not open is named in the error, with the
     * statement that does.
     */
    private async whileClosedToNewConnections(dbName: string, operation: () => Promise<void>): Promise<void> {
        const safe = dbName.replace(/"/g, '""');
        const maintenance = dbName === MAINTENANCE_DATABASE ? null : this.poolManager.getDrizzle(MAINTENANCE_DATABASE);
        let closed = false;
        try {
            if (maintenance) {
                const state = await maintenance.execute(sql`SELECT datallowconn FROM pg_database WHERE datname = ${dbName}`);
                const [row] = state.rows as Record<string, unknown>[];
                if (row?.datallowconn === true) {
                    await maintenance.execute(sql.raw(`ALTER DATABASE "${safe}" ALLOW_CONNECTIONS false`));
                    closed = true;
                }
            }
        } catch {
            // No `postgres` database to run it from, or not the owner.
        }
        if (!closed) {
            await this.poolManager.disconnectDatabase(MAINTENANCE_DATABASE);
            await operation();
            return;
        }

        let reopening: Promise<void> | undefined;
        const reopen = (): Promise<void> => {
            reopening ??= this.reopenToConnections(dbName);
            return reopening;
        };
        const onSignal = (signal: NodeJS.Signals): void => {
            void reopen().finally(() => process.kill(process.pid, signal));
        };
        process.once("SIGINT", onSignal);
        process.once("SIGTERM", onSignal);
        try {
            await operation();
        } finally {
            process.removeListener("SIGINT", onSignal);
            process.removeListener("SIGTERM", onSignal);
            await reopen();
        }
    }

    /** `ALLOW_CONNECTIONS true` again, from the maintenance database, or an error that says how to do it by hand. */
    private async reopenToConnections(dbName: string): Promise<void> {
        const statement = `ALTER DATABASE "${dbName.replace(/"/g, '""')}" ALLOW_CONNECTIONS true`;
        try {
            await this.poolManager.getDrizzle(MAINTENANCE_DATABASE).execute(sql.raw(statement));
        } catch (err) {
            throw new Error(
                `"${dbName}" was closed to new connections for the copy and could not be opened again ` +
                `(${extractPgError(err)?.message ?? extractCauseMessage(err) ?? String(err)}). ` +
                `Nothing can connect to it until you run, from another database: ${statement};`
            );
        } finally {
            await this.poolManager.disconnectDatabase(MAINTENANCE_DATABASE);
        }
    }

    /**
     * Disconnect every other session on a database, and say how many.
     *
     * `pg_terminate_backend` rather than `pg_cancel_backend`: cancelling a
     * query leaves the session connected, and a connected session is exactly
     * what blocks the operation.
     *
     * The current backend is excluded — terminating the connection running this
     * statement would abort the command that asked for it.
     */
    private async terminateConnections(dbName: string): Promise<number> {
        const result = await this.db.execute(sql`
            SELECT pg_terminate_backend(pid)
              FROM pg_stat_activity
             WHERE datname = ${dbName}
               AND pid <> pg_backend_pid()
        `);

        return (result.rows as unknown[]).length;
    }

    /**
     * Everything prune needs to decide, in two queries.
     *
     * Reads the rows and the server's database list rather than joining them,
     * so the *disagreements* between the two are visible — a row whose database
     * is gone and a database with no row are the two things prune exists to
     * find, and a join hides both.
     */
    async pruneCandidates(): Promise<{ rows: BranchRow[]; databases: string[] }> {
        const rowResult = await (await this.home.registry()).execute(sql.raw(`
            SELECT name, db_name, created_at FROM ${BRANCHES_TABLE} ORDER BY created_at
        `));
        const rows = (rowResult.rows as Record<string, unknown>[]).map((row) => ({
            name: row.name as string,
            dbName: row.db_name as string,
            createdAt: new Date(row.created_at as string)
        }));

        const dbResult = await this.db.execute(sql`
            SELECT datname FROM pg_database WHERE NOT datistemplate
        `);
        const databases = (dbResult.rows as Record<string, unknown>[]).map((row) => String(row.datname));

        return { rows, databases };
    }

    /** Remove a metadata row whose database is already gone. */
    async forgetBranchRow(name: string): Promise<void> {
        await (await this.home.registry()).execute(sql`DELETE FROM rebase.branches WHERE name = ${name}`);
    }

    /**
     * Drop a database by name, with no metadata row required.
     *
     * `deleteBranch` deliberately takes its database name from the row, because
     * the row is the only value that is true by construction. Prune has the
     * opposite job — the cases it handles are exactly the ones where row and
     * database disagree — so it needs to name a database directly. Guarded the
     * same way regardless: the main database is never droppable.
     */
    async dropDatabase(dbName: string): Promise<void> {
        validateIdentifier(dbName, "database name");
        if (dbName === await this.home.database()) {
            throw new Error("Cannot delete the main database.");
        }

        await this.poolManager.disconnectDatabase(dbName);
        try {
            await this.db.execute(sql.raw(`DROP DATABASE "${dbName.replace(/"/g, '""')}"`));
        } catch (err) {
            throw describeBranchDdlError(err, dbName);
        }
    }

    /**
     * List all branches recorded in the metadata table.
     * Optionally fetches database sizes from pg_database.
     */
    async listBranches(): Promise<BranchInfo[]> {
        const result = await (await this.home.registry()).execute(sql.raw(`
            SELECT 
                b.name,
                b.db_name,
                b.parent_db,
                b.created_at,
                pg_database_size(b.db_name) as size_bytes
            FROM ${BRANCHES_TABLE} b
            JOIN pg_database d ON d.datname = b.db_name
            ORDER BY b.created_at DESC
        `));

        return (result.rows as Record<string, unknown>[]).map((row) => ({
            name: row.name as string,
            database: row.db_name as string,
            parentDatabase: row.parent_db as string,
            createdAt: new Date(row.created_at as string),
            sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : undefined
        }));
    }

    /**
     * Get info about a specific branch.
     */
    async getBranchInfo(name: string): Promise<BranchInfo | undefined> {
        assertValidBranchName(name);

        const result = await (await this.home.registry()).execute(sql`
            SELECT
                b.name,
                b.db_name,
                b.parent_db,
                b.created_at
            FROM rebase.branches b
            WHERE b.name = ${name}
        `);

        const rows = result.rows as Record<string, unknown>[];
        if (rows.length === 0) return undefined;

        const row = rows[0];

        // Attempt to get size — may fail if the DB was externally dropped.
        // Same reason as `deleteBranch`: the size of a re-derived name is the
        // size of some other database, or of nothing.
        let sizeBytes: number | undefined;
        try {
            const dbName = row.db_name as string;
            const sizeResult = await this.db.execute(
                sql`SELECT pg_database_size(${dbName}) as size_bytes`
            );
            const sizeRows = sizeResult.rows as Record<string, unknown>[];
            if (sizeRows.length > 0 && sizeRows[0].size_bytes != null) {
                sizeBytes = Number(sizeRows[0].size_bytes);
            }
        } catch {
            // Database might not exist anymore
        }

        return {
            name: row.name as string,
            database: row.db_name as string,
            parentDatabase: row.parent_db as string,
            createdAt: new Date(row.created_at as string),
            sizeBytes
        };
    }
}
