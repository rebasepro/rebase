/**
 * Whether an error is the realtime client saying the connection is down —
 * not that the data is gone.
 *
 * Once the socket has been down for longer than a blip, the SDK tells every
 * live subscription `CONNECTION_LOST` through its `onError`, once, and keeps
 * the subscription: when the socket is back it is re-subscribed and its next
 * update carries what changed meanwhile. A view that already shows data should
 * keep showing it (the admin's connection banner says it may be stale) rather
 * than replace it with an error — for an open record that would unmount the
 * form and everything typed into it.
 *
 * Read by `code` rather than `instanceof RebaseApiError`: two copies of
 * `@rebasepro/types` in one tree disagree about the class, never about the code.
 *
 * @group Hooks and utilities
 */
export function isConnectionLostError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "CONNECTION_LOST";
}
