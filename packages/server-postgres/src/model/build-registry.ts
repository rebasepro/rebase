import { isTable, getTableName, Relations } from "drizzle-orm";
import { PgEnum, PgTable } from "drizzle-orm/pg-core";
import type { CollectionConfig, CompiledTable } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { PostgresTableRegistry } from "./PostgresTableRegistry";
import { assertRelationsResolve } from "./validate-relations";

/**
 * Everything a registry is built from: the compiled tables, the collections
 * they were lowered into (read by the subsystems not yet moved onto tables),
 * and the drizzle schema read back from this database. In BaaS mode all of it
 * is introspected from the live database.
 */
export interface RegistrySchema {
    /** The compiled tables: one per collection, by slug. */
    compiledTables?: readonly CompiledTable[];
    /** The lowered collections: one per compiled table, by slug. */
    collections?: CollectionConfig[];
    /** The drizzle tables read back from the catalogue, served tables and junctions alike. */
    tables?: Record<string, unknown>;
    enums?: Record<string, PgEnum<[string, ...string[]]>>;
    relations?: Record<string, Relations>;
}

/**
 * Build the table registry for a driver.
 *
 * Refuses, naming them, collections without a compiled table and compiled
 * tables without a collection: an entry the runtime would read half of is a
 * wiring defect, and the half it misses would be answered by a fallback.
 *
 * Order matters: the catalogue tables are registered before the relation
 * check, which reads them, and the compiled tables before them so each
 * runtime table is built over its catalogue table.
 */
export function buildTableRegistry(schema: RegistrySchema): PostgresTableRegistry {
    const registry = new PostgresTableRegistry();
    const collections = schema.collections ?? [];
    const compiled = schema.compiledTables ?? [];
    assertOneTablePerCollection(collections, compiled);

    if (collections.length > 0) {
        registry.registerMultiple(collections);
        logger.debug(
            `📋 [PostgresRegistry] Registered ${registry.getCollections().length} tables: ` +
            `[${registry.getCollections().map(c => c.slug).join(", ")}]`
        );
    }
    registry.registerTables(compiled);

    if (schema.tables) {
        Object.values(schema.tables).forEach((table) => {
            if (isTable(table)) {
                registry.registerPgTable(table as PgTable, getTableName(table));
            }
        });
    }

    if (schema.enums) registry.registerEnums(schema.enums);
    if (schema.relations) registry.registerRelations(schema.relations);

    // Now that the tables resolve: refuse to start on a relation whose names
    // do not exist. Compiling checks a relation against its target's
    // declaration; only here is there a database to check its names against.
    // Every one of these used to surface as an empty result at query time.
    assertRelationsResolve(registry);

    return registry;
}

function assertOneTablePerCollection(collections: readonly CollectionConfig[], compiled: readonly CompiledTable[]): void {
    const compiledSlugs = new Set(compiled.map(table => table.descriptor.slug));
    const collectionSlugs = new Set(collections.map(collection => collection.slug));
    const uncompiled = [...collectionSlugs].filter(slug => !compiledSlugs.has(slug));
    const unlowered = [...compiledSlugs].filter(slug => !collectionSlugs.has(slug));
    if (uncompiled.length === 0 && unlowered.length === 0) return;
    throw new Error(
        "The driver was handed tables and collections that do not match" +
        (uncompiled.length > 0 ? `; no compiled table for: ${uncompiled.join(", ")}` : "") +
        (unlowered.length > 0 ? `; no lowered collection for: ${unlowered.join(", ")}` : "") +
        ". Pass the `tables` that `compileSchema` (or `compileSchemaDefs`) returned beside the `collections` lowered from them."
    );
}
