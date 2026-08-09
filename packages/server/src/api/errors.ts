import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HonoEnv } from "./types";
import { logger } from "../utils/logger";

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
    detail?: string;
    hint?: string;
    constraint?: string;
}

/** 5-character SQLSTATE, e.g. `42501`, `23505`. */
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

/**
 * Walk the cause chain for the underlying database error, identified by a
 * 5-char SQLSTATE `code`. Drizzle wraps the pg error in `.cause`, and route
 * code sometimes wraps drizzle again, so the real error may sit several
 * levels down.
 */
function extractDbError(error: unknown, depth = 0): PgLikeError | null {
    if (!error || typeof error !== "object" || depth > 8) return null;
    const e = error as PgLikeError & { cause?: unknown };
    if (typeof e.code === "string" && SQLSTATE_RE.test(e.code)) return e;
    if (e.cause && typeof e.cause === "object") return extractDbError(e.cause, depth + 1);
    return null;
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
    /**
     * Whether this outcome is a routine part of normal operation rather than
     * something an operator should look at. Expected errors log at debug; every
     * other operational error logs at warn.
     *
     * The motivating case is `POST /auth/refresh` with no session: clients
     * refresh on page load before they know whether one exists, so every
     * anonymous page view is a 401 — correct, and not worth a warning line.
     *
     * The other class is a caller-caused 4xx that never reached the database: a
     * mistyped filter operator, sort direction or limit, a request for a
     * collection that does not exist. Nothing on this server is wrong, and the
     * response body has already told the caller what to fix — while one client
     * holding a stale name would otherwise write a warning per request, forever,
     * until the level means nothing. See `api/rest/query-parser.ts`.
     *
     * What stays at warn is anything that says something about the *server*:
     * a schema that has drifted from the code, a permission the database
     * refused, a dependency that failed. Those are 4xx too, and they are still
     * incidents.
     */
    public readonly expected: boolean;

    constructor(statusCode: number, code: string, message: string, details?: unknown, expected = false) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.expected = expected;
    }

    // ── Factory methods ──────────────────────────────────────────────

    static badRequest(message: string, code = "BAD_REQUEST", details?: unknown): ApiError {
        return new ApiError(400, code, message, details);
    }

    static unauthorized(message: string, code = "UNAUTHORIZED"): ApiError {
        return new ApiError(401, code, message);
    }

    /**
     * A 401 that is a normal outcome, not an incident — logged at debug.
     * See {@link ApiError.expected}.
     */
    static unauthenticated(message: string, code = "UNAUTHORIZED"): ApiError {
        return new ApiError(401, code, message, undefined, true);
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

// `isRebaseApiError` was here. It read `return error instanceof Error`, so it
// answered yes to every error while being named and used as though it
// discriminated — the create and update handlers guarded a "classify this as
// BAD_REQUEST" branch on it, and an unreachable database was therefore reported
// to callers as a bad request. Deleted rather than repaired: the shape it
// claimed to test is not decidable from an `Error`, and the layer that does
// know — the driver, which holds the SQLSTATE — raises a real `ApiError`.

/**
 * Hono error-handling middleware (`app.onError`).
 * Converts any error into the canonical `{ error: { message, code } }` shape.
 */
export const errorHandler: ErrorHandler<HonoEnv> = (err, c) => {
    // Typecast custom error properties
    const error: RebaseApiError = err;
    const reqId = typeof c.get === "function" ? c.get("requestId") : undefined;

    if (error instanceof ApiError || error.name === "ApiError") {
        // Operational errors — log at warn, unless the error declares itself a
        // routine outcome (see ApiError.expected), which would otherwise put a
        // warning in the log for every anonymous page view.
        const expected = error instanceof ApiError && error.expected;
        const line = `[API] ${c.req.method} ${c.req.path} → ${error.statusCode} ${error.code}: ${error.message}` +
            (reqId ? ` [${reqId}]` : "");
        if (expected) {
            logger.debug(line);
        } else {
            logger.warn(`⚠️ ${line}`);
        }
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

    // Resolve the actual cause — Node's net module wraps dual-stack failures
    // in an AggregateError whose inner errors carry the real address/port.
    let resolvedCause: PgLikeError | undefined;
    if (error.cause && typeof error.cause === "object" && error.cause !== null && "code" in error.cause) {
        const cause = error.cause as PgLikeError & { errors?: PgLikeError[] };
        if (cause.code === "ECONNREFUSED" && !cause.address && Array.isArray(cause.errors)) {
            // AggregateError — pick the first inner error that has address info
            resolvedCause = cause.errors.find(e => e.address) || cause;
        } else {
            resolvedCause = cause;
        }
    }

    // The real database error may sit several levels down the cause chain.
    // Losing it turns a precise failure (e.g. an RLS denial) into an opaque
    // "Failed query: …" 500 that is undiagnosable without direct DB access.
    const dbError = extractDbError(error);

    if (resolvedCause && (resolvedCause.code === "ENETUNREACH" || resolvedCause.code === "ECONNREFUSED")) {
        const cause = resolvedCause;
        if (cause.code === "ENETUNREACH") {
            logMessage = `Network unreachable. Cannot connect to database at ${cause.address}:${cause.port}.`;
        } else {
            logMessage = `Connection refused to database at ${cause.address}:${cause.port}. Is PostgreSQL running?`;
        }
    } else if ("code" in error && error.code === "ENETUNREACH") {
         const netErr = error as PgLikeError;
         logMessage = `Network unreachable. Cannot connect to service at ${netErr.address}:${netErr.port}.`;
    } else if (dbError && (dbError.code === "42703" || dbError.code === "42P01")) {
        code = "SCHEMA_DRIFT";
        const issue = dbError.code === "42703" ? "column" : "table";
        const identifier = dbError.table || dbError.column || extractMissingIdentifier(dbError.message) || "unknown";
        logMessage = `Schema drift: ${issue} "${identifier}" does not exist in the database. Run \`pnpm db:push\` to sync your schema, or \`pnpm db:migrate\` to apply pending migrations.`;
    } else if (dbError) {
        const parts = [`[PG ${dbError.code}] ${dbError.message}`];
        if (dbError.detail) parts.push(`Detail: ${dbError.detail}`);
        if (dbError.hint) parts.push(`Hint: ${dbError.hint}`);
        if (dbError.table) parts.push(`Table: ${dbError.table}`);
        if (dbError.column) parts.push(`Column: ${dbError.column}`);
        if (dbError.constraint) parts.push(`Constraint: ${dbError.constraint}`);
        if (dbError.code === "42501") {
            code = "DB_PERMISSION_DENIED";
            parts.push(
                "The database rejected the statement for lack of privilege — usually a row-level " +
                `security policy${dbError.table ? ` on "${dbError.table}"` : ""} denying this role, ` +
                "or a stale FORCE ROW LEVEL SECURITY flag binding the owner connection."
            );
        }
        logMessage = parts.join(". ");
    }

    const isDbSchemaMismatch = code === "SCHEMA_DRIFT";

    if (isDbSchemaMismatch) {
        // Database schema mismatch is logged as a warning instead of a fatal error
        logger.warn(
            `⚠️ [API] ${c.req.method} ${c.req.path} → ${statusCode} ${code}: ${logMessage}` +
            (reqId ? ` [${reqId}]` : "")
        );
        // In dev mode, show a one-time hint to run `rebase doctor`
        if (!_schemaDriftHinted && process.env.NODE_ENV !== "production") {
            _schemaDriftHinted = true;
            logger.warn([
                "",
                "┌──────────────────────────────────────────────────────────────┐",
                "│  💡 TIP: Run `rebase doctor` for full schema diagnostics    │",
                "│                                                             │",
                "│  Quick fixes (local dev, against DATABASE_URL):             │",
                "│    pnpm db:push      sync schema to database (dev)          │",
                "│    pnpm db:migrate   generate + apply migration (prod)      │",
                "│    rebase doctor     full 3-way drift report                │",
                "│                                                             │",
                "│  Managed cloud: the runtime applies schema + RLS at boot    │",
                "│  (REBASE_MIGRATE_ON_BOOT); redeploy rather than db:push,    │",
                "│  which cannot reach the tenant database.                    │",
                "└──────────────────────────────────────────────────────────────┘",
                ""
            ].join("\n"));
        }
    } else {
        // Unexpected errors — log at error level
        logger.error(
            `❌ [API] ${c.req.method} ${c.req.path} → ${statusCode} ${code}: ${logMessage}` +
            (reqId ? ` [${reqId}]` : "")
        );
    }

    // Suppress the huge stack trace for known DB errors: it is noisy, and the
    // extracted [PG …] line above carries the signal. The SQL and the bound
    // params it used to leak are no longer this branch's problem — `logger`
    // strips Drizzle's `Failed query: … / params: …` wrapper out of every
    // message and stack it emits, so the fallbacks below (a connection dropped
    // mid-statement carries no SQLSTATE, so `dbError` is null and the stack is
    // logged) are covered too.
    const suppressStack = isDbSchemaMismatch || dbError !== null || (statusCode < 500 && code === "BAD_REQUEST");
    if (!suppressStack) {
        logger.error(String(error.stack || error));
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
        const pgErr = dbError || (error as PgLikeError);
        const issue = pgErr.code === "42703" ? "column" : "table";
        const identifier = pgErr.table || pgErr.column || extractMissingIdentifier(pgErr.message || error.message) || "unknown";
        clientMessage = `Schema drift: ${issue} "${identifier}" does not exist. Run \`pnpm db:push\` to sync your schema.`;
    } else if (code === "DB_PERMISSION_DENIED") {
        clientMessage = `Permission denied by the database${dbError?.table ? ` on "${dbError.table}"` : ""} (row-level security). Check the RLS policies for this table.`;
    } else if (code === "INTERNAL_ERROR") {
        clientMessage = "Internal Server Error";
    }

    // Database diagnostics for the envelope: the SQLSTATE is always safe to
    // return; message/detail/hint can reference schema internals, so only
    // outside production.
    const dbDetails = dbError ? {
        dbCode: dbError.code,
        ...(process.env.NODE_ENV !== "production" && {
            dbMessage: dbError.message,
            ...(dbError.detail && { detail: dbError.detail }),
            ...(dbError.hint && { hint: dbError.hint })
        })
    } : undefined;

    return c.json({
        error: {
            message: clientMessage,
            code,
            ...(error.details !== undefined
                ? { details: error.details }
                : dbDetails !== undefined ? { details: dbDetails } : {}),
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
        DB_PERMISSION_DENIED: 500,
        INTERNAL_ERROR: 500,
        NOT_CONFIGURED: 503,
        SERVICE_UNAVAILABLE: 503
    };
    return map[code];
}


