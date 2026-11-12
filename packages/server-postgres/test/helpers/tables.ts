import { collectionsToTableDefs } from "@rebasepro/common";
import type { AnyCollectionConfig, AnyTableDef, AnyViewDef, CollectionConfig, DefaultRls, SecurityRule } from "@rebasepro/types";

/**
 * The temporary lift for test fixtures — the driver's twin of
 * `packages/server/test/helpers/tables.ts`.
 *
 * `defineTable` is the backend's only front door, but many fixtures in this
 * suite are still legacy collection literals. This turns them into table
 * definitions with `collectionsToTableDefs` (the bridge the codemod uses), so
 * every test boots through the real `tables` option and the real compiler and
 * lowering. A later slice converts the fixtures themselves to `defineTable`
 * source and deletes this file.
 */

/** What to spread into `createRebaseBackend` options: `tables`, and `defaultRls` when there is one. */
export interface LiftedTables {
    tables: (AnyTableDef | AnyViewDef)[];
    defaultRls?: DefaultRls;
}

/**
 * Lift legacy fixture collections into the backend's `tables` option.
 *
 * ```ts
 * await createRebaseBackend({ ...tablesFrom([posts, authors]), provision: false, … });
 * ```
 */
export function tablesFrom(
    collections: readonly (CollectionConfig | AnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): LiftedTables {
    const narrowed: CollectionConfig[] = collections.map(collection => collection);
    const { tables, defaultRls } = collectionsToTableDefs(narrowed, options);
    return defaultRls ? { tables, defaultRls } : { tables };
}
