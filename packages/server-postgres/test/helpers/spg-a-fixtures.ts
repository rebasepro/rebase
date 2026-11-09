/**
 * Small, real fixtures for the unit tests: a collection that only needs a
 * name, and a registry that answers `getTable` from a fixed map.
 */
import type { PgTable } from "drizzle-orm/pg-core";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry";

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

/** A real registry whose `getTable` answers from `tables`, as a spy a test can inspect. */
export function registryWithTables(tables: Record<string, PgTable>): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    jest.spyOn(registry, "getTable").mockImplementation((name) => tables[name]);
    return registry;
}
