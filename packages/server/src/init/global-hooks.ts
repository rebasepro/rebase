import type { CollectionCallbacks, InitializedDriver } from "@rebasepro/types";

/**
 * Hand the backend's global table hooks to one driver.
 *
 * `initializeRebaseBackend({ hooks })` — what `backend/hooks.ts` exports — is
 * declared once, on the backend, but each driver builds a registry of its own
 * in `initializeDriver` and runs global hooks from that. So they are given to
 * each driver here, by the coordinator, rather than left for every driver to
 * remember to ask for.
 *
 * The driver's registry takes them in its own shape: `callbacks` is the hooks
 * lowered by `globalHooksAsCallbacks` (one adapter, so a hook still receives
 * its table's descriptor). That shape is the driver contract until slice B-R7,
 * which hands drivers `TableHooks` and deletes the lowering.
 *
 * Refuses rather than skipping when the driver returns **a registry that cannot
 * take them**: every table that driver serves would run with the global hooks
 * off, an `afterRead` that masks PII among them, and nothing would say so.
 */
export function handGlobalHooksTo(
    driverId: string,
    driverResult: InitializedDriver,
    callbacks: CollectionCallbacks
): void {
    const registry = driverResult.collectionRegistry;
    if (!registry?.setGlobalCallbacks) {
        throw new Error(
            `hooks: data source "${driverId}" returned no registry that accepts global hooks, so the ones ` +
            "exported from backend/hooks.ts (`initializeRebaseBackend({ hooks })`) would not run on any of its " +
            "tables. Return a `collectionRegistry` implementing `setGlobalCallbacks` from the adapter's " +
            "`initializeDriver`, or move the hooks onto each table's `hooks`."
        );
    }
    registry.setGlobalCallbacks(callbacks);
}
