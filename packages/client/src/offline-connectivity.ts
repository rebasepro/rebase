import { RebaseApiError } from "./transport";

/**
 * Whether the network is worth trying, and when to try again after it wasn't.
 *
 * `navigator.onLine` is necessary but not sufficient: it reports the state of
 * the network interface, so it stays `true` behind a captive portal, on a
 * connection that resolves DNS but reaches nothing, and while the API itself
 * is down. This tracks what actually happened to requests as well, so the
 * first failure is the only one an app pays for — everything after it inside
 * the backoff window skips the doomed round trip and answers from the local
 * store immediately, which is the difference between an app that freezes when
 * the wifi drops and one that does not.
 */

/** The request never reached the server, so nothing was decided by it. */
export function isNetworkError(error: unknown): boolean {
    if (error instanceof RebaseApiError) {
        // A 0 status is what a transport reports when it has no response at all.
        return error.status === 0;
    }
    // fetch rejects with TypeError on network failure in every runtime we
    // support (browsers: "Failed to fetch"/"Load failed"; undici: "fetch
    // failed").
    if (error instanceof TypeError) return true;
    const name = (error as { name?: string } | undefined)?.name;
    // AbortError covers both an explicit abort and a fetch timeout; the others
    // are what Node and Safari surface for a dropped connection.
    return name === "AbortError" || name === "TimeoutError" || name === "NetworkError";
}

/**
 * Statuses that mean "not now" rather than "not ever": a queued write that
 * gets one of these is worth replaying, while a 400 or a 403 never will be.
 * 500 is deliberately absent — an unhandled server error is far more often a
 * bug the same payload will hit again than a blip, and retrying it forever
 * jams every write behind it.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

/**
 * The server holds this key for a request it has not answered yet.
 *
 * It is a 409 like a duplicate row is a 409, and nothing but the code separates
 * them — one means "your write is already there", the other means "your write
 * may not have happened at all, ask again".
 */
const IDEMPOTENCY_IN_PROGRESS = "IDEMPOTENCY_KEY_IN_PROGRESS";

/**
 * Is the server still answering an earlier attempt of this same write?
 *
 * The only correct response is to ask again — which is exactly what the
 * server's own message says, and exactly what this SDK used not to do.
 */
export function isIdempotencyInProgressError(error: unknown): boolean {
    return error instanceof RebaseApiError
        && error.status === 409
        && error.code === IDEMPOTENCY_IN_PROGRESS;
}

/** Is this failure worth another attempt later? */
export function isRetryableError(error: unknown): boolean {
    if (isNetworkError(error)) return true;
    if (!(error instanceof RebaseApiError)) return false;
    // The one 409 that resolves on its own. A key whose claim outlived the
    // request that took it — the process was killed between the write and the
    // answer — is refused until the claim's lease expires, and giving up on it
    // means dropping a write that retrying would have completed.
    if (isIdempotencyInProgressError(error)) return true;
    return error.status !== undefined && RETRYABLE_STATUSES.has(error.status);
}

/**
 * Did this write fail because the row is already there?
 *
 * Matched on the SQLSTATE the server passes through (`23505`, unique_violation)
 * and on 409, never on the message — a duplicate-key message names the
 * constraint and the values, so it is neither stable nor safe to parse.
 *
 * The queue uses this to recognise its own earlier attempt. A create whose
 * response was lost is replayed, and for a row carrying an id the SDK generated
 * the server can only be rejecting it because the first attempt actually landed.
 *
 * Which is why the status alone cannot decide it: `IDEMPOTENCY_KEY_IN_PROGRESS`
 * is a 409 that means the opposite — the row may not exist at all. Read as a
 * duplicate, the queue looked for a row that was never written, found nothing,
 * concluded there was nothing left to do and deleted the write from the queue.
 */
export function isDuplicateKeyError(error: unknown): boolean {
    if (!(error instanceof RebaseApiError)) return false;
    if (error.code === "23505") return true;
    return error.status === 409 && !isIdempotencyInProgressError(error);
}

export interface ConnectivityOptions {
    /** First retry delay after a failure. Defaults to 1 000 ms. */
    initialBackoffMs?: number;
    /** Ceiling for the doubling retry delay. Defaults to 60 000 ms. */
    maxBackoffMs?: number;
    /**
     * Let a known-failed connection suppress further attempts until the
     * backoff window opens. On by default — it is what makes a read or write
     * during an outage instant instead of a timeout. Turn it off when nothing
     * will ever wake the client up again (no retry timer, no `online` event),
     * where suppressing attempts would mean never recovering.
     */
    respectBackoff?: boolean;
    /** Injected for tests. */
    now?: () => number;
    /** Injected for tests; must return a handle `clearTimeout` accepts. */
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class ConnectivityMonitor {
    private state: "online" | "offline" = "online";
    private backoffMs: number;
    private readonly initialBackoffMs: number;
    private readonly maxBackoffMs: number;
    private retryAt = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private listeners = new Set<(online: boolean) => void>();
    private readonly respectBackoff: boolean;
    private readonly now: () => number;
    private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
    /** Called when the backoff window expires, to drive an automatic retry. */
    onRetryDue?: () => void;

    private readonly handleOnline = () => {
        // The OS says the interface is back. Trust it enough to try
        // immediately rather than sitting out the rest of the backoff — and to
        // say so, or a client with nothing queued would have no request whose
        // success could ever flip the badge back to "online".
        this.retryAt = 0;
        this.backoffMs = this.initialBackoffMs;
        this.clearPendingTimer();
        this.setState("online");
        this.onRetryDue?.();
    };
    private readonly handleOffline = () => {
        this.setState("offline");
    };

    constructor(options: ConnectivityOptions = {}) {
        this.initialBackoffMs = options.initialBackoffMs ?? 1_000;
        this.maxBackoffMs = Math.max(this.initialBackoffMs, options.maxBackoffMs ?? 60_000);
        this.backoffMs = this.initialBackoffMs;
        this.respectBackoff = options.respectBackoff ?? true;
        this.now = options.now ?? (() => Date.now());
        this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("online", this.handleOnline);
            window.addEventListener("offline", this.handleOffline);
        }
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
            this.state = "offline";
        }
    }

    /** What the app should be told: are we connected? */
    isOnline(): boolean {
        if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
        return this.state === "online";
    }

    /**
     * Should this request even be sent? False means "answer from the local
     * store instead" — the request would only burn a timeout to reach the same
     * conclusion the last one already did.
     */
    shouldAttempt(): boolean {
        if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
        if (this.state === "online" || !this.respectBackoff) return true;
        // Exactly one request is let through when the window opens; it is the
        // probe whose outcome decides whether we are back.
        return this.now() >= this.retryAt;
    }

    /** A request reached the server. */
    markSuccess(): void {
        this.backoffMs = this.initialBackoffMs;
        this.retryAt = 0;
        this.clearPendingTimer();
        this.setState("online");
    }

    /** A request did not reach the server: we are offline until proven otherwise. */
    markFailure(): void {
        this.deferRetry();
        this.setState("offline");
    }

    /**
     * Back off and try again later without claiming the connection is gone.
     * This is what a 429 or a 503 deserves — the server answered, so the app
     * is demonstrably online; it just should not hammer.
     */
    deferRetry(): void {
        const jitter = 0.8 + Math.random() * 0.4;
        this.retryAt = this.now() + this.backoffMs * jitter;
        const delay = Math.max(0, this.retryAt - this.now());
        this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
        this.scheduleRetry(delay);
    }

    /** Milliseconds until the next attempt is allowed; 0 when one is allowed now. */
    msUntilRetry(): number {
        if (this.state === "online") return 0;
        return Math.max(0, this.retryAt - this.now());
    }

    onChange(listener: (online: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    dispose(): void {
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
            window.removeEventListener("online", this.handleOnline);
            window.removeEventListener("offline", this.handleOffline);
        }
        this.clearPendingTimer();
        this.listeners.clear();
        this.onRetryDue = undefined;
    }

    private scheduleRetry(delay: number): void {
        this.clearPendingTimer();
        if (!this.onRetryDue) return;
        this.timer = this.setTimer(() => {
            this.timer = undefined;
            this.onRetryDue?.();
        }, delay);
        // A retry timer must never be the reason a Node script refuses to exit.
        (this.timer as unknown as { unref?: () => void }).unref?.();
    }

    private clearPendingTimer(): void {
        if (this.timer !== undefined) {
            this.clearTimer(this.timer);
            this.timer = undefined;
        }
    }

    private setState(next: "online" | "offline"): void {
        if (this.state === next) return;
        this.state = next;
        const online = this.isOnline();
        for (const listener of this.listeners) listener(online);
    }
}
