import React from "react";
import { DataSourceDefinition, RebaseData } from "@rebasepro/types";

/**
 * The data-source configuration provided to `<Rebase>`: the declared
 * definitions plus the built {@link RebaseData} instances for direct/custom
 * transports.
 *
 * The actual path-based routing is assembled by the navigation layer (which
 * has the collection registry) via `resolveDataSource` + `buildRoutedRebaseData`
 * and re-provided through `RebaseDataContext`.
 *
 * @internal
 */
export interface DataSourcesContextValue {
    /** All declared data sources, keyed by data-source key. */
    registry: Record<string, DataSourceDefinition>;
    /**
     * Built {@link RebaseData} for direct/custom data sources, keyed by
     * data-source key. Server-mediated sources are absent (they ride the
     * default client).
     */
    sources: Record<string, RebaseData>;
}

const EMPTY: DataSourcesContextValue = { registry: {}, sources: {} };

/** @internal */
export const DataSourcesContext = React.createContext<DataSourcesContextValue>(EMPTY);

/**
 * Access the data-source configuration provided to `<Rebase>` via the
 * `dataSources` prop.
 * @internal
 */
export const useDataSources = (): DataSourcesContextValue => React.useContext(DataSourcesContext);
