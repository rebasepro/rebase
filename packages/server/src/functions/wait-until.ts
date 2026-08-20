/**
 * Work that outlives the response.
 *
 * Sending a webhook, writing an audit row, warming a cache — work whose result
 * the caller does not wait for. Today, on Node, the way to do that is to not
 * await the promise, and it works: the process is long-lived, so a floating
 * promise settles eventually. The runtime even backstops it — an unhandled
 * rejection inside a function is logged rather than fatal, precisely so one
 * fire-and-forget call cannot end a shared process.
 *
 * That is a Node guarantee, and it is one of exactly two places where the
 * custom-functions contract silently depends on the host. On an isolate-based
 * host the isolate is eligible for termination the moment the response
 * resolves, so an un-awaited promise is not slow — it is **cancelled, usually
 * before it starts**, with no error anywhere. A function that has always sent
 * its webhook simply stops sending it, on a runtime whose logs show a clean
 * 200.
 *
 * There is no way to detect that from inside the function, and no way to fix it
 * afterwards except by rewriting every function that ever relied on it. So the
 * primitive exists now, before there is a host that needs it, and the
 * documentation names it as the only supported way to do post-response work.
 *
 * On Node it is not a no-op either. Registering the promise here is what lets
 * shutdown *wait* for it: a floating promise at SIGTERM is dropped mid-flight,
 * which is the same lost webhook arriving by a different route.
 *
 * @module
 */
import type { Context } from "hono";
import { logger } from "../utils/logger";

/**
 * Pending background work, on a process-global slot for the reason given in
 * `../singleton.ts`: two copies of this module in one process must not each
 * hold half the work, or shutdown drains one half and drops the other.
 */
const PENDING_SLOT = Symbol.for("@rebasepro/server:pending-background-work");

type GlobalWithPending = typeof globalThis & {
    [PENDING_SLOT]?: Set<Promise<unknown>>;
};

function pending(): Set<Promise<unknown>> {
    const global = globalThis as GlobalWithPending;
    if (!global[PENDING_SLOT]) global[PENDING_SLOT] = new Set();
    return global[PENDING_SLOT];
}

/** A context that may or may not carry the host's execution context. */
type MaybeExecutionCtx = {
    executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void };
};

/**
 * Keep `work` alive past the response, on any runtime.
 *
 * Hand it a promise or a function returning one. Nothing is awaited: the
 * response goes out immediately, exactly as an un-awaited call would.
 *
 * What it buys, per host:
 *
 * - **Isolate hosts** (Workers, Deno Deploy, Vercel Edge): the host is told to
 *   keep the isolate alive until the promise settles. Without this the work is
 *   dropped when the response resolves.
 * - **Node**: the promise is tracked so {@link drainBackgroundWork} can wait for
 *   it during graceful shutdown instead of the process exiting out from under
 *   it.
 *
 * On every host a rejection is logged rather than left to the unhandled-rejection
 * handler, so the failure names the function it came from.
 *
 * @example
 * ```ts
 * app.post("/orders", requireAuth, async (c) => {
 *     const order = await createOrder(c);
 *     waitUntil(c, notifyWarehouse(order));   // caller does not wait for this
 *     return c.json({ id: order.id });
 * });
 * ```
 */
export function waitUntil(
    c: Context,
    work: Promise<unknown> | (() => Promise<unknown> | unknown)
): void {
    let promise: Promise<unknown>;
    try {
        // A thunk is accepted because the natural way to write this —
        // `waitUntil(c, () => doThing())` — should not be a silent no-op, and
        // an accidentally-passed function is otherwise never invoked.
        promise = typeof work === "function" ? Promise.resolve(work()) : work;
    } catch (error) {
        // A thunk that threw synchronously. Its work never started, and the
        // response is still fine, so this is a log rather than a throw.
        logBackgroundFailure(c, error);
        return;
    }

    const tracked = promise.catch((error: unknown) => {
        logBackgroundFailure(c, error);
    });

    const set = pending();
    set.add(tracked);
    void tracked.finally(() => set.delete(tracked));

    // `c.executionCtx` is a getter that *throws* on a host that has none —
    // notably `@hono/node-server` — so this cannot be an `if`.
    try {
        const ctx = (c as unknown as MaybeExecutionCtx).executionCtx;
        ctx?.waitUntil?.(tracked);
    } catch {
        // No execution context: this is Node (or a test), where the process
        // outlives the response on its own and `drainBackgroundWork` covers
        // shutdown. Nothing to report — it is the expected path there.
    }
}

function logBackgroundFailure(c: Context, error: unknown): void {
    logger.error("[functions] Background work failed after the response was sent", {
        method: c.req?.method,
        path: c.req?.path,
        error: error instanceof Error ? error : new Error(String(error))
    });
}

/** How many background promises are still in flight. Diagnostics and tests. */
export function pendingBackgroundWork(): number {
    return pending().size;
}

/**
 * Wait for tracked background work to finish, up to `timeoutMs`.
 *
 * Called by the shutdown path after the server stops accepting connections. It
 * resolves to the number of promises still outstanding when it returned — `0`
 * for a clean drain, more than that for a timeout, which is worth a log line
 * because it means work was dropped.
 *
 * Rejections do not propagate: every tracked promise has already had a `catch`
 * attached by {@link waitUntil}.
 */
export async function drainBackgroundWork(timeoutMs = 5_000): Promise<number> {
    const set = pending();
    if (set.size === 0) return 0;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<"timeout">(resolve => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
        // Do not hold the event loop open just to observe a deadline.
        (timer as unknown as { unref?: () => void }).unref?.();
    });

    try {
        await Promise.race([Promise.allSettled([...set]), expired]);
    } finally {
        if (timer) clearTimeout(timer);
    }

    return set.size;
}

/** @internal Test seam — forgets tracked work without waiting for it. */
export function _resetBackgroundWork(): void {
    pending().clear();
}
