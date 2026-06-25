import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server-core";
import type { EntityCollection } from "@rebasepro/types";


/**
 * Auto-create auth tables if they don't exist.
 *
 * @param db         — Drizzle database instance
 * @param collection — The collection that represents auth users.
 *                     When omitted, a default `rebase.users` table is created.
 */
export async function ensureAuthTablesExist(db: NodePgDatabase, collection?: EntityCollection): Promise<void> {
    logger.info("🔍 Checking auth tables...");

    try {
        // Resolve dynamic user table name and ID type from the collection
        let usersTableName = '"rebase"."users"';
        let userIdType = "TEXT";
        let usersSchema = "rebase";
        let resolvedTable = "users";
        if (collection) {
            resolvedTable = ("table" in collection && typeof collection.table === "string")
                ? collection.table
                : collection.slug;
            usersSchema = ("schema" in collection && typeof collection.schema === "string")
                ? collection.schema
                : "public";
            usersTableName = usersSchema === "public"
                ? `"${resolvedTable}"`
                : `"${usersSchema}"."${resolvedTable}"`;

            // Derive ID column type from collection properties
            const idProp = collection.properties?.id;
            if (idProp) {
                const isId = ("isId" in idProp) ? (idProp as unknown as Record<string, unknown>).isId : undefined;
                if (isId === "uuid") {
                    userIdType = "UUID";
                } else if (isId === "autoincrement") {
                    userIdType = "INTEGER";
                }
                // Otherwise keep TEXT as default
            }
        }

        // Introspect the database to find the actual type of usersTableName's ID column if the table exists
        try {
            const result = await db.execute(sql`
                SELECT data_type 
                FROM information_schema.columns 
                WHERE table_schema = ${usersSchema} 
                  AND table_name = ${resolvedTable} 
                  AND column_name = 'id'
            `);
            if (result && result.rows && result.rows.length > 0) {
                const dbType = String((result.rows[0] as { data_type: string }).data_type).toUpperCase();
                if (dbType === "UUID") {
                    userIdType = "UUID";
                } else if (dbType === "INTEGER" || dbType === "SMALLINT" || dbType === "BIGINT") {
                    userIdType = "INTEGER";
                } else {
                    userIdType = "TEXT";
                }
                logger.info(`✨ Detected ${usersTableName}.id type from database: ${dbType}. Using user_id type: ${userIdType}`);
            }
        } catch (err) {
            // Ignore introspection errors, fallback to derived/default type
            logger.warn(`⚠️ Failed to introspect ${usersTableName}.id type from database, falling back to config type: ${userIdType}`, { error: err });
        }


        // ── Create schemas (idempotent) ──────────────────────────────────
        if (usersSchema !== "public") {
            await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(usersSchema)}`);
        }
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS rebase`);

        const authSchema = usersSchema === "public" ? "rebase" : usersSchema;
        const userIdentitiesTable = `"${authSchema}"."user_identities"`;
        const refreshTokensTableName = `"${authSchema}"."refresh_tokens"`;
        const passwordResetTokensTableName = `"${authSchema}"."password_reset_tokens"`;
        const appConfigTableName = `"${authSchema}"."app_config"`;

        // ── Create users table (idempotent) ─────────────────────────────
        // The users table MUST be created before any dependent auth tables
        // (user_identities, refresh_tokens, etc.) because they all hold
        // foreign keys referencing users(id).  When a developer runs
        // `pnpm dev` for the first time without `db:migrate`, this ensures
        // the server can self-bootstrap.
        const idDefault = userIdType === "UUID"
            ? "DEFAULT gen_random_uuid()"
            : userIdType === "INTEGER"
                ? "GENERATED ALWAYS AS IDENTITY"
                : "DEFAULT gen_random_uuid()::text";

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(usersTableName)} (
                id ${sql.raw(userIdType)} PRIMARY KEY ${sql.raw(idDefault)},
                email VARCHAR(255) UNIQUE NOT NULL,
                display_name VARCHAR(255),
                photo_url VARCHAR(500),
                roles TEXT[] DEFAULT '{}' NOT NULL,
                password_hash VARCHAR(255),
                email_verified BOOLEAN DEFAULT FALSE NOT NULL,
                email_verification_token VARCHAR(255),
                email_verification_sent_at TIMESTAMP WITH TIME ZONE,
                is_anonymous BOOLEAN DEFAULT FALSE NOT NULL,
                metadata JSONB DEFAULT '{}' NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
            )
        `);

        // ── Create dependent auth tables (idempotent) ───────────────────

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

        // Create magic link tokens table
        const magicLinkTokensTableName = `"${authSchema}"."magic_link_tokens"`;
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(magicLinkTokensTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                used_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create index on token_hash for magic link lookups
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_hash 
            ON ${sql.raw(magicLinkTokensTableName)}(token_hash)
        `);

        // Create index on user_id for magic link cleanup
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_user 
            ON ${sql.raw(magicLinkTokensTableName)}(user_id)
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
        // (no-op: roles are now stored inline on the users table)

        // ── Migration: Add is_anonymous column (safe for existing tables) ────
        await db.execute(sql`
            ALTER TABLE ${sql.raw(usersTableName)}
            ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE
        `);

        // ── Migration: Add inline roles column (safe for existing tables) ────
        await db.execute(sql`
            ALTER TABLE ${sql.raw(usersTableName)}
            ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{}' NOT NULL
        `);

        // ── Migration: Copy roles from legacy junction table to inline column ──
        // If the old rebase.user_roles and rebase.roles tables exist, migrate
        // the data into the new TEXT[] column then drop the legacy tables.
        try {
            const legacyCheck = await db.execute(sql`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'rebase' AND table_name = 'user_roles'
                ) AS has_user_roles
            `);
            const hasLegacyTables = (legacyCheck.rows[0] as { has_user_roles: boolean }).has_user_roles;

            if (hasLegacyTables) {
                logger.info("🔄 Migrating roles from legacy user_roles table...");
                // Update users' roles column from the junction table
                await db.execute(sql`
                    UPDATE ${sql.raw(usersTableName)} u
                    SET roles = COALESCE((
                        SELECT array_agg(ur.role_id)
                        FROM "rebase"."user_roles" ur
                        WHERE ur.user_id = u.id
                    ), '{}')
                    WHERE u.roles = '{}' OR u.roles IS NULL
                `);

                // Drop legacy tables (junction first due to FK)
                await db.execute(sql`DROP TABLE IF EXISTS "rebase"."user_roles" CASCADE`);
                await db.execute(sql`DROP TABLE IF EXISTS "rebase"."roles" CASCADE`);
                logger.info("✅ Legacy roles tables migrated and dropped");
            }
        } catch (migrationError: unknown) {
            // Non-fatal: log and continue — the column exists and will work
            logger.warn(`⚠️  Legacy roles migration skipped: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`);
        }

        // ── MFA tables ──────────────────────────────────────────────────────
        const mfaFactorsTableName = `"${authSchema}"."mfa_factors"`;
        const mfaChallengesTableName = `"${authSchema}"."mfa_challenges"`;
        const recoveryCodesTableName = `"${authSchema}"."recovery_codes"`;

        // Create mfa_factors table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(mfaFactorsTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                factor_type TEXT NOT NULL DEFAULT 'totp',
                secret_encrypted TEXT NOT NULL,
                friendly_name TEXT,
                verified BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create indexes on mfa_factors
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_mfa_factors_user
            ON ${sql.raw(mfaFactorsTableName)}(user_id)
        `);

        // Create mfa_challenges table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(mfaChallengesTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                factor_id TEXT NOT NULL REFERENCES ${sql.raw(mfaFactorsTableName)}(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                verified_at TIMESTAMP WITH TIME ZONE,
                ip_address TEXT,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
        `);

        // Create indexes on mfa_challenges
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_mfa_challenges_factor
            ON ${sql.raw(mfaChallengesTableName)}(factor_id)
        `);

        // Create recovery_codes table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(recoveryCodesTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                code_hash TEXT NOT NULL,
                used_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create indexes on recovery_codes
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_recovery_codes_user
            ON ${sql.raw(recoveryCodesTableName)}(user_id)
        `);

        logger.info("✅ Auth tables ready");
    } catch (error) {
        logger.error("❌ Failed to create auth tables", { error });
        logger.warn("⚠️ Continuing without creating auth tables.");
    }
}

