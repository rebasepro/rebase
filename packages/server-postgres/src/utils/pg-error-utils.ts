/**
 * Shared PostgreSQL error extraction and user-friendly message formatting.
 *
 * Drizzle wraps native PG errors in a `.cause` chain. These utilities
 * unwrap that chain to get the real PostgreSQL error (identified by a
 * 5-character alphanumeric `code` such as `42P01`) and translate it into
 * a message that is safe and helpful to show to end-users.
 */

import { logger } from "@rebasepro/server";

/**
 * Shape of a deliberate client-facing error — `ApiError` from
 * `@rebasepro/server`, or anything else carrying a 4xx `statusCode`.
 *
 * Matched structurally rather than with `instanceof`: `@rebasepro/server` can
 * be loaded twice (published dist vs. workspace source), which breaks class
 * identity — `PersistService` hedges against the same thing by also accepting
 * `name === "ApiError"`.
 */
interface ClientFacingError extends Error {
    statusCode?: number;
    code?: string;
    /** See `ApiError.expected` — routine outcomes log at debug, not warn. */
    expected?: boolean;
}

/**
 * Return the error when it is a deliberate 4xx, otherwise null.
 *
 * A thrown `ApiError` is a decision the server made about the request, not a
 * database failure: its message and code are already written for the client.
 */
function asClientFacingError(error: unknown): ClientFacingError | null {
    if (!(error instanceof Error)) return null;
    const e = error as ClientFacingError;
    if (typeof e.statusCode !== "number" || e.statusCode < 400 || e.statusCode >= 500) return null;
    return e;
}

/** Shape of PostgreSQL errors with diagnostic metadata. */
export interface PostgresError extends Error {
    code?: string;
    detail?: string;
    hint?: string;
    constraint?: string;
    column?: string;
    table?: string;
    dataType?: string;
    cause?: unknown;
}

/**
 * Extract the underlying PostgreSQL error from a Drizzle wrapper.
 * Drizzle wraps PG errors in a `cause` property — this function
 * recursively walks the chain until it finds an object with a PG
 * error code (5-char alphanumeric, e.g. `42P01`).
 */
export function extractPgError(error: unknown): PostgresError | null {
    if (!error || typeof error !== "object") return null;
    if (!(error instanceof Error)) {
        // Check non-Error objects for a cause chain (Drizzle sometimes wraps oddly)
        if ("cause" in error && (error as Record<string, unknown>).cause && typeof (error as Record<string, unknown>).cause === "object") {
            return extractPgError((error as Record<string, unknown>).cause);
        }
        return null;
    }

    // Check if the error itself has a PG error code
    if ("code" in error && typeof (error as PostgresError).code === "string" && /^[0-9A-Z]{5}$/.test((error as PostgresError).code!)) {
        return error as PostgresError;
    }

    // Check the cause chain (Drizzle wraps PG errors)
    if (error.cause && typeof error.cause === "object") {
        return extractPgError(error.cause);
    }

    return null;
}

/**
 * Whether the failure came back from Postgres rather than from building the
 * query — which decides whether a fallback query is worth issuing.
 *
 * Reads here run inside a transaction (that is where `SET LOCAL ROLE` binds
 * RLS). Once a statement raises, that transaction is aborted, and every later
 * statement on it returns `25P02` — "current transaction is aborted, commands
 * ignored until end of transaction block". So a retry after a database error
 * cannot succeed, and it replaces a precise diagnosis ("invalid input syntax
 * for type uuid") with a generic one. Rethrow instead.
 *
 * A query the driver could not even build — a missing reciprocal relation, say
 * — never reached Postgres, leaves the transaction usable, and is exactly what
 * the fallback paths exist for.
 */
export function reachedDatabase(error: unknown): boolean {
    return extractPgError(error) !== null;
}

/**
 * Walk the error cause chain and return the deepest meaningful message.
 */
export function extractCauseMessage(error: unknown): string | null {
    if (!error || typeof error !== "object") return null;
    if (!(error instanceof Error)) return null;

    if (error.cause && typeof error.cause === "object") {
        const deeper = extractCauseMessage(error.cause);
        if (deeper) return deeper;
        // The cause itself has a message
        if (error.cause instanceof Error && error.cause.message) {
            return error.cause.message;
        }
    }
    return null;
}

/**
 * Codes that mean "this connection will never work as configured".
 *
 * A wrong password or a database that does not exist is a settled fact about
 * the connection string, not a transient fault — retrying produces the same
 * answer forever.
 */
const UNRECOVERABLE_CONNECT_CODES = new Set([
    "28P01", // invalid_password
    "28000", // invalid_authorization_specification
    "3D000", // invalid_catalog_name — the database does not exist
    "42501"  // insufficient_privilege
]);

export interface ConnectFailure {
    /** True when retrying cannot help: the connection string itself is wrong. */
    fatal: boolean;
    /** The deepest message available — the Postgres one where there is one. */
    reason: string;
    /** The `SQLSTATE`, when the failure came from Postgres rather than the socket. */
    code?: string;
}

/**
 * Describe a failed connection attempt in terms a developer can act on.
 *
 * The error a caller catches is Drizzle's wrapper: its message is
 * `Failed query: SELECT 1` and its stack runs through drizzle internals, while
 * the sentence that says what is actually wrong — "password authentication
 * failed for user …", "database … does not exist" — sits in `.cause`. Logging
 * the wrapper, as the bootstrapper used to, tells a developer with a typo in
 * their `DATABASE_URL` nothing at all.
 */
export function classifyConnectFailure(error: unknown): ConnectFailure {
    const pgError = extractPgError(error);
    const reason =
        pgError?.message ??
        extractCauseMessage(error) ??
        (error instanceof Error ? error.message : String(error));
    return {
        fatal: Boolean(pgError?.code && UNRECOVERABLE_CONNECT_CODES.has(pgError.code)),
        reason,
        code: pgError?.code
    };
}

/**
 * Detect whether an error is specifically a role-switching permission failure
 * (e.g. "permission denied to set role" or "must be member of role"),
 * as opposed to a table-level permission denial.
 *
 * This is used by the backend driver to auto-disable role switching when the
 * connection user lacks SET ROLE privileges, rather than surfacing a confusing
 * error to the Studio SQL Editor user.
 */
export function isRoleSwitchingPermissionError(error: unknown): boolean {
    const pgError = extractPgError(error);
    if (!pgError || pgError.code !== "42501") return false;
    const msg = pgError.message.toLowerCase();
    return msg.includes("set role") || msg.includes("member of role");
}

/**
 * Translate a raw PostgreSQL error into a user-friendly message.
 *
 * @param pgError  - The extracted PostgreSQL error (from {@link extractPgError})
 * @param context  - A human-readable context string (e.g. collection slug or path)
 * @returns An object with a `message` safe for the client and the PG `code`.
 */
export function pgErrorToFriendlyMessage(pgError: PostgresError, context: string): { message: string; code: string } {
    const detail = pgError.detail as string | undefined;
    const hint = pgError.hint as string | undefined;
    const constraint = pgError.constraint as string | undefined;
    const column = pgError.column as string | undefined;
    const table = pgError.table as string | undefined;
    const dataType = pgError.dataType as string | undefined;
    const pgMessage = pgError.message || "Unknown database error";
    const code = pgError.code || "UNKNOWN";

    const suffix = hint ? ` Hint: ${hint}` : "";
    const tableRef = table ?? context;

    switch (pgError.code) {
        case "23503": // foreign_key_violation
            return {
                message: detail
                    ? `Foreign key constraint violated: ${detail}${suffix}`
                    : `Cannot complete operation: a foreign key constraint${constraint ? ` (${constraint})` : ""} was violated in "${context}".${suffix}`,
                code
            };
        case "23505": // unique_violation
            return {
                message: detail
                    ? `Duplicate value: ${detail}${suffix}`
                    : `Cannot complete operation: a unique constraint${constraint ? ` (${constraint})` : ""} was violated in "${context}".${suffix}`,
                code
            };
        case "23502": // not_null_violation
            return {
                message: `Missing required field: "${column ?? "unknown"}" in "${tableRef}" cannot be empty.${suffix}`,
                code
            };
        case "23514": // check_violation
            return {
                message: `Validation failed: a check constraint${constraint ? ` (${constraint})` : ""} was violated in "${context}".${suffix}`,
                code
            };
        case "22P02": // invalid_text_representation (e.g. invalid UUID, wrong enum value)
            return {
                message: `Invalid data format in "${context}": ${pgMessage}${suffix}`,
                code
            };
        case "22001": // string_data_right_truncation (value too long)
            return {
                message: `Value too long for column "${column ?? "unknown"}" in "${tableRef}": ${pgMessage}${suffix}`,
                code
            };
        case "22003": // numeric_value_out_of_range
            return {
                message: `Numeric value out of range for column "${column ?? "unknown"}" in "${tableRef}": ${pgMessage}${suffix}`,
                code
            };
        case "42703": // undefined_column
            return {
                message: `Unknown column in "${tableRef}": ${pgMessage}. Check if your schema is up to date (run migrations).${suffix}`,
                code
            };
        case "42P01": // undefined_table
            return {
                message: `Table not found for "${context}": ${pgMessage}. Check if your schema is up to date (run migrations).${suffix}`,
                code
            };
        case "42501": // insufficient_privilege
            return {
                message: `Permission denied on "${tableRef}". Check your database credentials and RLS policies.${suffix}`,
                code
            };
        case "28000": // invalid_authorization_specification
            return {
                message: `Authorization failed for "${context}". Check your database credentials.${suffix}`,
                code
            };
        default: {
            // Unhandled PG code — still surface the actual database message
            const parts = [`Database error in "${context}" [${code}]: ${pgMessage}`];
            if (detail) parts.push(`Detail: ${detail}`);
            if (column) parts.push(`Column: ${column}`);
            if (dataType) parts.push(`Data type: ${dataType}`);
            if (constraint) parts.push(`Constraint: ${constraint}`);
            if (hint) parts.push(`Hint: ${hint}`);
            return { message: parts.join(". "), code };
        }
    }
}

/**
 * Sanitize any error into a message safe and helpful for the client.
 *
 * A deliberate 4xx (`ApiError`) passes through untouched — the server already
 * decided what the client should read. Otherwise the PG error is extracted
 * from the Drizzle cause chain, falling back to a generic message that
 * doesn't leak SQL.
 *
 * @param error   - The raw caught error
 * @param context - A human-readable context string (e.g. collection path)
 * @returns An object with `message` (user-friendly) and optional `code`
 *          (the `ApiError` code, or the PG SQLSTATE).
 */
export function sanitizeErrorForClient(error: unknown, context: string): { message: string; code?: string } {
    // ── A deliberate 4xx is not a database failure ──────────────────
    // Its message and code are written for the client; replacing them with
    // "Check server logs" would discard the only diagnosis the caller gets
    // (e.g. the offending filter field and the collection's valid ones).
    // Log level follows the same convention as the HTTP error handler in
    // @rebasepro/server: routine outcomes at debug, everything else at warn.
    const clientError = asClientFacingError(error);
    if (clientError) {
        const line = `[API ${clientError.statusCode} ${clientError.code ?? "BAD_REQUEST"}] in "${context}": ${clientError.message}`;
        if (clientError.expected) {
            logger.debug(line);
        } else {
            logger.warn(`⚠️ ${line}`);
        }
        return { message: clientError.message, ...(clientError.code && { code: clientError.code }) };
    }

    // ── Always log the full, unsanitized error server-side ──────────
    const pgError = extractPgError(error);

    if (pgError) {
        logger.error(`[PG ${pgError.code}] Error in "${context}"`, {
            code: pgError.code,
            message: pgError.message,
            detail: pgError.detail,
            hint: pgError.hint,
            column: pgError.column,
            table: pgError.table,
            constraint: pgError.constraint,
            dataType: pgError.dataType,
            // Also log the outer Drizzle wrapper message for full context
            drizzleMessage: error instanceof Error ? error.message : String(error)
        });
        return pgErrorToFriendlyMessage(pgError, context);
    }

    // No PG error found — log the raw error as-is
    logger.error(`Database error in "${context}" (no PG error extracted)`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        cause: error instanceof Error && error.cause
            ? (error.cause instanceof Error ? error.cause.message : String(error.cause))
            : undefined
    });

    // Try to get the deepest cause message
    const causeMessage = extractCauseMessage(error);
    if (causeMessage) {
        return { message: `Database error in "${context}": ${causeMessage}` };
    }

    // Last resort — generic message, never leak raw SQL
    return { message: `Could not load data for "${context}". Check server logs for details.` };
}
