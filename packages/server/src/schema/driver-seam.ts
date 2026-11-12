import type { CollectionConfig } from "@rebasepro/types";

/**
 * The one seam between the server's table-model code and the data driver's
 * contract.
 *
 * Storage, auth, the RLS simulator, MCP and boot decide everything from table
 * descriptors; but a `DataDriver` call (`fetchCollection`, `count`, `save`,
 * `scanStoredRows`, …) still names its table with the collection the
 * definition was lowered into. Each of those areas asks this for that
 * collection, by slug, at the moment it calls the driver — and reads nothing
 * from it. The contract changes across server, driver and client in one slice
 * (B-R7), which deletes this type and every caller's use of it.
 *
 * `undefined` when no driver serves the slug.
 *
 * @group Schema
 */
export type DriverCollectionOf = (slug: string) => CollectionConfig | undefined;
