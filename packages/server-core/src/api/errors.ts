import { ErrorHandler } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";

/** Shape of Postgres / network errors with diagnostic codes */
interface PgLikeError {
    code?: string;
    address?: string;
    port?: number;
    message?: string;
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
    };
}

/**
 * Hono error-handling middleware (`app.onError`).
 * Converts any error into the canonical `{ error: { message, code } }` shape.
 */
export const errorHandler: ErrorHandler = (err, c) => {
    // Typecast custom error properties
    const error = err as Error & { statusCode?: number; code?: string; details?: unknown, name?: string };

    if (error instanceof ApiError || error.name === "ApiError") {
        // Operational errors — log at warn level
        console.warn(
            `⚠️ [API] ${c.req.method} ${c.req.path} → ${error.statusCode} ${error.code}: ${error.message}`
        );
        return c.json({
            error: {
                message: error.message,
                code: error.code || "INTERNAL_ERROR",
                ...(error.details !== undefined && { details: error.details })
            }
        } satisfies ErrorResponse, (error.statusCode || 500) as ContentfulStatusCode);
    }

    const statusCode = error.statusCode || codeToStatus(error.code) || 500;
    const code = error.code || "INTERNAL_ERROR";

    // Handle DB connection and specific system errors for better logging
    let logMessage = error.message;
    if (error.cause && typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause) {
        const cause = error.cause as PgLikeError;
        if (cause.code === 'ENETUNREACH') {
            logMessage = `Network unreachable. Cannot connect to database at ${cause.address}:${cause.port}.`;
        } else if (cause.code === 'ECONNREFUSED') {
            logMessage = `Connection refused to database at ${cause.address}:${cause.port}.`;
        } else if (cause.code === '42703' || cause.code === '42P01') {
            const issue = cause.code === '42703' ? 'column' : 'table';
            logMessage = `Database schema mismatch (${issue} missing): ${cause.message}. Did you forget to run migrations ('pnpm db:push' or 'pnpm db:migrate')?`;
        }
    } else if ('code' in error && error.code === 'ENETUNREACH') {
         const netErr = error as unknown as PgLikeError;
         logMessage = `Network unreachable. Cannot connect to service at ${netErr.address}:${netErr.port}.`;
    } else if ('code' in error && (error.code === '42703' || error.code === '42P01')) {
        const issue = error.code === '42703' ? 'column' : 'table';
        logMessage = `Database schema mismatch (${issue} missing): ${error.message}. Did you forget to run migrations ('pnpm db:push' or 'pnpm db:migrate')?`;
    }

    // Unexpected errors — log at error level
    console.error(
        `❌ [API] ${c.req.method} ${c.req.path} → ${statusCode} ${code}: ${logMessage}`
    );
    
    // Suppress the huge stack trace for known missing schema errors (it's noisy and not a code bug)
    const causePg = (error.cause && typeof error.cause === 'object') ? (error.cause as PgLikeError) : undefined;
    const pgErrorCode = causePg?.code || error.code;
    if (pgErrorCode !== '42703' && pgErrorCode !== '42P01') {
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
    } else if (pgErrorCode === '42703' || pgErrorCode === '42P01') {
        const issue = pgErrorCode === '42703' ? 'column' : 'table';
        clientMessage = `Database schema mismatch (${issue} missing). Ensure backend migrations are up to date!`;
    } else if (code === 'INTERNAL_ERROR') {
        clientMessage = "Internal Server Error";
    }

    return c.json({
        error: {
            message: clientMessage,
            code,
            ...(error.details !== undefined && { details: error.details })
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
        INTERNAL_ERROR: 500,
        NOT_CONFIGURED: 503,
        SERVICE_UNAVAILABLE: 503,
    };
    return map[code];
}


