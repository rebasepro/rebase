import type { CollectionCallbacks, InitializedDriver } from "@rebasepro/types";

/**
 * Hand the backend's global callbacks to one driver.
 *
 * `initializeRebaseBackend({ callbacks })` is declared once, on the backend,
 * but no driver resolves callbacks from the backend's `collectionRegistry`:
 * each builds a registry of its own in `initializeDriver` and reads global
 * callbacks from that. So they are given to each driver here, by the
 * coordinator, rather than left for every driver to remember to ask for.
 *
 * Refuses rather than skipping, in two cases.
 *
 * - **A registry that cannot take them.** Every collection that driver serves
 *   would run with the global hooks off, an `afterRead` that masks PII among
 *   them, and nothing would say so.
 * - **A global `beforeQuery` on a driver that does not compile one.** Only
 *   `@rebasepro/server-postgres` narrows a read before running it. Anywhere
 *   else the hook is a row filter that filters nothing, which is the refusal
 *   `assertBeforeQueryIsPostgresOnly` makes for a collection's own hook.
 */
export function handGlobalCallbacksTo(
    driverId: string,
    engine: string,
    driverResult: InitializedDriver,
    callbacks: CollectionCallbacks
): void {
    if (callbacks.beforeQuery && engine !== "postgres") {
        throw new Error(
            `callbacks.beforeQuery: a global \`beforeQuery\` narrows every collection's reads before they are ` +
            `compiled, which is a Postgres feature, and data source "${driverId}" is served by \`${engine}\`. ` +
            "Its collections would keep returning every row the engine allows. Declare the hook on the Postgres " +
            "collections that need it instead. Redaction that works on every engine is `afterRead`."
        );
    }

    const registry = driverResult.collectionRegistry;
    if (!registry?.setGlobalCallbacks) {
        throw new Error(
            `callbacks: data source "${driverId}" (\`${engine}\`) returned no collection registry that accepts ` +
            "global callbacks, so the ones declared on `initializeRebaseBackend({ callbacks })` would not run on " +
            "any of its collections. Return a `collectionRegistry` implementing `setGlobalCallbacks` from the " +
            "adapter's `initializeDriver`, or move the hooks onto each collection's `callbacks`."
        );
    }
    registry.setGlobalCallbacks(callbacks);
}
