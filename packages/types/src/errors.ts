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
    /** Stable, machine-readable error code (e.g. `"NOT_FOUND"`, `"BAD_REQUEST"`). */
    code?: string;
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
    /** Stable machine-readable error code, when the server supplied one. */
    readonly code?: string;
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
