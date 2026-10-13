import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import { REBASE_USER_ROLE, revokeInternalTableSql, sqlRows } from "@rebasepro/common";
import type { DeferredIndexBuild } from "../schema/plan/diff-plan";
import { BOOT_LOCK_RETRY_BUDGET_MS, isLockTimeout, resolveBootLockOptions, sleep, type BootLockOptions } from "../schema/boot-ddl";

/** How a history entry gets written from inside the write it records. */
export const RECORD_HISTORY_FUNCTION = "rebase.record_history";
/** The door for an entry that names its `format` — see {@link HistoryTableState.entryFormat}. */
const RECORD_HISTORY_SIGNATURE = `${RECORD_HISTORY_FUNCTION}(text, text, text, text[], jsonb, jsonb, text, smallint)`;
/**
 * The door before entries had a `format`. Still created where the column could
 * not be added, and left in place everywhere: an instance of the previous
 * version, mid rolling deploy, still calls it, and its entries are the whole
 * row — which is what the column's default, `1`, says.
 */
const LEGACY_RECORD_HISTORY_SIGNATURE = `${RECORD_HISTORY_FUNCTION}(text, text, text, text[], jsonb, jsonb, text)`;

/** What {@link ensureHistoryTableExists} left in place, for `HistoryService`. */
export interface HistoryTableState {
    /**
     * {@link RECORD_HISTORY_FUNCTION} exists, so an entry inside a write goes
     * on that write's transaction. Without it, entries go through the pool and
     * commit on their own.
     */
    inTransaction: boolean;
    /**
     * What new entries are stored as. `2` — an update keeps the previous values
     * of its changed fields only (`EntityHistoryEntry.format`) — once the table
     * has its `format` column; `1`, the whole previous row, where the column
     * could not be added this boot.
     */
    entryFormat: 1 | 2;
}

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
 * Resolves to what the history service may rely on: see {@link HistoryTableState}.
 */
export async function ensureHistoryTableExists(db: NodePgDatabase, options: BootLockOptions = {}): Promise<HistoryTableState> {
    logger.debug("🔍 Checking row history table...");
    let entryFormat: 1 | 2;

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
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                format SMALLINT NOT NULL DEFAULT 1
            )
        `);
        // A table from before 0.24 gains the column once. A constant default
        // makes it a catalogue change, but `ALTER TABLE` still needs the
        // table's lock for an instant, so it waits within the boot's budget —
        // and a table held throughout keeps writing whole rows until the next
        // boot adds it.
        entryFormat = await formatColumnExists(db) || await underLockBudget(db, ADD_FORMAT_COLUMN, options) ? 2 : 1;
        if (entryFormat === 1) {
            logger.warn(
                "⚠️ rebase.entity_history could not gain its `format` column this boot: another session held the " +
                "table for the whole lock budget. History entries keep storing the whole previous row until a boot adds it."
            );
        }

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
        return { inTransaction: false, entryFormat: 1 };
    }

    // The entry has to commit with the row it describes, so it is written on
    // the write's transaction — which runs as the request role, revoked from
    // this table just above. A `SECURITY DEFINER` function is the one door:
    // it inserts exactly an entry, with the owner's rights, for that single
    // statement, and only the request role may call it. The same reasoning,
    // at more length, is on `rebase.enqueue_job` in the job store.
    const signature = entryFormat === 2 ? RECORD_HISTORY_SIGNATURE : LEGACY_RECORD_HISTORY_SIGNATURE;
    try {
        await db.execute(sql.raw(entryFormat === 2
            ? `
            CREATE OR REPLACE FUNCTION ${RECORD_HISTORY_FUNCTION}(
                p_table_name text, p_entity_id text, p_action text, p_changed_fields text[],
                p_values jsonb, p_previous_values jsonb, p_updated_by text, p_format smallint
            ) RETURNS void
            LANGUAGE sql
            SECURITY DEFINER
            SET search_path = pg_catalog, pg_temp
            AS $fn$
                INSERT INTO rebase.entity_history
                    (table_name, entity_id, action, changed_fields, "values", previous_values, updated_by, format)
                VALUES (p_table_name, p_entity_id, p_action, p_changed_fields, p_values, p_previous_values, p_updated_by, p_format)
            $fn$
        `
            : `
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
        await db.execute(sql.raw(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`));
        await db.execute(sql.raw(`
            DO $grant$ BEGIN
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}') THEN
                    GRANT EXECUTE ON FUNCTION ${signature} TO ${REBASE_USER_ROLE};
                END IF;
            END $grant$
        `));
        return { inTransaction: true, entryFormat };
    } catch (error) {
        logger.warn(
            `⚠️ ${RECORD_HISTORY_FUNCTION} could not be created, so a history entry commits on its own: ` +
            "it survives a write that rolls back.",
            { error }
        );
        return { inTransaction: false, entryFormat };
    }
}

/**
 * What an earlier boot left in place, read without changing anything — for a
 * driver opened without provisioning. Entries go on the write's transaction
 * when the function for the table's entry format is there, and the format is
 * `2` when the table has its `format` column.
 */
export async function readHistoryTableState(db: NodePgDatabase): Promise<HistoryTableState> {
    const entryFormat: 1 | 2 = await formatColumnExists(db) ? 2 : 1;
    const signature = entryFormat === 2 ? RECORD_HISTORY_SIGNATURE : LEGACY_RECORD_HISTORY_SIGNATURE;
    const rows = sqlRows<{ present: boolean }>(await db.execute(sql`
        SELECT to_regprocedure(${signature}) IS NOT NULL AS present
    `));
    return { inTransaction: rows[0]?.present === true, entryFormat };
}

const ADD_FORMAT_COLUMN = "ALTER TABLE rebase.entity_history ADD COLUMN IF NOT EXISTS format SMALLINT NOT NULL DEFAULT 1";

/** Whether `rebase.entity_history` has its `format` column — a catalogue read, no lock. */
async function formatColumnExists(db: NodePgDatabase): Promise<boolean> {
    const rows = sqlRows<{ present: boolean }>(await db.execute(sql`
        SELECT EXISTS (
            SELECT 1 FROM pg_attribute
            WHERE attrelid = to_regclass('rebase.entity_history') AND attname = 'format' AND NOT attisdropped
        ) AS present
    `));
    return rows[0]?.present === true;
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
        if (await underLockBudget(db, `DROP INDEX IF EXISTS rebase.${REDUNDANT_ENTITY_INDEX}`, options)) {
            logger.info(`[history] Dropped rebase.${REDUNDANT_ENTITY_INDEX}: rebase.${HISTORY_TIME_INDEX} serves every read it did.`);
        } else {
            logger.warn(
                `⚠️ rebase.${REDUNDANT_ENTITY_INDEX} was not dropped this boot: another session held rebase.entity_history ` +
                "for the whole lock budget. It only costs a little on each recorded change; the next boot tries again."
            );
        }
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

/**
 * Run one DDL statement that needs the history table's lock, waiting for it at
 * most `lockTimeoutMs` per attempt within the boot's retry budget — so live
 * queries on the table never queue behind the boot for longer than that.
 * `true` when it ran; `false` when something held the table throughout.
 * Any other failure is thrown.
 */
async function underLockBudget(db: NodePgDatabase, statement: string, options: BootLockOptions): Promise<boolean> {
    const lock = resolveBootLockOptions(options);
    const deadline = Date.now() + (options.retryBudgetMs ?? BOOT_LOCK_RETRY_BUDGET_MS);
    for (let round = 1; ; round++) {
        try {
            await db.transaction(async tx => {
                await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${Math.max(1, Math.round(lock.lockTimeoutMs))}ms'`));
                await tx.execute(sql.raw(statement));
            });
            return true;
        } catch (error) {
            if (!isLockTimeout(error)) throw error;
            if (round >= lock.attempts || Date.now() >= deadline) return false;
            await sleep(Math.min(lock.backoffMs(round), Math.max(0, deadline - Date.now())));
        }
    }
}
