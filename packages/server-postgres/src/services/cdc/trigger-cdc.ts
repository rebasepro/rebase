import { logger } from "@rebasepro/server";
import type { RawSqlRunner } from "../../security/rls-enforcement";

/**
 * Trigger-based Change Data Capture (CDC).
 *
 * The preferred CDC source is the write-ahead log (logical replication), which
 * — like Supabase Realtime — sees *every* commit regardless of how it was made.
 * When logical replication is unavailable (managed Postgres without
 * `wal_level=logical`, no replication privilege, no `REPLICA IDENTITY`), this
 * trigger-based fallback provides the same guarantee at the row level:
 *
 *   AFTER INSERT/UPDATE/DELETE trigger  →  pg_notify('rebase_cdc', payload)
 *
 * A single dedicated LISTEN client per backend instance consumes the channel
 * (see {@link CdcListener}) and feeds the change into the existing
 * `RealtimeService.notifyUpdate` pipeline, so subscribers see the change no
 * matter what wrote it — psql, a cron in another service, raw Drizzle/SQL, or
 * the Studio SQL editor.
 *
 * Provisioning runs from the framework's own bootstrap as the owner (server)
 * context, alongside the RLS role provisioning. It is idempotent.
 */

/** Postgres NOTIFY channel carrying database-level change events. */
export const CDC_CHANNEL = "rebase_cdc";

/** Schema-qualified name of the generic trigger function. */
export const CDC_TRIGGER_FUNCTION = "rebase.rebase_cdc_notify";

/** Name of the per-table trigger (unqualified — triggers are namespaced by table). */
export const CDC_TRIGGER_NAME = "rebase_cdc_trigger";

/**
 * pg_notify hard-caps payloads at 8000 bytes and *aborts the triggering
 * statement* if the limit is exceeded. We stay comfortably under it and, for
 * wide rows, fall back to an identity-only payload so CDC can never break a
 * write. 7900 leaves headroom for the JSON envelope keys.
 */
const MAX_NOTIFY_BYTES = 7900;

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * SQL that (re)creates the generic CDC trigger function. Safe to run repeatedly:
 * `CREATE OR REPLACE` updates in place without dropping dependent triggers.
 *
 * The function emits `{ schema, table, op, row }`. The `row` is the full changed
 * tuple (NEW for insert/update, OLD for delete) so the consumer can route it to
 * a collection and extract the primary key. It is *not* trusted for delivery:
 * the consumer marks the row invalidated and each subscriber re-reads it under
 * its own RLS context, so a subscriber never receives a row it cannot read.
 */
export function buildCdcFunctionSql(): string {
    return `
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE OR REPLACE FUNCTION ${CDC_TRIGGER_FUNCTION}() RETURNS trigger
LANGUAGE plpgsql AS $rebase_cdc$
DECLARE
    rec     jsonb;
    payload text;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        rec := to_jsonb(OLD);
    ELSE
        rec := to_jsonb(NEW);
    END IF;

    payload := json_build_object(
        'schema', TG_TABLE_SCHEMA,
        'table',  TG_TABLE_NAME,
        'op',     TG_OP,
        'row',    rec
    )::text;

    -- Never let CDC abort the write: if the full row overflows the pg_notify
    -- 8000-byte cap, emit an identity-only payload the consumer can still route
    -- (and refetch the authoritative row from).
    IF (octet_length(payload) > ${MAX_NOTIFY_BYTES}) THEN
        payload := json_build_object(
            'schema',    TG_TABLE_SCHEMA,
            'table',     TG_TABLE_NAME,
            'op',        TG_OP,
            'row',       CASE WHEN rec ? 'id' THEN jsonb_build_object('id', rec->'id') ELSE '{}'::jsonb END,
            'truncated', true
        )::text;
    END IF;

    PERFORM pg_notify(${quoteLiteral(CDC_CHANNEL)}, payload);
    RETURN NULL;
END;
$rebase_cdc$;
`.trim();
}

/**
 * SQL that (re)attaches the CDC trigger to a single table. `DROP ... IF EXISTS`
 * before `CREATE` keeps it idempotent and picks up any function signature change.
 */
export function buildCdcTriggerSql(schema: string, table: string): string {
    const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
    return (
        `DROP TRIGGER IF EXISTS ${quoteIdent(CDC_TRIGGER_NAME)} ON ${qualified};\n` +
        `CREATE TRIGGER ${quoteIdent(CDC_TRIGGER_NAME)} ` +
        `AFTER INSERT OR UPDATE OR DELETE ON ${qualified} ` +
        `FOR EACH ROW EXECUTE FUNCTION ${CDC_TRIGGER_FUNCTION}();`
    );
}

export interface CdcTableRef {
    schema: string;
    table: string;
}

export interface ProvisionResult {
    /** Tables the trigger was successfully attached to. */
    installed: CdcTableRef[];
    /** Tables that could not be provisioned (e.g. not yet migrated), with the error. */
    skipped: Array<CdcTableRef & { reason: string }>;
}

/**
 * Idempotently install the CDC trigger function and per-table triggers.
 *
 * Runs as the owner (server) connection at bootstrap. A table that does not yet
 * exist in the database (schema drift) is skipped with a warning rather than
 * aborting the whole install, so one un-migrated collection cannot disable CDC
 * for the rest.
 */
export async function provisionTriggerCdc(
    run: RawSqlRunner,
    tables: CdcTableRef[]
): Promise<ProvisionResult> {
    // 1. The shared trigger function (once).
    await run(buildCdcFunctionSql());

    // 2. One trigger per managed table. De-duplicate identical refs.
    const seen = new Set<string>();
    const installed: CdcTableRef[] = [];
    const skipped: ProvisionResult["skipped"] = [];

    for (const ref of tables) {
        const key = `${ref.schema}.${ref.table}`;
        if (seen.has(key)) continue;
        seen.add(key);

        try {
            await run(buildCdcTriggerSql(ref.schema, ref.table));
            installed.push(ref);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            skipped.push({ ...ref, reason });
            logger.warn(
                `⚠️ [CDC] Could not attach change-capture trigger to "${key}" — ` +
                `is the table migrated? Writes to it won't emit database-level events.`,
                { detail: reason }
            );
        }
    }

    // Wiring detail. The single `Realtime source = …` line in the
    // bootstrapper is the fact a developer acts on; how many triggers it
    // took is for a diagnosis, and the skipped-table warning above still
    // fires on its own.
    logger.debug(
        `📡 [CDC] Trigger-based change capture provisioned on ${installed.length} table(s)` +
        (skipped.length ? ` (${skipped.length} skipped)` : "") + "."
    );

    return { installed, skipped };
}
