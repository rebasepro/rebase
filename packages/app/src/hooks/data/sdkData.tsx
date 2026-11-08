import React, { useContext, useRef } from "react";
import { DataDriver, DataSourceDefinition, DEFAULT_DATA_SOURCE_KEY, RebaseSdkData } from "@rebasepro/types";
import { buildRebaseData, wrapAsSdkData } from "@rebasepro/common";
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
    /** Where a driver stores a collection (see `EntityDataOptions.resolveDataPath`). */
    resolveDataPath: (slug: string) => string | undefined;
    /** A collection's config by slug (see `EntityDataOptions.resolveCollection`). */
    resolveCollection: (slug: string) => object | undefined;
    /** The `<Rebase>`'s change signal. */
    changes: DataChanges;
}

/**
 * Which flat layer the row hooks read, chosen the way `<Rebase>` chooses the
 * admin's default data source, so the two never disagree:
 *
 *   1. a `"(default)"` data source with a driver;
 *   2. the client's `data`, which serves the server's rows and aggregates over HTTP;
 *   3. the only data source with a driver.
 *
 * A driver is read through `buildRebaseData` with no collection resolver,
 * which keeps the wire's own values (ISO dates, a belongsTo as its foreign
 * key); `useData()` is the admin's view model and is never the source here.
 * One layer per source for the life of the `<Rebase>`, so inline `dataSources`
 * do not rebuild it on every render.
 *
 * @internal
 */
export function useBuildSdkDataLayer({ client, dataSources, resolveDataPath, resolveCollection, changes }: FlatSourceInputs): SdkDataLayer | undefined {
    const layers = useRef(new WeakMap<object, SdkDataLayer>());

    const layerFor = (source: object, build: () => FlatData): SdkDataLayer => {
        let layer = layers.current.get(source);
        if (!layer) {
            layer = { data: build(), changes, resolveCollection };
            layers.current.set(source, layer);
        }
        return layer;
    };
    const fromDriver = (driver: DataDriver) =>
        layerFor(driver, () => wrapAsSdkData(buildRebaseData(driver, { resolveDataPath })));

    const defaultDriver = dataSources.find((d) => d.key === DEFAULT_DATA_SOURCE_KEY && d.driver)?.driver;
    if (defaultDriver) return fromDriver(defaultDriver);
    if (client) {
        const clientData = client.data;
        return layerFor(client, () => clientData);
    }
    const drivers = dataSources.flatMap((d) => d.driver ? [d.driver] : []);
    if (drivers.length === 1) return fromDriver(drivers[0]);
    return undefined;
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
