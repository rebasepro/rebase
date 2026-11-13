import { isTable, getTableName, Relations } from "drizzle-orm";
import { PgEnum, PgTable } from "drizzle-orm/pg-core";
import type { CompiledTable } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { PostgresTableRegistry } from "./PostgresTableRegistry";
import { assertRelationsResolve } from "./validate-relations";

/**
 * Everything a registry is built from: the compiled tables and the drizzle
 * schema read back from this database. In BaaS mode both are introspected
 * from the live database.
 */
export interface RegistrySchema {
    /** The compiled tables, one per served table. */
    compiledTables?: readonly CompiledTable[];
    /** The drizzle tables read back from the catalogue, served tables and junctions alike. */
    tables?: Record<string, unknown>;
    enums?: Record<string, PgEnum<[string, ...string[]]>>;
    relations?: Record<string, Relations>;
}

/**
 * Build the table registry for a driver.
 *
 * Order matters: the catalogue tables are registered before the relation
 * check, which reads them, and the compiled tables before them so each
 * runtime table is built over its catalogue table.
 */
export function buildTableRegistry(schema: RegistrySchema): PostgresTableRegistry {
    const registry = new PostgresTableRegistry();
    const compiled = schema.compiledTables ?? [];
    registry.registerTables(compiled);
    if (compiled.length > 0) {
        logger.debug(
            `📋 [PostgresRegistry] Registered ${compiled.length} tables: ` +
            `[${compiled.map(table => table.descriptor.slug).join(", ")}]`
        );
    }

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
