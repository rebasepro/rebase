/**
 * Shared PostgreSQL error extraction and user-friendly message formatting.
 *
 * Drizzle wraps native PG errors in a `.cause` chain. These utilities
 * unwrap that chain to get the real PostgreSQL error (identified by a
 * 5-character alphanumeric `code` such as `42P01`) and translate it into
 * a message that is safe and helpful to show to end-users.
 */

import { logger } from "@rebasepro/server-core";

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
 * Extracts the PG error from the Drizzle cause chain when possible;
 * falls back to a generic message that doesn't leak SQL.
 *
 * @param error   - The raw caught error
 * @param context - A human-readable context string (e.g. collection path)
 * @returns An object with `message` (user-friendly) and optional `code` (PG code).
 */
export function sanitizeErrorForClient(error: unknown, context: string): { message: string; code?: string } {
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
