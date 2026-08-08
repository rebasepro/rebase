import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import { revokeInternalTableAccess } from "@rebasepro/common";
import type { CollectionConfig } from "@rebasepro/types";
import { AUTH_USERS_COLUMNS, authUsersColumnSql } from "../schema/auth-users-columns";
import { RLS_BOOTSTRAP_STATEMENTS } from "../schema/rls-bootstrap-sql";
import {
    AuthSchemaVersionError,
    assertAuthSchemaCompatible,
    resolveAuthSchema,
    stampAuthSchemaVersion
} from "./schema-version";


/**
 * Auto-create auth tables if they don't exist.
 *
 * @param db         — Drizzle database instance
 * @param collection — The collection that represents auth users.
 *                     When omitted, a default `rebase.users` table is created.
 */
export async function ensureAuthTablesExist(db: NodePgDatabase, collection?: CollectionConfig): Promise<void> {
    logger.info("🔍 Checking auth tables...");

    // Before anything else, and deliberately outside the catch below: refuse to
    // run against a database that a newer framework version has already
    // migrated. Everything past this point is best-effort by design, which is
    // exactly the wrong posture for an incompatibility that would otherwise
    // surface as a fully booted server failing every login.
    await assertAuthSchemaCompatible(db, resolveAuthSchema(collection));

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

            // Derive ID column type from collection properties.
            //
            // `"increment"`, not `"autoincrement"`. The latter was tested for
            // here and exists nowhere in the type system — the union is
            // `boolean | "manual" | "increment" | string` — so the INTEGER branch
            // was unreachable and an integer-keyed auth collection fell through
            // to TEXT. Introspection below hid it whenever the table already
            // existed; on a database where it did not, this created
            // `id TEXT DEFAULT gen_random_uuid()::text` for a collection that
            // declares a number, and every `uid` foreign key was typed to match
            // the wrong thing.
            const idProp = collection.properties?.id;
            if (idProp) {
                const isId = ("isId" in idProp) ? (idProp as unknown as Record<string, unknown>).isId : undefined;
                if (isId === "uuid") {
                    userIdType = "UUID";
                } else if (isId === "increment") {
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

        // Identifiers for the constraint and indexes reconciled further down.
        // Derived from the resolved table name so two auth tables in different
        // schemas cannot collide, and truncated to Postgres's 63-byte identifier
        // limit here rather than letting the server truncate silently — the
        // `IF NOT EXISTS` guards below have to compare against the same name
        // Postgres actually stored, or they re-run forever.
        const authIdentifier = (suffix: string) => `${resolvedTable}_${suffix}`.slice(0, 63);
        const emailLengthConstraint = `"${authIdentifier("email_length_check")}"`;
        const emailLowerUniqueIndex = authIdentifier("email_lower_key");
        const verificationTokenIndex = authIdentifier("email_verification_token_idx");

        // Every string column here is TEXT, deliberately. In Postgres VARCHAR(n)
        // and TEXT are the same type with the same storage and the same
        // performance; the only difference is a length check, and none of these
        // columns wants one. The widths this table used to carry were inherited
        // MySQL habit (255) and they were all wrong in the same direction —
        // `password_hash VARCHAR(255)` against a 193-char scrypt string left 62
        // characters of headroom in front of a KEY_LENGTH constant living in
        // another package, and `photo_url VARCHAR(500)` rejected the `data:` URIs
        // and long signed URLs that OAuth providers hand back. A limit worth
        // having is a CHECK — alterable without a table rewrite, unlike a type
        // modifier — which is why `email` has one and nothing else does.
        //
        // The column list comes from AUTH_USERS_COLUMNS rather than being spelled
        // out here, because this is not the only place that creates this table:
        // `db push` and the boot-time collection ensure do too, and when the
        // three lists were maintained separately they disagreed and boot order
        // silently decided which shape the database got. The `email` CHECK is
        // appended rather than listed there — it is a named constraint the
        // migration below has to be able to add separately, `NOT VALID`, to a
        // table that already holds rows.
        const usersColumnDdl = AUTH_USERS_COLUMNS
            .map((spec) => spec.column === "email"
                ? `${spec.column} ${authUsersColumnSql(spec)} CONSTRAINT ${emailLengthConstraint} CHECK (length(email) <= 320)`
                : `${spec.column} ${authUsersColumnSql(spec)}`)
            .join(",\n                ");
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS ${sql.raw(usersTableName)} (
                id ${sql.raw(userIdType)} PRIMARY KEY ${sql.raw(idDefault)},
                ${sql.raw(usersColumnDdl)}
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
        const legacyFkTables = [
            "user_identities",
            "refresh_tokens",
            "password_reset_tokens",
            "magic_link_tokens",
            "mfa_factors",
            "recovery_codes"
        ];

        // Only on a database that actually carries the legacy column. This whole
        // block is a 0.x compatibility shim, and it used to run unconditionally —
        // so every brand-new database was provisioned with a trigger function
        // written to reconcile a column it can never have, permanently, as part
        // of its first boot. A fresh install should not ship someone else's
        // migration history.
        // The table list is inlined rather than bound: drizzle expands a JS
        // array into a parameter TUPLE — `ANY(($2, $3, …))` — which Postgres
        // rejects, and the thrown error is swallowed by the catch around this
        // whole function, so auth would silently stop provisioning. These are
        // module-level constants, not input.
        const legacyFkTableList = legacyFkTables.map(t => `'${t}'`).join(", ");
        const legacyUserIdPresent = await db.execute(sql`
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = ${authSchema}
              AND table_name IN (${sql.raw(legacyFkTableList)})
              AND column_name = 'user_id'
            LIMIT 1
        `);

        if (legacyUserIdPresent.rows.length > 0) {
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
        }

        for (const authTable of legacyUserIdPresent.rows.length > 0 ? legacyFkTables : []) {
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

        // The RLS helper functions every generated policy calls. They live in
        // `rebase`, alongside the tables above — Rebase creates exactly one
        // schema in a user's database. Advisory-locked so concurrent HMR
        // reloads cannot race on `CREATE OR REPLACE`.
        //
        // The same statements the migration preamble carries, from the same
        // constant — these definitions being identical across the boot path and
        // the migration stream is the whole point of having them in one place.
        // One call per statement: this handle speaks the extended query
        // protocol, which rejects multi-command strings.
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'))`);
            for (const statement of RLS_BOOTSTRAP_STATEMENTS) {
                await tx.execute(sql.raw(statement));
            }
        });

        // Seed default roles if none exist
        // (no-op: roles are now stored inline on the users table)

        // ── Migration: reconcile the full users column set (safe for existing tables) ──
        // CREATE TABLE IF NOT EXISTS never revisits an existing table, so a
        // database provisioned by an older framework era is missing every
        // column added since. Each column the auth services read or write must
        // be back-filled here, or upgraded deployments break on the first
        // statement that references it.
        //
        // `email` is skipped: it has existed since the first era, so it is never
        // the missing one, and `ADD COLUMN … NOT NULL` with no default fails on
        // a table with rows.
        for (const spec of AUTH_USERS_COLUMNS) {
            if (spec.column === "email") continue;
            await db.execute(sql`
                ALTER TABLE ${sql.raw(usersTableName)}
                ADD COLUMN IF NOT EXISTS ${sql.raw(`${spec.column} ${authUsersColumnSql(spec)}`)}
            `);
        }

        // Which of the columns below the table actually has. An adopted table —
        // one this framework did not create, which the column-name resolution in
        // `services.ts` exists to support — may be missing any of them, and every
        // statement past this point has to tolerate that rather than abort the
        // whole migration block.
        const usersColumns = await db.execute(sql`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = ${usersSchema} AND table_name = ${resolvedTable}
        `);
        type UsersColumnRow = {
            column_name: string;
            data_type: string;
            is_nullable: "YES" | "NO";
            column_default: string | null;
        };
        const usersColumnRows = usersColumns.rows as UsersColumnRow[];
        const usersColumnTypes = new Map(usersColumnRows.map(row => [row.column_name, row.data_type]));
        const usersColumnState = new Map(usersColumnRows.map(row => [row.column_name, row]));

        // ── Migration: restore defaults and NOT NULL that another creator dropped ──
        // `ADD COLUMN IF NOT EXISTS` above only creates what is MISSING. A column
        // that exists with the wrong shape stays wrong forever — and until
        // AUTH_USERS_COLUMNS became the single source, that was the normal
        // outcome rather than an edge case: whichever of `db push`, boot-ensure
        // and this function reached the table first decided its constraints, so
        // a managed deploy ended up with a nullable `email`, a `roles` with no
        // `'{}'` default, and an `email_verified` that could be NULL.
        //
        // Ordered DEFAULT → back-fill → SET NOT NULL, because SET NOT NULL is
        // checked against existing rows: without the back-fill it throws on the
        // very databases that need it. `email` can carry no default, so a NULL
        // there is not repairable automatically — say so and leave the column
        // alone rather than inventing an address.
        for (const spec of AUTH_USERS_COLUMNS) {
            const state = usersColumnState.get(spec.column);
            if (!state) continue;

            if (spec.default !== undefined && state.column_default === null) {
                await db.execute(sql`
                    ALTER TABLE ${sql.raw(usersTableName)}
                    ALTER COLUMN ${sql.raw(`"${spec.column}"`)} SET DEFAULT ${sql.raw(spec.default)}
                `);
                logger.info(`🔧 Restored the default on ${usersTableName}.${spec.column}`);
            }

            if (!spec.notNull || state.is_nullable !== "YES") continue;

            if (spec.default !== undefined) {
                await db.execute(sql`
                    UPDATE ${sql.raw(usersTableName)}
                    SET ${sql.raw(`"${spec.column}"`)} = ${sql.raw(spec.default)}
                    WHERE ${sql.raw(`"${spec.column}"`)} IS NULL
                `);
            }
            try {
                await db.execute(sql`
                    ALTER TABLE ${sql.raw(usersTableName)}
                    ALTER COLUMN ${sql.raw(`"${spec.column}"`)} SET NOT NULL
                `);
                logger.info(`🔧 Restored NOT NULL on ${usersTableName}.${spec.column}`);
            } catch (err) {
                logger.warn(
                    `⚠️ ${usersTableName}.${spec.column} should be NOT NULL but still holds NULLs, so the ` +
                    "constraint was not applied. Fill or remove those rows and restart: " +
                    (err instanceof Error ? err.message : String(err))
                );
            }
        }

        // ── Migration: VARCHAR(n) → TEXT on the users string columns ────────
        // Tables created before the widths came off still carry them. Postgres
        // treats varchar(n) → text as binary-coercible with no stricter
        // constraint, so this is a catalogue-only change: no table rewrite, no
        // index rebuild, just a brief ACCESS EXCLUSIVE lock. Guarded on the
        // current type so it runs once and is a pure catalogue read thereafter.
        for (const column of ["email", "display_name", "photo_url", "password_hash", "email_verification_token"]) {
            if (usersColumnTypes.get(column) !== "character varying") continue;
            await db.execute(sql`
                ALTER TABLE ${sql.raw(usersTableName)}
                ALTER COLUMN ${sql.raw(`"${column}"`)} TYPE TEXT
            `);
            logger.info(`🔧 Widened ${usersTableName}.${column} from VARCHAR(n) to TEXT`);
        }

        // ── Migration: case-insensitive email identity ──────────────────────
        // `getUserByEmail` has always searched `email.toLowerCase()` while the
        // write path stored whatever it was handed, leaving normalisation to a
        // convention every caller had to remember. A row that reached the table
        // with mixed case is then invisible to every lookup — the account exists,
        // login reports no such user, and the plain UNIQUE on `email` does not
        // stop a second row differing only in case, because it compares bytes.
        //
        // Fixed on both sides: `mapPayload` now folds on write, and this index
        // makes the database agree. A unique index on lower(email) is strictly
        // stronger than the byte-exact UNIQUE that older tables carry, so the
        // old constraint is left alone — it can no longer fire on anything the
        // new one would allow.
        //
        // Deliberately no AUTH_SCHEMA_VERSION bump: a runtime that predates this
        // migration keeps working against the migrated table (all of its own
        // write paths already lower-cased), which is exactly the additive case
        // the version stamp is documented not to cover.
        if (usersColumnTypes.has("email")) {
            const indexPresent = await db.execute(sql`
                SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = ${usersSchema} AND c.relname = ${emailLowerUniqueIndex} AND c.relkind = 'i'
            `);
            if (indexPresent.rows.length === 0) {
                // Case-collisions already in the table would make the unique
                // index impossible to build. Report them and leave the table
                // alone: the next boot retries, so fixing the rows is all the
                // operator has to do. Failing loudly beats folding the emails
                // and letting CREATE INDEX pick which account survives.
                const collisions = await db.execute(sql`
                    SELECT lower(email) AS normalized, count(*)::int AS occurrences
                    FROM ${sql.raw(usersTableName)}
                    WHERE email IS NOT NULL
                    GROUP BY lower(email)
                    HAVING count(*) > 1
                    LIMIT 10
                `);
                if (collisions.rows.length > 0) {
                    const sample = (collisions.rows as { normalized: string; occurrences: number }[])
                        .map(row => `${row.normalized} (×${row.occurrences})`)
                        .join(", ");
                    logger.error(
                        `❌ Cannot enforce case-insensitive email uniqueness on ${usersTableName}: ` +
                        `these addresses already exist more than once, differing only in case — ${sample}. ` +
                        "Merge or delete the duplicates and restart; until then two accounts can share " +
                        "one address and only the lower-cased one is reachable by login."
                    );
                } else {
                    const folded = await db.execute(sql`
                        UPDATE ${sql.raw(usersTableName)}
                        SET email = lower(email)
                        WHERE email IS NOT NULL AND email <> lower(email)
                    `);
                    if (folded.rowCount) {
                        logger.info(`🔧 Lower-cased ${folded.rowCount} email address(es) in ${usersTableName}`);
                    }
                    await db.execute(sql`
                        CREATE UNIQUE INDEX IF NOT EXISTS ${sql.raw(`"${emailLowerUniqueIndex}"`)}
                        ON ${sql.raw(usersTableName)} (lower(email))
                    `);
                    logger.info(`✅ Email uniqueness on ${usersTableName} is now case-insensitive`);
                }
            }
        }

        // ── Migration: bound the email column's length ──────────────────────
        // The only length limit on this table worth keeping. 320 is the RFC 5321
        // maximum (64-char local part + @ + 255-char domain), and it matters here
        // beyond tidiness: `email` carries a btree index, and a sufficiently long
        // value fails index insertion with an error that says nothing about
        // email. NOT VALID so an adopted table with a long row still migrates —
        // it binds all new writes, which is the part that matters.
        if (usersColumnTypes.has("email")) {
            const checkPresent = await db.execute(sql`
                SELECT 1 FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = ${usersSchema}
                  AND t.relname = ${resolvedTable}
                  AND c.conname = ${authIdentifier("email_length_check")}
            `);
            if (checkPresent.rows.length === 0) {
                await db.execute(sql`
                    ALTER TABLE ${sql.raw(usersTableName)}
                    ADD CONSTRAINT ${sql.raw(emailLengthConstraint)} CHECK (length(email) <= 320) NOT VALID
                `);
            }
        }

        // ── Index: email verification token lookups ─────────────────────────
        // `getUserByVerificationToken` filters on this column, which had no
        // index — every click of a verification link was a sequential scan of
        // the whole users table. Partial, because the column is NULL for every
        // user who is not mid-verification, which is nearly all of them.
        if (usersColumnTypes.has("email_verification_token")) {
            await db.execute(sql`
                CREATE INDEX IF NOT EXISTS ${sql.raw(`"${verificationTokenIndex}"`)}
                ON ${sql.raw(usersTableName)} (email_verification_token)
                WHERE email_verification_token IS NOT NULL
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
                    // Nullable with no default and no back-fill: a row written
                    // before this column existed says nothing about whether a
                    // second factor was presented, and the reader treats "says
                    // nothing" as `aal1` — the restrictive answer. Stamping
                    // every existing row would be inventing evidence.
                    await db.execute(sql`ALTER TABLE ${sql.raw(qualified)} ADD COLUMN IF NOT EXISTS aal TEXT`);

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
                last_used_counter BIGINT,
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
                attempts INTEGER NOT NULL DEFAULT 0,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL
            )
        `);

        // Create indexes on mfa_challenges
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_mfa_challenges_factor
            ON ${sql.raw(mfaChallengesTableName)}(factor_id)
        `);

        // ── Migration: replay and brute-force state on the MFA tables ───────
        // Both are additive and nullable-or-defaulted, so a runtime that
        // predates them reads the tables unchanged. `last_used_counter` records
        // the TOTP step a factor has already spent (RFC 6238 §5.2); `attempts`
        // bounds how many guesses one challenge will take before it is dead.
        // Without them the code paths degrade to "no replay protection, rate
        // limiters only" rather than failing, which is why this is a warn.
        try {
            await db.execute(sql`ALTER TABLE ${sql.raw(mfaFactorsTableName)} ADD COLUMN IF NOT EXISTS last_used_counter BIGINT`);
            await db.execute(sql`ALTER TABLE ${sql.raw(mfaChallengesTableName)} ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`);
        } catch (mfaMigrationError: unknown) {
            logger.warn(`⚠️  MFA hardening columns skipped: ${mfaMigrationError instanceof Error ? mfaMigrationError.message : String(mfaMigrationError)}`);
        }

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
            // Every table this function creates, not a subset. `magic_link_tokens`
            // and `schema_meta` were missing here while their six siblings were
            // listed — so on a database carrying FORCE from the older RLS model,
            // magic-link sign-in kept failing 42501 after the upgrade that was
            // supposed to fix exactly that, and only for the one auth method.
            const authTablePairs: [string, string][] = [
                [usersSchema, resolvedTable],
                [authSchema, "user_identities"],
                [authSchema, "refresh_tokens"],
                [authSchema, "password_reset_tokens"],
                [authSchema, "magic_link_tokens"],
                [authSchema, "app_config"],
                [authSchema, "mfa_factors"],
                [authSchema, "mfa_challenges"],
                [authSchema, "recovery_codes"],
                [authSchema, "schema_meta"]
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

        // Stamped last of the MIGRATIONS, so a boot that died partway through
        // the ones above leaves the older stamp in place and the next boot runs
        // them again.
        await stampAuthSchemaVersion(db, authSchema);

        // ── Keep the end-user role out of auth's tables ─────────────────────
        // These carry session token hashes, TOTP secrets and recovery codes, and
        // none of them has RLS — they are not collections, so nothing ever
        // compiled a policy for them. Meanwhile the role provisioning grants
        // `rebase_user` DML on every table in this schema, and its
        // ALTER DEFAULT PRIVILEGES reaches the ones created right here, after it
        // ran. So the grant has to come back off; see `revokeInternalTableSql`
        // for why a revoke rather than an empty RLS policy set.
        //
        // After the stamp deliberately: `schema_meta` is created BY the stamp,
        // so revoking first would leave the one table holding this database's
        // schema version writable by every signed-in user until the next boot.
        // Nothing below re-runs the migrations, so the stamp's guarantee holds.
        await revokeInternalTableAccess(
            async (text) => { await db.execute(sql.raw(text)); },
            authSchema,
            {
                onError: (table, err) => logger.warn(
                    `🔐 Could not revoke authenticated-role access to "${authSchema}"."${table}": ` +
                    (err instanceof Error ? err.message : String(err))
                )
            }
        );

        logger.info("✅ Auth tables ready");
    } catch (error) {
        // The one failure that must not be survived. Continuing here is what
        // produced a server that answered /health with 200 while every login
        // returned 500 — the incompatibility is total, so crashing is the
        // kinder outcome: an orchestrator will not route traffic to a pod that
        // never came up.
        if (error instanceof AuthSchemaVersionError) throw error;
        logger.error("❌ Failed to create auth tables", { error });
        logger.warn("⚠️ Continuing without creating auth tables.");
    }
}

