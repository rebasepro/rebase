import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import { REBASE_USER_ROLE, revokeInternalTableSql, sqlRows } from "@rebasepro/common";
import type { DeferredIndexBuild } from "../schema/plan/diff-plan";
import { BOOT_LOCK_RETRY_BUDGET_MS, isLockTimeout, resolveBootLockOptions, sleep, type BootLockOptions } from "../schema/boot-ddl";

/** How a history entry gets written from inside the write it records. */
export const RECORD_HISTORY_FUNCTION = "rebase.record_history";
const RECORD_HISTORY_SIGNATURE = `${RECORD_HISTORY_FUNCTION}(text, text, text, text[], jsonb, jsonb, text)`;

/** A row's entries, newest first: the history list, the inline prune, and — by its prefix — every per-row lookup. */
const HISTORY_TIME_INDEX = "idx_history_time";
/** Entries by age alone, for the retention sweep (`HistoryService.pruneExpired`). */
export const HISTORY_SWEEP_INDEX = "idx_history_updated_at";
/**
 * `(table_name, entity_id)`: a strict prefix of {@link HISTORY_TIME_INDEX},
 * so it answered nothing the other could not, and every recorded change paid
 * for a third btree. Dropped at boot where it exists.
 */
const REDUNDANT_ENTITY_INDEX = "idx_history_entity";

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

        // One index serves every per-row read and prune: its prefix is the
        // `(table_name, entity_id)` lookup. The time-only one the retention
        // sweep reads is built in the background — see `ensureHistoryIndexes`.
        await db.execute(sql.raw(`
            CREATE INDEX IF NOT EXISTS ${HISTORY_TIME_INDEX}
            ON rebase.entity_history(table_name, entity_id, updated_at DESC)
        `));

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

/**
 * Bring the history table's indexes to what its reads need, and say which one
 * is left to build in the background.
 *
 * - `idx_history_entity` is dropped: `idx_history_time` leads with the same two
 *   columns, so it served nothing the other does not, and cost a btree insert
 *   per recorded change. A `DROP INDEX` takes the table's `ACCESS EXCLUSIVE`
 *   lock for an instant, so it runs under the boot's lock budget — one second
 *   per attempt, a few attempts — and a table something holds the whole time
 *   keeps the index until the next boot. Only once `idx_history_time` is there
 *   and valid, so a per-row lookup never loses its index.
 * - `idx_history_updated_at`, which the retention sweep reads, is returned for
 *   `buildDeferredIndexes`: on a table that already holds years of history the
 *   build takes seconds to minutes, so it is built `CONCURRENTLY` after the boot,
 *   blocking no read or write. Nothing is returned when it is already valid.
 *
 * Never throws: an index that cannot be dropped or read about is logged, and
 * the next boot asks again.
 */
export async function ensureHistoryIndexes(db: NodePgDatabase, options: BootLockOptions = {}): Promise<DeferredIndexBuild[]> {
    let states: Map<string, boolean>;
    try {
        states = await readHistoryIndexStates(db);
    } catch (error) {
        logger.warn("⚠️ Could not read the row history table's indexes; leaving them as they are this boot.", { error });
        return [];
    }

    if (states.has(REDUNDANT_ENTITY_INDEX) && states.get(HISTORY_TIME_INDEX) === true) {
        await dropRedundantEntityIndex(db, options);
    }

    if (states.get(HISTORY_SWEEP_INDEX) === true) return [];
    return [{
        schema: "rebase",
        table: "entity_history",
        indexName: HISTORY_SWEEP_INDEX,
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${HISTORY_SWEEP_INDEX}" ON "rebase"."entity_history" (updated_at);`,
        invalid: states.get(HISTORY_SWEEP_INDEX) === false
    }];
}

/** Each history index that exists, and whether it is valid (a cancelled concurrent build leaves an invalid one). */
async function readHistoryIndexStates(db: NodePgDatabase): Promise<Map<string, boolean>> {
    const rows = sqlRows<{ name: string; valid: boolean }>(await db.execute(sql`
        SELECT c.relname AS name, i.indisvalid AS valid
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'rebase'
          AND c.relname IN (${REDUNDANT_ENTITY_INDEX}, ${HISTORY_TIME_INDEX}, ${HISTORY_SWEEP_INDEX})
    `));
    return new Map(rows.map(row => [row.name, row.valid === true]));
}

async function dropRedundantEntityIndex(db: NodePgDatabase, options: BootLockOptions): Promise<void> {
    const lock = resolveBootLockOptions(options);
    const deadline = Date.now() + (options.retryBudgetMs ?? BOOT_LOCK_RETRY_BUDGET_MS);
    for (let round = 1; ; round++) {
        try {
            await db.transaction(async tx => {
                await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${Math.max(1, Math.round(lock.lockTimeoutMs))}ms'`));
                await tx.execute(sql.raw(`DROP INDEX IF EXISTS rebase.${REDUNDANT_ENTITY_INDEX}`));
            });
            logger.info(`[history] Dropped rebase.${REDUNDANT_ENTITY_INDEX}: rebase.${HISTORY_TIME_INDEX} serves every read it did.`);
            return;
        } catch (error) {
            if (isLockTimeout(error) && round < lock.attempts && Date.now() < deadline) {
                await sleep(Math.min(lock.backoffMs(round), Math.max(0, deadline - Date.now())));
                continue;
            }
            logger.warn(
                `⚠️ rebase.${REDUNDANT_ENTITY_INDEX} was not dropped this boot` +
                (isLockTimeout(error) ? ": another session held rebase.entity_history for the whole lock budget." : ".") +
                " It only costs a little on each recorded change; the next boot tries again.",
                isLockTimeout(error) ? undefined : { error }
            );
            return;
        }
    }
}
