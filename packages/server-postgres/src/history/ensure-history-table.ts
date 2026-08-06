import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import { revokeInternalTableSql } from "@rebasepro/common";

/**
 * Auto-create the row history table if it doesn't exist.
 * This runs on startup when history is enabled, following the same
 * pattern as `ensureAuthTablesExist`.
 */
export async function ensureHistoryTableExists(db: NodePgDatabase): Promise<void> {
    logger.info("🔍 Checking row history table...");

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

        logger.info("✅ Entity history table ready");
    } catch (error) {
        logger.error("❌ Failed to create row history table", { error: error });
        logger.warn("⚠️ Continuing without creating history table.");
    }
}
