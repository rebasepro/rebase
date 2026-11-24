import { ApiError } from "../api/errors";
import type { CatalogColumn } from "./db-table-catalog";
import { relationRef } from "./db-table-catalog";
import { isRecord, quoteIdent } from "./db-sql-guards";

/**
 * SQL for the Studio row browser, built from a relation's catalog columns.
 *
 * Every value travels as text and is cast to the column's own type
 * (`CAST($n AS <format_type>)`), and every value is read back as `::text`.
 * That is how a database tool edits a row without losing anything: a
 * `bigint` past 2^53, a `numeric(30,10)`, a `timestamptz` with its offset and
 * a `bytea` all round-trip through the same text Postgres prints. Column
 * names come only from the catalog; a name the catalog does not list is
 * refused, so no identifier is ever taken from the request.
 */

export const ROW_FILTER_OPERATORS = [
    "eq", "neq", "lt", "lte", "gt", "gte", "like", "ilike", "in", "is_null", "not_null"
] as const;
export type RowFilterOperator = typeof ROW_FILTER_OPERATORS[number];

export interface RowFilter {
    column: string;
    op: RowFilterOperator;
    /** Text for comparisons, a list for `in`, absent for the null tests. */
    value?: string | string[];
}

export interface RowsQueryInput {
    schema: string;
    table: string;
    columns: readonly CatalogColumn[];
    filters: readonly RowFilter[];
    orderBy?: string;
    direction?: "asc" | "desc";
    limit: number;
    offset: number;
}

export interface BuiltQuery {
    sql: string;
    params: unknown[];
}

export const MAX_PAGE_SIZE = 1000;
export const EXACT_COUNT_LIMIT = 50_000;
export const MAX_WRITE_ROWS = 1000;

/**
 * A column compared as text rather than cast to its own type: arrays and
 * types with no ordering or equality worth trusting from a filter box
 * (`json`, `xml`, geometric types, …).
 */
function comparesAsText(column: CatalogColumn): boolean {
    if (column.category === "A") return true;
    if (column.category === "G" || column.category === "X") return true;
    return column.udt === "json" || column.udt === "xml";
}

function columnByName(columns: readonly CatalogColumn[], name: unknown, label: string): CatalogColumn {
    const column = typeof name === "string" ? columns.find(candidate => candidate.name === name) : undefined;
    if (!column) {
        throw ApiError.badRequest(`${label} "${String(name ?? "")}" is not a column of this table.`, "INVALID_INPUT");
    }
    return column;
}

/** The columns read back, each as the text Postgres prints for it. */
export function selectList(columns: readonly CatalogColumn[]): string {
    return columns.map(column => `${quoteIdent(column.name)}::text AS ${quoteIdent(column.name)}`).join(", ");
}

/** Reads `filters` off a request: a JSON array of `{ column, op, value }`. */
export function parseRowFilters(raw: unknown, columns: readonly CatalogColumn[]): RowFilter[] {
    if (raw === undefined || raw === null || raw === "") return [];
    let parsed: unknown = raw;
    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw ApiError.badRequest("`filters` must be a JSON array of { column, op, value }.", "INVALID_INPUT");
        }
    }
    if (!Array.isArray(parsed)) {
        throw ApiError.badRequest("`filters` must be a JSON array of { column, op, value }.", "INVALID_INPUT");
    }
    return parsed.map((entry, index) => {
        if (!isRecord(entry)) throw ApiError.badRequest(`filters[${index}] must be an object.`, "INVALID_INPUT");
        const column = columnByName(columns, entry.column, `filters[${index}].column`).name;
        const op = ROW_FILTER_OPERATORS.find(candidate => candidate === entry.op);
        if (!op) {
            throw ApiError.badRequest(
                `filters[${index}].op must be one of ${ROW_FILTER_OPERATORS.join(", ")}.`,
                "INVALID_INPUT"
            );
        }
        if (op === "is_null" || op === "not_null") return { column, op };
        if (op === "in") {
            if (!Array.isArray(entry.value) || entry.value.length === 0) {
                throw ApiError.badRequest(`filters[${index}].value must be a non-empty list for "in".`, "INVALID_INPUT");
            }
            return { column, op, value: entry.value.map(item => String(item)) };
        }
        if (entry.value === undefined || entry.value === null) {
            throw ApiError.badRequest(`filters[${index}].value is required for "${op}".`, "INVALID_INPUT");
        }
        return { column, op, value: String(entry.value) };
    });
}

const COMPARATORS: Record<"eq" | "neq" | "lt" | "lte" | "gt" | "gte", string> = {
    eq: "=",
    neq: "<>",
    lt: "<",
    lte: "<=",
    gt: ">",
    gte: ">="
};

export function buildWhere(
    filters: readonly RowFilter[],
    columns: readonly CatalogColumn[],
    params: unknown[]
): string {
    const clauses = filters.map(filter => {
        const column = columnByName(columns, filter.column, "Filter column");
        const ident = quoteIdent(column.name);
        const asText = comparesAsText(column);
        const next = (value: unknown) => {
            params.push(value);
            return `$${params.length}`;
        };
        switch (filter.op) {
            case "is_null":
                return `${ident} IS NULL`;
            case "not_null":
                return `${ident} IS NOT NULL`;
            case "like":
                return `${ident}::text LIKE ${next(filter.value)}`;
            case "ilike":
                return `${ident}::text ILIKE ${next(filter.value)}`;
            case "in": {
                const values = Array.isArray(filter.value) ? filter.value : [String(filter.value ?? "")];
                const placeholder = next(values);
                return asText
                    ? `${ident}::text = ANY(CAST(${placeholder} AS text[]))`
                    : `${ident} = ANY(CAST(CAST(${placeholder} AS text[]) AS ${column.type}[]))`;
            }
            default: {
                const operator = COMPARATORS[filter.op];
                const placeholder = next(filter.value);
                return asText
                    ? `${ident}::text ${operator} ${placeholder}`
                    : `${ident} ${operator} CAST(${placeholder} AS ${column.type})`;
            }
        }
    });
    return clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
}

/** One page of rows, ordered by the chosen column, then by the primary key so pages never overlap. */
export function buildRowsQuery(input: RowsQueryInput): BuiltQuery {
    const params: unknown[] = [];
    const where = buildWhere(input.filters, input.columns, params);
    const order: string[] = [];
    if (input.orderBy) {
        const column = columnByName(input.columns, input.orderBy, "orderBy");
        order.push(`${quoteIdent(column.name)} ${input.direction === "desc" ? "DESC" : "ASC"} NULLS LAST`);
    }
    for (const column of input.columns) {
        if (column.primaryKey && column.name !== input.orderBy) order.push(`${quoteIdent(column.name)} ASC`);
    }
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(input.limit)));
    const offset = Math.max(0, Math.floor(input.offset));
    params.push(limit, offset);
    const sql = `SELECT ${selectList(input.columns)} FROM ${relationRef(input.schema, input.table)}${where}`
        + `${order.length > 0 ? ` ORDER BY ${order.join(", ")}` : ""}`
        + ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return { sql, params };
}

/**
 * Counts matching rows up to {@link EXACT_COUNT_LIMIT} + 1. A result past the
 * limit means "more than that": the caller shows the planner's estimate
 * instead of scanning a large table to the end.
 */
export function buildCountQuery(input: Omit<RowsQueryInput, "limit" | "offset" | "orderBy" | "direction">): BuiltQuery {
    const params: unknown[] = [];
    const where = buildWhere(input.filters, input.columns, params);
    params.push(EXACT_COUNT_LIMIT + 1);
    return {
        sql: `SELECT count(*)::bigint AS total FROM (SELECT 1 FROM ${relationRef(input.schema, input.table)}${where} LIMIT $${params.length}) AS matched`,
        params
    };
}

function writableColumn(columns: readonly CatalogColumn[], name: string, label: string): CatalogColumn {
    const column = columnByName(columns, name, label);
    if (column.generated) {
        throw ApiError.badRequest(`Column "${column.name}" is generated and cannot be written.`, "INVALID_INPUT");
    }
    return column;
}

/** A row's values as the request sent them: column → text, or `null` to store NULL. */
export function parseRowValues(raw: unknown, label: string): Record<string, string | null> {
    if (!isRecord(raw)) throw ApiError.badRequest(`${label} must be an object of column → value.`, "INVALID_INPUT");
    const values: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(raw)) {
        values[key] = value === null || value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value);
    }
    return values;
}

export function primaryKeyColumns(columns: readonly CatalogColumn[]): CatalogColumn[] {
    return columns.filter(column => column.primaryKey);
}

function keyClause(key: Record<string, string | null>, pk: readonly CatalogColumn[], params: unknown[]): string {
    return pk.map(column => {
        const value = key[column.name];
        if (value === undefined || value === null) {
            throw ApiError.badRequest(`The row key is missing primary key column "${column.name}".`, "INVALID_INPUT");
        }
        params.push(value);
        return `${quoteIdent(column.name)} = CAST($${params.length} AS ${column.type})`;
    }).join(" AND ");
}

function requirePrimaryKey(columns: readonly CatalogColumn[]): CatalogColumn[] {
    const pk = primaryKeyColumns(columns);
    if (pk.length === 0) {
        throw ApiError.badRequest(
            "This relation has no primary key, so a row cannot be addressed for an update or delete. Add a primary key, or use the SQL editor.",
            "NO_PRIMARY_KEY"
        );
    }
    return pk;
}

/**
 * One multi-row INSERT, so a batch lands whole or not at all. A column a row
 * leaves out takes its default (`DEFAULT`), not NULL.
 */
export function buildInsert(
    schema: string,
    table: string,
    columns: readonly CatalogColumn[],
    rows: readonly Record<string, string | null>[]
): BuiltQuery {
    if (rows.length === 0) throw ApiError.badRequest("`rows` must contain at least one row.", "INVALID_INPUT");
    if (rows.length > MAX_WRITE_ROWS) {
        throw ApiError.badRequest(`At most ${MAX_WRITE_ROWS} rows can be inserted in one request.`, "INVALID_INPUT");
    }
    const names = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const targets = names.map(name => writableColumn(columns, name, "Column"));
    const target = relationRef(schema, table);
    if (targets.length === 0) {
        if (rows.length > 1) {
            throw ApiError.badRequest("Rows with no values can only be inserted one at a time.", "INVALID_INPUT");
        }
        return { sql: `INSERT INTO ${target} DEFAULT VALUES RETURNING ${selectList(columns)}`, params: [] };
    }
    const params: unknown[] = [];
    const tuples = rows.map(row => `(${targets.map(column => {
        if (!(column.name in row)) return "DEFAULT";
        params.push(row[column.name]);
        return `CAST($${params.length} AS ${column.type})`;
    }).join(", ")})`);
    return {
        sql: `INSERT INTO ${target} (${targets.map(column => quoteIdent(column.name)).join(", ")}) VALUES ${tuples.join(", ")} RETURNING ${selectList(columns)}`,
        params
    };
}

export function buildUpdate(
    schema: string,
    table: string,
    columns: readonly CatalogColumn[],
    key: Record<string, string | null>,
    values: Record<string, string | null>
): BuiltQuery {
    const pk = requirePrimaryKey(columns);
    const entries = Object.entries(values);
    if (entries.length === 0) throw ApiError.badRequest("`values` must change at least one column.", "INVALID_INPUT");
    const params: unknown[] = [];
    const sets = entries.map(([name, value]) => {
        const column = writableColumn(columns, name, "Column");
        params.push(value);
        return `${quoteIdent(column.name)} = CAST($${params.length} AS ${column.type})`;
    });
    const where = keyClause(key, pk, params);
    return {
        sql: `UPDATE ${relationRef(schema, table)} SET ${sets.join(", ")} WHERE ${where} RETURNING ${selectList(columns)}`,
        params
    };
}

export function buildDelete(
    schema: string,
    table: string,
    columns: readonly CatalogColumn[],
    keys: readonly Record<string, string | null>[]
): BuiltQuery {
    const pk = requirePrimaryKey(columns);
    if (keys.length === 0) throw ApiError.badRequest("`keys` must name at least one row.", "INVALID_INPUT");
    if (keys.length > MAX_WRITE_ROWS) {
        throw ApiError.badRequest(`At most ${MAX_WRITE_ROWS} rows can be deleted in one request.`, "INVALID_INPUT");
    }
    const params: unknown[] = [];
    const clauses = keys.map(key => `(${keyClause(key, pk, params)})`);
    return {
        sql: `DELETE FROM ${relationRef(schema, table)} WHERE ${clauses.join(" OR ")} RETURNING 1 AS deleted`,
        params
    };
}

/** RFC 4180: a field holding a comma, quote or line break is quoted, quotes doubled; NULL is an empty field. */
export function csvField(value: unknown): string {
    if (value === null || value === undefined) return "";
    const textValue = String(value);
    return /[",\r\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}
