import { Client, type Connection, type Pool, type PoolClient, type Submittable } from "pg";
import type { SqlScriptColumn, SqlScriptNotice, SqlScriptResult, SqlScriptTable } from "@rebasepro/types";
import { logger } from "@rebasepro/server";

/**
 * Running a SQL script a person wrote — the Studio console — and saying what
 * came back, column by column.
 *
 * The console used to receive bare rows and guess, from the query's text, which
 * table a cell belonged to and which column held its key. The guess wrote
 * `UPDATE authors SET name = … WHERE id = <the post's id>` for a cell of
 * `SELECT p.id, a.name FROM posts p JOIN authors a …`, and `UPDATE users SET
 * name = …` for `lower(email) AS name`. The database knows the answer: every
 * column of a result's row description carries the table and column it was
 * read from, or zero when it was computed. This reads it off the wire.
 *
 * Values come back as the text the database wrote, never parsed. Parsed, a
 * `text[]` read as a JavaScript array and went back as JSON — a malformed array
 * literal; a `bytea` as a serialized Buffer; a `timestamp` as a Date shifted by
 * the server's timezone; a `numeric` as a float. Text is what the database
 * reads back exactly.
 */

/** The parts of a `RowDescription` field this reads. */
interface WireField {
    name: string;
    /** The OID of the table the column was read from; 0 when it was computed. */
    tableID: number;
    /** Its attribute number in that table; 0 when it was computed. */
    columnID: number;
    dataTypeID: number;
}

/** One statement of the script, as it came back. */
export interface StatementOutcome {
    fields: WireField[];
    rows: Record<string, string | null>[];
    /** How many rows the database sent for it, kept or not. */
    received: number;
    /** Rows past the {@link SqlResultLimits} were counted and not kept. */
    truncated: boolean;
    /** The command tag, e.g. `SELECT 3`, `INSERT 0 1`, `CREATE TABLE`. */
    tag?: string;
}

/** How much of one statement's result a run keeps. */
export interface SqlResultLimits {
    /** Rows kept; the rest are counted and let go. */
    maxRows: number;
    /** Characters of values kept, summed over the kept rows. */
    maxTextLength: number;
}

/**
 * What the Studio console keeps of a result: its first 10,000 rows, or its
 * first 32 Mi characters of values, whichever ends first.
 *
 * Every row used to be kept. `TABLE events` on a million rows held 418 MB of
 * row objects and built a 475 MB frame, and a server with 1 GiB died of it —
 * every other user's connection with it. Ten times the console's own
 * `LIMIT 1000`, so a run that asked for a page always gets it whole; the text
 * budget is for the rows a count does not bound — a document column, a
 * `jsonb` blob — and keeps the frame, the string it is built from and the
 * socket's copy of it around 100 MB at worst.
 *
 * Postgres still sends every row (a simple query cannot be stopped short of
 * cancelling it, which would abort the statements after it); they are counted,
 * so the result says how many there were.
 */
export const SQL_CONSOLE_RESULT_LIMITS: SqlResultLimits = { maxRows: 10_000, maxTextLength: 32 * 1024 * 1024 };

/** The rows of one result kept so far, against {@link SqlResultLimits}. */
class ResultBudget {
    private rows = 0;
    private textLength = 0;

    constructor(private readonly limits: SqlResultLimits) {}

    /** Whether a row with `textLength` characters of values is kept; counted when it is. */
    admit(textLength: number): boolean {
        if (this.rows >= this.limits.maxRows || this.textLength + textLength > this.limits.maxTextLength) return false;
        this.rows++;
        this.textLength += textLength;
        return true;
    }
}

function textLengthOf(values: readonly (string | null)[]): number {
    let length = 0;
    for (const value of values) if (value !== null) length += value.length;
    return length;
}

/**
 * The script, sent as one simple query and read message by message.
 *
 * A `Submittable` rather than `client.query(text)`: node-postgres parses every
 * value through its type parsers and drops each field's origin, and for a
 * multi-statement script returns an array the driver's callers took for a
 * result with no rows. The message handlers below are the ones node-postgres
 * calls on the active query — the same protocol `pg-cursor` implements.
 */
export class ScriptRun implements Submittable {
    /**
     * Set by node-postgres when the pool has a `query_timeout`: a wrapper that
     * clears its read timer. Called on every outcome, so the timer never
     * outlives the run.
     */
    callback?: (error: Error | null) => void;

    /**
     * Every statement of the script, as it came back. Only the last holds its
     * rows: the console shows the last, and a statement's rows are let go when
     * the next one begins — `SELECT * FROM big; SELECT 1` held every row of
     * `big` to the end, to show one.
     */
    readonly statements: StatementOutcome[] = [];
    readonly done: Promise<StatementOutcome[]>;

    /** The statement whose row description arrived and whose command has not completed. */
    private open?: StatementOutcome;
    /** What {@link open} has kept of its rows. */
    private budget: ResultBudget;
    private settled = false;
    private resolveRun: (statements: StatementOutcome[]) => void = () => undefined;
    private rejectRun: (error: Error) => void = () => undefined;

    constructor(private readonly text: string, private readonly limits: SqlResultLimits = SQL_CONSOLE_RESULT_LIMITS) {
        this.budget = new ResultBudget(limits);
        this.done = new Promise((resolve, reject) => {
            this.resolveRun = resolve;
            this.rejectRun = reject;
        });
    }

    submit(connection: Connection): void {
        connection.query(this.text);
    }

    handleRowDescription(message: { fields: WireField[] }): void {
        this.releaseRows();
        this.budget = new ResultBudget(this.limits);
        this.open = {
            fields: message.fields.map(({ name, tableID, columnID, dataTypeID }) => ({ name, tableID, columnID, dataTypeID })),
            rows: [],
            received: 0,
            truncated: false
        };
        this.statements.push(this.open);
    }

    handleDataRow(message: { fields: (string | null)[] }): void {
        const statement = this.open;
        if (!statement) return;
        statement.received++;
        if (statement.truncated) return;
        if (!this.budget.admit(textLengthOf(message.fields))) {
            statement.truncated = true;
            return;
        }
        const row: Record<string, string | null> = {};
        statement.fields.forEach((field, index) => {
            row[field.name] = message.fields[index] ?? null;
        });
        statement.rows.push(row);
    }

    handleCommandComplete(message: { text: string }): void {
        const statement = this.open ?? { fields: [], rows: [], received: 0, truncated: false };
        if (!this.open) {
            this.releaseRows();
            this.statements.push(statement);
        }
        this.open = undefined;
        statement.tag = message.text;
    }

    handleEmptyQuery(): void {
        // An empty statement (`;;`) completes nothing and returns nothing.
    }

    handlePortalSuspended(): void {
        // Only the extended protocol suspends a portal; a simple query never does.
    }

    /**
     * `COPY … FROM STDIN` waits for data the console has no way to send. Fail
     * the copy rather than leave the session waiting for it.
     */
    handleCopyInResponse(connection: Connection): void {
        if ("sendCopyFail" in connection && typeof connection.sendCopyFail === "function") {
            connection.sendCopyFail("COPY FROM STDIN has no source in the SQL console");
        }
    }

    handleCopyData(): void {
        // `COPY … TO STDOUT` streams data the console does not show.
    }

    handleError(error: Error): void {
        this.settle(error);
    }

    handleReadyForQuery(): void {
        this.settle(null);
    }

    /** Let go of the rows of the statement before the one beginning: only the last is shown. */
    private releaseRows(): void {
        const previous = this.statements[this.statements.length - 1];
        if (previous) previous.rows = [];
    }

    private settle(error: Error | null): void {
        if (this.settled) return;
        this.settled = true;
        this.callback?.(error);
        if (error) this.rejectRun(error);
        else this.resolveRun(this.statements);
    }
}

/**
 * `INSERT 0 1` → `INSERT`, 1. `CREATE TABLE` → `CREATE TABLE`, no count.
 *
 * Only the commands whose tag ends in a count have one; the numbers are
 * stripped from the end of every other tag, of which there are none.
 */
export function parseCommandTag(tag: string | undefined): { command?: string; rowCount?: number } {
    if (!tag) return {};
    const counted = /^(SELECT|INSERT|UPDATE|DELETE|MERGE|COPY|MOVE|FETCH)(?: \d+)? (\d+)$/.exec(tag);
    if (counted) return { command: counted[1], rowCount: Number(counted[2]) };
    return { command: tag };
}

/** `pg_class.relkind` → what {@link SqlScriptTable.kind} calls it. */
function relationKind(relkind: string): SqlScriptTable["kind"] {
    switch (relkind) {
        case "r": return "table";
        case "p": return "partitioned table";
        case "v": return "view";
        case "m": return "materialized view";
        case "f": return "foreign table";
        default: return "other";
    }
}

/**
 * Name the tables, columns and types the row description referred to by OID.
 *
 * On the run's own session, after it was reset: the catalogue is readable by
 * every role, and the OIDs belong to this database. A failure here costs the
 * result its provenance, never its rows — a column with no source is one the
 * console will not edit.
 */
async function describeColumns(connection: PoolClient, fields: WireField[]): Promise<{ columns: SqlScriptColumn[]; tables: SqlScriptTable[] }> {
    const unnamed = { columns: fields.map(field => ({ name: field.name })), tables: [] };
    if (fields.length === 0) return unnamed;
    try {
        const typeOids = [...new Set(fields.map(field => field.dataTypeID))];
        const tableOids = [...new Set(fields.filter(field => field.tableID !== 0).map(field => field.tableID))];

        const types = await connection.query<{ oid: string; name: string }>(
            "SELECT oid::text AS oid, format_type(oid, NULL) AS name FROM pg_type WHERE oid = ANY($1::oid[])",
            [typeOids]
        );
        const typeNames = new Map(types.rows.map(row => [Number(row.oid), row.name]));

        const relations = tableOids.length === 0 ? [] : (await connection.query<{
            oid: string;
            schema: string;
            table: string;
            relkind: string;
            has_inheritors: boolean;
            primary_key: string[] | null;
        }>(
            `SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS "table", c.relkind::text AS relkind,
                    (c.relkind = 'r' AND c.relhassubclass) AS has_inheritors,
                    (SELECT array_agg(a.attname::text ORDER BY k.ord)
                       FROM pg_index i
                       CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                      WHERE i.indrelid = c.oid AND i.indisprimary) AS primary_key
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.oid = ANY($1::oid[])`,
            [tableOids]
        )).rows;
        const attributes = tableOids.length === 0 ? [] : (await connection.query<{ oid: string; attnum: number; name: string }>(
            `SELECT attrelid::text AS oid, attnum, attname::text AS name
               FROM pg_attribute
              WHERE attrelid = ANY($1::oid[]) AND attnum > 0 AND NOT attisdropped`,
            [tableOids]
        )).rows;

        const relationByOid = new Map(relations.map(relation => [Number(relation.oid), relation]));
        const attributeName = new Map(attributes.map(attribute => [`${attribute.oid}:${attribute.attnum}`, attribute.name]));

        const columns = fields.map((field): SqlScriptColumn => {
            const column: SqlScriptColumn = { name: field.name };
            const type = typeNames.get(field.dataTypeID);
            if (type) column.type = type;
            const relation = field.tableID !== 0 ? relationByOid.get(field.tableID) : undefined;
            const sourceColumn = attributeName.get(`${field.tableID}:${field.columnID}`);
            if (relation && sourceColumn) {
                column.source = { schema: relation.schema, table: relation.table, column: sourceColumn };
            }
            return column;
        });
        const tables = relations.map((relation): SqlScriptTable => ({
            schema: relation.schema,
            table: relation.table,
            kind: relationKind(relation.relkind),
            primaryKey: relation.primary_key ?? [],
            hasInheritors: relation.has_inheritors
        }));
        return { columns, tables };
    } catch (error: unknown) {
        logger.warn("[SQL console] Could not describe the result's columns; none of them will be editable", { error });
        return unnamed;
    }
}

/**
 * What puts a session back after caller SQL: the session user and role, then
 * every setting. Two statements, because the extended protocol refuses a
 * multi-command string. Pinned settings (`search_path` from the connection's
 * startup options) come back as they were pinned.
 */
export const RESET_SESSION_STATEMENTS = ["SET SESSION AUTHORIZATION DEFAULT", "RESET ALL"] as const;

/**
 * A connection's transaction state, as its last ReadyForQuery reported it:
 * `I` idle, `T` in a transaction, `E` in a failed one. `null` when the client
 * does not say (node-postgres has since 8.16; the package requires 8.22).
 */
export function transactionStatus(connection: object): string | null {
    if (!("getTransactionStatus" in connection) || typeof connection.getTransactionStatus !== "function") return null;
    const status: unknown = connection.getTransactionStatus();
    return typeof status === "string" ? status : null;
}

/**
 * SQL a person ran began a transaction and did not end it.
 *
 * Each run is a session of its own, so a transaction cannot outlive the run
 * that began it: a `BEGIN` alone, then an `UPDATE` in the next run, then a
 * `ROLLBACK` in a third, committed the UPDATE and reported three successes.
 * Refused instead, with the transaction rolled back.
 */
export class SqlTransactionLeftOpenError extends Error {
    readonly code = "SQL_TRANSACTION_LEFT_OPEN";

    constructor() {
        super(
            "This SQL began a transaction and did not end it, so it was rolled back: nothing it did was kept. " +
            "Each run is a session of its own, and a transaction cannot outlive the run that began it — " +
            "put the BEGIN and its COMMIT (or ROLLBACK) in the same run."
        );
        this.name = "SqlTransactionLeftOpenError";
    }
}

export interface OwnSessionOptions {
    /**
     * Put the session in the role the SQL runs as. Called once, before it, at
     * session level — so the role holds for every statement, a `COMMIT` in the
     * middle included. `SET LOCAL ROLE` inside a wrapping transaction did not:
     * the caller's `COMMIT` ended that transaction, and every statement after
     * it ran as the connection owner.
     */
    assumeRole?: (connection: PoolClient) => Promise<void>;
}

/**
 * Run `work` — SQL a person wrote — on a connection of its own from `pool`,
 * and put the connection back the way it was handed out.
 *
 * A transaction the SQL left open is rolled back, and the run refused with
 * {@link SqlTransactionLeftOpenError}; a run that failed with one open says
 * that it was rolled back. The session is then reset — role, session
 * authorization, settings — and destroyed instead when it cannot be. Last,
 * `afterReset` reads what it needs on the clean session, as the owner.
 */
export async function onOwnSession<T>(
    pool: Pool,
    options: OwnSessionOptions,
    work: (connection: PoolClient) => Promise<T>,
    afterReset?: (connection: PoolClient, value: T) => Promise<T>
): Promise<T> {
    const connection = await pool.connect();
    let reusable = true;
    try {
        let outcome: { value: T } | { error: unknown };
        try {
            await options.assumeRole?.(connection);
            outcome = { value: await work(connection) };
        } catch (error: unknown) {
            outcome = { error };
        }

        let leftOpen = false;
        const status = transactionStatus(connection);
        if (status === "T" || status === "E") {
            leftOpen = true;
            try {
                await connection.query("ROLLBACK");
            } catch {
                reusable = false;
            }
        }
        if (reusable) {
            try {
                for (const statement of RESET_SESSION_STATEMENTS) await connection.query(statement);
            } catch {
                reusable = false;
            }
        }

        if ("error" in outcome) {
            // The database's own error, kept, and told what became of the
            // transaction. On the deepest cause: that is the message the
            // socket reports, so a note on a wrapper would never be read.
            if (leftOpen) {
                const reported = deepestCause(outcome.error);
                if (reported) reported.message = `${reported.message}. The transaction this run began was rolled back: nothing it did was kept.`;
            }
            throw outcome.error;
        }
        if (leftOpen) throw new SqlTransactionLeftOpenError();
        return afterReset && reusable ? await afterReset(connection, outcome.value) : outcome.value;
    } finally {
        connection.release(reusable ? undefined : true);
    }
}

/** The innermost `Error` of a `cause` chain — Drizzle wraps the database's error in its own. */
function deepestCause(error: unknown): Error | undefined {
    let deepest: Error | undefined;
    for (let current: unknown = error; current instanceof Error; current = current.cause) deepest = current;
    return deepest;
}

/** How many notices one run keeps; a loop that raises one per row is not a report. */
const MAX_NOTICES = 100;

/**
 * Run `sql` on a connection of its own from `pool` and return what the last
 * statement returned, with each column's provenance and what the database
 * said along the way — `there is no transaction in progress` for a ROLLBACK
 * with nothing to roll back, which used to read as success.
 */
export async function runSqlScriptOnPool(pool: Pool, sql: string, options: OwnSessionOptions = {}): Promise<SqlScriptResult> {
    const notices: SqlScriptNotice[] = [];
    const run = await onOwnSession(pool, options, async (connection) => {
        const listen = (notice: { severity?: string; message?: string }) => {
            if (notices.length < MAX_NOTICES) notices.push({ severity: notice.severity ?? "NOTICE", message: notice.message ?? "" });
        };
        connection.on("notice", listen);
        try {
            const script = new ScriptRun(sql);
            connection.query(script);
            const statements = await script.done;
            const last: StatementOutcome = statements[statements.length - 1] ?? { fields: [], rows: [], received: 0, truncated: false };
            return { last, described: { columns: last.fields.map((field): SqlScriptColumn => ({ name: field.name })), tables: [] as SqlScriptTable[] } };
        } finally {
            connection.removeListener("notice", listen);
        }
    }, async (connection, value) => ({ ...value, described: await describeColumns(connection, value.last.fields) }));

    const tag = parseCommandTag(run.last.tag);
    return {
        rows: run.last.rows,
        columns: run.described.columns,
        tables: run.described.tables,
        ...tag,
        // The tag counts every row the statement returned; a command whose
        // tag carries no count was counted here.
        ...(run.last.truncated ? { truncated: true, rowCount: tag.rowCount ?? run.last.received } : {}),
        notices
    };
}

/**
 * The same shape for rows that came back parsed, from a handle that is not a
 * pool (PGlite in process): every value as text, and no column with a source —
 * nothing to say where a value came from, so nothing the console will edit.
 */
export function sqlScriptResultFromRows(rows: Record<string, unknown>[], limits: SqlResultLimits = SQL_CONSOLE_RESULT_LIMITS): SqlScriptResult {
    const names = rows.length > 0 ? Object.keys(rows[0]) : [];
    const budget = new ResultBudget(limits);
    const kept: Record<string, string | null>[] = [];
    for (const row of rows) {
        const entries = Object.entries(row).map(([key, value]): [string, string | null] => [key, valueAsText(value)]);
        if (!budget.admit(textLengthOf(entries.map(([, value]) => value)))) break;
        kept.push(Object.fromEntries(entries));
    }
    return {
        rows: kept,
        columns: names.map(name => ({ name })),
        tables: [],
        ...(kept.length < rows.length ? { truncated: true, rowCount: rows.length } : {}),
        notices: []
    };
}

function valueAsText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString("hex")}`;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/**
 * How many bytes of rows one answer of the admin `executeSql` door — the
 * WebSocket `EXECUTE_SQL` without `mode: "script"` — may carry: 128 MiB.
 *
 * That door had no limit at all. A million-row `SELECT` held every row parsed
 * (432 MB of heap on the console's door before it was capped), then built the
 * frame from them, and a server with 1 GiB died of it — with every other
 * user's connection. Unlike the console's script door it does not keep a
 * prefix: a program reading rows through it would take a prefix for the whole
 * answer, so past the budget the answer is refused, {@link SqlResultTooLargeError}.
 *
 * Generous on purpose. The catalogue reads the admin UI makes through this door
 * are far below it — the SQL console's schema browser reads one
 * `information_schema.columns` row per column, 7 MB for the 100,000 columns of
 * 5,000 tables — and anything near it is a result no browser tab should hold.
 */
export const SQL_RESULT_BYTE_BUDGET = 128 * 1024 * 1024;

/**
 * A result larger than the bytes its caller allowed, refused rather than
 * returned in part. Its message is for the person who wrote the SQL.
 */
export class SqlResultTooLargeError extends Error {
    readonly code = "RESULT_TOO_LARGE";

    constructor(readonly limitBytes: number) {
        super(
            `This result is larger than ${describeBytes(limitBytes)} of rows, so none of it was sent. ` +
            "Add a LIMIT, or select fewer columns, to read it in parts."
        );
        this.name = "SqlResultTooLargeError";
    }
}

function describeBytes(bytes: number): string {
    const mib = bytes / (1024 * 1024);
    return mib >= 1 ? `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB` : `${bytes} bytes`;
}

/**
 * The bytes a row takes as the database sends it: each value's text and four
 * bytes of length. For rows that come back parsed, where there is no message
 * to measure — PGlite, a client that is not node-postgres's own.
 */
function rowBytes(row: Record<string, unknown>): number {
    let bytes = 6;
    for (const value of Object.values(row)) bytes += 4 + textBytes(value);
    return bytes;
}

function textBytes(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === "string") return value.length;
    if (value instanceof Date) return 24;
    if (value instanceof Uint8Array) return 2 + value.byteLength * 2;
    if (typeof value === "object") return JSON.stringify(value).length;
    return String(value).length;
}

/**
 * Refuse rows that came back whole and are past `maxBytes`.
 *
 * Where nothing could watch the read, it is measured once done — and the
 * answer still refused rather than sent.
 */
export function refuseOversizedRows<T extends Record<string, unknown>>(rows: T[], maxBytes: number): T[] {
    let bytes = 0;
    for (const row of rows) {
        bytes += rowBytes(row);
        if (bytes > maxBytes) throw new SqlResultTooLargeError(maxBytes);
    }
    return rows;
}

/** A `DataRow` message's length, as node-postgres's parser hands it over. */
function messageLength(message: unknown): number {
    return typeof message === "object" && message !== null && "length" in message && typeof message.length === "number"
        ? message.length
        : 0;
}

/**
 * Run `work` — one query on `connection` — and stop reading once its rows pass
 * `maxBytes`.
 *
 * node-postgres keeps every row of a query until the query completes, and a
 * simple query cannot be stopped short of its end, so the only way to stop
 * holding rows is to stop receiving them: the socket is closed. Postgres sees
 * its client gone and abandons the statement; the session — and anything it
 * held — goes with it, and `onOwnSession` destroys the connection rather than
 * return it to the pool. What the caller gets is {@link SqlResultTooLargeError},
 * never the rows read so far.
 *
 * Counted from the wire, message by message, as they arrive: what is held when
 * it stops is the budget plus one network read.
 */
export async function readWithinBudget<T extends Record<string, unknown>>(
    connection: PoolClient,
    maxBytes: number,
    work: () => Promise<T[]>
): Promise<T[]> {
    if (!(connection instanceof Client)) return refuseOversizedRows(await work(), maxBytes);
    const wire = connection.connection;
    let received = 0;
    let exceeded = false;
    const count = (message: unknown) => {
        if (exceeded) return;
        received += messageLength(message);
        if (received <= maxBytes) return;
        exceeded = true;
        wire.stream.destroy();
    };
    // A checked-out client has no pool listener, and node-postgres emits the
    // closed socket as an `error` on the client: unheard, that ends the process.
    const ignore = () => undefined;
    connection.on("error", ignore);
    wire.on("dataRow", count);
    try {
        const rows = await work();
        if (exceeded) throw new SqlResultTooLargeError(maxBytes);
        return rows;
    } catch (error: unknown) {
        if (exceeded) throw new SqlResultTooLargeError(maxBytes);
        throw error;
    } finally {
        wire.removeListener("dataRow", count);
        // A closed connection may still say so; it is discarded, not reused.
        if (!exceeded) connection.removeListener("error", ignore);
    }
}
