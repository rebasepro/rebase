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
 * trigger-based fallback provides the same guarantee:
 *
 *   AFTER INSERT/UPDATE/DELETE/TRUNCATE statement trigger  →  pg_notify('rebase_cdc', payload)
 *
 * once per statement, naming the changed rows by key in batches of about a
 * thousand — a 1M-row UPDATE is ~1,000 notifications, where a row trigger sent
 * a million into Postgres's shared notification queue, to every instance.
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

/**
 * Schema-qualified name of the row-level trigger function: one notification
 * per changed row. What every version before statement-level capture attached
 * everywhere, and still what a partitioned or foreign table gets — see
 * {@link levelForRelkind}.
 */
export const CDC_TRIGGER_FUNCTION = "rebase.rebase_cdc_notify";

/**
 * Schema-qualified name of the statement-level trigger function: one
 * notification per ~1,000 changed rows. See {@link buildCdcFunctionSql}.
 *
 * A function of its own rather than a new body for the row function, because
 * an instance of an older version replaces the row function's body every time
 * it boots: a statement trigger calling it would then run a row trigger's body,
 * for every write, until the next boot of this version.
 */
export const CDC_STATEMENT_FUNCTION = "rebase.rebase_cdc_notify_statement";

/** Name of the per-table row-level trigger (unqualified — triggers are namespaced by table). */
export const CDC_TRIGGER_NAME = "rebase_cdc_trigger";

/** How a table is instrumented: one notification per statement's ~1,000 rows, or one per row. */
export type CdcTriggerLevel = "statement" | "row";

/** One trigger this module creates, as `pg_trigger` describes it. */
interface CdcTriggerSpec {
    name: string;
    /** The function it calls. */
    fn: "row" | "statement";
    /** `CREATE TRIGGER` between the name and `ON`. */
    timing: string;
    /** `CREATE TRIGGER` between the table and `EXECUTE`. */
    forEach: string;
    /** `tgtype`: ROW (1), BEFORE (2), INSERT (4), DELETE (8), UPDATE (16), TRUNCATE (32), INSTEAD (64). */
    type: number;
    /** `tgnewtable` / `tgoldtable`: the transition tables it captures. */
    newTable: string | null;
    oldTable: string | null;
}

/** The transition tables the statement function reads. */
const NEW_ROWS = "rebase_cdc_new";
const OLD_ROWS = "rebase_cdc_old";

/**
 * The statement-level triggers a plain table gets. One per event, because
 * Postgres refuses transition tables on a trigger with more than one event.
 * The TRUNCATE one is new with them: a row trigger never fires on `TRUNCATE`,
 * so a truncated table used to be announced to nobody.
 */
export const CDC_STATEMENT_TRIGGERS: readonly CdcTriggerSpec[] = [
    { name: "rebase_cdc_insert", fn: "statement", timing: "AFTER INSERT", forEach: `REFERENCING NEW TABLE AS ${NEW_ROWS} FOR EACH STATEMENT`, type: 4, newTable: NEW_ROWS, oldTable: null },
    { name: "rebase_cdc_update", fn: "statement", timing: "AFTER UPDATE", forEach: `REFERENCING NEW TABLE AS ${NEW_ROWS} FOR EACH STATEMENT`, type: 16, newTable: NEW_ROWS, oldTable: null },
    { name: "rebase_cdc_delete", fn: "statement", timing: "AFTER DELETE", forEach: `REFERENCING OLD TABLE AS ${OLD_ROWS} FOR EACH STATEMENT`, type: 8, newTable: null, oldTable: OLD_ROWS },
    { name: "rebase_cdc_truncate", fn: "statement", timing: "AFTER TRUNCATE", forEach: "FOR EACH STATEMENT", type: 32, newTable: null, oldTable: null }
];

/**
 * The row-level trigger: ROW (1) + INSERT (4) + DELETE (8) + UPDATE (16), and
 * neither BEFORE (2), TRUNCATE (32) nor INSTEAD OF (64) — so AFTER.
 */
const CDC_ROW_TRIGGER: CdcTriggerSpec = {
    name: CDC_TRIGGER_NAME, fn: "row", timing: "AFTER INSERT OR UPDATE OR DELETE", forEach: "FOR EACH ROW",
    type: 1 + 4 + 8 + 16, newTable: null, oldTable: null
};

/** Every trigger name this module owns, whichever level a table is at. */
const ALL_TRIGGER_NAMES = [CDC_TRIGGER_NAME, ...CDC_STATEMENT_TRIGGERS.map((t) => t.name)];

const triggersFor = (level: CdcTriggerLevel): readonly CdcTriggerSpec[] =>
    level === "statement" ? CDC_STATEMENT_TRIGGERS : [CDC_ROW_TRIGGER];

/**
 * The level a table is instrumented at, by `pg_class.relkind`.
 *
 * A plain table gets statement triggers. A partitioned table keeps the row
 * trigger: Postgres clones a row trigger onto every partition, so a write made
 * straight to a partition is still captured, while a statement trigger on the
 * parent fires only for statements against the parent. A foreign table
 * cannot have transition tables at all.
 */
export const levelForRelkind = (relkind: string | null | undefined): CdcTriggerLevel =>
    relkind === "p" || relkind === "f" ? "row" : "statement";

/**
 * How long after a boot first converts a table from the row trigger, the
 * statement triggers still announce every change one row per notification.
 *
 * The triggers are the database's, and an instance of the previous version
 * still running beside this one — a rolling deploy, a rollback — reads the
 * same channel with a parser that knows one row per notification: given a
 * batch it sees no key, so its lists refetch but its single-row and
 * many-to-many subscribers hear nothing. While any such instance may be up,
 * the statement triggers speak its protocol; after this window they batch.
 * Every version that batches reads both. A boot of the older version re-attaches its row trigger (it
 * creates a missing one), and the next boot of this one converts it back and
 * re-opens the window, so a rollback is covered the same way.
 */
export const CDC_ROW_COMPAT_MS = 24 * 60 * 60 * 1000;

/**
 * pg_notify hard-caps payloads at 8000 bytes and *aborts the triggering
 * statement* if the limit is exceeded. The payload is an identity, so it fits
 * unless a key is enormous; one that does not is sent with no key at all (a
 * collection-wide invalidation) rather than breaking the write. 7900 leaves
 * headroom for the envelope.
 */
const MAX_NOTIFY_BYTES = 7900;

/**
 * Room left in a batch for the key that starts it: a chunk is cut by the
 * running length of its keys, so it can run over its budget by its first key.
 * A chunk that still overflows — a key longer than this — is sent one key per
 * notification.
 */
const CHUNK_SLACK_BYTES = 64;

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * SQL that (re)creates both CDC trigger functions. Safe to run repeatedly:
 * `CREATE OR REPLACE` updates in place without dropping dependent triggers —
 * which is also how a database instrumented by an older version gets these
 * bodies on its next boot, for every table at once, re-attached or not.
 *
 * Both functions emit `{ schema, table, op, ... }`, and the rows are named by
 * **identity, never the tuple**. Postgres puts no privilege on `LISTEN`: any
 * role that can connect can listen on this channel, whatever it may `SELECT`.
 * When `row` was `to_jsonb(NEW)`, a login with no grant on anything received
 * every changed row of every instrumented table — `password_hash` and
 * verification tokens from the auth table included — past RLS and column
 * grants. The consumer never read anything but the key: every subscriber
 * re-reads the row under its own scope.
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
 * `compatUntil` is the end of the window in which the statement function
 * still sends one row per notification — see {@link CDC_ROW_COMPAT_MS}. A
 * timestamp, or `-infinity` for none.
 */
export function buildCdcFunctionSql(options: { compatUntil?: string } = {}): string {
    return `CREATE SCHEMA IF NOT EXISTS rebase;\n\n${buildCdcRowFunctionSql()}\n\n${buildCdcStatementFunctionSql(options.compatUntil ?? "-infinity")}`;
}

/**
 * The row-level function: `{ schema, table, op, row }`, one per changed row.
 *
 * A trigger attached by `id` alone reads that one column straight off the
 * row. Reaching any other key goes through `to_jsonb` of the whole row, which
 * fetches every TOASTed column and serialises it: on a table with a rich-text
 * or JSON document per row, a write that only flipped `status` cost the
 * trigger 150–260 µs per row instead of ~5, to read a key. The payload is the
 * same text either way. A column renamed since the trigger was attached raises
 * `undefined_column` on that read, which falls through to the general path
 * rather than failing the write.
 */
function buildCdcRowFunctionSql(): string {
    return `
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

/** The line of the statement function that holds its compatibility window, and how to read it back. */
const COMPAT_DECLARATION = "compat_until CONSTANT timestamptz := ";
const COMPAT_PATTERN = `${COMPAT_DECLARATION}'([^']*)'`;

/**
 * The statement-level function: what a plain table's four triggers call.
 *
 * It reads the statement's transition table, so a 1M-row UPDATE is one call,
 * not a million, and announces the changed keys in batches:
 *
 *     { schema, table, op, cols: ["id"], keys: [1, 2, 3, …] }
 *
 * cut to stay under the 8000-byte NOTIFY limit — about a thousand integer ids
 * per notification, so ~1,000 notifications where the row trigger sent 1M.
 * With one column, a key is the value; with several, an array in `cols`
 * order. A statement that changed one row sends the row trigger's
 * `{ schema, table, op, row }`, so the common single-row write is announced
 * exactly as it always was, and a statement that changed none sends nothing.
 * `TRUNCATE` sends `{ schema, table, op: "TRUNCATE" }`.
 *
 * Until `compat_until`, every row is announced on its own in the row
 * trigger's shape — see {@link CDC_ROW_COMPAT_MS}.
 *
 * The `id` key — what provisioning attaches every collection keyed by `id`
 * with — is read by a query planned once per trigger. Any other key is read
 * by a query built per statement, after checking which of the requested
 * columns the table still has. Neither reads any other column, so no TOASTed
 * document is fetched to name its row.
 */
function buildCdcStatementFunctionSql(compatUntil: string): string {
    const channel = quoteLiteral(CDC_CHANNEL);
    // The batch as the id path builds it: `head` + `cols` + `keys`, and the
    // envelope around the keys counted out of the budget.
    const idEnvelope = `,"cols":["id"],"keys":[]}`;
    const chunked = (source: string, keyExpr: string) =>
        `SELECT string_agg(k, ',') AS keys
                   FROM (SELECT k, (sum(octet_length(k) + 1) OVER (ROWS UNBOUNDED PRECEDING) - 1) / budget AS c
                           FROM (SELECT ${keyExpr} AS k FROM ${source} t) s) s
                  GROUP BY c`;
    const unkeyed = `head || ',"row":{},"truncated":true}'`;
    const perRow = (source: string) =>
        `PERFORM pg_notify(${channel}, CASE WHEN octet_length(p) > ${MAX_NOTIFY_BYTES} THEN ${unkeyed} ELSE p END)
                       FROM (SELECT head || ',"row":' || json_build_object('id', t.id)::text || '}' AS p FROM ${source} t) s;`;
    const firstTwo = (source: string) =>
        `SELECT count(*), max(json_build_object('id', t.id)::text) INTO n, one FROM (SELECT id FROM ${source} LIMIT 2) t;`;
    const countTwo = (source: string) => `SELECT count(*) INTO n FROM (SELECT FROM ${source} LIMIT 2) s;`;
    return `
CREATE OR REPLACE FUNCTION ${CDC_STATEMENT_FUNCTION}() RETURNS trigger
LANGUAGE plpgsql AS $rebase_cdc$
DECLARE
    -- One row per notification until then: see CDC_ROW_COMPAT_MS in trigger-cdc.ts.
    ${COMPAT_DECLARATION}${quoteLiteral(compatUntil)};
    head    text;
    cols    text[];
    collist text;
    n       bigint;
    one     text;
    budget  bigint;
    chunks  text[];
    chunk   text;
    payload text;
BEGIN
    head := format('{"schema":%s,"table":%s,"op":%s', to_json(TG_TABLE_SCHEMA::text), to_json(TG_TABLE_NAME::text), to_json(TG_OP::text));
    IF TG_OP = 'TRUNCATE' THEN
        PERFORM pg_notify(${channel}, head || '}');
        RETURN NULL;
    END IF;

    IF TG_NARGS = 1 AND TG_ARGV[0] = 'id' THEN
        BEGIN
            -- None, one, or more (no further), and the one named as the row trigger names it.
            IF TG_OP = 'DELETE' THEN
                ${firstTwo(OLD_ROWS)}
            ELSE
                ${firstTwo(NEW_ROWS)}
            END IF;
            IF n = 0 THEN
                RETURN NULL;
            END IF;
            IF n = 1 THEN
                payload := head || ',"row":' || one || '}';
                -- A key too large to notify is sent as no key: never let CDC abort the write.
                PERFORM pg_notify(${channel}, CASE WHEN octet_length(payload) > ${MAX_NOTIFY_BYTES} THEN ${unkeyed} ELSE payload END);
                RETURN NULL;
            END IF;
            IF now() < compat_until THEN
                IF TG_OP = 'DELETE' THEN
                    ${perRow(OLD_ROWS)}
                ELSE
                    ${perRow(NEW_ROWS)}
                END IF;
                RETURN NULL;
            END IF;
            budget := greatest(${MAX_NOTIFY_BYTES} - octet_length(head) - ${idEnvelope.length} - ${CHUNK_SLACK_BYTES}, ${CHUNK_SLACK_BYTES});
            IF TG_OP = 'DELETE' THEN
                chunks := ARRAY(${chunked(OLD_ROWS, "to_json(t.id)::text")});
            ELSE
                chunks := ARRAY(${chunked(NEW_ROWS, "to_json(t.id)::text")});
            END IF;
            cols := ARRAY['id'];
        EXCEPTION WHEN undefined_column THEN
            -- \`id\` is gone since the trigger was attached: named below like any other key.
            cols := NULL;
        END;
    END IF;

    IF cols IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            ${countTwo(OLD_ROWS)}
        ELSE
            ${countTwo(NEW_ROWS)}
        END IF;
        IF n = 0 THEN
            RETURN NULL;
        END IF;
        cols := ARRAY(SELECT x.col FROM unnest(TG_ARGV) WITH ORDINALITY AS x(col, i)
                       WHERE EXISTS (SELECT FROM pg_attribute a
                                      WHERE a.attrelid = TG_RELID AND a.attname = x.col AND a.attnum > 0 AND NOT a.attisdropped)
                       ORDER BY x.i);
        IF cardinality(cols) = 0 THEN
            cols := ARRAY(SELECT a.attname::text FROM pg_index i
                            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                           WHERE i.indrelid = TG_RELID AND i.indisprimary
                           ORDER BY a.attnum);
        END IF;
        IF cardinality(cols) = 0 AND EXISTS (SELECT FROM pg_attribute a
                                              WHERE a.attrelid = TG_RELID AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped) THEN
            cols := ARRAY['id'];
        END IF;
        IF cardinality(cols) = 0 THEN
            -- Nothing names a row of this table: a change to all of it.
            PERFORM pg_notify(${channel}, head || ',"row":{}}');
            RETURN NULL;
        END IF;

        IF n = 1 OR now() < compat_until THEN
            EXECUTE format(
                'SELECT pg_notify(%L, CASE WHEN octet_length(p) > ${MAX_NOTIFY_BYTES} THEN %L ELSE p END)
                   FROM (SELECT %L || json_build_object(%s)::text || ''}'' AS p FROM %I t) s',
                ${channel}, ${unkeyed}, head || ',"row":',
                (SELECT string_agg(format('%L, t.%I', c, c), ', ') FROM unnest(cols) AS c),
                CASE TG_OP WHEN 'DELETE' THEN '${OLD_ROWS}' ELSE '${NEW_ROWS}' END);
            RETURN NULL;
        END IF;

        collist := (SELECT string_agg(format('t.%I', c), ', ') FROM unnest(cols) AS c);
        budget := greatest(${MAX_NOTIFY_BYTES} - octet_length(head) - octet_length(to_json(cols)::text) - 20 - ${CHUNK_SLACK_BYTES}, ${CHUNK_SLACK_BYTES});
        EXECUTE format(
            'SELECT ARRAY(SELECT string_agg(k, '','')
                            FROM (SELECT k, (sum(octet_length(k) + 1) OVER (ROWS UNBOUNDED PRECEDING) - 1) / %s AS c
                                    FROM (SELECT %s AS k FROM %I t) s) s
                           GROUP BY c)',
            budget,
            CASE WHEN cardinality(cols) = 1 THEN format('to_json(%s)::text', collist)
                 ELSE format('json_build_array(%s)::text', collist) END,
            CASE TG_OP WHEN 'DELETE' THEN '${OLD_ROWS}' ELSE '${NEW_ROWS}' END) INTO chunks;
    END IF;

    head := head || ',"cols":' || to_json(cols)::text || ',"keys":[';
    FOREACH chunk IN ARRAY chunks LOOP
        payload := head || chunk || ']}';
        IF octet_length(payload) <= ${MAX_NOTIFY_BYTES} THEN
            PERFORM pg_notify(${channel}, payload);
        ELSE
            -- A key long enough to overflow its batch: each of the batch's keys on its own.
            PERFORM pg_notify(${channel}, CASE WHEN octet_length(p) > ${MAX_NOTIFY_BYTES} THEN ${unkeyed} ELSE p END)
               FROM (SELECT head || k.value::text || ']}' AS p FROM json_array_elements(('[' || chunk || ']')::json) AS k) s;
        END IF;
    END LOOP;
    RETURN NULL;
END;
$rebase_cdc$;
`.trim();
}

/**
 * SQL that (re)attaches the CDC triggers to a single table, at `level`.
 * Every trigger this module owns is dropped first, whichever level it was
 * created at, so a table moves between levels — a row trigger left by an
 * older version becomes the statement triggers — in one transaction, with no
 * moment at which a write is announced by neither.
 *
 * `identityColumns` are what the payload names the changed rows by — see
 * {@link buildCdcFunctionSql}. Passed as trigger arguments, so one shared
 * function serves every table. Empty means "the primary key".
 */
export function buildCdcTriggerSql(
    schema: string,
    table: string,
    identityColumns: readonly string[] = [],
    level: CdcTriggerLevel = "statement"
): string {
    const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
    const drops = ALL_TRIGGER_NAMES.map((name) => `DROP TRIGGER IF EXISTS ${quoteIdent(name)} ON ${qualified};\n`).join("");
    return drops + buildCdcTriggerCreateSql(schema, table, identityColumns, level);
}

/**
 * `CREATE TRIGGER` alone, for a table that has no capture trigger yet.
 *
 * Not {@link buildCdcTriggerSql}: its `DROP TRIGGER IF EXISTS` takes an ACCESS
 * EXCLUSIVE lock on the table even when there is nothing to drop, while
 * `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE, which readers never wait for.
 */
const buildCdcTriggerCreateSql = (
    schema: string,
    table: string,
    identityColumns: readonly string[],
    level: CdcTriggerLevel
): string => {
    const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`;
    const args = [...new Set(identityColumns)].map(quoteLiteral).join(", ");
    return triggersFor(level)
        .map((spec) =>
            `CREATE TRIGGER ${quoteIdent(spec.name)} ${spec.timing} ON ${qualified} ${spec.forEach} ` +
            `EXECUTE FUNCTION ${spec.fn === "statement" ? CDC_STATEMENT_FUNCTION : CDC_TRIGGER_FUNCTION}(${args});`)
        .join("\n");
};

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

/** `to_regprocedure` of each function, as a SQL expression. */
const ROW_FUNCTION_OID = `to_regprocedure(${quoteLiteral(`${CDC_TRIGGER_FUNCTION}()`)})`;
const STATEMENT_FUNCTION_OID = `to_regprocedure(${quoteLiteral(`${CDC_STATEMENT_FUNCTION}()`)})`;
/** The installed statement function's `compat_until` literal, or NULL when it is not installed. */
const INSTALLED_COMPAT_SQL =
    `(SELECT substring(p.prosrc FROM ${quoteLiteral(COMPAT_PATTERN)}) FROM pg_proc p WHERE p.oid = ${STATEMENT_FUNCTION_OID})`;

/** The window end a `compat_until` literal names, in epoch ms; `-Infinity` for none or unreadable. */
const compatMs = (literal: unknown): number => {
    if (typeof literal !== "string" || literal === "" || literal === "-infinity") return -Infinity;
    const ms = Date.parse(literal);
    return Number.isFinite(ms) ? ms : -Infinity;
};

const compatLiteral = (ms: number): string => (Number.isFinite(ms) ? new Date(ms).toISOString() : "-infinity");

/**
 * What a boot compares the installed functions with, so one that changes
 * nothing leaves them alone: every boot used to run `CREATE OR REPLACE` on
 * both, rewriting their catalogue rows to the same text.
 *
 * `prosrc` is the body exactly as written between the dollar quotes, so the
 * comparison is of text. The statement function's is compared without its
 * `compat_until` line: the window is read on its own, and the code is
 * current whatever window it carries. The bodies are ASCII, so the
 * comparison holds in a database of any encoding.
 */
const DOLLAR_QUOTE = "$rebase_cdc$";
const functionBody = (sql: string): string =>
    sql.slice(sql.indexOf(DOLLAR_QUOTE) + DOLLAR_QUOTE.length, sql.lastIndexOf(DOLLAR_QUOTE));
const COMPAT_LINE_SQL_PATTERN = `${COMPAT_DECLARATION}'[^']*'`;
const withoutCompat = (body: string): string => body.replace(new RegExp(COMPAT_LINE_SQL_PATTERN), "");

/** Whether each installed function is the current one, as SQL columns of one row. */
const functionsCurrentSql = (): string =>
    `(SELECT p.prosrc = ${quoteLiteral(functionBody(buildCdcRowFunctionSql()))} ` +
    `FROM pg_proc p WHERE p.oid = ${ROW_FUNCTION_OID}) AS row_function_current, ` +
    `(SELECT regexp_replace(p.prosrc, ${quoteLiteral(COMPAT_LINE_SQL_PATTERN)}, '') = ` +
    `${quoteLiteral(withoutCompat(functionBody(buildCdcStatementFunctionSql("-infinity"))))} ` +
    `FROM pg_proc p WHERE p.oid = ${STATEMENT_FUNCTION_OID}) AS statement_code_current, ` +
    `${INSTALLED_COMPAT_SQL} AS compat_until`;

/** The installed functions, as {@link functionsCurrentSql} reads them. */
interface InstalledFunctions {
    rowCurrent: boolean;
    statementCodeCurrent: boolean;
    /** The statement function's `compat_until` literal, as written; `null` when it is not installed. */
    compatLiteral: string | null;
}

const readInstalledFunctions = (row: Record<string, unknown> | undefined): InstalledFunctions => ({
    rowCurrent: row?.row_function_current === true,
    statementCodeCurrent: row?.statement_code_current === true,
    compatLiteral: typeof row?.compat_until === "string" ? row.compat_until : null
});

/**
 * The function DDL this boot needs: none when both are already exactly what
 * it would write, `compatUntil` included.
 */
function functionSqlToRun(installed: InstalledFunctions | undefined, compatUntil: string, only?: { row: boolean; statement: boolean }): string | undefined {
    const sql: string[] = [];
    if ((only?.row ?? true) && !installed?.rowCurrent) sql.push(buildCdcRowFunctionSql());
    if ((only?.statement ?? true) && !(installed?.statementCodeCurrent && installed.compatLiteral === compatUntil)) {
        sql.push(buildCdcStatementFunctionSql(compatUntil));
    }
    return sql.length > 0 ? `CREATE SCHEMA IF NOT EXISTS rebase;\n\n${sql.join("\n\n")}` : undefined;
}

/**
 * Replace the already-installed trigger functions with the current bodies, and
 * install nothing where there is none.
 *
 * For a process that owns the schema but is not provisioning capture on this
 * boot — `REALTIME_CDC=off`, or no direct URL to listen on. The triggers an
 * earlier boot attached keep firing whether anything consumes them or not, so
 * a database instrumented by a version whose function put whole rows on the
 * channel kept doing so, for every login that cares to `LISTEN`, until capture
 * was switched back on. The statement function keeps its compatibility
 * window. Returns whether a function was there to replace.
 */
export async function refreshInstalledCdcFunction(run: RawSqlRunner): Promise<boolean> {
    const rows = await run(
        `SELECT ${ROW_FUNCTION_OID} IS NOT NULL AS installed, ` +
        `${STATEMENT_FUNCTION_OID} IS NOT NULL AS statement_installed, ` +
        functionsCurrentSql()
    );
    const row = rows[0];
    const rowInstalled = row?.installed === true;
    const statementInstalled = row?.statement_installed === true;
    if (!rowInstalled && !statementInstalled) return false;
    const installed = readInstalledFunctions(row);
    const sql = functionSqlToRun(installed, compatLiteral(compatMs(installed.compatLiteral)), { row: rowInstalled, statement: statementInstalled });
    if (sql) await run(sql);
    return true;
}

/**
 * The columns a table's trigger is attached with: its primary key, read from
 * the catalogue, then each requested column the table actually has — and the
 * table's `relkind`, which decides its level.
 *
 * The key is always included, because it is what the consumer falls back on
 * when a requested column was named wrong — a column guessed from a field name,
 * say — and a payload naming half a composite key would address the wrong row.
 * A column that does not exist is dropped here rather than left to be skipped
 * on every write. If the catalogue cannot be read, the request stands as given.
 */
async function resolveIdentityColumns(run: RawSqlRunner, ref: CdcTableRef): Promise<{ identity: string[]; relkind: string | null }> {
    const requested = ref.identityColumns ?? [];
    const qualified = `${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`;
    let columns: Array<{ name: string; primary: boolean }>;
    let relkind: string | null = null;
    try {
        const rows = await run(
            "SELECT a.attname AS name, coalesce(a.attnum = ANY (i.indkey), false) AS is_primary, c.relkind::text AS relkind " +
            "FROM pg_attribute a " +
            "JOIN pg_class c ON c.oid = a.attrelid " +
            "LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary " +
            `WHERE a.attrelid = to_regclass(${quoteLiteral(qualified)}) AND a.attnum > 0 AND NOT a.attisdropped ` +
            "ORDER BY a.attnum"
        );
        columns = rows.map((row) => ({ name: String(row.name), primary: row.is_primary === true }));
        relkind = typeof rows[0]?.relkind === "string" ? rows[0].relkind : null;
    } catch {
        return { identity: [...new Set(requested)], relkind: null };
    }
    return { identity: identityFrom(columns, requested), relkind };
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

/** One installed trigger with a name this module owns, as the catalogue has it. */
interface InstalledTrigger {
    name: string;
    /** Which of this module's functions it calls, if either. */
    fn: "row" | "statement" | "other";
    type: number;
    /** `tgenabled`: `O` is the default — fires on origin and local writes. */
    enabled: string;
    /** The arguments it was attached with, in order. */
    args: string[];
    /** A `WHEN` clause, an `UPDATE OF` column list or a constraint trigger: none of which this module creates. */
    qualified: boolean;
    newTable: string | null;
    oldTable: string | null;
}

/** One table's kind, columns and installed capture triggers, as the catalogue has them. */
interface CaptureState {
    /** `pg_class.relkind`, or `null` when the table does not exist. */
    relkind: string | null;
    /** In `attnum` order. Empty when the table does not exist. */
    columns: Array<{ name: string; primary: boolean }>;
    /** The installed triggers named like this module's, at either level. */
    triggers: InstalledTrigger[];
}

/** `tgargs` is each argument followed by a NUL byte; read as hex so no byte is lost to an encoding. */
const decodeTriggerArgs = (hex: string): string[] => {
    if (!hex) return [];
    const parts = Buffer.from(hex, "hex").toString("utf8").split("\0");
    parts.pop();
    return parts;
};

/**
 * Every listed table's kind, columns and capture triggers, and the installed
 * statement function's compatibility window, in one catalogue query.
 *
 * It replaced a key read per table followed by an unconditional `DROP TRIGGER;
 * CREATE TRIGGER` per table: 2N round trips, N commits and N ACCESS EXCLUSIVE
 * locks on every boot, measured holding a live `SELECT` behind the boot for
 * 4.4 s while a report read the table.
 */
async function readCaptureState(
    run: RawSqlRunner,
    refs: CdcTableRef[]
): Promise<{ tables: Map<string, CaptureState>; compatUntil: number; functions: InstalledFunctions }> {
    const targets = refs
        .map((ref) => `(${quoteLiteral(`${ref.schema}.${ref.table}`)}, to_regclass(${quoteLiteral(`${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`)}))`)
        .join(", ");
    const rows = await run(
        `WITH target(key, rel) AS (VALUES ${targets})
         SELECT t.key,
                (SELECT c.relkind::text FROM pg_class c WHERE c.oid = t.rel) AS relkind,
                (SELECT coalesce(json_agg(json_build_object('name', a.attname,
                                                            'primary', coalesce(a.attnum = ANY (i.indkey), false))
                                          ORDER BY a.attnum), '[]'::json)
                   FROM pg_attribute a
                   LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary
                  WHERE a.attrelid = t.rel AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
                (SELECT coalesce(json_agg(json_build_object(
                            'name', tr.tgname,
                            'fn', CASE WHEN tr.tgfoid = ${ROW_FUNCTION_OID} THEN 'row'
                                       WHEN tr.tgfoid = ${STATEMENT_FUNCTION_OID} THEN 'statement'
                                       ELSE 'other' END,
                            'type', tr.tgtype::int,
                            'enabled', tr.tgenabled::text,
                            'args', encode(tr.tgargs, 'hex'),
                            'qualified', tr.tgqual IS NOT NULL OR coalesce(array_length(tr.tgattr::int2[], 1), 0) > 0
                                         OR tr.tgconstraint <> 0,
                            'newTable', tr.tgnewtable,
                            'oldTable', tr.tgoldtable)), '[]'::json)
                   FROM pg_trigger tr
                  WHERE tr.tgrelid = t.rel AND tr.tgname IN (${ALL_TRIGGER_NAMES.map(quoteLiteral).join(", ")})) AS triggers,
                f.*
           FROM target t, (SELECT ${functionsCurrentSql()}) f`
    );
    const parseJson = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
    const tables = new Map<string, CaptureState>();
    let compatUntil = -Infinity;
    for (const row of rows) {
        const columns = parseJson<Array<{ name: string; primary: boolean }> | null>(row.columns) ?? [];
        const triggers = parseJson<Array<Record<string, unknown>> | null>(row.triggers) ?? [];
        compatUntil = Math.max(compatUntil, compatMs(row.compat_until));
        tables.set(String(row.key), {
            relkind: typeof row.relkind === "string" ? row.relkind : null,
            columns: columns.map((column) => ({ name: String(column.name), primary: column.primary === true })),
            triggers: triggers.map((trigger) => ({
                name: String(trigger.name),
                fn: trigger.fn === "row" || trigger.fn === "statement" ? trigger.fn : "other",
                type: Number(trigger.type),
                enabled: String(trigger.enabled),
                args: decodeTriggerArgs(typeof trigger.args === "string" ? trigger.args : ""),
                qualified: trigger.qualified === true,
                newTable: typeof trigger.newTable === "string" ? trigger.newTable : null,
                oldTable: typeof trigger.oldTable === "string" ? trigger.oldTable : null
            }))
        });
    }
    return { tables, compatUntil, functions: readInstalledFunctions(rows[0]) };
}

/** Whether `trigger` is exactly what {@link buildCdcTriggerSql} creates for `spec`. */
const matchesSpec = (trigger: InstalledTrigger, spec: CdcTriggerSpec, args: readonly string[]): boolean =>
    trigger.fn === spec.fn &&
    trigger.type === spec.type &&
    // A trigger someone disabled by hand is not current: re-creating it is
    // what every boot did before, and what turns capture back on.
    trigger.enabled === "O" &&
    !trigger.qualified &&
    trigger.newTable === spec.newTable &&
    trigger.oldTable === spec.oldTable &&
    trigger.args.length === args.length &&
    trigger.args.every((arg, i) => arg === args[i]);

/**
 * Whether the installed triggers are exactly the ones {@link buildCdcTriggerSql}
 * would create at `level` — each of them, and none of the other level's.
 */
const triggersAreCurrent = (installed: readonly InstalledTrigger[], identity: readonly string[], level: CdcTriggerLevel): boolean => {
    const args = [...new Set(identity)];
    const wanted = triggersFor(level);
    if (installed.length !== wanted.length) return false;
    return wanted.every((spec) => {
        const trigger = installed.find((t) => t.name === spec.name);
        return trigger !== undefined && matchesSpec(trigger, spec, args);
    });
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
 * Idempotently install the CDC trigger functions and per-table triggers.
 *
 * A plain table gets the statement-level triggers, a partitioned or foreign
 * one the row trigger ({@link levelForRelkind}). A table whose triggers are
 * already exactly the ones this would create — same function, same events,
 * enabled, same identity arguments — is left alone; one with a trigger
 * missing, disabled, attached with different arguments or at the other level
 * is (re-)attached, all of it in one transaction.
 *
 * Converting a table from a row trigger an older version attached opens the
 * statement function's compatibility window ({@link CDC_ROW_COMPAT_MS}): the
 * instances that attached it may still be listening.
 *
 * Runs as the owner (server) connection at bootstrap. A table that does not yet
 * exist in the database (schema drift) is skipped with a warning rather than
 * aborting the whole install, so one un-migrated collection cannot disable CDC
 * for the rest.
 */
export async function provisionTriggerCdc(
    run: RawSqlRunner,
    tables: CdcTableRef[],
    options: { now?: number } = {}
): Promise<ProvisionResult> {
    const now = options.now ?? Date.now();

    // One trigger set per managed table. A table listed more than once — a
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

    // What is already attached, read once. Triggers that are exactly the ones
    // this would create are left alone: the functions below are replaced in
    // place (`CREATE OR REPLACE` keeps their OIDs), so an attached trigger
    // picks up a new body without being re-created. If the read itself fails,
    // every table takes the old path — read its key, drop and re-create.
    let states: Map<string, CaptureState> | undefined;
    let installedCompat = -Infinity;
    let functions: InstalledFunctions | undefined;
    try {
        if (byTable.size > 0) {
            const read = await readCaptureState(run, [...byTable.values()]);
            states = read.tables;
            installedCompat = read.compatUntil;
            functions = read.functions;
        } else {
            states = new Map();
        }
    } catch (err) {
        logger.debug("[CDC] Could not read the installed triggers in one query; re-attaching each table", {
            detail: err instanceof Error ? err.message : String(err)
        });
    }

    // A row trigger on a table that is to get statement triggers was attached
    // by an older version, whose instances may still be listening. Unknown
    // when the read failed, so assumed.
    const known = states;
    const convertsFromRows = !known || [...byTable.keys()].some((key) => {
        const state = known.get(key);
        return state !== undefined && levelForRelkind(state.relkind) === "statement" &&
            state.triggers.some((trigger) => trigger.name === CDC_TRIGGER_NAME);
    });
    const compatUntil = convertsFromRows ? Math.max(installedCompat, now + CDC_ROW_COMPAT_MS) : installedCompat;

    // The shared trigger functions (once), unless they are already exactly these.
    const functionSql = functionSqlToRun(functions, compatLiteral(compatUntil));
    if (functionSql) await run(functionSql);

    let unchanged = 0;
    for (const [key, ref] of byTable) {
        try {
            const state = states?.get(key);
            if (state) {
                const identity = identityFrom(state.columns, ref.identityColumns ?? []);
                const level = levelForRelkind(state.relkind);
                if (triggersAreCurrent(state.triggers, identity, level)) {
                    installed.push(ref);
                    unchanged++;
                    continue;
                }
                await attachWithLockBudget(run, state.triggers.length > 0
                    ? buildCdcTriggerSql(ref.schema, ref.table, identity, level)
                    : buildCdcTriggerCreateSql(ref.schema, ref.table, identity, level));
            } else {
                const { identity, relkind } = await resolveIdentityColumns(run, ref);
                await attachWithLockBudget(run, buildCdcTriggerSql(ref.schema, ref.table, identity, levelForRelkind(relkind)));
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
        (skipped.length ? ` (${skipped.length} skipped)` : "") +
        (compatUntil > now ? `; one row per notification until ${compatLiteral(compatUntil)}` : "") + "."
    );

    return { installed, skipped };
}
