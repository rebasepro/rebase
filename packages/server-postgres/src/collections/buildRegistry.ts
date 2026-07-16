import { isTable, getTableName, Relations } from "drizzle-orm";
import { PgEnum, PgTable } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { PostgresCollectionRegistry } from "./PostgresCollectionRegistry";
import { warnOnKeysTheAdminCannotResolve } from "../services/collection-helpers";

/**
 * Everything a registry is built from: the collections, and the drizzle schema
 * they are backed by. In BaaS mode all of it is introspected from the live
 * database; in CMS mode it comes from the config and the generated schema.
 */
export interface RegistrySchema {
    collections?: CollectionConfig[];
    tables?: Record<string, unknown>;
    enums?: Record<string, PgEnum<[string, ...string[]]>>;
    relations?: Record<string, Relations>;
}

/**
 * Build the collection registry for a driver.
 *
 * The order matters and is the reason this is one function rather than a run of
 * statements in the bootstrapper. Keys are resolved from the drizzle schema, so
 * anything that inspects them has to run *after* the tables are registered —
 * and `warnOnKeysTheAdminCannotResolve` fails open if it does not, because a
 * collection whose table it cannot look up is one it has nothing to say about.
 * Warned too early, it would skip every collection and report nothing, which
 * reads exactly like having nothing to report.
 */
export function buildCollectionRegistry(schema: RegistrySchema): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();

    if (schema.collections) {
        registry.registerMultiple(schema.collections);
        logger.info(
            `📋 [PostgresRegistry] Registered ${registry.getCollections().length} collections: ` +
            `[${registry.getCollections().map(c => c.slug).join(", ")}]`
        );
    }

    if (schema.tables) {
        Object.values(schema.tables).forEach((table) => {
            if (isTable(table)) {
                registry.registerTable(table as PgTable, getTableName(table));
            }
        });
    }

    if (schema.enums) registry.registerEnums(schema.enums);
    if (schema.relations) registry.registerRelations(schema.relations);

    // Now that the keys resolve: say which of them the admin cannot see. It
    // compiles the same collection files into its bundle but never the drizzle
    // schema, and nothing serves it one, so only an edit to the config fixes it.
    warnOnKeysTheAdminCannotResolve(registry.getCollections(), registry);

    return registry;
}
