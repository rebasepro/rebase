import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HonoEnv } from "./types";
import { logger } from "../utils/logger";
import { hostEnv } from "../utils/host";

/**
 * A stale caller's schema stamp, as the cause of the error it explains.
 *
 * `createSchemaDriftDetector` puts the two stamps on the context when a request
 * carries an `x-rebase-schema` older than this backend's. It lives next door;
 * this half is here because `errors.ts` is in the graph of
 * `@rebasepro/server/functions` and may not reach `@rebasepro/types` at runtime.
 */
function schemaDriftCause(drift: { client: string; server: string } | undefined): {
    code: string;
    message: string;
    clientSchema: string;
    serverSchema: string;
} | undefined {
    if (!drift) return undefined;
    return {
        code: "SCHEMA_DRIFT",
        message:
            `This client was generated against schema ${drift.client}; this backend serves `
            + `${drift.server}. If the field named above was renamed or removed, regenerate the `
            + "SDK (`rebase generate-sdk`) and rebuild.",
        clientSchema: drift.client,
        serverSchema: drift.server
    };
}

/** Tracks whether we've already shown the doctor hint (once per process). */
let _schemaDriftHinted = false;

/**
 * The schema-drift remedy, in the words that work on *this* database.
 *
 * The three copies of this message hard-coded `Run \`pnpm db:push\``, and on a
 * stock scaffold — where the managed PGlite database is the default — that
 * command answers `✗ rebase db push does not work on the managed development
 * database.` and exits 1. So the one instruction the server gave when a
 * developer's schema had drifted was a command their project refuses.
 *
 * Atlas plans a push by diffing against a second, empty database, and PGlite
 * serves exactly one — which is why it cannot run there, and why the remedy
 * has to know which database is under this run. There, boot applies additive
 * changes, so restarting `rebase dev` *is* the fix.
 *
 * `REBASE_DEV_DATABASE_KIND` is set by the CLI from the database it resolved,
 * the same variable `rebase schema generate`'s closing line already branches
 * on. Absent — a deployed backend, a container, anything not started by
 * `rebase dev` — the answer is the general one.
 */
export function schemaDriftRemedy(): { short: string; lines: string[] } {
    if (hostEnv().REBASE_DEV_DATABASE_KIND === "managed") {
        return {
            short: "Restart `rebase dev` — boot applies additive schema changes to the managed database.",
            lines: [
                "  Quick fixes (managed development database):",
                "    restart `rebase dev`   boot applies additive changes",
                "    rebase doctor          full 3-way drift report",
                "",
                "  `rebase db push` does not run here: Atlas plans against a",
                "  second, empty database and PGlite serves one. For a change",
                "  boot leaves alone, use your own Postgres (DATABASE_URL)",
                "  or `rebase dev --docker`."
            ]
        };
    }

    return {
        short: "Run `rebase db push` to sync your schema, or `rebase db migrate` to apply pending migrations.",
        lines: [
            "  Quick fixes (local dev, against DATABASE_URL):",
            "    rebase db push        sync schema to database (dev)",
            "    rebase db migrate     apply pending migrations (prod)",
            "    rebase doctor         full 3-way drift report",
            "",
            "  Managed cloud: the runtime applies schema + RLS at boot",
            "  (REBASE_MIGRATE_ON_BOOT); redeploy rather than db push,",
            "  which cannot reach the tenant database."
        ]
    };
}

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
 * What SQLSTATE 25006 means here, in the only terms that help the author fix it.
 *
 * Every request-scoped read runs `withTransaction(..., { accessMode: "read
 * only" })`, so a write attempted anywhere under it — including from a
 * `context.data` call inside an `afterRead` callback — is refused by Postgres
 * rather than by us. The callback name is in the message because that is the
 * file the reader has to open, and nothing else on a read path can raise this.
 */
const READ_ONLY_TRANSACTION_MESSAGE =
    "An `afterRead` callback tried to write. Request-scoped reads run in a READ ONLY " +
    "transaction, so neither the callback nor anything it calls (context.data included) " +
    "may write. Move the write outside the read: enqueue a background job, or use " +
    "`rebase.dataAsAdmin` from a job or a custom function.";

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
        /**
         * Why this request was going to fail whatever it asked for.
         *
         * Only `SCHEMA_DRIFT` today: the caller's `x-rebase-schema` stamp is
         * older than this backend's, so a 400 naming an unknown field is very
         * likely a rename the client has not regenerated for. The error itself
         * is unchanged — this explains it, it does not cause it.
         */
        cause?: {
            code: string;
            message: string;
            clientSchema: string;
            serverSchema: string;
        };
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
 * Leave the code and the message where the request log will find them.
 *
 * A failed request used to produce two lines, each holding half of it: this
 * handler had the code and the diagnosis, `requestLogger` had the user, the
 * collection, the status and the latency. Correlating them meant matching on
 * the request id — which only one of them printed reliably — and the pair cost
 * twice the volume for less than one line's worth of meaning.
 */
function handOffToRequestLog(c: Context<HonoEnv>, code: string, message: string): void {
    if (typeof c.set !== "function") return;
    c.set("errorSummary", { code, message });
}

/**
 * Is a request line coming for this request?
 *
 * `requestLogger` claims it before the handler runs, so by the time an error
 * reaches here the answer is already known. When nothing claimed it — a router
 * a project mounted onto its own Hono app, a test driving `app.fetch`
 * directly — this handler stays the only thing that would report the failure,
 * so it still writes its own line. Silence is the one outcome neither half may
 * produce.
 */
function requestWillBeLogged(c: Context<HonoEnv>): boolean {
    return typeof c.get === "function" && c.get("requestLogged") === true;
}

/**
 * Hono error-handling middleware (`app.onError`).
 * Converts any error into the canonical `{ error: { message, code } }` shape.
 */
export const errorHandler: ErrorHandler<HonoEnv> = (err, c) => {
    // Typecast custom error properties
    const error: RebaseApiError = err;
    const reqId = typeof c.get === "function" ? c.get("requestId") : undefined;

    // `RebaseApiError` from `@rebasepro/types` is the browser-safe error class,
    // and the only one a `config/collections/*.ts` file can throw — that file is
    // bundled into the admin SPA, so it may not import the server package. It
    // spells its status `status` rather than `statusCode`, so normalize it here
    // and one class then works from a collection callback, a custom function and
    // the SDK alike.
    //
    // Matched by name rather than `instanceof`: a monorepo can resolve two
    // copies of @rebasepro/types, and `instanceof` is false across them.
    const isBrowserSafeError = /^Rebase(Api|Client)Error$/.test(error.name);

    /* A stale SDK, named on the errors it explains.

       400 and 404 only: those are what a renamed or removed field produces —
       an unknown filter field is a 400, a collection gone from under its slug
       is a 404 — and they are the two a caller can act on by regenerating.
       Attaching it to a 500 would be noise, since a server fault has nothing to
       do with how old the caller's schema is. */
    const driftFor = (status: number) =>
        (status === 400 || status === 404) && typeof c.get === "function"
            ? schemaDriftCause(c.get("schemaDrift"))
            : undefined;

    if (isBrowserSafeError && error.statusCode === undefined) {
        const status = (error as unknown as { status?: unknown }).status;
        if (typeof status === "number") error.statusCode = status;
    }

    if (error instanceof ApiError || error.name === "ApiError"
        || (isBrowserSafeError && typeof error.statusCode === "number")) {
        // Operational errors — log at warn, unless the error declares itself a
        // routine outcome (see ApiError.expected), which would otherwise put a
        // warning in the log for every anonymous page view.
        const expected = error instanceof ApiError && error.expected;
        handOffToRequestLog(c, error.code || "INTERNAL_ERROR", error.message);
        if (!requestWillBeLogged(c)) {
            const line = `[API] ${c.req.method} ${c.req.path} → ${error.statusCode} ${error.code}: ${error.message}` +
                (reqId ? ` [${reqId}]` : "");
            if (expected) {
                logger.debug(line);
            } else {
                logger.warn(`⚠️ ${line}`);
            }
        }
        const apiErrorStatus = error.statusCode || 500;
        const apiErrorDrift = driftFor(apiErrorStatus);
        return c.json({
            error: {
                message: error.message,
                code: error.code || "INTERNAL_ERROR",
                ...(error.details !== undefined && { details: error.details }),
                ...(reqId && { requestId: reqId }),
                ...(apiErrorDrift && { cause: apiErrorDrift })
            }
        } satisfies ErrorResponse, apiErrorStatus as ContentfulStatusCode);
    }

    let statusCode = error.statusCode || codeToStatus(error.code) || 500;
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
        logMessage = `Schema drift: ${issue} "${identifier}" does not exist in the database. ${schemaDriftRemedy().short}`;
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
        // 25006 read_only_sql_transaction. A request-scoped read opens its
        // transaction `READ ONLY`, so the only way to reach this is user code on
        // a read path attempting a write — which means an `afterRead` callback,
        // or something it called. Left in the generic branch it was a 500
        // "Internal Server Error", indistinguishable from the database being
        // down; it is the caller's own code, and it is not a server failure.
        if (dbError.code === "25006") {
            code = "READ_ONLY_TRANSACTION";
            statusCode = 409;
            parts.push(READ_ONLY_TRANSACTION_MESSAGE);
        }
        logMessage = parts.join(". ");
    }

    const isDbSchemaMismatch = code === "SCHEMA_DRIFT";

    // `logMessage`, not the sanitized client message: the request line is a
    // server log, and the whole point of this branch is the diagnosis it built.
    handOffToRequestLog(c, code, logMessage);

    if (isDbSchemaMismatch) {
        // Database schema mismatch is logged as a warning instead of a fatal error
        if (!requestWillBeLogged(c)) logger.warn(
            `⚠️ [API] ${c.req.method} ${c.req.path} → ${statusCode} ${code}: ${logMessage}` +
            (reqId ? ` [${reqId}]` : "")
        );
        // In dev mode, show a one-time hint to run `rebase doctor`
        if (!_schemaDriftHinted && hostEnv().NODE_ENV !== "production") {
            _schemaDriftHinted = true;
            // Drawn rather than hand-aligned: the remedy inside it now varies
            // with the database, and a box whose rows were padded by hand
            // stayed straight only for the text it was written around.
            const WIDTH = 62;
            const row = (text: string) => `│${text.padEnd(WIDTH).slice(0, WIDTH)}│`;
            logger.warn([
                "",
                `┌${"─".repeat(WIDTH)}┐`,
                // One space short, deliberately: the emoji occupies two columns
                // in a terminal and one in `String.length`.
                `│${"  💡 TIP: Run `rebase doctor` for full schema diagnostics".padEnd(WIDTH - 1)}│`,
                row(""),
                ...schemaDriftRemedy().lines.map(row),
                `└${"─".repeat(WIDTH)}┘`,
                ""
            ].join("\n"));
        }
    } else if (code === "READ_ONLY_TRANSACTION") {
        // A 4xx: the application's own callback, refused. Not a server fault, so
        // not an ❌ in the log either — and, like the drift arm above, not a
        // second line when the request log is already going to carry it.
        if (!requestWillBeLogged(c)) logger.warn(
            `⚠️ [API] ${c.req.method} ${c.req.path} → ${statusCode} ${code}: ${logMessage}` +
            (reqId ? ` [${reqId}]` : "")
        );
    } else if (!requestWillBeLogged(c)) {
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
        // The error goes in as a value, not as `String(error.stack)`. A string
        // is a leaf to the logger: `serialiseError` — the `.cause`/
        // `AggregateError` walker the boot path relies on — never runs on one,
        // so the request path used to print the outer wrapper's stack and drop
        // the sentence that says what actually failed (`connect ECONNRESET`,
        // sitting two `.cause` links down). Structured, it walks the chain and
        // redacts each link on the way.
        logger.error("unhandled request error", { error });
    }

    // Sanitize the message for the client to prevent leaking sensitive details
    // like SQL queries or internal IP addresses.
    let clientMessage = "An unexpected error occurred";
    if (code === "READ_ONLY_TRANSACTION") {
        // Ahead of the generic 4xx arm below, which would echo the raw driver
        // message ("Failed query: insert into …") back to the caller.
        clientMessage = READ_ONLY_TRANSACTION_MESSAGE;
    } else if (statusCode < 500 && error.message) {
        // If it's a 4xx error (e.g. from validation), it's generally safe to send the message
        clientMessage = error.message;
    } else if (error instanceof ApiError || error.name === "ApiError") {
        // We already handled ApiError above, but just in case
        clientMessage = error.message;
    } else if (code === "SCHEMA_DRIFT") {
        const pgErr = dbError || (error as PgLikeError);
        const issue = pgErr.code === "42703" ? "column" : "table";
        const identifier = pgErr.table || pgErr.column || extractMissingIdentifier(pgErr.message || error.message) || "unknown";
        clientMessage = `Schema drift: ${issue} "${identifier}" does not exist. ${schemaDriftRemedy().short}`;
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
        ...(hostEnv().NODE_ENV !== "production" && {
            dbMessage: dbError.message,
            ...(dbError.detail && { detail: dbError.detail }),
            ...(dbError.hint && { hint: dbError.hint })
        })
    } : undefined;

    const drift = driftFor(statusCode);

    return c.json({
        error: {
            message: clientMessage,
            code,
            ...(error.details !== undefined
                ? { details: error.details }
                : dbDetails !== undefined ? { details: dbDetails } : {}),
            ...(reqId && { requestId: reqId }),
            ...(drift && { cause: drift })
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
        READ_ONLY_TRANSACTION: 409,
        SCHEMA_DRIFT: 500,
        DB_PERMISSION_DENIED: 500,
        INTERNAL_ERROR: 500,
        NOT_CONFIGURED: 503,
        SERVICE_UNAVAILABLE: 503
    };
    return map[code];
}


