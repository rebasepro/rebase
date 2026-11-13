import { RebaseApiError } from "@rebasepro/types";

/**
 * The client a hook reads as `context.client` — or a refusal naming why there
 * is none.
 *
 * A driver is constructed before the server client exists, and
 * `initializeRebaseBackend` hands it the client afterwards. So a driver can
 * run hooks without one: constructed on its own, or missed by that injection,
 * which is how a second database's hooks once ran with
 * `context.client === undefined` while the type said it was there.
 *
 * Called from a getter on the context rather than when the context is built,
 * because most hooks never touch `client` and must not fail for its absence.
 * The one that does gets this sentence instead of "Cannot read properties of
 * undefined". A 500, not the 400 a plain throw from a hook becomes: the hook
 * is not at fault, the server's wiring is.
 *
 * @group Data
 */
export function requireCallbackClient<C>(client: C | undefined): C {
    if (!client) {
        throw new RebaseApiError(
            "`context.client` is not available to this callback: the driver running it was never given the " +
            "server client. `initializeRebaseBackend` attaches it to every data source's driver at boot, so this " +
            "driver was constructed outside it or missed. Queries do not need it — they go through `context.data`.",
            { status: 500, code: "INTERNAL_ERROR" }
        );
    }
    return client;
}
