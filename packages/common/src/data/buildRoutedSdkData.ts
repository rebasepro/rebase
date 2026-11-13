import { RebaseSdkData, SDKTableClient } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * What can be routed: anything with the SDK's `.table(slug)` accessor — a
 * whole {@link RebaseSdkData}, or just its `table` method.
 */
export type RoutableSdkData = { table(slug: string): SDKTableClient };

/**
 * Parameters for {@link buildRoutedSdkData}.
 */
export interface RoutedSdkDataParams<T extends RoutableSdkData = RebaseSdkData> {
    /**
     * The default data source: every table that does not resolve to an entry
     * in `sources`.
     */
    defaultData: T;

    /** Per-data-source data, keyed by data-source key (e.g. `"analytics"`). */
    sources: Record<string, T>;

    /**
     * The data-source key of a table slug or path (`resolveDataSource(…).key`).
     * `undefined`, or a key absent from `sources`, routes to the default.
     */
    resolveKey: (slugOrPath: string) => string | undefined;

    /**
     * The slug a property names (`data.myNotes`). Absent, a property is its
     * snake_case (`my_notes`). See `createAccessorSlugResolver`.
     */
    resolveAccessor?: (property: string) => string;
}

/**
 * SDK data that sends each table to the data source it is declared on.
 *
 * `.table(path)` (and `data.products`-style access) resolves the table's
 * data-source key through `resolveKey` and reads the matching entry of
 * `sources`, the default otherwise. With no `sources` it returns
 * `defaultData` itself, so a single-source setup keeps its identity.
 *
 * @example
 * const data = buildRoutedSdkData({
 *     defaultData: buildSdkData(postgresDriver),
 *     sources: { analytics: buildSdkData(analyticsDriver) },
 *     resolveKey: (slug) => resolveDataSource(registry.getTable(slug), defs).key
 * });
 */
export function buildRoutedSdkData<T extends RoutableSdkData = RebaseSdkData>({
    defaultData,
    sources,
    resolveKey,
    resolveAccessor
}: RoutedSdkDataParams<T>): T {
    // Nothing to route: the default untouched (its identity is an effect dependency).
    if (!sources || Object.keys(sources).length === 0) {
        return defaultData;
    }

    function resolve(slugOrPath: string): T {
        const key = resolveKey(slugOrPath);
        if (key && sources[key]) return sources[key];
        return defaultData;
    }

    function getAccessor(slugOrPath: string): SDKTableClient {
        return resolve(slugOrPath).table(slugOrPath);
    }

    const target = { table: getAccessor } as T;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "table") return getAccessor;
            if (typeof prop === "symbol") return undefined;
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            // A table's own accessor name, else camelCase → snake_case, as `buildSdkData` names it.
            return getAccessor(resolveAccessor?.(prop) ?? toSnakeCase(prop));
        }
    });
}
