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
    | "NETWORK_ERROR"
    | "OFFLINE"
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
     *
     * Three states, and they mean different things:
     *
     * - a real status — the server answered, and this is what it said;
     * - **`0`** — the request never reached a server: DNS, a refused
     *   connection, CORS, an abort. `XMLHttpRequest` has always spelled that
     *   `0`, and a fabricated 5xx would be indistinguishable from one the
     *   server actually sent. The original failure is on `cause`;
     * - `undefined` — nothing was sent at all: a realtime/WebSocket failure,
     *   or a client-side logic error raised before any request.
     */
    status?: number;
    /** Stable, machine-readable error code. See {@link RebaseErrorCode}. */
    code?: RebaseErrorCode;
    /** Structured error payload returned by the server, when present. */
    details?: unknown;
    /**
     * The server's correlation id for the request that failed, when it sent
     * one — the `requestId` in the error envelope, which also comes back on the
     * `X-Request-ID` header.
     *
     * The envelope has carried it for a while; the client dropped it on the
     * floor, so a bug report from an app could never quote the one string that
     * finds the server-side line.
     */
    requestId?: string;
    /**
     * Seconds to wait before retrying, from the response's `Retry-After`
     * header. Present on a 429 and on some 503s.
     *
     * Also dropped. The offline queue's own backoff therefore ignored a server
     * that had said exactly how long to wait — the one number that turns a
     * retry storm into a queue that drains.
     */
    retryAfterSeconds?: number;
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
    /** See {@link RebaseErrorInit.requestId}. Quote it in a bug report. */
    readonly requestId?: string;
    /** See {@link RebaseErrorInit.retryAfterSeconds}. */
    readonly retryAfterSeconds?: number;

    constructor(message: string, init: RebaseErrorInit = {}) {
        super(message);
        this.name = "RebaseApiError";
        this.status = init.status;
        this.code = init.code;
        this.details = init.details;
        this.requestId = init.requestId;
        this.retryAfterSeconds = init.retryAfterSeconds;
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
    /**
     * `init` is the same one {@link RebaseApiError} takes, and it is what makes
     * `code` reachable at all.
     *
     * The constructor used to accept a message and nothing else, so every
     * client-side failure — an undefined filter value, an unknown accessor,
     * `listen()` on a client built with `realtime: false`, a function name with
     * a `/` in it, `refreshSession()` while signed out — arrived with `code ===
     * undefined`. The documented `switch (e.code)` in this file's own example
     * fell to `default: throw e` for all of them, and the only client-side error
     * that *did* carry a code was `OFFLINE`, because that one path minted a
     * `RebaseApiError` instead.
     */
    constructor(message: string, init: RebaseErrorInit = {}) {
        super(message, init);
        this.name = "RebaseClientError";
    }
}

/**
 * Brand for a contract method a particular client cannot serve.
 *
 * `Symbol.for` rather than a fresh symbol: two copies of `@rebasepro/types` in
 * one tree — which happens, see `docs/dependency-duplication-traps.md` — must
 * agree about it, and a module-local symbol would not.
 */
const UNSUPPORTED_METHOD = Symbol.for("rebase.unsupportedMethod");

/**
 * Build the stub a client installs for a contract method it cannot serve.
 *
 * `listen`, `listenById` and `count` are part of `SDKCollectionClient`, not
 * optional extras — a caller should be able to write
 * `client.data.posts.count()` without asking first, and a transport that cannot
 * serve it should answer with a sentence naming the configuration that would,
 * rather than with `undefined is not a function` at the call site. Where the
 * transport genuinely cannot (a client built with `realtime: false`, a driver
 * with no `listenCollection`), it installs one of these instead of omitting the
 * method.
 *
 * @param message What to tell the caller, naming the fix.
 * @group Errors
 */
export function unsupportedMethod<F>(message: string): F {
    const stub = (): never => {
        // The two reasons a method is a stub — `realtime: false`, and a driver
        // with no `listenCollection` — are one thing to a caller: this client
        // cannot do realtime. One code covers both, and the message says which.
        throw new RebaseClientError(message, { code: "REALTIME_DISABLED" });
    };
    (stub as unknown as Record<symbol, boolean>)[UNSUPPORTED_METHOD] = true;
    return stub as unknown as F;
}

/**
 * Can this method actually do anything?
 *
 * `true` for a stub from {@link unsupportedMethod} **and** for a method that is
 * simply not there — a partial client, a hand-built test double, an
 * implementation written against an older shape of the interface. Both mean the
 * same thing to a caller, so both answer the same way, and an adapter that
 * checks this cannot be caught out by either.
 *
 * Ordinary code does not need it: calling the method and letting it throw is
 * the normal path. Adapters do — the admin panel chooses between subscribing
 * and a one-shot `find()` by asking whether the client can listen, and a UI
 * that subscribes into a throw is worse than one that polls. This is the
 * question `if (accessor.listen)` used to be asking, made explicit now that the
 * method is always there to call.
 *
 * @group Errors
 */
export function isUnsupported(method: unknown): boolean {
    if (typeof method !== "function") return true;
    return (method as unknown as Record<symbol, boolean>)[UNSUPPORTED_METHOD] === true;
}
