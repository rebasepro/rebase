import React, { useContext, useRef } from "react";
import { DataDriver, DataSourceDefinition, DEFAULT_DATA_SOURCE_KEY, RebaseSdkData } from "@rebasepro/types";
import { buildRebaseData, buildRoutedRebaseData, resolveDataSource, wrapAsSdkData } from "@rebasepro/common";
import type { DataChanges } from "./dataChanges";

/**
 * The flat data the row hooks read: `collection(slug)` and nothing else, so a
 * typed client (`RebaseSdkData<Database>`) fits as well as an untyped one.
 */
export type FlatData = Pick<RebaseSdkData, "collection">;

/** The flat data of one `<Rebase>`, and what says its collections changed. */
export interface SdkDataLayer {
    data: FlatData;
    /** The `<Rebase>`'s change signal, shared with the admin's data. */
    changes: DataChanges;
    /** A collection's config by slug, where the admin registered one; what `useRowWrites` reads its `browserCallbacks` from. */
    resolveCollection: (slug: string) => object | undefined;
}

/** @internal */
export const SdkDataLayerContext = React.createContext<SdkDataLayer | undefined>(undefined);

interface FlatSourceInputs {
    /** The client `<Rebase>` reads through: the simulated one while an RLS simulation is on. */
    client?: { data: FlatData };
    dataSources: (DataSourceDefinition & { driver?: DataDriver })[];
    /**
     * The driver an embedding gives the row hooks in place of the default
     * source's (`RebaseEmbedHost.rowHooksDriver`): the same data, with each
     * write the person's to confirm.
     */
    rowHooksDriver?: DataDriver;
    /** Where a driver stores a collection (see `EntityDataOptions.resolveDataPath`). */
    resolveDataPath: (slug: string) => string | undefined;
    /** A collection's config by slug (see `EntityDataOptions.resolveCollection`). */
    resolveCollection: (slug: string) => object | undefined;
    /** The `<Rebase>`'s change signal. */
    changes: DataChanges;
}

/** The routing key a collection declares (`dataSource`), read off whatever config the resolver holds. */
function dataSourceKeyOf(collection: object | undefined): string {
    const dataSource = collection && "dataSource" in collection && typeof collection.dataSource === "string"
        ? collection.dataSource
        : undefined;
    return resolveDataSource({ dataSource }).key;
}

/**
 * Which flat layer the row hooks and `context.data` read, chosen the way
 * `<Rebase>` chooses the admin's data, so the two never disagree.
 *
 * The default source is:
 *
 *   1. a `"(default)"` data source with a driver;
 *   2. the client's `data`, which serves the server's rows and aggregates over HTTP;
 *   3. the only data source with a driver.
 *
 * An embedding's `rowHooksDriver` comes before all three. Every other data
 * source with a driver serves the collections that declare it (`dataSource`),
 * as the admin routes them (`buildRoutedRebaseData`); any other collection
 * reads the default.
 *
 * A driver is read through `buildRebaseData` with no collection resolver,
 * which keeps the wire's own values (ISO dates, a belongsTo as its foreign
 * key); `useData()` is the admin's view model and is never the source here.
 * One layer for the life of the `<Rebase>` while its sources stay the same
 * instances, so inline `dataSources` do not rebuild it on every render.
 *
 * @internal
 */
export function useBuildSdkDataLayer({ client, dataSources, rowHooksDriver, resolveDataPath, resolveCollection, changes }: FlatSourceInputs): SdkDataLayer | undefined {
    const flats = useRef(new WeakMap<object, FlatData>());
    const previous = useRef<{ sources: unknown[]; layer: SdkDataLayer | undefined } | undefined>(undefined);

    const flatOf = (source: object, build: () => FlatData): FlatData => {
        let flat = flats.current.get(source);
        if (!flat) {
            flat = build();
            flats.current.set(source, flat);
        }
        return flat;
    };
    const fromDriver = (driver: DataDriver) =>
        flatOf(driver, () => wrapAsSdkData(buildRebaseData(driver, { resolveDataPath })));

    const withDrivers = dataSources.flatMap((d) => d.driver ? [{ key: d.key, driver: d.driver }] : []);
    const defaultDriver = withDrivers.find((d) => d.key === DEFAULT_DATA_SOURCE_KEY)?.driver;
    const defaultSource: { source: object; data: () => FlatData } | undefined = rowHooksDriver
        ? { source: rowHooksDriver, data: () => fromDriver(rowHooksDriver) }
        : defaultDriver
            ? { source: defaultDriver, data: () => fromDriver(defaultDriver) }
            : client
                ? { source: client, data: () => client.data }
                : withDrivers.length === 1
                    ? { source: withDrivers[0].driver, data: () => fromDriver(withDrivers[0].driver) }
                    : undefined;
    const routed = withDrivers.filter((d) => d.key !== DEFAULT_DATA_SOURCE_KEY && d.driver !== defaultSource?.source);

    // The same sources, in the same order, are the same layer.
    const sources: unknown[] = defaultSource ? [defaultSource.source, ...routed.flatMap((d) => [d.key, d.driver])] : [];
    const last = previous.current;
    if (last && last.sources.length === sources.length && last.sources.every((source, i) => source === sources[i])) {
        return last.layer;
    }

    let layer: SdkDataLayer | undefined;
    if (defaultSource) {
        const defaultData = flatOf(defaultSource.source, defaultSource.data);
        const data = routed.length === 0
            ? defaultData
            : buildRoutedRebaseData<FlatData>({
                defaultData,
                sources: Object.fromEntries(routed.map((d) => [d.key, fromDriver(d.driver)])),
                resolveKey: (slugOrPath) => dataSourceKeyOf(resolveCollection(slugOrPath))
            });
        layer = { data, changes, resolveCollection };
    }
    previous.current = { sources, layer };
    return layer;
}

/**
 * The flat data layer of the enclosing `<Rebase>`.
 *
 * @internal
 */
export function useSdkData(hook: string): SdkDataLayer {
    const layer = useContext(SdkDataLayerContext);
    if (!layer) {
        throw new Error(`${hook} must be used inside <Rebase>, with a \`client\` or a \`dataSources\` entry that has a driver.`);
    }
    return layer;
}

export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
