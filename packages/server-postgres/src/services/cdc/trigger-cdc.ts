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
 * statement* if the limit is exceeded. The payload is an identity, so it fits
 * unless a key is enormous; one that does not is sent with no key at all (a
 * collection-wide invalidation) rather than breaking the write. 7900 leaves
 * headroom for the envelope.
 */
const MAX_NOTIFY_BYTES = 7900;

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * SQL that (re)creates the generic CDC trigger function. Safe to run repeatedly:
 * `CREATE OR REPLACE` updates in place without dropping dependent triggers —
 * which is also how a database instrumented by an older version gets this body
 * on its next boot, for every table at once, re-attached or not.
 *
 * The function emits `{ schema, table, op, row }`, and `row` is an **identity,
 * never the tuple**. Postgres puts no privilege on `LISTEN`: any role that can
 * connect can listen on this channel, whatever it may `SELECT`. When `row` was
 * `to_jsonb(NEW)`, a login with no grant on anything received every changed row
 * of every instrumented table — `password_hash` and verification tokens from
 * the auth table included — past RLS and column grants. The consumer never
 * read anything but the key: every subscriber re-reads the row under its own
 * scope.
 *
 * The identity is, in order:
 *  - the columns the trigger was attached with (`TG_ARGV`) — the key the
 *    consumer addresses the row by, and for a junction table the two ids that
 *    name the child list it changed; see {@link buildCdcTriggerSql};
 *  - otherwise the table's primary key, read from the catalogue — a trigger
 *    attached with no columns, by an older boot or on a table no collection
 *    maps any more;
 *  - otherwise `id`, if the table has one, and else nothing: a change the
 *    consumer can only treat as collection-wide.
 */
export function buildCdcFunctionSql(): string {
    return `
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE OR REPLACE FUNCTION ${CDC_TRIGGER_FUNCTION}() RETURNS trigger
LANGUAGE plpgsql AS $rebase_cdc$
DECLARE
    rec     jsonb;
    ident   jsonb := '{}'::jsonb;
    col     text;
    payload text;
BEGIN
    -- The tuple is read here and never leaves this function: only the
    -- identity below is put on the channel.
    IF (TG_OP = 'DELETE') THEN
        rec := to_jsonb(OLD);
    ELSE
        rec := to_jsonb(NEW);
    END IF;

    FOR n IN 0 .. TG_NARGS - 1 LOOP
        col := TG_ARGV[n];
        IF rec ? col THEN
            ident := ident || jsonb_build_object(col, rec -> col);
        END IF;
    END LOOP;

    IF ident = '{}'::jsonb THEN
        SELECT coalesce(jsonb_object_agg(a.attname, rec -> a.attname), '{}'::jsonb) INTO ident
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = TG_RELID AND i.indisprimary;
    END IF;

    IF ident = '{}'::jsonb AND rec ? 'id' THEN
        ident := jsonb_build_object('id', rec -> 'id');
    END IF;

    payload := json_build_object(
        'schema', TG_TABLE_SCHEMA,
        'table',  TG_TABLE_NAME,
        'op',     TG_OP,
        'row',    ident
    )::text;

    -- Never let CDC abort the write: a key too large to notify is sent as no
    -- key, which the consumer treats as a change to the whole collection.
    IF (octet_length(payload) > ${MAX_NOTIFY_BYTES}) THEN
        payload := json_build_object(
            'schema',    TG_TABLE_SCHEMA,
            'table',     TG_TABLE_NAME,
            'op',        TG_OP,
            'row',       '{}'::jsonb,
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
 *
 * `identityColumns` are what the payload names the changed row by — see
 * {@link buildCdcFunctionSql}. Passed as trigger arguments, so one shared
 * function serves every table without a catalogue read per row. Empty means
 * "the primary key".
 */
export function buildCdcTriggerSql(schema: string, table: string, identityColumns: readonly string[] = []): string {
    const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
    const args = [...new Set(identityColumns)].map(quoteLiteral).join(", ");
    return (
        `DROP TRIGGER IF EXISTS ${quoteIdent(CDC_TRIGGER_NAME)} ON ${qualified};\n` +
        `CREATE TRIGGER ${quoteIdent(CDC_TRIGGER_NAME)} ` +
        `AFTER INSERT OR UPDATE OR DELETE ON ${qualified} ` +
        `FOR EACH ROW EXECUTE FUNCTION ${CDC_TRIGGER_FUNCTION}(${args});`
    );
}

export interface CdcTableRef {
    schema: string;
    table: string;
    /**
     * The columns a change to this table is announced by — the collection's
     * key columns, or a junction's two id columns. Absent means the primary
     * key. Nothing else ever leaves the trigger; see {@link buildCdcFunctionSql}.
     */
    identityColumns?: string[];
}

export interface ProvisionResult {
    /** Tables the trigger was successfully attached to. */
    installed: CdcTableRef[];
    /** Tables that could not be provisioned (e.g. not yet migrated), with the error. */
    skipped: Array<CdcTableRef & { reason: string }>;
}

/**
 * Replace an already-installed trigger function with the current body, and
 * install nothing where there is none.
 *
 * For a process that owns the schema but is not provisioning capture on this
 * boot — `REALTIME_CDC=off`, or no direct URL to listen on. The triggers an
 * earlier boot attached keep firing whether anything consumes them or not, so
 * a database instrumented by a version whose function put whole rows on the
 * channel kept doing so, for every login that cares to `LISTEN`, until capture
 * was switched back on. Returns whether a function was there to replace.
 */
export async function refreshInstalledCdcFunction(run: RawSqlRunner): Promise<boolean> {
    const rows = await run(`SELECT to_regprocedure(${quoteLiteral(`${CDC_TRIGGER_FUNCTION}()`)}) IS NOT NULL AS installed`);
    if (rows[0]?.installed !== true) return false;
    await run(buildCdcFunctionSql());
    return true;
}

/**
 * The columns a table's trigger is attached with: its primary key, read from
 * the catalogue, then each requested column the table actually has.
 *
 * The key is always included, because it is what the consumer falls back on
 * when a requested column was named wrong — a column guessed from a field name,
 * say — and a payload naming half a composite key would address the wrong row.
 * A column that does not exist is dropped here rather than left to be skipped
 * on every write. If the catalogue cannot be read, the request stands as given.
 */
async function resolveIdentityColumns(run: RawSqlRunner, ref: CdcTableRef): Promise<string[]> {
    const requested = ref.identityColumns ?? [];
    const qualified = `${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`;
    let columns: Array<{ name: string; primary: boolean }>;
    try {
        const rows = await run(
            "SELECT a.attname AS name, coalesce(a.attnum = ANY (i.indkey), false) AS is_primary " +
            "FROM pg_attribute a " +
            "LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary " +
            `WHERE a.attrelid = to_regclass(${quoteLiteral(qualified)}) AND a.attnum > 0 AND NOT a.attisdropped ` +
            "ORDER BY a.attnum"
        );
        columns = rows.map((row) => ({ name: String(row.name), primary: row.is_primary === true }));
    } catch {
        return [...new Set(requested)];
    }
    if (columns.length === 0) return [...new Set(requested)];
    const existing = new Set(columns.map((column) => column.name));
    return [...new Set([
        ...columns.filter((column) => column.primary).map((column) => column.name),
        ...requested.filter((column) => existing.has(column))
    ])];
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

    // 2. One trigger per managed table. A table listed more than once — a
    // junction, once per direction of its relation — is attached once, with
    // every identity column any listing asked for.
    const byTable = new Map<string, CdcTableRef>();
    for (const ref of tables) {
        const key = `${ref.schema}.${ref.table}`;
        const existing = byTable.get(key);
        if (!existing) {
            byTable.set(key, { ...ref, identityColumns: [...(ref.identityColumns ?? [])] });
        } else {
            existing.identityColumns = [...new Set([...(existing.identityColumns ?? []), ...(ref.identityColumns ?? [])])];
        }
    }
    const installed: CdcTableRef[] = [];
    const skipped: ProvisionResult["skipped"] = [];

    for (const [key, ref] of byTable) {
        try {
            const identity = await resolveIdentityColumns(run, ref);
            await run(buildCdcTriggerSql(ref.schema, ref.table, identity));
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
