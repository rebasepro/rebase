import type { SqlScriptColumn, SqlScriptResult, SqlScriptTable } from "@rebasepro/types";

/**
 * Read an `EXECUTE_SQL_SUCCESS` payload for a script run as a
 * {@link SqlScriptResult}, checking every field rather than trusting the frame.
 *
 * A server from before scripts existed answers `{ result }` alone, with parsed
 * values. Its rows are kept, as text, and no column is said to come from
 * anywhere — the console edits no cell of a result it cannot trace.
 */
export function readSqlScriptResult(payload: unknown): SqlScriptResult {
    const record = asRecord(payload);
    const rows = Array.isArray(record?.result) ? record.result.map(asRecord).filter(isDefined).map(textRow) : [];
    const columns = Array.isArray(record?.columns)
        ? record.columns.map(readColumn).filter(isDefined)
        : Object.keys(rows[0] ?? {}).map((name): SqlScriptColumn => ({ name }));
    const tables = Array.isArray(record?.tables) ? record.tables.map(readTable).filter(isDefined) : [];
    const result: SqlScriptResult = { rows, columns, tables };
    if (typeof record?.command === "string") result.command = record.command;
    if (typeof record?.rowCount === "number") result.rowCount = record.rowCount;
    return result;
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : undefined;
}

function textRow(row: Record<string, unknown>): Record<string, string | null> {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, asText(value)]));
}

function asText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function readColumn(value: unknown): SqlScriptColumn | undefined {
    const record = asRecord(value);
    if (typeof record?.name !== "string") return undefined;
    const column: SqlScriptColumn = { name: record.name };
    if (typeof record.type === "string") column.type = record.type;
    const source = asRecord(record.source);
    if (typeof source?.schema === "string" && typeof source.table === "string" && typeof source.column === "string") {
        column.source = { schema: source.schema, table: source.table, column: source.column };
    }
    return column;
}

const TABLE_KINDS: readonly SqlScriptTable["kind"][] = ["table", "partitioned table", "view", "materialized view", "foreign table", "other"];

function readTable(value: unknown): SqlScriptTable | undefined {
    const record = asRecord(value);
    if (typeof record?.schema !== "string" || typeof record.table !== "string") return undefined;
    const kind = TABLE_KINDS.find(candidate => candidate === record.kind) ?? "other";
    const primaryKey = Array.isArray(record.primaryKey) && record.primaryKey.every((column): column is string => typeof column === "string")
        ? record.primaryKey
        : [];
    return {
        schema: record.schema,
        table: record.table,
        kind,
        primaryKey,
        // Unknown reads as the unsafe answer: a table whose rows may live in
        // tables that inherit it is not one a key finds a single row in.
        hasInheritors: record.hasInheritors !== false
    };
}
