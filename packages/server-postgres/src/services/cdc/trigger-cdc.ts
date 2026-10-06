import { logger } from "@rebasepro/server";
import type { RawSqlRunner } from "../../security/rls-enforcement";
import { BOOT_LOCK_ATTEMPTS, BOOT_LOCK_TIMEOUT_MS, isLockTimeout, sleep } from "../../schema/boot-ddl";

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
 *
 * A trigger attached by `id` alone — what provisioning gives every collection
 * keyed by `id` — reads that one column straight off the row. Reaching any
 * other key goes through `to_jsonb` of the whole row, which fetches every
 * TOASTed column and serialises it: on a table with a rich-text or JSON
 * document per row, a write that only flipped `status` cost the trigger
 * 150–260 µs per row instead of ~5, to read a key. The payload is the same
 * text either way. A column renamed since the trigger was attached raises
 * `undefined_column` on that read, which falls through to the general path
 * rather than failing the write.
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
    -- The common key, read on its own: no other column is fetched.
    IF TG_NARGS = 1 AND TG_ARGV[0] = 'id' THEN
        BEGIN
            IF (TG_OP = 'DELETE') THEN
                ident := jsonb_build_object('id', OLD.id);
            ELSE
                ident := jsonb_build_object('id', NEW.id);
            END IF;
        EXCEPTION WHEN undefined_column THEN
            ident := '{}'::jsonb;
        END;
    END IF;

    IF ident = '{}'::jsonb THEN
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

/**
 * `CREATE TRIGGER` alone, for a table that has no capture trigger yet.
 *
 * Not {@link buildCdcTriggerSql}: its `DROP TRIGGER IF EXISTS` takes an ACCESS
 * EXCLUSIVE lock on the table even when there is nothing to drop, while
 * `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE, which readers never wait for.
 */
const buildCdcTriggerCreateSql = (schema: string, table: string, identityColumns: readonly string[]): string => {
    const sql = buildCdcTriggerSql(schema, table, identityColumns);
    return sql.slice(sql.indexOf("\n") + 1);
};

/**
 * `tgtype` of the trigger {@link buildCdcTriggerSql} creates: ROW (1) +
 * INSERT (4) + DELETE (8) + UPDATE (16), and neither BEFORE (2), TRUNCATE (32)
 * nor INSTEAD OF (64) — so AFTER.
 */
const CDC_TRIGGER_TYPE = 1 + 4 + 8 + 16;

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
    return identityFrom(columns, requested);
}

/** {@link resolveIdentityColumns}' rule, over columns already read. */
function identityFrom(columns: Array<{ name: string; primary: boolean }>, requested: readonly string[]): string[] {
    if (columns.length === 0) return [...new Set(requested)];
    const existing = new Set(columns.map((column) => column.name));
    return [...new Set([
        ...columns.filter((column) => column.primary).map((column) => column.name),
        ...requested.filter((column) => existing.has(column))
    ])];
}

/** One table's columns and installed capture trigger, as the catalogue has them. */
interface CaptureState {
    /** In `attnum` order. Empty when the table does not exist. */
    columns: Array<{ name: string; primary: boolean }>;
    /** The installed `rebase_cdc_trigger`, or `null` when there is none. */
    trigger: {
        /** Whether it calls {@link CDC_TRIGGER_FUNCTION}. */
        callsFunction: boolean;
        type: number;
        /** `tgenabled`: `O` is the default — fires on origin and local writes. */
        enabled: string;
        /** The arguments it was attached with, in order. */
        args: string[];
        /** A `WHEN` clause, an `UPDATE OF` column list or a constraint trigger: none of which this module creates. */
        qualified: boolean;
    } | null;
}

/** `tgargs` is each argument followed by a NUL byte; read as hex so no byte is lost to an encoding. */
const decodeTriggerArgs = (hex: string): string[] => {
    if (!hex) return [];
    const parts = Buffer.from(hex, "hex").toString("utf8").split("\0");
    parts.pop();
    return parts;
};

/**
 * Every listed table's columns and capture trigger, in one catalogue query.
 *
 * It replaced a key read per table followed by an unconditional `DROP TRIGGER;
 * CREATE TRIGGER` per table: 2N round trips, N commits and N ACCESS EXCLUSIVE
 * locks on every boot, measured holding a live `SELECT` behind the boot for
 * 4.4 s while a report read the table.
 */
async function readCaptureState(run: RawSqlRunner, refs: CdcTableRef[]): Promise<Map<string, CaptureState>> {
    const targets = refs
        .map((ref) => `(${quoteLiteral(`${ref.schema}.${ref.table}`)}, to_regclass(${quoteLiteral(`${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`)}))`)
        .join(", ");
    const rows = await run(
        `WITH target(key, rel) AS (VALUES ${targets})
         SELECT t.key,
                (SELECT coalesce(json_agg(json_build_object('name', a.attname,
                                                            'primary', coalesce(a.attnum = ANY (i.indkey), false))
                                          ORDER BY a.attnum), '[]'::json)
                   FROM pg_attribute a
                   LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary
                  WHERE a.attrelid = t.rel AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
                (SELECT json_build_object(
                            'callsFunction', tr.tgfoid = to_regprocedure(${quoteLiteral(`${CDC_TRIGGER_FUNCTION}()`)}),
                            'type', tr.tgtype::int,
                            'enabled', tr.tgenabled::text,
                            'args', encode(tr.tgargs, 'hex'),
                            'qualified', tr.tgqual IS NOT NULL OR coalesce(array_length(tr.tgattr::int2[], 1), 0) > 0
                                         OR tr.tgconstraint <> 0)
                   FROM pg_trigger tr
                  WHERE tr.tgrelid = t.rel AND tr.tgname = ${quoteLiteral(CDC_TRIGGER_NAME)}) AS trigger
           FROM target t`
    );
    const parseJson = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
    const states = new Map<string, CaptureState>();
    for (const row of rows) {
        const columns = parseJson<Array<{ name: string; primary: boolean }> | null>(row.columns) ?? [];
        const trigger = parseJson<{ callsFunction: boolean | null; type: number; enabled: string; args: string; qualified: boolean } | null>(row.trigger);
        states.set(String(row.key), {
            columns: columns.map((column) => ({ name: String(column.name), primary: column.primary === true })),
            trigger: trigger
                ? {
                    callsFunction: trigger.callsFunction === true,
                    type: Number(trigger.type),
                    enabled: String(trigger.enabled),
                    args: decodeTriggerArgs(trigger.args ?? ""),
                    qualified: trigger.qualified === true
                }
                : null
        });
    }
    return states;
}

/** Whether the installed trigger is exactly the one {@link buildCdcTriggerSql} would create. */
const triggerIsCurrent = (trigger: CaptureState["trigger"], identity: readonly string[]): boolean => {
    if (!trigger) return false;
    const args = [...new Set(identity)];
    return trigger.callsFunction &&
        trigger.type === CDC_TRIGGER_TYPE &&
        // A trigger someone disabled by hand is not current: re-creating it is
        // what every boot did before, and what turns capture back on.
        trigger.enabled === "O" &&
        !trigger.qualified &&
        trigger.args.length === args.length &&
        trigger.args.every((arg, i) => arg === args[i]);
};

/**
 * Run one table's trigger DDL with a lock budget, retrying a lock timeout.
 *
 * `lock_timeout` because a `DROP TRIGGER` waits for ACCESS EXCLUSIVE, and every
 * live query on the table queues behind a waiting lock — see `schema/boot-ddl`.
 * A table still contended after the last attempt is reported by the caller like
 * any other table it could not instrument; its existing trigger, if any, is
 * untouched and keeps firing.
 */
async function attachWithLockBudget(run: RawSqlRunner, sql: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await run(`SET LOCAL lock_timeout = '${BOOT_LOCK_TIMEOUT_MS}ms';\n${sql}`);
            return;
        } catch (err) {
            if (!isLockTimeout(err) || attempt >= BOOT_LOCK_ATTEMPTS) throw err;
            await sleep(500 * attempt * (1 + Math.random()));
        }
    }
}

/**
 * Idempotently install the CDC trigger function and per-table triggers.
 *
 * A table whose trigger is already exactly the one this would create —
 * same function, AFTER INSERT/UPDATE/DELETE FOR EACH ROW, enabled, same
 * identity arguments — is left alone; one that is missing, disabled or
 * attached with different arguments is (re-)attached.
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

    // What is already attached, read once. A trigger that is exactly the one
    // this would create is left alone: the function above is replaced in place
    // (`CREATE OR REPLACE` keeps its OID), so an attached trigger picks up a new
    // body without being re-created. If the read itself fails, every table
    // takes the old path — read its key, drop and re-create.
    let states: Map<string, CaptureState> | undefined;
    try {
        states = byTable.size > 0 ? await readCaptureState(run, [...byTable.values()]) : new Map();
    } catch (err) {
        logger.debug("[CDC] Could not read the installed triggers in one query; re-attaching each table", {
            detail: err instanceof Error ? err.message : String(err)
        });
    }
    let unchanged = 0;

    for (const [key, ref] of byTable) {
        try {
            const state = states?.get(key);
            if (state) {
                const identity = identityFrom(state.columns, ref.identityColumns ?? []);
                if (triggerIsCurrent(state.trigger, identity)) {
                    installed.push(ref);
                    unchanged++;
                    continue;
                }
                await attachWithLockBudget(run, state.trigger
                    ? buildCdcTriggerSql(ref.schema, ref.table, identity)
                    : buildCdcTriggerCreateSql(ref.schema, ref.table, identity));
            } else {
                const identity = await resolveIdentityColumns(run, ref);
                await attachWithLockBudget(run, buildCdcTriggerSql(ref.schema, ref.table, identity));
            }
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
        (unchanged ? ` (${unchanged} already current)` : "") +
        (skipped.length ? ` (${skipped.length} skipped)` : "") + "."
    );

    return { installed, skipped };
}
