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
import { DatabasePoolManager } from "../databasePoolManager";
import { extractPgError, extractCauseMessage } from "../utils/pg-error-utils";

/** Internal prefix applied to branch database names to avoid collisions. */
const BRANCH_DB_PREFIX = "rb_";

/** `duplicate_database` — the target database name is already taken. */
const PG_DUPLICATE_DATABASE = "42P04";

/** `object_in_use` — the database still has connections attached. */
const PG_OBJECT_IN_USE = "55006";

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

export class BranchService {
    constructor(
        private db: DrizzleClient,
        private poolManager: DatabasePoolManager
    ) {}

    /**
     * Ensure the `rebase.branches` metadata table exists in the default database.
     * Idempotent — safe to call on every startup.
     */
    async ensureBranchMetadataTable(): Promise<void> {
        // Create the rebase schema (idempotent — may already exist from auth/history init)
        await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS rebase`);

        await this.db.execute(sql.raw(`
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
        await this.db.execute(sql.raw(revokeInternalTableSql("rebase", "branches")));
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
        if (options?.source) {
            validateIdentifier(options.source, "source database name");
        }

        const dbName = toBranchDbName(name);
        const sourceDb = options?.source || this.poolManager.defaultDatabaseName;

        // Check if branch already exists
        const existing = await this.db.execute(
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

        if (options?.force) {
            const closed = await this.terminateConnections(sourceDb);
            if (closed > 0) {
                // Postgres reports the backend as gone before its slot is
                // actually free, and CREATE DATABASE then fails on a connection
                // that no longer exists. One short settle beats a confusing retry.
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }

        // Create the database using the source as a template.
        // Note: Identifiers must be double-quoted, not parameterized.
        const safeDbName = dbName.replace(/"/g, '""');
        const safeSourceDb = sourceDb.replace(/"/g, '""');
        try {
            await this.db.execute(
                sql.raw(`CREATE DATABASE "${safeDbName}" TEMPLATE "${safeSourceDb}"`)
            );
        } catch (err) {
            const pgError = extractPgError(err);
            if (pgError?.code === PG_OBJECT_IN_USE) {
                // The template — not the new database — is the one still in use.
                throw new Error(
                    `Cannot create branch: the source database "${sourceDb}" has active connections.\n`
                    + await this.describeBlockingConnections(sourceDb)
                );
            }
            throw describeBranchDdlError(err, dbName);
        }

        // Record metadata in the default database
        const now = new Date();
        await this.db.execute(
            sql`INSERT INTO rebase.branches (name, db_name, parent_db, created_at)
                VALUES (${name}, ${dbName}, ${sourceDb}, ${now.toISOString()})`
        );

        return {
            name,
            parentDatabase: sourceDb,
            createdAt: now
        };
    }

    /**
     * Delete a branch database and remove its metadata.
     * Cannot delete the main/default database.
     */
    async deleteBranch(name: string, options?: { force?: boolean }): Promise<void> {
        assertValidBranchName(name);

        // Safety, first pass: a request that would target the default database
        // is refused before any metadata is read, so the answer costs nothing
        // and cannot depend on what a row happens to say.
        if (toBranchDbName(name) === this.poolManager.defaultDatabaseName) {
            throw new Error("Cannot delete the main database.");
        }

        // Verify the branch exists, and take the database name from the row
        // rather than deriving it again. A branch created before names stopped
        // being stripped is recorded as `rb_myfeature` while `my-feature` now
        // derives `rb_my-feature`; re-deriving would drop a database this row
        // never named — or, if that name happened to exist, somebody else's.
        // The stored value is the only one that is true by construction.
        const existing = await this.db.execute(
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
        if (dbName === this.poolManager.defaultDatabaseName) {
            throw new Error("Cannot delete the main database.");
        }

        // Disconnect any pools to this branch before dropping. Same limit as
        // `createBranch`: in-process pools only.
        await this.poolManager.disconnectDatabase(dbName);

        if (options?.force) {
            const closed = await this.terminateConnections(dbName);
            if (closed > 0) await new Promise((resolve) => setTimeout(resolve, 250));
        }

        // Drop the database
        const safeDbName = dbName.replace(/"/g, '""');
        try {
            await this.db.execute(sql.raw(`DROP DATABASE "${safeDbName}"`));
        } catch (err) {
            const pgError = extractPgError(err);
            if (pgError?.code === PG_OBJECT_IN_USE) {
                throw new Error(
                    `Cannot delete branch "${name}": the database has active connections.\n`
                    + await this.describeBlockingConnections(dbName)
                );
            }
            throw describeBranchDdlError(err, dbName);
        }

        // Remove metadata
        await this.db.execute(
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
    private async describeBlockingConnections(dbName: string): Promise<string> {
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

            return `  Connected right now:\n${listed}\n`
                + "  A running `rebase dev` is the usual one — stop it, or re-run with --force to\n"
                + "  disconnect them for you.";
        } catch {
            return "  Close other clients and connections, or re-run with --force.";
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
     * List all branches recorded in the metadata table.
     * Optionally fetches database sizes from pg_database.
     */
    async listBranches(): Promise<BranchInfo[]> {
        const result = await this.db.execute(sql.raw(`
            SELECT 
                b.name,
                b.parent_db,
                b.created_at,
                pg_database_size(b.db_name) as size_bytes
            FROM ${BRANCHES_TABLE} b
            JOIN pg_database d ON d.datname = b.db_name
            ORDER BY b.created_at DESC
        `));

        return (result.rows as Record<string, unknown>[]).map((row) => ({
            name: row.name as string,
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

        const result = await this.db.execute(sql`
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
            parentDatabase: row.parent_db as string,
            createdAt: new Date(row.created_at as string),
            sizeBytes
        };
    }
}
