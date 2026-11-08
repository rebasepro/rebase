import { useEffect, useMemo, useReducer, useState } from "react";
import { AggregateParams, AggregateResult } from "@rebasepro/types";
import { messageOf, useSdkData } from "./sdkData";
import { useStableFilterValues } from "./useStableFilterValues";

/**
 * @group Hooks and utilities
 */
export interface UseAggregateResult {
    /** One row per group (one row without `groupBy`), each aggregate under its alias: `count`, `sum_total`. */
    result?: AggregateResult;
    loading: boolean;
    /** Also set when the data source cannot aggregate at all. */
    error?: string;
}

/**
 * `count`/`sum`/`avg`/`min`/`max` over a collection's matching rows, optionally
 * grouped: the same call as `client.data.<collection>.aggregate()`, computed
 * by the data source rather than by reading the rows.
 *
 * Read again after every write to the collection in this `<Rebase>` — through
 * {@link useRowWrites}, a record form, a collection view or `useData()` — and
 * every change its data source announces. `params`
 * are compared by value. A data source that cannot aggregate (a browser
 * driver with no aggregate support) answers with `error` saying so, never
 * with an empty result.
 *
 * ```tsx
 * const { result } = useAggregate<Order>("orders", {
 *     select: [{ fn: "sum", field: "total" }, { fn: "count" }],
 *     groupBy: ["status"]
 * });
 * // [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
 * ```
 *
 * @group Hooks and utilities
 */
export function useAggregate<M extends Record<string, unknown> = Record<string, unknown>>(
    collection: string,
    params: AggregateParams<M>
): UseAggregateResult {
    const { data, changes } = useSdkData("useAggregate");
    const query = useStableFilterValues(params);
    const accessor = useMemo(() => data.collection<M>(collection), [data, collection]);

    const [version, recompute] = useReducer((n: number) => n + 1, 0);
    useEffect(() => changes.subscribe(collection, recompute), [changes, collection]);

    const [state, setState] = useState<UseAggregateResult>({ loading: true });

    useEffect(() => {
        // A partial client may have no method at all; a data source that
        // cannot aggregate installs a stub that throws its own message.
        if (typeof accessor.aggregate !== "function") {
            setState({
                loading: false,
                error: `Aggregates are not available for "${collection}": its data source does not implement them.`
            });
            return;
        }
        setState((current) => current.loading ? current : { ...current, loading: true });
        let cancelled = false;
        Promise.resolve()
            .then(() => accessor.aggregate(query))
            .then(
                (result) => {
                    if (!cancelled) setState({ result, loading: false });
                },
                (error: unknown) => {
                    if (!cancelled) setState({ loading: false, error: messageOf(error) });
                });
        return () => {
            cancelled = true;
        };
    }, [accessor, collection, query, version]);

    return state;
}
