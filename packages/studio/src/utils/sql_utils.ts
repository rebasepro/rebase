import { parse, parseFirst, type Expr, type SelectFromStatement, type SelectedColumn, type Statement } from "pgsql-ast-parser";
import type { TableInfo } from "../components/SQLEditor/sql_editor_types";

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
 * A table extracted from a SQL query's FROM/JOIN clauses.
 */
export interface ExtractedTable {
    name: string;
    /** The schema the query named, if it named one. */
    schema?: string;
    alias?: string;
}

/**
 * A table as SQL: `"schema"."table"` when the query named its schema, and a
 * bare `"table"` when it left it to the search path — which then resolves it
 * the same way it resolved the query.
 */
export function quoteTableName(tableName: string, schemaName?: string): string {
    const quote = (identifier: string) => `"${identifier.replace(/"/g, "\"\"")}"`;
    return schemaName ? `${quote(schemaName)}.${quote(tableName)}` : quote(tableName);
}

/**
 * The introspected columns of a table the query named — in the schema it
 * named, when it named one. Unqualified, the first schema that has a table of
 * that name answers.
 */
function findTableInfo(schemas: Record<string, TableInfo[]>, table: ExtractedTable): TableInfo | undefined {
    if (table.schema) {
        return schemas[table.schema]?.find(t => t.tableName === table.name);
    }
    for (const schema of Object.values(schemas)) {
        const tableInfo = schema.find(t => t.tableName === table.name);
        if (tableInfo) return tableInfo;
    }
    return undefined;
}

/**
 * The name Postgres gives the result column of an unaliased select item, as
 * far as it can be told from the expression: a column keeps its name, a cast
 * the name of what it casts, a function call the function's, and anything
 * else a name no table column has.
 */
function expressionColumnName(expr: Expr): string {
    switch (expr.type) {
        case "ref":
            return expr.name;
        case "cast": {
            const operandName = expressionColumnName(expr.operand);
            if (operandName !== "?column?") return operandName;
            return expr.to.kind === "array" ? operandName : expr.to.name;
        }
        case "call":
            return expr.function.name;
        case "keyword":
            return expr.keyword;
        case "case":
            return "case";
        case "array select":
            return "array";
        case "select": {
            const [first] = expr.columns ?? [];
            return first ? selectedColumnName(first) : "?column?";
        }
        default:
            return "?column?";
    }
}

function selectedColumnName(column: SelectedColumn): string {
    return column.alias?.name ?? expressionColumnName(column.expr);
}

/**
 * How many columns of the query's result may carry `name` — an upper bound:
 * a `*` over a source whose columns are not known counts once for every name.
 *
 * A result row is an object keyed by column name, so where two columns share
 * a name the row holds only the last of them. A key or a value read from such
 * a row cannot be told apart from its namesake: for `SELECT * FROM posts p
 * JOIN authors a …` the row's `id` is the author's.
 */
function resultColumnCounter(ast: SelectFromStatement, schemas: Record<string, TableInfo[]>): (name: string) => number {
    const sources = (ast.from ?? []).map(item => {
        if (item.type === "table") {
            const renamed = item.name.columnNames ?? [];
            const columns = findTableInfo(schemas, { name: item.name.name, schema: item.name.schema })
                ?.columns.map((c, i) => renamed[i]?.name ?? c.name);
            return { refName: item.name.alias ?? item.name.name, columns };
        }
        if (item.type === "statement") {
            const { statement } = item;
            const named = statement.type === "select" &&
                (statement.columns ?? []).every(c => !(c.expr.type === "ref" && c.expr.name === "*"));
            const renamed = item.columnNames ?? [];
            const columns = named && statement.type === "select"
                ? (statement.columns ?? []).map((c, i) => renamed[i]?.name ?? selectedColumnName(c))
                : undefined;
            return { refName: item.alias, columns };
        }
        return { refName: item.alias?.name, columns: undefined };
    });
    return (name: string) => {
        let count = 0;
        for (const column of ast.columns ?? []) {
            const expr = column.expr;
            if (expr.type === "ref" && expr.name === "*") {
                const covered = expr.table
                    ? sources.filter(source => source.refName === expr.table?.name)
                    : sources;
                if (covered.length === 0) count += 1;
                for (const source of covered) {
                    count += source.columns ? source.columns.filter(c => c === name).length : 1;
                }
            } else if (selectedColumnName(column) === name) {
                count += 1;
            }
        }
        return count;
    };
}

/**
 * A collection matched to a table in a SQL query.
 */
export interface ResolvedQueryCollection {
    /** DB table name from the SQL AST (e.g. "blog_posts") */
    tableName: string;
    /** SQL alias if present (e.g. "bp") */
    tableAlias?: string;
    /** The matched collection */
    collection: AdminCollection;
    /** Columns from this table that are present in the result set */
    columns: string[];
    /** The result column name that holds the primary key for this table (e.g. "id", "author_id") */
    pkColumn?: string;
}

/**
 * Extract all tables referenced in a SQL query's FROM and JOIN clauses.
 * Returns an empty array for non-SELECT queries or parse failures.
 */
export function extractTablesFromQuery(sqlString: string): ExtractedTable[] {
    try {
        const ast = parseFirst(sqlString);
        if (ast.type !== "select") return [];

        const tables: ExtractedTable[] = [];

        // pgsql-ast-parser From items — tables and joins with left/right branches
        type FromNode = { type: string; name?: { name: string; schema?: string; alias?: string }; left?: FromNode; right?: FromNode };
        const processFrom = (fromItems: FromNode[]) => {
            for (const item of fromItems) {
                if (item.type === "table" && item.name) {
                    tables.push({ name: item.name.name,
schema: item.name.schema,
alias: item.name.alias });
                }
                if (item.type === "join") {
                    if (item.left) processFrom([item.left]);
                    if (item.right) processFrom([item.right]);
                }
            }
        };

        if (ast.from) {
            processFrom(ast.from);
        }

        return tables;
    } catch {
        return [];
    }
}

import { toSnakeCase } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Resolve which collections are referenced by a SQL query.
 *
 * Parses the SQL, extracts table names, and matches each against
 * registered collections via `collection.table` (falling back to
 * snake_case of `collection.slug`).
 *
 * For each matched collection, determines which result columns
 * belong to that table using the database schema information.
 */
export function resolveQueryCollections(
    sqlString: string,
    schemas: Record<string, TableInfo[]>,
    collections: AdminCollection[],
    resultColumns?: string[]
): ResolvedQueryCollection[] {
    const tables = extractTablesFromQuery(sqlString);
    if (tables.length === 0) return [];

    // Parse the AST to resolve SELECT column aliases
    const selectColumns: { table?: string; column: string; alias?: string }[] = [];
    let countResultColumns: ((name: string) => number) | undefined;
    try {
        const ast = parseFirst(sqlString);
        if (ast.type === "select") {
            countResultColumns = resultColumnCounter(ast, schemas);
            for (const col of ast.columns ?? []) {
                if (col.expr?.type === "ref") {
                    selectColumns.push({
                        table: col.expr.table?.name,
                        column: col.expr.name,
                        alias: col.alias?.name
                    });
                }
            }
        }
    } catch { /* parse failure is ok, we'll fall back */ }

    const results: ResolvedQueryCollection[] = [];

    for (const table of tables) {
        // Match table name against collection table or slug->snake_case —
        // and, when the query named a schema, the collection's schema too:
        // `archive.orders` is not the `orders` collection's table, and its
        // rows' ids open somebody else's records.
        const matched = collections.find(c => {
            const tableName = ("table" in c ? c.table : undefined) || toSnakeCase(c.slug);
            const schemaName = ("schema" in c ? c.schema : undefined) || "public";
            return tableName === table.name && (!table.schema || table.schema === schemaName);
        });

        if (!matched) continue;

        // Find columns belonging to this table from the schema
        const tableColumns: string[] = findTableInfo(schemas, table)?.columns.map(c => c.name) ?? [];

        // Determine which result column holds the PK ("id") for this table.
        // 1. Check parsed SELECT columns for an explicit "id" column from this table (by name or alias)
        // 2. Fall back to checking if result columns contain "id"
        let pkColumn: string | undefined;

        // Look in the AST select columns for `table.id` or `alias.id`
        const tableRef = table.alias || table.name;
        const idSelectCol = selectColumns.find(
            sc => sc.column === "id" && (!sc.table || sc.table === tableRef || sc.table === table.name)
        );
        if (idSelectCol) {
            pkColumn = idSelectCol.alias || idSelectCol.column; // use alias if present
        }

        // If we didn't find it from the AST (e.g. SELECT *), check if result columns have "id"
        if (!pkColumn && resultColumns) {
            if (resultColumns.includes("id")) {
                pkColumn = "id";
            }
        }

        // If still not found, fall back to checking tableColumns
        if (!pkColumn && tableColumns.includes("id")) {
            pkColumn = "id";
        }

        // A key column another column of the result shares its name with is
        // not this table's: the row holds only the last of them.
        if (pkColumn && (!countResultColumns || countResultColumns(pkColumn) > 1)) {
            pkColumn = undefined;
        }

        results.push({
            tableName: table.name,
            tableAlias: table.alias,
            collection: matched,
            columns: tableColumns,
            pkColumn
        });
    }

    return results;
}

export interface PKMapping {
    /** The actual column name in the database table */
    dbColumn: string;
    /** The column name as it appears in the query result set (may be aliased) */
    resultColumn: string;
}

export interface TableAndPKResult {
    tableName?: string;
    /**
     * The schema the query named for that table — `undefined` when it named
     * none. Build the UPDATE with {@link quoteTableName}: a bare table name
     * resolves through the search path, which is how editing a row of
     * `archive.orders` used to update `public.orders`.
     */
    schemaName?: string;
    primaryKeys?: PKMapping[];
    error?: string;
}

export function determineTableAndPK(sqlString: string, columnKey: string, schemas: Record<string, TableInfo[]>): TableAndPKResult {
    try {
        const tables = extractTablesFromQuery(sqlString);

        const ast = parseFirst(sqlString);
        if (ast.type !== "select") {
            return { error: "Inline editing is only supported for SELECT queries." };
        }

        if (tables.length === 0) {
            return { error: "Could not find any tables in the query." };
        }

        // Parse SELECT columns to resolve aliases
        const selectColumns: { table?: string; column: string; alias?: string }[] = [];
        if (ast.columns) {
            for (const col of ast.columns) {
                if (col.expr?.type === "ref") {
                    selectColumns.push({
                        table: col.expr.table?.name,
                        column: col.expr.name,
                        alias: col.alias?.name
                    });
                }
            }
        }

        // Resolve which DB column `columnKey` refers to (it might be aliased)
        const resolvedColumn = selectColumns.find(
            sc => (sc.alias === columnKey) || (!sc.alias && sc.column === columnKey)
        );
        const actualDbColumnName = resolvedColumn?.column ?? columnKey;
        const columnTableRef = resolvedColumn?.table; // e.g. "p" or "posts"

        // Resolve the table for the edited column
        let resolvedTable: ExtractedTable | null = null;

        if (tables.length === 1) {
            resolvedTable = tables[0];
        } else {
            // If the AST tells us which table, use that
            if (columnTableRef) {
                const matchedTable = tables.find(
                    t => t.alias === columnTableRef || t.name === columnTableRef
                );
                if (matchedTable) {
                    resolvedTable = matchedTable;
                }
            }

            // Otherwise, look up which schema table has this column
            if (!resolvedTable) {
                const matchedTables = tables.filter(t =>
                    findTableInfo(schemas, t)?.columns.some(c => c.name === actualDbColumnName) ?? false
                );

                if (matchedTables.length === 1) {
                    resolvedTable = matchedTables[0];
                } else if (matchedTables.length > 1) {
                    return { error: `Ambiguous column "${columnKey}": Found in multiple queried tables.` };
                } else {
                    return { error: `Could not find column "${columnKey}" in the queried tables.` };
                }
            }
        }

        if (!resolvedTable) {
            return { error: "Could not resolve the target table." };
        }
        const resolvedTableName = resolvedTable.name;

        // Find the table's actual primary key columns from the schema — the
        // schema the query named, when it named one.
        const pkDbColumns = (findTableInfo(schemas, resolvedTable)?.columns ?? [])
            .filter(c => c.isPrimaryKey)
            .map(c => c.name);

        if (pkDbColumns.length === 0) {
            return { error: `Table "${resolvedTableName}" has no primary key defined.` };
        }

        // The table's alias in the query (for resolving PK result column names)
        const tableAlias = resolvedTable.alias;

        // Map each PK db column to its result column name (resolving aliases)
        const primaryKeys: PKMapping[] = pkDbColumns.map(dbCol => {
            // Find the SELECT column for this PK
            const selectCol = selectColumns.find(
                sc => sc.column === dbCol &&
                    (!sc.table || sc.table === (tableAlias || resolvedTableName))
            );
            return {
                dbColumn: dbCol,
                resultColumn: selectCol?.alias || selectCol?.column || dbCol
            };
        });

        // The row holds only the last of several columns of one name, so an
        // edited value or a key read from a shared name may be another
        // table's: the UPDATE would find some other row by it.
        const countResultColumns = resultColumnCounter(ast, schemas);
        if (countResultColumns(columnKey) > 1) {
            return { error: `Ambiguous column "${columnKey}": the result has more than one column of that name. Give each one its own alias to edit it.` };
        }
        const sharedKey = primaryKeys.find(pk => countResultColumns(pk.resultColumn) > 1);
        if (sharedKey) {
            return { error: `Cannot tell which "${sharedKey.resultColumn}" column is the key of "${resolvedTableName}": the result has more than one column of that name. Give it its own alias (${tableAlias || resolvedTableName}.${sharedKey.dbColumn} AS ${resolvedTableName}_${sharedKey.dbColumn}) to edit this table.` };
        }

        return { tableName: resolvedTableName,
schemaName: resolvedTable.schema,
primaryKeys };
    } catch (e: unknown) {
        console.warn("Failed to parse SQL AST:", e);
        const message = e instanceof Error ? e.message : String(e);
        return { error: `Could not safely parse query for inline editing: ${message}` };
    }
}
