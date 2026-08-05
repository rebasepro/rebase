import {
    DataSourceDefinition,
    ResolvedDataSource,
    DEFAULT_DATA_SOURCE_KEY,
    getDataSourceCapabilities
} from "@rebasepro/types";

/**
 * The subset of a collection needed to resolve its data source. Accepting a
 * structural type (rather than the full `CollectionConfig`) keeps this usable
 * from anywhere — frontend router, backend registry, editor — without coupling
 * to the collection union.
 */
export interface DataSourceResolvable {
    /** Preferred routing key. */
    dataSource?: string;
    /** Engine type discriminant (set on variant collection types). */
    engine?: string;
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
 * 1. The routing **key** is `collection.dataSource`, else
 *    {@link DEFAULT_DATA_SOURCE_KEY}.
 * 2. If a definition is registered for that key, it provides `engine`,
 *    `transport`, and `databaseId`.
 * 3. Otherwise values are synthesized: `engine` from `collection.engine`
 *    (or the key, or `"postgres"`), `transport` defaults to `"server"`,
 *    and `databaseId` from the collection.
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
    const key = collection?.dataSource ?? DEFAULT_DATA_SOURCE_KEY;
    const def = registry?.[key];

    const engine = def?.engine
        ?? collection?.engine
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

/**
 * Does a SQL toolchain own this collection's storage?
 *
 * "Owns the storage" means: something generates a table for it, pushes that
 * table to a database, plans its RLS policies, and reports it as drifted when
 * the two disagree. That is true of a Postgres collection and false of a
 * Firestore or MongoDB one, whose documents live in a store Rebase never
 * migrates — and the two were never told apart. Every stage of the SQL
 * toolchain took "the collections" to mean *all* of them, so a Firestore
 * collection declared next to the Postgres ones got a `pgTable` in the
 * generated schema, a `CREATE TABLE` at boot, RLS policies, and a place in the
 * `db push` include list — where its name shielding a same-named real table
 * from Atlas's exclude list is the one that can lose data.
 *
 * The answer is the resolved engine's {@link DataSourceCapabilities}, not a
 * name check: an engine registered through `registerDataSourceCapabilities`
 * gets the same treatment as the built-in ones.
 *
 * Deliberately answers **true** for an engine nobody has heard of. Build-time
 * tooling (the CLI, the schema generator) has no data-source registry to
 * resolve a `dataSource` key against, so an unknown key resolves to an unknown
 * engine — and the cost of the two mistakes is not symmetric. Wrongly
 * including a collection generates a table nothing writes to; wrongly excluding
 * one silently stops generating a table the app is serving from. Declare
 * `engine` on a collection that is not SQL-backed and this is exact.
 */
export function isRelationalCollection(
    collection: DataSourceResolvable | undefined,
    registry?: DataSourceRegistry
): boolean {
    // The collection's own `engine` wins over a registered definition's. That
    // is the opposite of {@link resolveDataSource}'s precedence, deliberately:
    // there a definition describes where the data *goes*, so it should override;
    // here the question is what the author said this collection is, and a
    // collection declaring `engine: "firestore"` with no `dataSource` must not
    // come back as the default source's engine and be handed a table.
    const engine = collection?.engine
        ?? (collection?.dataSource ? resolveDataSource(collection, registry).engine : undefined);
    return getDataSourceCapabilities(engine).supportsRelations;
}

/**
 * The subset of `collections` a SQL toolchain owns — see
 * {@link isRelationalCollection}.
 *
 * Every stage that generates SQL from collections starts by calling this, so
 * the rule lives in one place rather than being re-decided per generator. It
 * keeps the input order.
 */
export function relationalCollections<C extends DataSourceResolvable>(
    collections: readonly C[],
    registry?: DataSourceRegistry
): C[] {
    return collections.filter(collection => isRelationalCollection(collection, registry));
}
