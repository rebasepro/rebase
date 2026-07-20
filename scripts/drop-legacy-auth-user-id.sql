-- Phase 2 (contract) of the auth `user_id` → `uid` migration.
--
-- Phase 1 (expand) runs automatically when a backend boots: see
-- `ensureAuthTables` in packages/server-postgres/src/auth/ensure-tables.ts. It
-- adds `uid`, backfills it, relaxes `user_id` to nullable, and installs a
-- trigger that keeps the two in sync — so a backend of either era can read and
-- write the same database.
--
-- This script removes the legacy column and the trigger. It is deliberately
-- NOT run automatically, because doing so is what breaks an old backend.
--
-- ⚠️  RUN THIS ONLY WHEN EVERY BACKEND REACHING THIS DATABASE READS `uid`.
--     That means: the rollout is complete, and you no longer intend to roll
--     back to a release that predates the rename. Dropping the column is not
--     reversible without restoring from backup — the values survive in `uid`,
--     but any old code pointed at this database afterwards will fail every
--     auth query.
--
-- Verify first (should return 0 rows where the two disagree):
--
--     SELECT 'refresh_tokens' AS t, count(*) FROM rebase.refresh_tokens
--       WHERE uid IS DISTINCT FROM user_id;
--
-- Then run:
--
--     psql "$DATABASE_URL" -v schema=rebase -f scripts/drop-legacy-auth-user-id.sql
--
-- Only the framework's own auth tables are touched. Ownership columns in your
-- application's tables are yours to name and are left alone.

-- Abort on the first error. Without this psql reports the failing statement and
-- carries on to the next one, so a broken migration exits 0 having done nothing.
\set ON_ERROR_STOP on

\if :{?schema}
\else
    \set schema rebase
\endif

-- Carried through a session GUC rather than interpolated directly into the DO
-- block below: psql does not substitute :'schema' inside dollar-quoted text, so
-- the body would fail to parse.
SELECT set_config('rebase.target_schema', :'schema', false);

DO $$
DECLARE
    target_schema text := current_setting('rebase.target_schema');
    auth_table    text;
    qualified     text;
    divergent     bigint;
BEGIN
    FOREACH auth_table IN ARRAY ARRAY[
        'user_identities',
        'refresh_tokens',
        'password_reset_tokens',
        'magic_link_tokens',
        'mfa_factors',
        'recovery_codes'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = target_schema
              AND table_name = auth_table
              AND column_name = 'user_id'
        ) THEN
            RAISE NOTICE 'skipped %.% (no legacy column)', target_schema, auth_table;
            CONTINUE;
        END IF;

        qualified := format('%I.%I', target_schema, auth_table);

        -- Refuse to drop a column that still disagrees with `uid`: that means
        -- some writer is not going through the trigger, and the values would
        -- be lost rather than merely duplicated.
        EXECUTE format(
            'SELECT count(*) FROM %s WHERE uid IS DISTINCT FROM user_id', qualified
        ) INTO divergent;

        IF divergent > 0 THEN
            RAISE EXCEPTION
                '%: % row(s) where uid <> user_id — refusing to drop. Investigate before rerunning.',
                qualified, divergent;
        END IF;

        EXECUTE format('DROP TRIGGER IF EXISTS sync_uid_user_id ON %s', qualified);
        EXECUTE format('ALTER TABLE %s DROP COLUMN user_id', qualified);
        EXECUTE format('ALTER TABLE %s ALTER COLUMN uid SET NOT NULL', qualified);

        RAISE NOTICE 'dropped %.user_id', qualified;
    END LOOP;
END $$;

-- The sync function is shared by all six tables, so it can only go once the
-- last trigger has. Harmless to leave if another schema still uses it.
DO $$
DECLARE
    target_schema text := current_setting('rebase.target_schema');
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'sync_uid_user_id' AND n.nspname = target_schema
          AND NOT t.tgisinternal
    ) THEN
        EXECUTE format('DROP FUNCTION IF EXISTS %I.sync_uid_user_id()', target_schema);
        RAISE NOTICE 'dropped %.sync_uid_user_id()', target_schema;
    END IF;
END $$;
