/**
 * A real table registry, for tests that only need path lookups.
 *
 * The socket and the services take a `PostgresTableRegistry`; a stand-in
 * object with one method had to be cast into the class. Registering the
 * fixtures in a real one answers the same lookups with the real code.
 */
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { PostgresTableRegistry } from "../../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./tables";

/** A registry holding `collections` and the tables they compile to, as the driver's would. */
export function registryOf(...collections: LegacyCollectionConfig[]): PostgresTableRegistry {
    const registry = new FixtureTableRegistry();
    registry.registerMultiple(collections);
    return registry;
}
