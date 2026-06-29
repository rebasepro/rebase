import { RebaseData, CollectionAccessor } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * Parameters for {@link buildRoutedRebaseData}.
 */
export interface RoutedRebaseDataParams {
    /**
     * The default data source. Handles every collection that does not
     * resolve to an entry in `sources` (i.e. server-transport collections,
     * which ride the Rebase client).
     */
    defaultData: RebaseData;

    /**
     * Per-data-source {@link RebaseData} instances for direct and custom
     * transports, keyed by data-source key (e.g. `"analytics"`). Server-
     * mediated sources are not listed here — they fall through to
     * `defaultData`.
     */
    sources: Record<string, RebaseData>;

    /**
     * Resolve the data-source key for a given collection slug or path.
     * Typically backed by the collection registry + `resolveDataSource`
     * (`resolveDataSource(registry.getCollection(path), defs).key`).
     *
     * Return `undefined` (or a key absent from `sources`) to route to the
     * default data source.
     */
    resolveKey: (slugOrPath: string) => string | undefined;
}

/**
 * Build a {@link RebaseData} that routes each collection to the right
 * backend based on its resolved data source.
 *
 * `.collection(path)` (and dynamic `data.products`-style access) resolves the
 * collection's data-source key via `resolveKey` and delegates to the matching
 * entry in `sources`, falling back to `defaultData` when there is no match.
 * Because routing keys off the *path being accessed*, a reference widget
 * inside a Firestore form that points at a Postgres collection is still
 * served by Postgres — routing follows the target, not the ancestor.
 *
 * When `sources` is empty this returns `defaultData` untouched, so the
 * single-driver setup keeps identical behaviour and identity (important for
 * effect dependencies that key off the data instance).
 *
 * @example
 * const data = buildRoutedRebaseData({
 *     defaultData: client.data,
 *     sources: { analytics: buildRebaseData(firestoreDriver) },
 *     resolveKey: (path) => resolveDataSource(registry.getCollection(path), defs).key
 * });
 * await data.products.find();        // → default (server / Postgres)
 * await data.events.find();          // → Firestore, if `events.dataSource === "analytics"`
 */
export function buildRoutedRebaseData({
    defaultData,
    sources,
    resolveKey
}: RoutedRebaseDataParams): RebaseData {

    // Fast path: nothing to route → return the default untouched (preserves
    // referential identity for effect dependencies).
    if (!sources || Object.keys(sources).length === 0) {
        return defaultData;
    }

    function resolve(slugOrPath: string): RebaseData {
        const key = resolveKey(slugOrPath);
        if (key && sources[key]) return sources[key];
        return defaultData;
    }

    function getAccessor(slugOrPath: string): CollectionAccessor {
        return resolve(slugOrPath).collection(slugOrPath);
    }

    const target = {
        collection: getAccessor
    } as RebaseData;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return getAccessor;
            // Ignore Symbol properties (e.g. Symbol.toPrimitive, Symbol.iterator)
            if (typeof prop === "symbol") return undefined;
            // Ignore internal JS properties
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;

            // Convert camelCase property names to snake_case slugs, mirroring
            // buildRebaseData so dynamic access routes consistently.
            return getAccessor(toSnakeCase(prop));
        }
    });
}
