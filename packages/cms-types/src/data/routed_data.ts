import { RebaseData } from "../types/table_accessor";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * What the admin's router routes: its Entity-shaped {@link RebaseData}, or
 * just a `.table(slug)` accessor of one, which is all the router needs. The
 * SDK's rows are routed by `buildRoutedSdkData` (`@rebasepro/common`).
 */
export type RoutableData = RebaseData | Pick<RebaseData, "table">;

/**
 * Parameters for {@link buildRoutedRebaseData}.
 */
export interface RoutedRebaseDataParams<T extends RoutableData = RebaseData> {
    /**
     * The default data source. Handles every table that does not
     * resolve to an entry in `sources` (i.e. server-transport tables,
     * which ride the Rebase client).
     */
    defaultData: T;

    /**
     * Per-data-source instances for direct and custom transports, keyed by
     * data-source key (e.g. `"analytics"`). Server-mediated sources are not
     * listed here — they fall through to `defaultData`.
     */
    sources: Record<string, T>;

    /**
     * Resolve the data-source key for a given table slug or path.
     * Typically backed by the collection registry + `resolveDataSource`
     * (`resolveDataSource(registry.getCollection(path), defs).key`).
     *
     * Return `undefined` (or a key absent from `sources`) to route to the
     * default data source.
     */
    resolveKey: (slugOrPath: string) => string | undefined;

    /**
     * The slug a property names (`data.myNotes`). Absent, a property is its
     * snake_case (`my_notes`). See `createAccessorSlugResolver`.
     */
    resolveAccessor?: (property: string) => string;
}

/**
 * Build the admin's {@link RebaseData} that routes each table to the right
 * backend based on its resolved data source.
 *
 * `.table(path)` (and dynamic `data.products`-style access) resolves the
 * table's data-source key via `resolveKey` and delegates to the matching
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
 *     defaultData: wrapAsEntityData(client.data, entityDataOptions),
 *     sources: { analytics: buildRebaseData(firestoreDriver) },
 *     resolveKey: (path) => resolveDataSource(registry.getCollection(path), defs).key
 * });
 * await data.products.find();        // → default (server / Postgres)
 * await data.events.find();          // → Firestore, if `events.dataSource === "analytics"`
 */
export function buildRoutedRebaseData<T extends RoutableData = RebaseData>({
    defaultData,
    sources,
    resolveKey,
    resolveAccessor
}: RoutedRebaseDataParams<T>): T {

    // Fast path: nothing to route → return the default untouched (preserves
    // referential identity for effect dependencies).
    if (!sources || Object.keys(sources).length === 0) {
        return defaultData;
    }

    function resolve(slugOrPath: string): T {
        const key = resolveKey(slugOrPath);
        if (key && sources[key]) return sources[key];
        return defaultData;
    }

    function getAccessor(slugOrPath: string) {
        return (resolve(slugOrPath) as RoutableData).table(slugOrPath);
    }

    const target = {
        table: getAccessor
    } as T;

    return new Proxy(target as object, {
        get(_target, prop: string | symbol) {
            if (prop === "table") return getAccessor;
            // Ignore Symbol properties (e.g. Symbol.toPrimitive, Symbol.iterator)
            if (typeof prop === "symbol") return undefined;
            // Ignore internal JS properties
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;

            // A table's own accessor name, else camelCase → snake_case,
            // mirroring buildRebaseData so dynamic access routes consistently.
            return getAccessor(resolveAccessor?.(prop) ?? toSnakeCase(prop));
        }
    }) as T;
}
