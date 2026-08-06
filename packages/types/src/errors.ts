/**
 * The error codes every route can produce, as `RebaseApiError.code`.
 *
 * These are the defaults on `ApiError`'s static constructors server-side, so
 * any endpoint can answer with one. They are **not** the complete set: routes
 * pass their own more specific codes too (`EMAIL_EXISTS`, `TOKEN_EXPIRED`,
 * `INVALID_BULK_BODY`, …), and auth alone defines a couple of dozen.
 *
 * Hence the union is deliberately open rather than closed. It exists to give
 * autocomplete and to catch a typo in the common cases — `code` was a bare
 * `string`, so `e.code === "NOT_FOUND"` and `e.code === "NOTFOUND"` were
 * equally valid and only one of them worked. Closing it would be a lie that
 * broke the moment a route added a code.
 *
 * @example
 * if (e instanceof RebaseApiError) {
 *   switch (e.code) {
 *     case "NOT_FOUND": return null;          // completed
 *     case "FORBIDDEN": return redirect();
 *     default: throw e;                       // routes' own codes land here
 *   }
 * }
 *
 * @group Errors
 */
export type RebaseErrorCode =
    | "BAD_REQUEST"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "INTERNAL_ERROR"
    | "SERVICE_UNAVAILABLE"
    | "DB_PERMISSION_DENIED"
    | "SCHEMA_DRIFT"
    // `string & {}` keeps the union open while preserving completion on the
    // literals above — a bare `| string` would collapse them and offer nothing.
    | (string & {});

/**
 * Structured initializer for {@link RebaseApiError}.
 *
 * @group Errors
 */
export interface RebaseErrorInit {
    /**
     * HTTP status code, when the error originated from an HTTP response.
     * Left `undefined` for realtime/WebSocket, network, and client-side
     * logic errors that have no HTTP status.
     */
    status?: number;
    /** Stable, machine-readable error code. See {@link RebaseErrorCode}. */
    code?: RebaseErrorCode;
    /** Structured error payload returned by the server, when present. */
    details?: unknown;
    /** The underlying error this one wraps, if any. */
    cause?: unknown;
}

/**
 * The single error type thrown across the entire Rebase client surface —
 * HTTP data/control-plane calls, realtime/WebSocket operations, and
 * client-side logic errors (e.g. an unknown collection accessor). A `catch`
 * block only ever needs to check for this one class:
 *
 * ```ts
 * import { RebaseApiError } from "@rebasepro/client"; // re-exported
 *
 * try {
 *   await client.data.products.update(id, { price: 9 });
 * } catch (e) {
 *   if (e instanceof RebaseApiError) {
 *     if (e.status === 404) { ... }   // HTTP failures carry a status
 *     console.error(e.code, e.details);
 *   }
 * }
 * ```
 *
 * `status` is present for HTTP failures and `undefined` otherwise, so its
 * presence distinguishes transport-level errors from realtime/logic errors.
 *
 * @group Errors
 */
export class RebaseApiError extends Error {
    /** HTTP status code, or `undefined` for non-HTTP errors. */
    readonly status?: number;
    /** Stable machine-readable error code, when the server supplied one. See {@link RebaseErrorCode}. */
    readonly code?: RebaseErrorCode;
    /** Structured error payload from the server, when present. */
    readonly details?: unknown;

    constructor(message: string, init: RebaseErrorInit = {}) {
        super(message);
        this.name = "RebaseApiError";
        this.status = init.status;
        this.code = init.code;
        this.details = init.details;
        if (init.cause !== undefined) {
            // `cause` is standard on Error but not always in the lib target's type.
            (this as { cause?: unknown }).cause = init.cause;
        }
    }
}

/**
 * Client-side logic error — raised before any request is made (e.g. accessing
 * an unknown collection accessor when a typed dictionary is configured).
 *
 * A subclass of {@link RebaseApiError} (with no `status`), so a single
 * `catch (e) { if (e instanceof RebaseApiError) ... }` handles it too.
 *
 * @group Errors
 */
export class RebaseClientError extends RebaseApiError {
    constructor(message: string) {
        super(message);
        this.name = "RebaseClientError";
    }
}
