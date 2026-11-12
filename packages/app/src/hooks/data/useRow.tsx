import { useEffect, useMemo, useReducer, useState } from "react";
import { isUnsupported } from "@rebasepro/types";
import { messageOf, useSdkData } from "./sdkData";

/**
 * @group Hooks and utilities
 */
export interface UseRowResult<M extends Record<string, unknown> = Record<string, unknown>> {
    /** The row as the server sends it; undefined while loading, and for a row that is not there or not visible. */
    row?: M;
    loading: boolean;
    error?: string;
    /** Read the row again. */
    refresh: () => void;
}

interface RowState<M> {
    /** The row this state describes, so another row's is never shown as this one. */
    key: string;
    row?: M;
    loading: boolean;
    error?: string;
}

/**
 * One row of a collection, in the shape the server sends it (see
 * {@link useRows}). Pass `undefined` for no row yet: it reads nothing.
 *
 * Kept current the way {@link useRows} is: subscribed where the data source
 * can, read again after a write to the collection where it cannot.
 *
 * ```tsx
 * const { row: order, loading } = useRow<Order>("orders", orderId);
 * ```
 *
 * @group Hooks and utilities
 */
export function useRow<M extends Record<string, unknown> = Record<string, unknown>>(
    collection: string,
    id: string | number | undefined
): UseRowResult<M> {
    const { data, changes } = useSdkData("useRow");
    const accessor = useMemo(() => data.table<M>(collection), [data, collection]);
    const live = !isUnsupported(accessor.listenById);
    const absent = id === undefined || id === "";
    const key = absent ? "" : `${collection}\u0000${typeof id}:${String(id)}`;

    const [version, refresh] = useReducer((n: number) => n + 1, 0);
    useEffect(() => live || absent ? undefined : changes.subscribe(collection, refresh), [live, absent, changes, collection]);

    const [state, setState] = useState<RowState<M>>({ key, loading: !absent });

    useEffect(() => {
        if (id === undefined || id === "") {
            setState((current) => current.key === "" && !current.loading ? current : { key: "", loading: false });
            return;
        }
        setState((current) => current.key !== key
            ? { key, loading: true }
            : current.loading ? current : { ...current, loading: true });

        let cancelled = false;
        const onRow = (row: M | undefined) => {
            if (!cancelled) setState({ key, row, loading: false });
        };
        const onError = (error: unknown) => {
            if (!cancelled) setState({ key, loading: false, error: messageOf(error) });
        };

        let unsubscribe: (() => void) | undefined;
        if (live) {
            try {
                unsubscribe = accessor.listenById(id, onRow, onError);
            } catch (error) {
                onError(error);
            }
        } else {
            Promise.resolve()
                .then(() => accessor.findById(id))
                .then(onRow, onError);
        }
        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, [accessor, id, key, live, version]);

    // Until the effect catches up with a new id, the state is the old row's.
    const current: RowState<M> = state.key === key ? state : { key, loading: !absent };
    return useMemo(() => ({
        row: current.row,
        loading: current.loading,
        error: current.error,
        refresh
    }), [current.row, current.loading, current.error, refresh]);
}
