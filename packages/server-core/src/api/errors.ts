import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HonoEnv } from "./types";

/** Tracks whether we've already shown the doctor hint (once per process). */
let _schemaDriftHinted = false;

/** Shape of Postgres / network errors with diagnostic codes */
interface PgLikeError {
    code?: string;
    address?: string;
    port?: number;
    message?: string;
    table?: string;
    column?: string;
    schema?: string;
}

/**
 * Extract the missing table or column name from a PG error.
 * PG 42P01 messages look like: 'relation "my_table" does not exist'
 * PG 42703 messages look like: 'column "my_col" does not exist' or 'column my_table.my_col does not exist'
 */
function extractMissingIdentifier(pgMessage?: string): string | null {
    if (!pgMessage) return null;
    // Match quoted identifier: relation "xxx" / column "xxx"
    const quoted = pgMessage.match(/(?:relation|column|table)\s+"([^"]+)"/i);
    if (quoted) return quoted[1];
    // Match unquoted: column table.col does not exist
    const unquoted = pgMessage.match(/(?:relation|column|table)\s+([\w.]+)\s+does not exist/i);
    if (unquoted) return unquoted[1];
    return null;
}

/**
 * Standardized API error class.
 * Throw this from any route handler — the errorHandler middleware
 * will format it into `{ error: { message, code, details? } }`.
 */
export class ApiError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details?: unknown;

    constructor(statusCode: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }

    // ── Factory methods ──────────────────────────────────────────────

    static badRequest(message: string, code = "BAD_REQUEST", details?: unknown): ApiError {
        return new ApiError(400, code, message, details);
    }

    static unauthorized(message: string, code = "UNAUTHORIZED"): ApiError {
        return new ApiError(401, code, message);
    }

    static forbidden(message: string, code = "FORBIDDEN"): ApiError {
        return new ApiError(403, code, message);
    }

    static notFound(message: string, code = "NOT_FOUND"): ApiError {
        return new ApiError(404, code, message);
    }

    static conflict(message: string, code = "CONFLICT"): ApiError {
        return new ApiError(409, code, message);
    }

    static internal(message: string, code = "INTERNAL_ERROR"): ApiError {
        return new ApiError(500, code, message);
    }

    static serviceUnavailable(message: string, code = "SERVICE_UNAVAILABLE"): ApiError {
        return new ApiError(503, code, message);
    }
}

/**
 * Canonical error response shape:
 * `{ error: { message: string, code: string, details?: unknown } }`
 */
export interface ErrorResponse {
    error: {
        message: string;
        code: string;
        details?: unknown;
        /** Request correlation ID for tracing (echoes X-Request-ID). */
        requestId?: string;
    };
}

/**
 * General shape of errors that flow through the API error handler.
 * Extends Error with optional HTTP status, error code, and details.
 */
export interface RebaseApiError extends Error {
    statusCode?: number;
    code?: string;
    details?: unknown;
}

/**
 * Type guard for errors that carry optional API metadata (statusCode, code, details).
 * Returns true for any Error instance — the optional properties are then
 * checked via normal property access.
 */
export function isRebaseApiError(error: unknown): error is RebaseApiError {
    return error instanceof Error;
}

/**
 * Hono error-handling middleware (`app.onError`).
 * Converts any error into the canonical `{ error: { message, code } }` shape.
 */
export const errorHandler: ErrorHandler<HonoEnv> = (err, c) => {
    // Typecast custom error properties
    const error: RebaseApiError = err;
    const reqId = typeof c.get === "function" ? c.get("requestId") : undefined;

    if (error instanceof ApiError || error.name === "ApiError") {
        // Operational errors — log at warn level
        console.warn(
            `⚠️ [API] ${c.req.method} ${c.req.path} → ${error.statusCode} ${error.code}: ${error.message}` +
            (reqId ? ` [${reqId}]` : "")
        );
        return c.json({
            error: {
                message: error.message,
                code: error.code || "INTERNAL_ERROR",
                ...(error.details !== undefined && { details: error.details }),
                ...(reqId && { requestId: reqId })
            }
        } satisfies ErrorResponse, (error.statusCode || 500) as ContentfulStatusCode);
    }

    const statusCode = error.statusCode || codeToStatus(error.code) || 500;
    let code = error.code || "INTERNAL_ERROR";

    // Handle DB connection and specific system errors for better logging
    let logMessage = error.message;
    if (error.cause && typeof error.cause === "object" && error.cause !== null && "code" in error.cause) {
        const cause = error.cause as PgLikeError;
        if (cause.code === "ENETUNREACH") {
            logMessage = `Network unreachable. Cannot connect to database at ${cause.address}:${cause.port}.`;
        } else if (cause.code === "ECONNREFUSED") {
            logMessage = `Connection refused to database at ${cause.address}:${cause.port}.`;
        } else if (cause.code === "42703" || cause.code === "42P01") {
            code = "SCHEMA_DRIFT";
            const issue = cause.code === "42703" ? "column" : "table";
            const identifier = cause.table || cause.column || extractMissingIdentifier(cause.message) || "unknown";
            logMessage = `Schema drift: ${issue} "${identifier}" does not exist in the database. Run \`pnpm db:push\` to sync your schema, or \`pnpm db:migrate\` to apply pending migrations.`;
        }
    } else if ("code" in error && error.code === "ENETUNREACH") {
         const netErr = error as PgLikeError;
         logMessage = `Network unreachable. Cannot connect to service at ${netErr.address}:${netErr.port}.`;
    } else if ("code" in error && (error.code === "42703" || error.code === "42P01")) {
        code = "SCHEMA_DRIFT";
        const issue = error.code === "42703" ? "column" : "table";
        const pgErr = error as PgLikeError;
        const identifier = pgErr.table || pgErr.column || extractMissingIdentifier(error.message) || "unknown";
        logMessage = `Schema drift: ${issue} "${identifier}" does not exist in the database. Run \`pnpm db:push\` to sync your schema, or \`pnpm db:migrate\` to apply pending migrations.`;
    }

    const causePg = (error.cause && typeof error.cause === "object") ? (error.cause as PgLikeError) : undefined;
    const pgErrorCode = causePg?.code || error.code;
    const isDbSchemaMismatch = code === "SCHEMA_DRIFT" || pgErrorCode === "42703" || pgErrorCode === "42P01";

    if (isDbSchemaMismatch) {
        // Database schema mismatch is logged as a warning instead of a fatal error
        console.warn(
            `⚠️ [API] ${c.req.method} ${c.req.path} → ${statusCode} ${code}: ${logMessage}` +
            (reqId ? ` [${reqId}]` : "")
        );
        // In dev mode, show a one-time hint to run `rebase doctor`
        if (!_schemaDriftHinted && process.env.NODE_ENV !== "production") {
            _schemaDriftHinted = true;
            console.warn([
                "",
                "┌──────────────────────────────────────────────────────────────┐",
                "│  💡 TIP: Run `rebase doctor` for full schema diagnostics    │",
                "│                                                             │",
                "│  Quick fixes:                                               │",
                "│    pnpm db:push      sync schema to database (dev)          │",
                "│    pnpm db:migrate   generate + apply migration (prod)      │",
                "│    rebase doctor     full 3-way drift report                │",
                "└──────────────────────────────────────────────────────────────┘",
                ""
            ].join("\n"));
        }
    } else {
        // Unexpected errors — log at error level
        console.error(
            `❌ [API] ${c.req.method} ${c.req.path} → ${statusCode} ${code}: ${logMessage}` +
            (reqId ? ` [${reqId}]` : "")
        );
    }

    // Suppress the huge stack trace for known DB errors (it's noisy and leaks SQL)
    const suppressStack = isDbSchemaMismatch || (statusCode < 500 && code === "BAD_REQUEST");
    if (!suppressStack) {
        console.error(error.stack || error);
    }

    // Sanitize the message for the client to prevent leaking sensitive details
    // like SQL queries or internal IP addresses.
    let clientMessage = "An unexpected error occurred";
    if (statusCode < 500 && error.message) {
        // If it's a 4xx error (e.g. from validation), it's generally safe to send the message
        clientMessage = error.message;
    } else if (error instanceof ApiError || error.name === "ApiError") {
        // We already handled ApiError above, but just in case
        clientMessage = error.message;
    } else if (code === "SCHEMA_DRIFT") {
        const pgErr = causePg || (error as PgLikeError);
        const issue = (pgErr.code === "42703" || pgErrorCode === "42703") ? "column" : "table";
        const identifier = pgErr.table || pgErr.column || extractMissingIdentifier(pgErr.message || error.message) || "unknown";
        clientMessage = `Schema drift: ${issue} "${identifier}" does not exist. Run \`pnpm db:push\` to sync your schema.`;
    } else if (code === "INTERNAL_ERROR") {
        clientMessage = "Internal Server Error";
    }

    return c.json({
        error: {
            message: clientMessage,
            code,
            ...(error.details !== undefined && { details: error.details }),
            ...(reqId && { requestId: reqId })
        }
    } satisfies ErrorResponse, statusCode as ContentfulStatusCode);
};

/**
 * Map known error codes to HTTP status codes.
 */
function codeToStatus(code?: string): number | undefined {
    if (!code) return undefined;
    const map: Record<string, number> = {
        BAD_REQUEST: 400,
        INVALID_INPUT: 400,
        WEAK_PASSWORD: 400,
        UNAUTHORIZED: 401,
        INVALID_CREDENTIALS: 401,
        INVALID_TOKEN: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        EMAIL_EXISTS: 409,
        ROLE_EXISTS: 409,
        SCHEMA_DRIFT: 500,
        INTERNAL_ERROR: 500,
        NOT_CONFIGURED: 503,
        SERVICE_UNAVAILABLE: 503
    };
    return map[code];
}


