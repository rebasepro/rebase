import { astVisitor, parse, type Statement } from "pgsql-ast-parser";
import { toSnakeCase } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { SqlScriptResult } from "@rebasepro/types";

/** The statements in `sqlText`, or `null` when the parser cannot read it. */
function parseStatements(sqlText: string): Statement[] | null {
    try {
        return parse(sqlText);
    } catch {
        return null;
    }
}

/**
 * The `EXPLAIN` for one statement, or `null` when `sqlText` is not exactly one.
 *
 * Never `ANALYZE`: that executes the statement to time it, so explaining a
 * `DELETE` deleted the rows — without the confirmation "Run" asks for.
 *
 * And never more than one statement. Sent as one simple query, `EXPLAIN (…)
 * SELECT 1; DELETE …` explains the SELECT and *runs* the DELETE. Text the
 * parser cannot read is still explained, as long as no `;` could be hiding a
 * second statement in it.
 */
export function buildExplainSql(sqlText: string): string | null {
    const statement = sqlText.trim().replace(/;+$/, "").trim();
    if (!statement) return null;
    const statements = parseStatements(statement);
    const single = statements ? statements.length === 1 : !statement.includes(";");
    return single ? `EXPLAIN (FORMAT JSON) ${statement}` : null;
}

/**
 * Whether the console's automatic `LIMIT` may be appended to `sqlText`: one
 * top-level SELECT that has no limit of its own.
 *
 * Decided on the parsed statement, not the text. A search for the word SELECT
 * also found it inside `INSERT INTO … SELECT` and `CREATE TABLE … AS SELECT`,
 * which then copied a thousand rows and reported success, and at the start of
 * a script whose last statement the appended `LIMIT` turned into a syntax
 * error. Text the parser cannot read is left as written.
 */
export function acceptsAutoLimit(sqlText: string): boolean {
    const statements = parseStatements(sqlText);
    if (!statements || statements.length !== 1) return false;
    const [statement] = statements;
    return statement.type === "select" && !statement.limit;
}

/** A destructive command named anywhere in a text, comments included. */
const DESTRUCTIVE_COMMAND = /\b(DELETE|UPDATE|DROP|TRUNCATE)\b/i;

function isDestructiveStatement(statement: Statement): boolean {
    switch (statement.type) {
        case "delete":
        case "update":
            return !statement.where;
        case "truncate table":
        case "drop table":
        case "drop sequence":
        case "drop index":
        case "drop type":
        case "drop trigger":
        case "drop function":
            return true;
        case "alter table":
            return statement.changes.some(change => change.type === "drop column" || change.type === "drop constraint");
        case "with":
            return statement.bind.some(binding => isDestructiveStatement(binding.statement)) ||
                isDestructiveStatement(statement.in);
        case "with recursive":
            return isDestructiveStatement(statement.in);
        case "do":
            return DESTRUCTIVE_COMMAND.test(statement.code);
        default:
            return false;
    }
}

/**
 * Whether "Run" asks before running `sqlText`: a statement in it deletes or
 * updates without a WHERE of its own, drops or truncates.
 *
 * Decided per parsed statement, not on the text. A search of the text for the
 * word WHERE found it in another statement or in a comment, so `DELETE FROM
 * posts; SELECT * FROM posts WHERE id = 1` deleted every post without asking.
 * Text the parser cannot read is confirmed whenever it names a destructive
 * command.
 */
export function needsDestructiveConfirmation(sqlText: string): boolean {
    const statements = parseStatements(sqlText);
    if (!statements) return DESTRUCTIVE_COMMAND.test(sqlText);
    return statements.some(isDestructiveStatement);
}

/**
 * A table as SQL: `"schema"."table"` when a schema is given, a bare `"table"`
 * otherwise.
 */
export function quoteTableName(tableName: string, schemaName?: string): string {
    return schemaName ? `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}` : quoteIdentifier(tableName);
}

/** An identifier as SQL, whatever it holds: double-quoted, with `"` doubled. */
export function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
}

/** What the console knows about a result: its columns, and the tables they came from. */
export type ResultProvenance = Pick<SqlScriptResult, "columns" | "tables">;

/**
 * The stored cell a result cell is, and the key that finds its row.
 */
export interface CellEditTarget {
    schema: string;
    table: string;
    /** The table column the edited value is written to. */
    column: string;
    /** Each primary key column of the table, and the result column holding its value for the row. */
    key: { column: string; resultColumn: string }[];
}

/**
 * Why a cell cannot be edited: a translation key of the console's, and its
 * parameters.
 */
export interface CellEditRefusal {
    key:
        | "studio_sql_edit_unreadable_query"
        | "studio_sql_edit_not_a_select"
        | "studio_sql_edit_duplicate_column"
        | "studio_sql_edit_computed_column"
        | "studio_sql_edit_not_a_table"
        | "studio_sql_edit_inherited_table"
        | "studio_sql_edit_no_primary_key"
        | "studio_sql_edit_key_missing"
        | "studio_sql_edit_table_read_twice";
    params: Record<string, string>;
}

export type CellEditResolution =
    | { target: CellEditTarget; refusal?: undefined }
    | { target?: undefined; refusal: CellEditRefusal };

const refuse = (key: CellEditRefusal["key"], params: Record<string, string> = {}): CellEditResolution =>
    ({ refusal: { key, params } });

/**
 * Which stored cell an edit of the result column `resultColumn` writes, and
 * how its row is found again — or why no edit is safe.
 *
 * Decided on what the database reported, not on the query's text. Each
 * column of the result says which table column it was read from, or that it
 * was computed; a cell is editable only when it was read from a column of a
 * table, every column of that table's primary key was read too, and each of
 * them is the only column of the result with its name — a row holds one value
 * per name.
 *
 * The text was the only evidence before, and it was wrong twice over. For
 * `SELECT p.id, a.name FROM posts p JOIN authors a …` it took the post's `id`
 * for the author's key and updated whichever author shared the post's id.
 * For `SELECT id, lower(email) AS name FROM users` it wrote the edited text
 * to `users.name`.
 *
 * The database reports a table, not which mention of it: in a self-join both
 * sides are `authors`, and a key from one with a value from the other finds
 * the wrong row. So the query is still read, for one thing — the table must
 * be read once, and nothing it is read through may be read twice.
 */
export function resolveCellEdit(sqlText: string, provenance: ResultProvenance, resultColumn: string): CellEditResolution {
    const sameName = provenance.columns.filter(column => column.name === resultColumn);
    if (sameName.length !== 1) return refuse("studio_sql_edit_duplicate_column", { column: resultColumn });
    const source = sameName[0].source;
    if (!source) return refuse("studio_sql_edit_computed_column", { column: resultColumn });

    const tableLabel = `${source.schema}.${source.table}`;
    const table = provenance.tables.find(t => t.schema === source.schema && t.table === source.table);
    if (!table || (table.kind !== "table" && table.kind !== "partitioned table")) {
        return refuse("studio_sql_edit_not_a_table", { column: resultColumn, table: tableLabel });
    }
    if (table.hasInheritors) return refuse("studio_sql_edit_inherited_table", { table: tableLabel });
    if (table.primaryKey.length === 0) return refuse("studio_sql_edit_no_primary_key", { table: tableLabel });

    const key: CellEditTarget["key"] = [];
    for (const keyColumn of table.primaryKey) {
        const holders = provenance.columns.filter(column =>
            column.source?.schema === source.schema &&
            column.source.table === source.table &&
            column.source.column === keyColumn);
        const holder = holders.length === 1 && provenance.columns.filter(column => column.name === holders[0].name).length === 1
            ? holders[0]
            : undefined;
        if (!holder) return refuse("studio_sql_edit_key_missing", { table: tableLabel, columns: table.primaryKey.join(", ") });
        key.push({ column: keyColumn, resultColumn: holder.name });
    }

    const readOnce = tableReadOnce(sqlText, source.table);
    if (readOnce !== true) return readOnce;

    return { target: { schema: source.schema, table: source.table, column: source.column, key } };
}

/**
 * Whether `sqlText` is one SELECT that reads `table` once — counting every
 * mention of a table of that name, in any schema and at any depth, and every
 * mention of a `WITH` query, since one read twice reads its tables twice.
 */
function tableReadOnce(sqlText: string, table: string): true | CellEditResolution {
    const statements = parseStatements(sqlText);
    if (!statements) return refuse("studio_sql_edit_unreadable_query");
    if (statements.length !== 1) return refuse("studio_sql_edit_not_a_select");
    const [statement] = statements;
    const isRead = statement.type === "select" ||
        (statement.type === "with" &&
            statement.in.type === "select" &&
            statement.bind.every(binding => binding.statement.type === "select"));
    if (!isRead) return refuse("studio_sql_edit_not_a_select");

    const mentions = new Map<string, number>();
    const withNames: string[] = [];
    astVisitor(visitor => ({
        fromTable: from => {
            const name = from.name.name.toLowerCase();
            mentions.set(name, (mentions.get(name) ?? 0) + 1);
            visitor.super().fromTable(from);
        },
        with: withStatement => {
            withNames.push(...withStatement.bind.map(binding => binding.alias.name.toLowerCase()));
            visitor.super().with(withStatement);
        }
    })).statement(statement);

    const readTwice = (mentions.get(table.toLowerCase()) ?? 0) !== 1 ||
        withNames.some(name => (mentions.get(name) ?? 0) > 1);
    return readTwice ? refuse("studio_sql_edit_table_read_twice", { table }) : true;
}

/**
 * A collection whose records a query's rows can be opened as.
 */
export interface ResolvedQueryCollection {
    /** The table, as the database named it. */
    tableName: string;
    schemaName: string;
    /** The matched collection */
    collection: AdminCollection;
    /** The result column that holds the table's primary key. */
    pkColumn: string;
}

/**
 * The collections a result's rows can be opened as: those whose table one of
 * the result's columns was read from, with the table's (single-column) primary
 * key read too, under a name no other column of the result has.
 *
 * Matched on the provenance the database reported. A text match took the
 * result's `id` for every table of a join: `SELECT p.id, a.name FROM posts p
 * JOIN authors a …` offered to open the author whose id was the post's.
 */
export function resolveQueryCollections(provenance: ResultProvenance, collections: AdminCollection[]): ResolvedQueryCollection[] {
    const results: ResolvedQueryCollection[] = [];
    for (const table of provenance.tables) {
        const collection = collections.find(c => {
            const tableName = ("table" in c ? c.table : undefined) || toSnakeCase(c.slug);
            const schemaName = ("schema" in c ? c.schema : undefined) || "public";
            return tableName === table.table && schemaName === table.schema;
        });
        if (!collection || table.primaryKey.length !== 1) continue;
        const [keyColumn] = table.primaryKey;
        const holders = provenance.columns.filter(column =>
            column.source?.schema === table.schema &&
            column.source.table === table.table &&
            column.source.column === keyColumn);
        if (holders.length !== 1) continue;
        const pkColumn = holders[0].name;
        if (provenance.columns.filter(column => column.name === pkColumn).length !== 1) continue;
        results.push({ tableName: table.table, schemaName: table.schema, collection, pkColumn });
    }
    return results;
}
