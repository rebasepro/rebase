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
import { DrizzleClient } from "../interfaces";
import { DatabasePoolManager } from "../databasePoolManager";

/** Internal prefix applied to branch database names to avoid collisions. */
const BRANCH_DB_PREFIX = "rb_";

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
 * Sanitize a user-provided branch name to a safe PostgreSQL identifier.
 * Only allows alphanumeric characters and underscores.
 */
function sanitizeBranchName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, "");
}

/**
 * Convert a user-facing branch name to the actual PostgreSQL database name.
 */
function toBranchDbName(name: string): string {
    const sanitized = sanitizeBranchName(name);
    if (!sanitized) throw new Error("Branch name must contain at least one alphanumeric character.");
    return `${BRANCH_DB_PREFIX}${sanitized}`;
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
    async createBranch(name: string, options?: { source?: string }): Promise<BranchInfo> {
        validateIdentifier(name, "branch name");
        if (options?.source) {
            validateIdentifier(options.source, "source database name");
        }

        const dbName = toBranchDbName(name);
        const sanitizedName = sanitizeBranchName(name);
        const sourceDb = options?.source || this.poolManager.defaultDatabaseName;

        // Check if branch already exists
        const existing = await this.db.execute(
            sql`SELECT name FROM rebase.branches WHERE name = ${sanitizedName} OR db_name = ${dbName}`
        );
        if ((existing.rows as unknown[]).length > 0) {
            throw new Error(`Branch "${sanitizedName}" already exists.`);
        }

        // Disconnect any idle pools to the source DB so TEMPLATE works.
        // CREATE DATABASE ... TEMPLATE requires no other connections to the template.
        await this.poolManager.disconnectDatabase(sourceDb);

        // Create the database using the source as a template.
        // Note: Identifiers must be double-quoted, not parameterized.
        const safeDbName = dbName.replace(/"/g, '""');
        const safeSourceDb = sourceDb.replace(/"/g, '""');
        try {
            await this.db.execute(
                sql.raw(`CREATE DATABASE "${safeDbName}" TEMPLATE "${safeSourceDb}"`)
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("already exists")) {
                throw new Error(`Database "${dbName}" already exists on the server. Choose a different branch name.`);
            }
            // If template fails due to active connections, provide a helpful error
            if (msg.includes("being accessed by other users")) {
                throw new Error(
                    `Cannot create branch: the source database "${sourceDb}" has active connections. ` +
                    "Close other clients or connections and try again."
                );
            }
            throw err;
        }

        // Record metadata in the default database
        const now = new Date();
        await this.db.execute(
            sql`INSERT INTO rebase.branches (name, db_name, parent_db, created_at) 
                VALUES (${sanitizedName}, ${dbName}, ${sourceDb}, ${now.toISOString()})`
        );

        return {
            name: sanitizedName,
            parentDatabase: sourceDb,
            createdAt: now
        };
    }

    /**
     * Delete a branch database and remove its metadata.
     * Cannot delete the main/default database.
     */
    async deleteBranch(name: string): Promise<void> {
        const sanitizedName = sanitizeBranchName(name);
        const dbName = toBranchDbName(name);

        // Safety: never delete the default database
        if (dbName === this.poolManager.defaultDatabaseName) {
            throw new Error("Cannot delete the main database.");
        }

        // Verify the branch exists in our metadata
        const existing = await this.db.execute(
            sql`SELECT db_name FROM rebase.branches WHERE name = ${sanitizedName}`
        );
        if ((existing.rows as unknown[]).length === 0) {
            throw new Error(`Branch "${sanitizedName}" not found.`);
        }

        // Disconnect any pools to this branch before dropping
        await this.poolManager.disconnectDatabase(dbName);

        // Drop the database
        const safeDbName = dbName.replace(/"/g, '""');
        try {
            await this.db.execute(sql.raw(`DROP DATABASE "${safeDbName}"`));
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("being accessed by other users")) {
                throw new Error(
                    `Cannot delete branch "${sanitizedName}": the database has active connections. ` +
                    "Close other clients and try again."
                );
            }
            throw err;
        }

        // Remove metadata
        await this.db.execute(
            sql`DELETE FROM rebase.branches WHERE name = ${sanitizedName}`
        );
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
        const sanitizedName = sanitizeBranchName(name);

        const result = await this.db.execute(sql`
            SELECT 
                b.name,
                b.parent_db,
                b.created_at
            FROM rebase.branches b
            WHERE b.name = ${sanitizedName}
        `);

        const rows = result.rows as Record<string, unknown>[];
        if (rows.length === 0) return undefined;

        const row = rows[0];

        // Attempt to get size — may fail if the DB was externally dropped
        let sizeBytes: number | undefined;
        try {
            const dbName = toBranchDbName(sanitizedName);
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
