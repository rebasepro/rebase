import type { InitializedDriver } from "@rebasepro/types";

/**
 * Give every data source's driver the server client its callbacks read as
 * `context.client`.
 *
 * A driver is created before the client — the client depends on the mounted
 * Hono app — so the client is injected afterwards. It used to be injected into
 * the DEFAULT driver only. Each declared `database(...)` gets a bootstrapper and
 * a driver of its own, so a collection on a second source ran its callbacks with
 * `context.client === undefined`, typed as present through a cast in the driver:
 * a `beforeSave` calling `context.client.functions.invoke(...)` worked on the
 * default database and threw on the other one.
 *
 * Returns how many drivers took the client, which is what a test can hold.
 */
export function injectCallbackClient(results: Iterable<InitializedDriver>, client: unknown): number {
    let injected = 0;
    for (const result of results) {
        const internals = result.internals as Record<string, unknown> | undefined;
        const driver = internals?.driver as Record<string, unknown> | undefined;
        if (driver && "client" in driver) {
            driver.client = client;
            injected++;
        }
    }
    return injected;
}
