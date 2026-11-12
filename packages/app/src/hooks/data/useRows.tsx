import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DEFAULT_LIST_LIMIT, FindParams, FindResult, MAX_LIST_LIMIT, isUnsupported } from "@rebasepro/types";
import { messageOf, useSdkData } from "./sdkData";
import { useStableFilterValues } from "./useStableFilterValues";

/**
 * Which rows {@link useRows} reads: the narrowing and window of a `find()`.
 * @group Hooks and utilities
 */
export interface UseRowsOptions<M extends Record<string, unknown> = Record<string, unknown>> {
    /** Filter conditions, as `find({ where })`. */
    where?: FindParams<M>["where"];
    /** Sort order, as `find({ orderBy })`. */
    orderBy?: FindParams<M>["orderBy"];
    /** Rows per page. The server's default (50) when omitted. */
    limit?: number;
    /** Rows to skip before the first page. */
    offset?: number;
    /** Text search, AND-ed with `where`. */
    searchString?: string;
}

/**
 * @group Hooks and utilities
 */
export interface UseRowsResult<M extends Record<string, unknown> = Record<string, unknown>> {
    /** The rows as the server sends them: ISO date strings, a belongsTo under its foreign-key column. */
    rows: M[];
    /** Every row the query matches, where the data source counted them. */
    total?: number;
    /** Whether rows past the ones loaded match the query. */
    hasMore: boolean;
    /**
     * Read one more page into `rows`. The rows are one read, so the window
     * stops growing at 1000 rows; page past that with `offset`.
     */
    loadMore: () => void;
    loading: boolean;
    error?: string;
    /** Read the rows again. */
    refresh: () => void;
}

interface RowsState<M extends Record<string, unknown>> {
    /** The read these rows answer: its collection, options and window. */
    collection: string;
    query: UseRowsOptions<M> | undefined;
    limit: number | undefined;
    rows: M[];
    total?: number;
    hasMore: boolean;
    loading: boolean;
    error?: string;
}

/**
 * The params of one read, without the keys the caller left out.
 */
function findParamsOf<M extends Record<string, unknown>>(options: UseRowsOptions<M> | undefined, limit: number | undefined): FindParams<M> {
    const params: FindParams<M> = {};
    if (options?.where !== undefined) params.where = options.where;
    if (options?.orderBy !== undefined) params.orderBy = options.orderBy;
    if (options?.offset !== undefined) params.offset = options.offset;
    if (options?.searchString) params.searchString = options.searchString;
    if (limit !== undefined) params.limit = limit;
    return params;
}

/**
 * A page of a collection's rows, in the shape the server sends them — the
 * shape `client.data` returns and a backend's `context.data` returns, not the
 * admin's `Entity`.
 *
 * Kept current: where the data source can subscribe the rows follow every
 * change to the collection; where it cannot they are read again after every
 * write to it in this `<Rebase>` — through {@link useRowWrites}, a record
 * form, a collection view or `useData()` — and every change the data source
 * announces. Options are compared by value, so
 * an inline object does not read again on every render.
 *
 * ```tsx
 * const { rows, hasMore, loadMore } = useRows<Order>("orders", {
 *     where: { status: ["==", "pending"] },
 *     orderBy: ["created_at", "desc"],
 *     limit: 20
 * });
 * ```
 *
 * @group Hooks and utilities
 */
export function useRows<M extends Record<string, unknown> = Record<string, unknown>>(
    collection: string,
    options?: UseRowsOptions<M>
): UseRowsResult<M> {
    const { data, changes } = useSdkData("useRows");
    const query = useStableFilterValues(options);
    const accessor = useMemo(() => data.table<M>(collection), [data, collection]);
    const live = !isUnsupported(accessor.listen);

    // How many pages `loadMore` has asked for, counted for this query only: a
    // different query starts again at its first page.
    const [loaded, setLoaded] = useState({ collection, query, pages: 1 });
    const pages = loaded.collection === collection && loaded.query === query ? loaded.pages : 1;
    const pageSize = query?.limit ?? DEFAULT_LIST_LIMIT;
    const limit = pages > 1 ? Math.min(pageSize * pages, MAX_LIST_LIMIT) : query?.limit;

    const [version, refresh] = useReducer((n: number) => n + 1, 0);
    useEffect(() => live ? undefined : changes.subscribe(collection, refresh), [live, changes, collection]);

    const [state, setState] = useState<RowsState<M>>({ collection, query, limit, rows: [], hasMore: false, loading: true });
    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        // A different collection's rows, or another query's, are not a
        // placeholder for this one's. A longer window of the same query
        // (loadMore) and a refresh keep the rows they have while they load.
        setState((current) => current.collection !== collection || current.query !== query
            ? { collection, query, limit, rows: [], hasMore: false, loading: true }
            : current.loading ? current : { ...current, loading: true });

        let cancelled = false;
        const onResult = (result: FindResult<M>) => {
            if (cancelled) return;
            setState({
                collection,
                query,
                limit,
                rows: result.data,
                total: result.meta.total,
                hasMore: result.meta.hasMore,
                loading: false
            });
        };
        const onError = (error: unknown) => {
            if (cancelled) return;
            setState({ collection, query, limit, rows: [], hasMore: false, loading: false, error: messageOf(error) });
        };

        const params = findParamsOf(query, limit);
        let unsubscribe: (() => void) | undefined;
        if (live) {
            try {
                unsubscribe = accessor.listen(params, onResult, onError);
            } catch (error) {
                onError(error);
            }
        } else {
            // A promise cannot be cancelled, so a replaced query disowns its
            // answer instead: responses do not arrive in the order they were
            // asked for.
            Promise.resolve()
                .then(() => accessor.find(params))
                .then(onResult, onError);
        }
        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, [accessor, collection, live, query, limit, version]);

    const loadMore = useCallback(() => {
        const current = stateRef.current;
        if (!current.hasMore || current.loading) return;
        setLoaded((previous) => {
            const from = previous.collection === collection && previous.query === query ? previous.pages : 1;
            if ((query?.limit ?? DEFAULT_LIST_LIMIT) * from >= MAX_LIST_LIMIT) return previous;
            return { collection, query, pages: from + 1 };
        });
    }, [collection, query]);

    // Until the effect catches up with new arguments, the state is the old
    // read's: another collection's or query's rows, or error, are none of
    // this one's, and a longer window of the same query is still loading.
    const current = useMemo<RowsState<M>>(() => {
        if (state.collection !== collection || state.query !== query) {
            return { collection, query, limit, rows: [], hasMore: false, loading: true };
        }
        if (state.limit !== limit && !state.loading) return { ...state, loading: true };
        return state;
    }, [state, collection, query, limit]);
    return useMemo(() => ({
        rows: current.rows,
        total: current.total,
        hasMore: current.hasMore,
        loading: current.loading,
        error: current.error,
        loadMore,
        refresh
    }), [current, loadMore, refresh]);
}
