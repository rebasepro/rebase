/**
 * A real drizzle database over a pg client that never connects.
 *
 * The services take a `NodePgDatabase`; tests used to hand them an object with
 * `execute` and `transaction` on it, cast into the type. This is the type
 * itself: drizzle builds every statement and runs the transaction protocol
 * (BEGIN, COMMIT, savepoints) as it would against Postgres, and the client's
 * `query` — the one place a statement leaves the process — records it and
 * answers from `answer`, with no rows unless told otherwise.
 *
 * A statement drizzle sends in array mode (a typed `select` with fields)
 * expects rows as arrays; `answer` sees `rowMode` and must shape them so.
 */
import { jest } from "@jest/globals";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

export interface RecordedStatement {
    text: string;
    values: unknown[];
    rowMode?: string;
}

/** What the client was handed, as text and bound values. */
function statementOf(config: unknown, values: unknown): RecordedStatement {
    if (typeof config === "string") return { text: config, values: Array.isArray(values) ? values : [] };
    if (typeof config !== "object" || config === null) return { text: String(config), values: [] };
    const text = "text" in config && typeof config.text === "string" ? config.text : "";
    const bound = "values" in config && Array.isArray(config.values) ? config.values : Array.isArray(values) ? values : [];
    const rowMode = "rowMode" in config && typeof config.rowMode === "string" ? config.rowMode : undefined;
    return { text, values: bound, ...(rowMode ? { rowMode } : {}) };
}

/**
 * `rows` as drizzle asked for them: objects, or — in array mode — arrays in
 * the order of the statement's select list, matched on each item's last
 * quoted identifier.
 */
export function shapedRows(statement: RecordedStatement, rows: Record<string, unknown>[]): unknown[] {
    if (statement.rowMode !== "array") return rows;
    const list = /^select (.*?) from /is.exec(statement.text)?.[1] ?? "";
    const columns = list.split(",").map((item) => /"([^"]+)"\s*$/.exec(item.trim())?.[1] ?? item.trim());
    return rows.map((row) => columns.map((column) => row[column]));
}

export function recordingDb(answer: (statement: RecordedStatement) => unknown[] = () => []) {
    const statements: RecordedStatement[] = [];
    const client = new pg.Client();
    const query = jest.spyOn(client, "query").mockImplementation(async (config: unknown, values?: unknown) => {
        const statement = statementOf(config, values);
        statements.push(statement);
        const rows = answer(statement);
        return { rows, rowCount: rows.length, command: statement.text.split(/\s+/)[0]?.toUpperCase() ?? "", oid: 0, fields: [] };
    });
    const db = drizzle({ client });
    return { db, client, query, statements };
}
