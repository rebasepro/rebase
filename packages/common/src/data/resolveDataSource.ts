import {
    DataSourceDefinition,
    ResolvedDataSource,
    DEFAULT_DATA_SOURCE_KEY,
    getDataSourceCapabilities
} from "@rebasepro/types";

/**
 * The subset of a collection needed to resolve its data source. Accepting a
 * structural type (rather than the full `EntityCollection`) keeps this usable
 * from anywhere — frontend router, backend registry, editor — without coupling
 * to the collection union.
 */
export interface DataSourceResolvable {
    /** Preferred routing key. */
    dataSource?: string;
    /** Legacy engine hint / fallback routing key. */
    driver?: string;
    /** Within-engine instance. */
    databaseId?: string;
}

/** A lookup of data-source definitions by key. */
export type DataSourceRegistry = Record<string, DataSourceDefinition>;

/**
 * Build a keyed registry from a list of {@link DataSourceDefinition}s.
 * Later entries win on key collision.
 */
export function createDataSourceRegistry(definitions?: DataSourceDefinition[]): DataSourceRegistry {
    const registry: DataSourceRegistry = {};
    for (const def of definitions ?? []) {
        registry[def.key] = def;
    }
    return registry;
}

/**
 * Resolve the effective data source for a collection — the single source of
 * truth shared by the frontend router, the backend driver registry, and the
 * editor's capability lookups.
 *
 * Resolution order:
 * 1. The routing **key** is `collection.dataSource`, else the legacy
 *    `collection.driver`, else {@link DEFAULT_DATA_SOURCE_KEY}.
 * 2. If a definition is registered for that key, it provides `engine`,
 *    `transport`, and `databaseId`.
 * 3. Otherwise values are synthesized for backward compatibility: `engine`
 *    from the legacy `driver` (or the key, or `"postgres"`), `transport`
 *    defaults to `"server"`, and `databaseId` from the collection.
 *
 * `capabilities` are always derived from the resolved `engine`, so two
 * data sources sharing an engine share capabilities.
 *
 * @param collection the collection (or any object carrying the routing fields)
 * @param registry   optional registry of declared data sources
 */
export function resolveDataSource(
    collection: DataSourceResolvable | undefined,
    registry?: DataSourceRegistry
): ResolvedDataSource {
    const key = collection?.dataSource ?? collection?.driver ?? DEFAULT_DATA_SOURCE_KEY;
    const def = registry?.[key];

    const engine = def?.engine
        ?? collection?.driver
        ?? (key !== DEFAULT_DATA_SOURCE_KEY ? key : "postgres");

    const transport = def?.transport ?? "server";
    const databaseId = collection?.databaseId ?? def?.databaseId;

    return {
        key,
        engine,
        transport,
        databaseId,
        capabilities: getDataSourceCapabilities(engine)
    };
}
