import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import type { CollectionConfig } from "@rebasepro/types";


/**
 * Auto-create auth tables if they don't exist.
 *
 * @param db         — Drizzle database instance
 * @param collection — The collection that represents auth users.
 *                     When omitted, a default `rebase.users` table is created.
 */
export async function ensureAuthTablesExist(db: NodePgDatabase, collection?: CollectionConfig): Promise<void> {
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
                tokens_valid_after TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
            )
        `);

        // ── Migration: auth FK column user_id → uid, phase 1 (expand) ───────
        // Must run BEFORE the dependent tables below: CREATE TABLE IF NOT
        // EXISTS never revisits an existing table, so a database provisioned
        // before this migration still lacks `uid` — and the
        // CREATE INDEX ... (uid) statements that follow would fail on it.
        //
        // Deliberately NOT a plain RENAME. Both Cloud Run and Kubernetes roll
        // deploys, so old and new pods serve the same database at the same time,
        // and a rollback puts old code back in front of a migrated database. A
        // rename breaks every auth query on whichever side is out of step.
        // Instead: add `uid`, backfill it, drop the NOT NULL on `user_id`, and
        // keep the two in sync with a trigger, so a backend of either era can
        // read and write. `scripts/drop-legacy-auth-user-id.sql` removes the
        // column once no old backend remains (phase 2, contract).
        //
        // Idempotent throughout: every step is guarded on catalogue state.
        await db.execute(sql`
            CREATE OR REPLACE FUNCTION ${sql.raw(`"${authSchema}"`)}.sync_uid_user_id() RETURNS trigger AS $$
            BEGIN
                IF NEW.uid IS NULL AND NEW.user_id IS NOT NULL THEN
                    NEW.uid := NEW.user_id;
                ELSIF NEW.user_id IS NULL AND NEW.uid IS NOT NULL THEN
                    NEW.user_id := NEW.uid;
                END IF;
                RETURN NEW;
            END $$ LANGUAGE plpgsql
        `);

        for (const authTable of [
            "user_identities",
            "refresh_tokens",
            "password_reset_tokens",
            "magic_link_tokens",
            "mfa_factors",
            "recovery_codes"
        ]) {
            const qualified = `"${authSchema}"."${authTable}"`;
            await db.execute(sql`
                DO $$
                DECLARE
                    has_legacy boolean;
                    has_uid    boolean;
                BEGIN
                    SELECT
                        bool_or(column_name = 'user_id'),
                        bool_or(column_name = 'uid')
                    INTO has_legacy, has_uid
                    FROM information_schema.columns
                    WHERE table_schema = ${sql.raw(`'${authSchema}'`)}
                      AND table_name = ${sql.raw(`'${authTable}'`)};

                    -- Table absent, or already uid-only (a fresh install, or
                    -- phase 2 already run): nothing to do.
                    IF has_legacy IS NOT TRUE THEN
                        RETURN;
                    END IF;

                    IF has_uid IS NOT TRUE THEN
                        EXECUTE ${sql.raw(`'ALTER TABLE ${qualified} ADD COLUMN uid ${userIdType} REFERENCES ${usersTableName}(id) ON DELETE CASCADE'`)};
                        EXECUTE ${sql.raw(`'UPDATE ${qualified} SET uid = user_id WHERE uid IS NULL'`)};
                        EXECUTE ${sql.raw(`'CREATE INDEX IF NOT EXISTS idx_${authTable}_uid ON ${qualified}(uid)'`)};
                    END IF;

                    -- New code inserts uid and never user_id, so the legacy
                    -- column can no longer be NOT NULL. The trigger below
                    -- backfills it, but the constraint is checked first.
                    EXECUTE ${sql.raw(`'ALTER TABLE ${qualified} ALTER COLUMN user_id DROP NOT NULL'`)};

                    EXECUTE ${sql.raw(`'DROP TRIGGER IF EXISTS sync_uid_user_id ON ${qualified}'`)};
                    EXECUTE ${sql.raw(`'CREATE TRIGGER sync_uid_user_id BEFORE INSERT OR UPDATE ON ${qualified} FOR EACH ROW EXECUTE FUNCTION "${authSchema}".sync_uid_user_id()'`)};
                END $$
            `);
        }

        // ── Create dependent auth tables (idempotent) ───────────────────

        // Create user_identities table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(userIdentitiesTable)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                uid ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
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
            ON ${sql.raw(userIdentitiesTable)}(uid)
        `);


        // Create refresh tokens table. One row per TOKEN, grouped into a
        // sign-in by session_id — deliberately without a uniqueness rule on
        // (uid, user_agent, ip_address); see the schema module for why that
        // constraint had to go.
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(refreshTokensTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                uid ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                session_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
                token_hash TEXT NOT NULL UNIQUE,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                revoked BOOLEAN DEFAULT FALSE NOT NULL,
                rotated_at TIMESTAMP WITH TIME ZONE,
                session_started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
                user_agent TEXT,
                ip_address TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create index on token_hash for faster lookups
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash 
            ON ${sql.raw(refreshTokensTableName)}(token_hash)
        `);

        // Create index on uid for cleanup operations
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user 
            ON ${sql.raw(refreshTokensTableName)}(uid)
        `);

        // Create password reset tokens table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(passwordResetTokensTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                uid ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
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

        // Create index on uid for password reset cleanup
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user 
            ON ${sql.raw(passwordResetTokensTableName)}(uid)
        `);

        // Create magic link tokens table
        const magicLinkTokensTableName = `"${authSchema}"."magic_link_tokens"`;
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(magicLinkTokensTableName)} (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                uid ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
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

        // Create index on uid for magic link cleanup
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_user 
            ON ${sql.raw(magicLinkTokensTableName)}(uid)
        `);

        // Create app config table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(appConfigTableName)} (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create the `auth` schema with PostgreSQL RLS helper functions.
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS auth`);

        // Use an advisory transaction lock to serialize function recreation during HMR
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'))`);

            // Falls back to the pre-rename `app.user_id` so a database that has
            // taken the new schema but is still served by an older backend keeps
            // resolving the principal. Keep in sync with AUTH_BOOTSTRAP_SQL.
            await tx.execute(sql`
                CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$
                    SELECT COALESCE(
                        NULLIF(current_setting('app.uid', true), ''),
                        NULLIF(current_setting('app.user_id', true), '')
                    );
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

        // ── Migration: reconcile the full users column set (safe for existing tables) ──
        // CREATE TABLE IF NOT EXISTS never revisits an existing table, so a
        // database provisioned by an older framework era is missing every
        // column added since. Each column the auth services read or write must
        // be back-filled here, or upgraded deployments break on the first
        // statement that references it. `email` is deliberately absent: it has
        // existed since the first era and cannot be added NOT NULL safely.
        const userColumnBackfills = [
            "display_name VARCHAR(255)",
            "photo_url VARCHAR(500)",
            "roles TEXT[] DEFAULT '{}' NOT NULL",
            "password_hash VARCHAR(255)",
            "email_verified BOOLEAN DEFAULT FALSE NOT NULL",
            "email_verification_token VARCHAR(255)",
            "email_verification_sent_at TIMESTAMP WITH TIME ZONE",
            "is_anonymous BOOLEAN DEFAULT FALSE NOT NULL",
            "metadata JSONB DEFAULT '{}' NOT NULL",
            "tokens_valid_after TIMESTAMP WITH TIME ZONE",
            "created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL",
            "updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL"
        ];
        for (const columnDef of userColumnBackfills) {
            await db.execute(sql`
                ALTER TABLE ${sql.raw(usersTableName)}
                ADD COLUMN IF NOT EXISTS ${sql.raw(columnDef)}
            `);
        }

        // ── Migration: refresh_tokens become session-scoped, rotation-safe ──
        // Two shapes are reconciled here, on EVERY table named refresh_tokens
        // in whatever schema it lives (a database provisioned by an older era
        // can carry the table in a different schema than the one this run
        // derives, and auth would then read a table nobody migrated):
        //
        //   1. The new columns. A token is now a member of a session
        //      (`session_id`) and is retained after rotation (`revoked`,
        //      `rotated_at`) so a replayed token can be recognised instead of
        //      looking like a forgery. `session_started_at` is carried across
        //      rotations so `users.tokens_valid_after` cannot be outrun.
        //   2. The removal of `unique_device_session`. It made (uid,
        //      user_agent, ip_address) the identity of a session, which evicted
        //      a second browser profile behind one NAT and churned rows as
        //      phones changed networks. UA and IP are metadata now.
        //
        // Every existing row is adopted rather than dropped: it keeps its
        // token_hash, gets a session of its own, and stays unrevoked — so the
        // sessions live in browsers right now survive the upgrade rather than
        // everyone being signed out by the fix for being signed out.
        try {
            const rtTables = await db.execute(sql`
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_name = 'refresh_tokens'
            `);
            const found = (rtTables.rows as { table_schema: string; table_name: string }[]);
            logger.info(`🔍 refresh_tokens reconcile: found ${found.length} table(s): ${found.map(r => `"${r.table_schema}"."${r.table_name}"`).join(", ") || "(none)"}`);
            for (const { table_schema } of found) {
                const qualified = `"${table_schema}"."refresh_tokens"`;
                try {
                    // Added nullable, then back-filled, then constrained: adding
                    // `session_id NOT NULL DEFAULT gen_random_uuid()` in one step
                    // would stamp every existing row with the SAME uuid on some
                    // Postgres versions, silently merging every live session into
                    // one that a single logout would then wipe.
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ADD COLUMN IF NOT EXISTS session_id TEXT`);
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT FALSE NOT NULL`);
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMP WITH TIME ZONE`);
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMP WITH TIME ZONE`);

                    // One session per pre-existing row: under the old model a row
                    // WAS a device session, and there is no record of which rows
                    // descended from the same sign-in.
                    await db.execute(sql`
                        UPDATE ${sql.raw(qualified)}
                        SET session_id = gen_random_uuid()::text
                        WHERE session_id IS NULL
                    `);
                    await db.execute(sql`
                        UPDATE ${sql.raw(qualified)}
                        SET session_started_at = COALESCE(created_at, NOW())
                        WHERE session_started_at IS NULL
                    `);
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ALTER COLUMN session_id SET DEFAULT gen_random_uuid()::text`);
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ALTER COLUMN session_started_at SET DEFAULT NOW()`);
                    // SET NOT NULL only once the back-fill above has definitely
                    // run; on a table that somehow still holds a NULL this throws
                    // and is caught below rather than failing the boot.
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ALTER COLUMN session_id SET NOT NULL`);
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ALTER COLUMN session_started_at SET NOT NULL`);

                    await db.execute(sql`
                        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session
                        ON ${sql.raw(qualified)}(session_id)
                    `);

                    // The device-session constraint is now actively harmful: two
                    // live tokens of one session (a rotation in flight) share a
                    // uid, and usually a user agent and IP too.
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} DROP CONSTRAINT IF EXISTS unique_device_session`);
                    logger.info(`✅ refresh_tokens reconciled for session-scoped rotation: ${qualified}`);
                } catch (perTableError: unknown) {
                    logger.warn(`⚠️  refresh_tokens reconcile failed for ${qualified}: ${perTableError instanceof Error ? perTableError.message : String(perTableError)}`);
                }
            }
        } catch (migrationError: unknown) {
            logger.warn(`⚠️  refresh_tokens session migration skipped: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`);
        }

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
                uid ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
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
            ON ${sql.raw(mfaFactorsTableName)}(uid)
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
                uid ${sql.raw(userIdType)} NOT NULL REFERENCES ${sql.raw(usersTableName)}(id) ON DELETE CASCADE,
                code_hash TEXT NOT NULL,
                used_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create indexes on recovery_codes
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_recovery_codes_user
            ON ${sql.raw(recoveryCodesTableName)}(uid)
        `);

        // ── Migration: clear stale FORCE ROW LEVEL SECURITY (older RLS model) ──
        // The current model never emits FORCE: privileged auth writes run as
        // the table owner and rely on the owner bypassing plain ENABLE RLS
        // (see generate-postgres-ddl-logic). A table still carrying FORCE from
        // an older framework era binds the owner too, so the first user
        // registration after an upgrade fails with SQLSTATE 42501. Reconcile
        // on boot; only tables actually flagged get the ALTER (and its lock).
        try {
            const authTablePairs: [string, string][] = [
                [usersSchema, resolvedTable],
                [authSchema, "user_identities"],
                [authSchema, "refresh_tokens"],
                [authSchema, "password_reset_tokens"],
                [authSchema, "app_config"],
                [authSchema, "mfa_factors"],
                [authSchema, "mfa_challenges"],
                [authSchema, "recovery_codes"]
            ];
            for (const [schemaName, tableName] of authTablePairs) {
                const forced = await db.execute(sql`
                    SELECT 1
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = ${schemaName}
                      AND c.relname = ${tableName}
                      AND c.relforcerowsecurity
                `);
                if (forced.rows.length > 0) {
                    await db.execute(sql`
                        ALTER TABLE ${sql.raw(`"${schemaName}"."${tableName}"`)}
                        NO FORCE ROW LEVEL SECURITY
                    `);
                    logger.warn(
                        `🔧 Cleared stale FORCE ROW LEVEL SECURITY on "${schemaName}"."${tableName}" ` +
                        "(legacy RLS model — it binds the owner connection and breaks privileged auth writes)"
                    );
                }
            }
        } catch (rlsReconcileError: unknown) {
            // Non-fatal: the connection may lack ownership on a pre-provisioned
            // table; registration will still fail loudly (42501) if FORCE remains.
            logger.warn(
                `⚠️  Could not reconcile FORCE ROW LEVEL SECURITY on auth tables: ` +
                `${rlsReconcileError instanceof Error ? rlsReconcileError.message : String(rlsReconcileError)}`
            );
        }

        logger.info("✅ Auth tables ready");
    } catch (error) {
        logger.error("❌ Failed to create auth tables", { error });
        logger.warn("⚠️ Continuing without creating auth tables.");
    }
}

