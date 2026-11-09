/**
 * A real drizzle node-postgres database whose pg client never connects.
 *
 * Every statement drizzle sends — `BEGIN`, the auth-context `set_config`, the
 * query itself, `COMMIT` — reaches `client.query`, which records it and answers
 * with the rows `respond` returns. So a test exercises the driver's real
 * transaction path (a real `NodePgTransaction`, real SQL compilation) and
 * asserts on the text and parameters Postgres would have been sent, without a
 * server and without pretending a hand-built object is a `NodePgDatabase`.
 */
import { jest } from "@jest/globals";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

export interface RecordedQuery {
    text: string;
    values: readonly unknown[];
}

/**
 * What a statement answers: its rows, or its rows and the `rowCount` pg
 * reports. A select drizzle compiles itself (`db.select()…`) asks pg for
 * array rows — one array per row, in selection order — while `db.execute`
 * reads object rows.
 */
export type QueryAnswer = readonly unknown[] | { rows: readonly unknown[]; rowCount?: number };

export type QueryResponder = (query: RecordedQuery) => QueryAnswer;

/** The text and bound values of one `client.query(...)` call, whatever form drizzle used. */
function recordedQueryOf(args: readonly unknown[]): RecordedQuery {
    const [first, second] = args;
    const valuesOf = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
    if (typeof first === "string") return { text: first, values: valuesOf(second) };
    if (first !== null && typeof first === "object" && "text" in first && typeof first.text === "string") {
        const configValues = "values" in first ? first.values : undefined;
        return { text: first.text, values: valuesOf(second ?? configValues) };
    }
    throw new Error(`recording db: unexpected query arguments ${JSON.stringify(args)}`);
}

/**
 * Object rows as the array rows a drizzle-compiled select reads: each row's
 * values in the order the statement selects its columns (`"posts"."title"` and
 * `"title"` both read `title`). A selected expression that is not a plain
 * column reads `undefined`.
 */
export function arrayRowsFor(sqlText: string, rows: readonly Record<string, unknown>[]): unknown[][] {
    const selectList = /^\s*select\s+(?:distinct\s+)?([\s\S]*?)\s+from\s/i.exec(sqlText)?.[1] ?? "";
    const columns: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of selectList) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
            columns.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    if (current.trim()) columns.push(current.trim());
    const names = columns.map(column => /^(?:"[^"]+"\.)?"([^"]+)"$/.exec(column)?.[1]);
    return rows.map(row => names.map(name => (name === undefined ? undefined : row[name])));
}

export function recordingDb(respond: QueryResponder = () => []) {
    const client = new pg.Client({ connectionString: "postgres://recording@127.0.0.1:1/recording" });
    const queries: RecordedQuery[] = [];
    jest.spyOn(client, "query").mockImplementation((...args: unknown[]) => {
        const query = recordedQueryOf(args);
        queries.push(query);
        const answer = respond(query);
        const rows = "rows" in answer ? answer.rows : answer;
        const rowCount = "rows" in answer && answer.rowCount !== undefined ? answer.rowCount : rows.length;
        return Promise.resolve({ command: "SELECT", rowCount, oid: 0, fields: [], rows });
    });
    const db = drizzle({ client });
    /** The recorded statements, without the transaction's own BEGIN / COMMIT / ROLLBACK. */
    const statements = () => queries.filter(q => !/^\s*(begin|commit|rollback)\b/i.test(q.text));
    return { db, client, queries, statements };
}
