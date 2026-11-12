import { useMemo } from "react";
import { useTableDescriptors, type TableDescriptorsState } from "@rebasepro/app";
import type { TableDescriptor } from "@rebasepro/types";

/**
 * The tables a panel scope renders: the ones handed to it (`tables` on
 * `<RebaseCMS>` or `CollectionsProvider`, for embedding and tests), or else
 * the ones the server serves the signed-in caller.
 *
 * Given tables are ready at once and nothing is asked of the server.
 */
export function usePanelTables(given: readonly TableDescriptor[] | undefined, enabled: boolean): TableDescriptorsState {
    const served = useTableDescriptors({ enabled: enabled && given === undefined });
    const reload = served.reload;
    return useMemo<TableDescriptorsState>(() => given === undefined ? served : {
        tables: given,
        status: "ready",
        error: undefined,
        unavailable: false,
        unavailableReason: undefined,
        reload
    }, [given, served, reload]);
}
