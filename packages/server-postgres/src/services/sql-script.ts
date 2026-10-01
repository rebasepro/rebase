import type { Connection, Pool, PoolClient, Submittable } from "pg";
import type { SqlScriptColumn, SqlScriptResult, SqlScriptTable } from "@rebasepro/types";
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
interface StatementOutcome {
    fields: WireField[];
    rows: Record<string, string | null>[];
    /** The command tag, e.g. `SELECT 3`, `INSERT 0 1`, `CREATE TABLE`. */
    tag?: string;
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
class ScriptRun implements Submittable {
    /**
     * Set by node-postgres when the pool has a `query_timeout`: a wrapper that
     * clears its read timer. Called on every outcome, so the timer never
     * outlives the run.
     */
    callback?: (error: Error | null) => void;

    readonly statements: StatementOutcome[] = [];
    readonly done: Promise<StatementOutcome[]>;

    /** The statement whose row description arrived and whose command has not completed. */
    private open?: StatementOutcome;
    private settled = false;
    private resolveRun: (statements: StatementOutcome[]) => void = () => undefined;
    private rejectRun: (error: Error) => void = () => undefined;

    constructor(private readonly text: string) {
        this.done = new Promise((resolve, reject) => {
            this.resolveRun = resolve;
            this.rejectRun = reject;
        });
    }

    submit(connection: Connection): void {
        connection.query(this.text);
    }

    handleRowDescription(message: { fields: WireField[] }): void {
        this.open = {
            fields: message.fields.map(({ name, tableID, columnID, dataTypeID }) => ({ name, tableID, columnID, dataTypeID })),
            rows: []
        };
        this.statements.push(this.open);
    }

    handleDataRow(message: { fields: (string | null)[] }): void {
        const statement = this.open;
        if (!statement) return;
        const row: Record<string, string | null> = {};
        statement.fields.forEach((field, index) => {
            row[field.name] = message.fields[index] ?? null;
        });
        statement.rows.push(row);
    }

    handleCommandComplete(message: { text: string }): void {
        const statement = this.open ?? { fields: [], rows: [] };
        if (!this.open) this.statements.push(statement);
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

/** What puts a session back after a script: the session user and role, then every setting. */
const RESET_SESSION_STATEMENTS = ["SET SESSION AUTHORIZATION DEFAULT", "RESET ALL"] as const;

export interface RunSqlScriptOptions {
    /**
     * Put the session in the role the script runs as. Called once, before the
     * script, on the script's own session — so the role holds for every
     * statement of it, a `COMMIT` in the middle included.
     */
    assumeRole?: (connection: PoolClient) => Promise<void>;
}

/**
 * Run `sql` on a connection of its own from `pool`, reset that connection, and
 * return what the last statement returned with each column's provenance.
 */
export async function runSqlScriptOnPool(pool: Pool, sql: string, options: RunSqlScriptOptions = {}): Promise<SqlScriptResult> {
    const connection = await pool.connect();
    let reusable = true;
    try {
        let statements: StatementOutcome[];
        try {
            await options.assumeRole?.(connection);
            const run = new ScriptRun(sql);
            connection.query(run);
            statements = await run.done;
        } finally {
            try {
                for (const statement of RESET_SESSION_STATEMENTS) await connection.query(statement);
            } catch {
                // A session that cannot be reset — an open or failed transaction
                // — is destroyed rather than handed to the next request.
                reusable = false;
            }
        }

        const last: StatementOutcome = statements[statements.length - 1] ?? { fields: [], rows: [] };
        const { columns, tables } = reusable
            ? await describeColumns(connection, last.fields)
            : { columns: last.fields.map(field => ({ name: field.name })), tables: [] };
        return {
            rows: last.rows,
            columns,
            tables,
            ...parseCommandTag(last.tag)
        };
    } finally {
        connection.release(reusable ? undefined : true);
    }
}

/**
 * The same shape for rows that came back parsed, from a handle that is not a
 * pool (PGlite in process): every value as text, and no column with a source —
 * nothing to say where a value came from, so nothing the console will edit.
 */
export function sqlScriptResultFromRows(rows: Record<string, unknown>[]): SqlScriptResult {
    const names = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
        rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, valueAsText(value)]))),
        columns: names.map(name => ({ name })),
        tables: []
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
