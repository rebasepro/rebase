import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getTableConfig, AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getColumnMeta } from "../services/entity-helpers";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";

/**
 * Default roles to seed on first run
 */
const DEFAULT_ROLES = [
    {
        id: "admin",
        name: "Admin",
        is_admin: true,
        default_permissions: { read: true, create: true, edit: true, delete: true }
    },
    {
        id: "editor",
        name: "Editor",
        is_admin: false,
        default_permissions: { read: true, create: true, edit: true, delete: true }
    },
    {
        id: "viewer",
        name: "Viewer",
        is_admin: false,
        default_permissions: { read: true, create: false, edit: false, delete: false }
    }
];

/**
 * Auto-create auth tables if they don't exist
 * This runs on startup to ensure the database is ready for auth
 */
export async function ensureAuthTablesExist(db: NodePgDatabase, registry?: PostgresCollectionRegistry): Promise<void> {
    console.log("🔍 Checking auth tables...");

    try {
        // Resolve dynamic user table name and ID type
        let usersTableName = '"users"';
        let userIdType = "TEXT";
        let usersSchema = "public";
        if (registry) {
            const usersTable = registry.getTable("users") as (PgTable & Record<string, AnyPgColumn>) | undefined;
            if (usersTable) {
                const { getTableName } = await import("drizzle-orm");
                usersSchema = getTableConfig(usersTable).schema || "public";
                usersTableName = usersSchema === "public" ? `"${getTableName(usersTable)}"` : `"${usersSchema}"."${getTableName(usersTable)}"`;

                // Inspect users.id column to match referenced column type
                if (usersTable.id) {
                    const col = usersTable.id;
                    const meta = getColumnMeta(col);
                    const columnType = meta.columnType;
                    if (columnType === "PgUUID") {
                        userIdType = "UUID";
                    } else if (columnType === "PgSerial" || columnType === "PgInteger") {
                        userIdType = "INTEGER";
                    } else if (columnType === "PgBigInt" || columnType === "PgBigSerial") {
                        userIdType = "BIGINT";
                    }
                }
            }
        }

        // Resolve dynamic roles schema name
        let rolesSchema = "rebase";
        if (registry) {
            const rolesTable = registry.getTable("roles");
            if (rolesTable) {
                rolesSchema = getTableConfig(rolesTable).schema || "public";
            }
        }

        // ── Create schemas (idempotent) ──────────────────────────────────
        if (usersSchema !== "public") {
            await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(usersSchema)}`);
        }
        if (rolesSchema !== "public" && rolesSchema !== usersSchema) {
            await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(rolesSchema)}`);
        }
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS rebase`);

        // Dynamic table names
        const userIdentitiesTable = `"${rolesSchema}"."user_identities"`;
        const rolesTableName = `"${rolesSchema}"."roles"`;
        const userRolesTableName = `"${rolesSchema}"."user_roles"`;
        const refreshTokensTableName = `"${rolesSchema}"."refresh_tokens"`;
        const passwordResetTokensTableName = `"${rolesSchema}"."password_reset_tokens"`;
        const appConfigTableName = `"${rolesSchema}"."app_config"`;

        // ── Create tables (idempotent) ──────────────────────────────────

        // Create user_identities table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(userIdentitiesTable)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                provider TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                profile_data JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(provider, provider_id)
            )
        `);

        // Create indexes on user_identities
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_user_identities_user 
            ON ${sql.raw(userIdentitiesTable)}(user_id)
        `);


        // Create roles table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(rolesTableName)} (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                default_permissions JSONB,
                collection_permissions JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create user_roles junction table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(userRolesTableName)} (
                user_id ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                role_id TEXT NOT NULL REFERENCES ${sql.raw(rolesTableName)}(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, role_id)
            )
        `);

        // Create index on user_id for faster lookups
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_user_roles_user 
            ON ${sql.raw(userRolesTableName)}(user_id)
        `);

        // Create refresh tokens table (includes user_agent, ip_address, and unique constraint)
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(refreshTokensTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                user_agent TEXT,
                ip_address TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                CONSTRAINT unique_device_session UNIQUE (user_id, user_agent, ip_address)
            )
        `);

        // Create index on token_hash for faster lookups
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash 
            ON ${sql.raw(refreshTokensTableName)}(token_hash)
        `);

        // Create index on user_id for cleanup operations
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user 
            ON ${sql.raw(refreshTokensTableName)}(user_id)
        `);

        // Create password reset tokens table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(passwordResetTokensTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                used_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create index on token_hash for password reset lookups
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash 
            ON ${sql.raw(passwordResetTokensTableName)}(token_hash)
        `);

        // Create index on user_id for password reset cleanup
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user 
            ON ${sql.raw(passwordResetTokensTableName)}(user_id)
        `);

        // Create app config table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(appConfigTableName)} (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create the `auth` schema with Supabase-style helper functions for RLS.
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS auth`);

        // Use an advisory transaction lock to serialize function recreation during HMR
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'))`);

            await tx.execute(sql`
                CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$
                    SELECT NULLIF(current_setting('app.user_id', true), '');
                $$ LANGUAGE sql STABLE
            `);

            await tx.execute(sql`
                CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
                    SELECT COALESCE(
                        NULLIF(current_setting('app.jwt', true), ''),
                        '{}'
                    )::jsonb;
                $$ LANGUAGE sql STABLE
            `);

            await tx.execute(sql`
                CREATE OR REPLACE FUNCTION auth.roles() RETURNS text AS $$
                    SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
                $$ LANGUAGE sql STABLE
            `);
        });

        // Seed default roles if none exist
        await seedDefaultRoles(db, rolesTableName);

        console.log("✅ Auth tables ready");
    } catch (error) {
        console.error("❌ Failed to create auth tables:", error);
        console.warn("⚠️ Continuing without creating auth tables.");
    }
}

/**
 * Seed default roles if the roles table is empty
 */
async function seedDefaultRoles(db: NodePgDatabase, rolesTableName: string): Promise<void> {
    // Check if any roles exist
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM ${sql.raw(rolesTableName)}`);
    const count = parseInt((result.rows[0] as Record<string, string | number>)?.count as string || "0", 10);

    if (count > 0) {
        console.log(`📋 Found ${count} existing roles`);
        return;
    }

    console.log("🌱 Seeding default roles...");

    for (const role of DEFAULT_ROLES) {
        await db.execute(sql`
            INSERT INTO ${sql.raw(rolesTableName)} (id, name, is_admin, default_permissions)
            VALUES (
                ${role.id}, 
                ${role.name}, 
                ${role.is_admin}, 
                ${JSON.stringify(role.default_permissions)}::jsonb
            )
            ON CONFLICT (id) DO NOTHING
        `);
    }

    console.log("✅ Default roles created: admin, editor, viewer");
}
