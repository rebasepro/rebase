import {
    ConnectivityMonitor,
    isDuplicateKeyError,
    isNetworkError,
    isRetryableError
} from "./offline-connectivity";
import { RebaseApiError } from "./transport";

/**
 * The monitor decides whether a request is worth sending at all, so getting it
 * wrong is either an app that hangs on every read during an outage, or one that
 * never notices the network came back.
 */
describe("network error classification", () => {
    it("recognises a request that never reached the server", () => {
        expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
        expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
        expect(isNetworkError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
        expect(isNetworkError(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toBe(true);
        expect(isNetworkError(new RebaseApiError("no response", { status: 0 }))).toBe(true);
    });

    it("does not mistake a server's answer for a dead network", () => {
        expect(isNetworkError(new RebaseApiError("nope", { status: 403 }))).toBe(false);
        expect(isNetworkError(new RebaseApiError("boom", { status: 500 }))).toBe(false);
        // A programming error must propagate, not be swallowed as "offline".
        expect(isNetworkError(new RangeError("bug"))).toBe(false);
    });

    it("retries what will pass and gives up on what will not", () => {
        expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true);
        expect(isRetryableError(new RebaseApiError("busy", { status: 429 }))).toBe(true);
        expect(isRetryableError(new RebaseApiError("down", { status: 503 }))).toBe(true);
        expect(isRetryableError(new RebaseApiError("gateway", { status: 502 }))).toBe(true);

        expect(isRetryableError(new RebaseApiError("invalid", { status: 400 }))).toBe(false);
        expect(isRetryableError(new RebaseApiError("denied", { status: 403 }))).toBe(false);
        expect(isRetryableError(new RebaseApiError("gone", { status: 404 }))).toBe(false);
        // A 500 is far more often a bug the same payload will hit again than a
        // blip, and retrying it forever jams every write queued behind it.
        expect(isRetryableError(new RebaseApiError("boom", { status: 500 }))).toBe(false);
    });

    it("retries a write the server is still answering, and only that 409", () => {
        // The server's own message says to retry — "its result will be
        // replayed" — and a key whose claim outlived the process that took it
        // is refused until the lease expires. Giving up instead rolls back a
        // write that retrying would have completed.
        expect(isRetryableError(new RebaseApiError("in progress", {
            status: 409, code: "IDEMPOTENCY_KEY_IN_PROGRESS"
        }))).toBe(true);
        // Every other 409 is a real conflict and stays fatal.
        expect(isRetryableError(new RebaseApiError("row exists", { status: 409, code: "23505" }))).toBe(false);
        expect(isRetryableError(new RebaseApiError("conflict", { status: 409 }))).toBe(false);
        expect(isRetryableError(new RebaseApiError("reused", {
            status: 422, code: "IDEMPOTENCY_KEY_REUSED"
        }))).toBe(false);
    });

    it("does not read an unanswered write as a row that is already there", () => {
        // The status alone cannot decide it. Read as a duplicate, the queue
        // went looking for a row that was never written, found nothing,
        // concluded there was nothing left to do and deleted the write.
        expect(isDuplicateKeyError(new RebaseApiError("in progress", {
            status: 409, code: "IDEMPOTENCY_KEY_IN_PROGRESS"
        }))).toBe(false);

        expect(isDuplicateKeyError(new RebaseApiError("dup", { status: 400, code: "23505" }))).toBe(true);
        expect(isDuplicateKeyError(new RebaseApiError("conflict", { status: 409 }))).toBe(true);
        expect(isDuplicateKeyError(new RebaseApiError("gone", { status: 404 }))).toBe(false);
    });
});

describe("ConnectivityMonitor", () => {
    function createMonitor(overrides: Partial<ConstructorParameters<typeof ConnectivityMonitor>[0]> = {}) {
        let now = 1_000_000;
        const timers: { fn: () => void; at: number }[] = [];
        const monitor = new ConnectivityMonitor({
            initialBackoffMs: 100,
            maxBackoffMs: 800,
            now: () => now,
            setTimer: ((fn: () => void, ms: number) => {
                timers.push({ fn, at: now + ms });
                return timers.length as unknown as ReturnType<typeof setTimeout>;
            }) as never,
            clearTimer: (() => undefined) as never,
            ...overrides
        });
        const advance = (ms: number) => {
            now += ms;
            for (const timer of timers.splice(0)) {
                if (timer.at <= now) timer.fn();
                else timers.push(timer);
            }
        };
        return { monitor, advance, at: () => now };
    }

    it("starts willing to try", () => {
        const { monitor } = createMonitor();
        expect(monitor.isOnline()).toBe(true);
        expect(monitor.shouldAttempt()).toBe(true);
    });

    it("stops attempting after a failure, until the backoff window opens", () => {
        const { monitor, advance } = createMonitor();
        monitor.markFailure();

        expect(monitor.isOnline()).toBe(false);
        // This is the whole point: the second read during an outage costs
        // nothing instead of another timeout.
        expect(monitor.shouldAttempt()).toBe(false);

        advance(200);
        expect(monitor.shouldAttempt()).toBe(true);
    });

    it("doubles the delay on repeated failures and caps it", () => {
        const { monitor, advance } = createMonitor();
        monitor.markFailure();
        const first = monitor.msUntilRetry();
        advance(first);

        monitor.markFailure();
        const second = monitor.msUntilRetry();
        expect(second).toBeGreaterThan(first);

        for (let i = 0; i < 10; i++) {
            advance(monitor.msUntilRetry());
            monitor.markFailure();
        }
        // 800 plus the 20% jitter ceiling.
        expect(monitor.msUntilRetry()).toBeLessThanOrEqual(800 * 1.2);
    });

    it("resets the backoff once a request gets through", () => {
        const { monitor, advance } = createMonitor();
        monitor.markFailure();
        advance(monitor.msUntilRetry());
        monitor.markFailure();
        monitor.markSuccess();

        expect(monitor.isOnline()).toBe(true);
        expect(monitor.shouldAttempt()).toBe(true);
        monitor.markFailure();
        // Back to the initial delay, not to where the doubling had reached.
        expect(monitor.msUntilRetry()).toBeLessThanOrEqual(100 * 1.2);
    });

    it("fires the retry hook when the window opens", () => {
        const { monitor, advance } = createMonitor();
        let retries = 0;
        monitor.onRetryDue = () => { retries++; };

        monitor.markFailure();
        expect(retries).toBe(0);
        advance(200);
        expect(retries).toBe(1);
    });

    it("backs off without claiming the connection is gone", () => {
        const { monitor } = createMonitor();
        // A 429 means the server answered — the app is demonstrably online and
        // an "offline" badge would be a lie.
        monitor.deferRetry();
        expect(monitor.isOnline()).toBe(true);
        expect(monitor.shouldAttempt()).toBe(true);
    });

    it("notifies listeners on each transition, and only on transitions", () => {
        const { monitor } = createMonitor();
        const seen: boolean[] = [];
        monitor.onChange((online) => seen.push(online));

        monitor.markFailure();
        monitor.markFailure();
        monitor.markSuccess();
        monitor.markSuccess();

        expect(seen).toEqual([false, true]);
    });

    it("keeps attempting when backoff suppression is off", () => {
        // Without a retry timer nothing would ever reopen the window, so
        // suppressing attempts would strand the client offline forever.
        const { monitor } = createMonitor({ respectBackoff: false });
        monitor.markFailure();
        expect(monitor.isOnline()).toBe(false);
        expect(monitor.shouldAttempt()).toBe(true);
    });
});
