import { getTableColumns } from "drizzle-orm";
import type { CollectionConfig } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import { toSnakeCase } from "@rebasepro/utils";

import type { PostgresCollectionRegistry } from "../../collections/PostgresCollectionRegistry";
import { getPrimaryKeys } from "../collection-helpers";

/** One key field of a collection, and the column it is stored in. */
export interface KeyColumn {
    fieldName: string;
    columnName: string;
}

/**
 * The columns a collection's rows are addressed by.
 *
 * A change notification names its row by column — that is all a trigger sees —
 * and an address is built from the key's *field* names. Both ends read the
 * mapping from here: the provisioner, to attach the trigger with exactly these
 * columns (and nothing else leaves the database), and the consumer, to turn the
 * captured columns back into an address. A key declared as `userId` over
 * `user_id` used to be looked up by field name on the captured row, never
 * found, and every external write reached no single-row subscriber.
 */
export function collectionKeyColumns(collection: CollectionConfig, registry: PostgresCollectionRegistry): KeyColumn[] {
    const table = registry.getTable(getTableName(collection));
    const columns = table ? getTableColumns(table) : undefined;
    return getPrimaryKeys(collection, registry).map((pk) => {
        const property = collection.properties?.[pk.fieldName];
        const declared = property && "columnName" in property ? property.columnName : undefined;
        return {
            fieldName: pk.fieldName,
            columnName: columns?.[pk.fieldName]?.name ?? declared ?? toSnakeCase(pk.fieldName)
        };
    });
}
