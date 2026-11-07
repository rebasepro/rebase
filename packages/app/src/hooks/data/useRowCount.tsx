import { useEffect, useMemo, useReducer, useState } from "react";
import { FindParams, isUnsupported } from "@rebasepro/types";
import { messageOf, useSdkData } from "./sdkData";
import { useStableFilterValues } from "./useStableFilterValues";

/**
 * @group Hooks and utilities
 */
export interface UseRowCountResult {
    /** How many rows match; undefined until counted. */
    count?: number;
    loading: boolean;
    error?: string;
}

/**
 * How many rows of a collection match `where`. Live where the data source can
 * count live; elsewhere counted again after every write made through
 * {@link useRowWrites}. `where` is compared by value.
 *
 * ```tsx
 * const { count } = useRowCount<Order>("orders", { status: ["==", "pending"] });
 * ```
 *
 * @group Hooks and utilities
 */
export function useRowCount<M extends Record<string, unknown> = Record<string, unknown>>(
    collection: string,
    where?: FindParams<M>["where"]
): UseRowCountResult {
    const { data, changes } = useSdkData("useRowCount");
    const filter = useStableFilterValues(where);
    const accessor = useMemo(() => data.collection<M>(collection), [data, collection]);
    const live = !isUnsupported(accessor.listenCount);

    const [version, recount] = useReducer((n: number) => n + 1, 0);
    useEffect(() => live ? undefined : changes.subscribe(collection, recount), [live, changes, collection]);

    const [state, setState] = useState<UseRowCountResult>({ loading: true });

    useEffect(() => {
        setState((current) => current.loading ? current : { ...current, loading: true });
        let cancelled = false;
        const onCount = (count: number) => {
            if (!cancelled) setState({ count, loading: false });
        };
        const onError = (error: unknown) => {
            if (!cancelled) setState({ loading: false, error: messageOf(error) });
        };

        const params: FindParams<M> = filter !== undefined ? { where: filter } : {};
        let unsubscribe: (() => void) | undefined;
        if (live) {
            try {
                unsubscribe = accessor.listenCount(params, onCount, onError);
            } catch (error) {
                onError(error);
            }
        } else {
            Promise.resolve()
                .then(() => accessor.count(params))
                .then(onCount, onError);
        }
        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, [accessor, live, filter, version]);

    return state;
}
