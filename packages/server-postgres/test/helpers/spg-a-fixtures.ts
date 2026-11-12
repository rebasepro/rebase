/**
 * Small, real fixtures for the unit tests: a collection that only needs a
 * name, and a registry that answers `getPgTable` from a fixed map.
 */
import type { PgTable } from "drizzle-orm/pg-core";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { PostgresTableRegistry } from "../../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./tables";

/**
 * A minimal real collection — enough for the code that only identifies one
 * (a relation's `target`, a scope's parent). `name` defaults to the slug and
 * `properties` to none.
 */
export function namedCollection(slug: string, extra: Partial<PostgresCollectionConfig> = {}): PostgresCollectionConfig {
    return {
        slug,
        name: slug,
        properties: {},
        ...extra
    };
}

/**
 * A real registry holding these catalogue tables under these names, its
 * `getPgTable` a spy that calls through. Fixture collections registered on it
 * afterwards get their runtime tables built over them.
 */
export function registryWithTables(tables: Record<string, PgTable>): PostgresTableRegistry {
    const registry = new FixtureTableRegistry();
    for (const [name, table] of Object.entries(tables)) registry.registerPgTable(table, name);
    // Calls through: a test can still ask which tables were looked up.
    jest.spyOn(registry, "getPgTable");
    return registry;
}
