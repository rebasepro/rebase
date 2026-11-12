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
 * Refuses rather than skipping when the driver returns **a registry that cannot
 * take them**: every collection that driver serves would run with the global
 * hooks off, an `afterRead` that masks PII among them, and nothing would say
 * so.
 */
export function handGlobalCallbacksTo(
    driverId: string,
    driverResult: InitializedDriver,
    callbacks: CollectionCallbacks
): void {
    const registry = driverResult.collectionRegistry;
    if (!registry?.setGlobalCallbacks) {
        throw new Error(
            `callbacks: data source "${driverId}" returned no collection registry that accepts ` +
            "global callbacks, so the ones declared on `initializeRebaseBackend({ callbacks })` would not run on " +
            "any of its collections. Return a `collectionRegistry` implementing `setGlobalCallbacks` from the " +
            "adapter's `initializeDriver`, or move the hooks onto each collection's `callbacks`."
        );
    }
    registry.setGlobalCallbacks(callbacks);
}
