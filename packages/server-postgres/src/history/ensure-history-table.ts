import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import { REBASE_USER_ROLE, revokeInternalTableSql } from "@rebasepro/common";

/** How a history entry gets written from inside the write it records. */
export const RECORD_HISTORY_FUNCTION = "rebase.record_history";
const RECORD_HISTORY_SIGNATURE = `${RECORD_HISTORY_FUNCTION}(text, text, text, text[], jsonb, jsonb, text)`;

/**
 * Auto-create the row history table if it doesn't exist.
 * This runs on startup when history is enabled, following the same
 * pattern as `ensureAuthTablesExist`.
 *
 * Resolves `true` when {@link RECORD_HISTORY_FUNCTION} exists, so an entry can
 * be written on the write's own transaction; `false` sends entries through the
 * pool as before, committing on their own.
 */
export async function ensureHistoryTableExists(db: NodePgDatabase): Promise<boolean> {
    logger.debug("🔍 Checking row history table...");

    try {
        // Create the rebase schema (idempotent — may already exist from auth init)
        await db.execute(sql`CREATE SCHEMA IF NOT EXISTS rebase`);

        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS rebase.entity_history (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                table_name TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                action TEXT NOT NULL,
                changed_fields TEXT[],
                "values" JSONB,
                previous_values JSONB,
                updated_by TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_history_entity
            ON rebase.entity_history(table_name, entity_id)
        `);

        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_history_time
            ON rebase.entity_history(table_name, entity_id, updated_at DESC)
        `);

        // Every previous value of every audited row, in one table with no RLS
        // and no tenant scoping — so a readable copy defeats the row policies on
        // the tables it shadows. The driver's schema-wide grant reaches it
        // (created here, after that grant ran), so take it back.
        await db.execute(sql.raw(revokeInternalTableSql("rebase", "entity_history")));

        logger.debug("✅ Entity history table ready");
    } catch (error) {
        logger.error("❌ Failed to create row history table", { error: error });
        logger.warn("⚠️ Continuing without creating history table.");
        return false;
    }

    // The entry has to commit with the row it describes, so it is written on
    // the write's transaction — which runs as the request role, revoked from
    // this table just above. A `SECURITY DEFINER` function is the one door:
    // it inserts exactly an entry, with the owner's rights, for that single
    // statement, and only the request role may call it. The same reasoning,
    // at more length, is on `rebase.enqueue_job` in the job store.
    try {
        await db.execute(sql.raw(`
            CREATE OR REPLACE FUNCTION ${RECORD_HISTORY_FUNCTION}(
                p_table_name text, p_entity_id text, p_action text, p_changed_fields text[],
                p_values jsonb, p_previous_values jsonb, p_updated_by text
            ) RETURNS void
            LANGUAGE sql
            SECURITY DEFINER
            SET search_path = pg_catalog, pg_temp
            AS $fn$
                INSERT INTO rebase.entity_history
                    (table_name, entity_id, action, changed_fields, "values", previous_values, updated_by)
                VALUES (p_table_name, p_entity_id, p_action, p_changed_fields, p_values, p_previous_values, p_updated_by)
            $fn$
        `));
        await db.execute(sql.raw(`REVOKE ALL ON FUNCTION ${RECORD_HISTORY_SIGNATURE} FROM PUBLIC`));
        await db.execute(sql.raw(`
            DO $grant$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}') THEN
                    GRANT EXECUTE ON FUNCTION ${RECORD_HISTORY_SIGNATURE} TO ${REBASE_USER_ROLE};
                END IF;
            END $grant$
        `));
        return true;
    } catch (error) {
        logger.warn(
            `⚠️ ${RECORD_HISTORY_FUNCTION} could not be created, so a history entry commits on its own: ` +
            "it survives a write that rolls back.",
            { error }
        );
        return false;
    }
}
