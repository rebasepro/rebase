/**
 * A real collection registry, for tests that only need path lookups.
 *
 * The socket and the services take a `PostgresCollectionRegistry`; a stand-in
 * object with one method had to be cast into the class. Registering the
 * fixtures in a real one answers the same lookups with the real code.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry";

/** A registry holding `collections`, as the driver's would. */
export function registryOf(...collections: CollectionConfig[]): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple(collections);
    return registry;
}
