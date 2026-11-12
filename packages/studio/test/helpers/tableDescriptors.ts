import type { TableDescriptorsState, TableDescriptorsUnavailableReason } from "@rebasepro/app";
import type { TableDescriptor } from "@rebasepro/types";

const reload = () => undefined;

/**
 * What `useTableDescriptors` answers once the server has served `tables`.
 * Build it once per test module and hand the same object back on every
 * render, as the real hook's memo does: views depend on it by identity.
 */
export function readyTables(tables: readonly TableDescriptor[]): TableDescriptorsState {
    return { tables, status: "ready", error: undefined, unavailable: false, unavailableReason: undefined, reload };
}

/** The server serves no tables at all, for `reason`. */
export function unavailableTables(reason: TableDescriptorsUnavailableReason): TableDescriptorsState {
    return { tables: [], status: "ready", error: undefined, unavailable: true, unavailableReason: reason, reload };
}

/** Still asking. */
export const LOADING_TABLES: TableDescriptorsState = {
    tables: [], status: "loading", error: undefined, unavailable: false, unavailableReason: undefined, reload
};

/** The request failed. */
export function failedTables(error: Error, retry: () => void = reload): TableDescriptorsState {
    return { tables: [], status: "error", error, unavailable: false, unavailableReason: undefined, reload: retry };
}

/** A backend that declares no tables. */
export const NO_TABLES: TableDescriptorsState = readyTables([]);
