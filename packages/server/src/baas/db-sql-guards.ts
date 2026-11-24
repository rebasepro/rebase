import { ApiError, extractDbError } from "../api/errors";

/**
 * Input guards and quoting shared by the `/api/admin/db` routes: every name
 * and expression an admin types passes one of these before it reaches DDL.
 */

/** SQLSTATEs for "that already exists": a conflict, not a malformed request. */
const ALREADY_EXISTS_CODES = new Set(["42P07", "42710", "42701", "42P06"]);

/**
 * A statement Postgres refused, as the admin who sent it needs to read it.
 *
 * The DDL these routes run is built from what the admin typed — a name, a
 * type, a default, a policy condition — so the database's own sentence is the
 * answer that tells them what to change. Left alone, a driver error is a 500
 * and the client reads "An unexpected error occurred", with the reason only in
 * the server log.
 */
export function ddlRefusal(error: unknown): unknown {
    const pg = extractDbError(error);
    if (!pg?.message) return error;
    const message = [
        `PostgreSQL refused the change: ${pg.message}.`,
        pg.detail,
        pg.hint ? `Hint: ${pg.hint}` : undefined
    ].filter(Boolean).join(" ");
    const status = pg.code && ALREADY_EXISTS_CODES.has(pg.code) ? 409 : 400;
    return new ApiError(status, "DDL_REJECTED", message, { dbCode: pg.code }, true);
}

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const PROTECTED_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast", "rebase", "auth"]);

const ALLOWED_SQL_TYPES_RE = /^(?:text|boolean|bool|smallint|int2|integer|int|int4|bigint|int8|real|float4|double precision|float8|uuid|date|time|timetz|timestamp|timestamptz|timestamp with time zone|timestamp without time zone|json|jsonb|bytea|inet|cidr|macaddr|tsvector|serial|bigserial|smallserial|varchar(?:\(\d{1,5}\))?|character varying(?:\(\d{1,5}\))?|char(?:\(\d{1,5}\))?|numeric(?:\(\d{1,3}(?:,\s*\d{1,3})?\))?|decimal(?:\(\d{1,3}(?:,\s*\d{1,3})?\))?|vector\(\d{1,5}\))(?:\[\])?$/i;

const ON_ACTIONS = new Set(["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"]);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

export function assertIdent(value: unknown, label: string): string {
    if (typeof value !== "string" || !IDENTIFIER_RE.test(value.trim())) {
        throw ApiError.badRequest(
            `${label} "${String(value ?? "")}" must be a valid PostgreSQL identifier (${IDENTIFIER_RE.source}).`,
            "INVALID_INPUT"
        );
    }
    return value.trim();
}

export function assertSchema(value: unknown): string {
    const schema = value === undefined || value === "" ? "public" : assertIdent(value, "Schema name");
    if (PROTECTED_SCHEMAS.has(schema.toLowerCase()) || schema.toLowerCase().startsWith("pg_")) {
        throw ApiError.badRequest(`Schema "${schema}" is protected and cannot be modified through /api/admin/db.`, "INVALID_INPUT");
    }
    return schema;
}

export function assertSqlType(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw ApiError.badRequest(`${label} must specify a PostgreSQL column type.`, "INVALID_INPUT");
    }
    const trimmed = value.trim();
    if (!ALLOWED_SQL_TYPES_RE.test(trimmed)) {
        throw ApiError.badRequest(
            `Unsupported or unsafe SQL type "${trimmed}" for ${label}. Use a standard PostgreSQL type (e.g. text, integer, uuid, boolean, timestamptz, jsonb, numeric, varchar(255), text[]).`,
            "INVALID_INPUT"
        );
    }
    return trimmed;
}

export function assertOnAction(value: unknown, label: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") {
        throw ApiError.badRequest(`${label} must be a string.`, "INVALID_INPUT");
    }
    const upper = value.trim().toUpperCase().replace(/_/g, " ");
    if (!ON_ACTIONS.has(upper)) {
        throw ApiError.badRequest(`Invalid ${label} action "${value}". Use NO ACTION, RESTRICT, CASCADE, SET NULL, or SET DEFAULT.`, "INVALID_INPUT");
    }
    return upper;
}

export function assertSafeDefaultExpression(raw: unknown): string | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string") {
        throw ApiError.badRequest("Column `default` must be a SQL expression string.", "INVALID_INPUT");
    }
    const expr = raw.trim();
    // Prevent statement injection in DEFAULT expressions.
    if (expr.includes(";") || expr.includes("--") || expr.includes("/*")) {
        throw ApiError.badRequest("Column `default` expression must not contain statement terminators or comments.", "INVALID_INPUT");
    }
    return expr;
}

export function assertSafePolicyExpression(raw: unknown, label: string): string | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string") {
        throw ApiError.badRequest(`Policy ${label} must be a SQL boolean expression string.`, "INVALID_INPUT");
    }
    const expr = raw.trim();
    if (expr.includes(";") || expr.includes("--") || expr.includes("/*")) {
        throw ApiError.badRequest(`Policy ${label} expression must not contain statement terminators or comments.`, "INVALID_INPUT");
    }
    return expr;
}
