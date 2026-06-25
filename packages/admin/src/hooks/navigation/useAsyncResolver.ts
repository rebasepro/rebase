import { useCallback, useEffect, useRef, useState, useMemo } from "react";

export type UseAsyncResolverResult<T> = {
    data: T;
    loading: boolean;
    error: Error | undefined;
    refresh: () => void;
};

/**
 * Generic hook that resolves an async value with loading/error/refresh
 * state management, cancellation on unmount or deps change, and
 * ref-based change detection to prevent unnecessary state updates.
 *
 * Extracted from the common pattern in useResolvedCollections and
 * useResolvedViews.
 */
export function useAsyncResolver<T>({
    resolver,
    initialValue,
    isEqual,
    deps,
    disabled,
}: {
    /** Async function that resolves the data */
    resolver: () => Promise<T>;
    /** Initial value before first resolution */
    initialValue: T;
    /** Equality check to prevent unnecessary state updates */
    isEqual: (a: T, b: T) => boolean;
    /** Effect dependencies — when these change, resolver re-runs */
    deps: React.DependencyList;
    /** When true, skip resolution */
    disabled?: boolean;
}): UseAsyncResolverResult<T> {

    const [data, setData] = useState<T>(initialValue);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | undefined>(undefined);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const refresh = useCallback(() => {
        setRefreshTrigger(prev => prev + 1);
    }, []);

    // Ref for change detection — avoids state updates when data hasn't changed
    const dataRef = useRef<T>(initialValue);

    // Store resolver in a ref so we always call the latest version
    // without adding it to effect deps (it's typically a new closure each render)
    const resolverRef = useRef(resolver);
    resolverRef.current = resolver;

    // Same for isEqual
    const isEqualRef = useRef(isEqual);
    isEqualRef.current = isEqual;

    useEffect(() => {
        if (disabled) return;

        let cancelled = false;

        (async () => {
            try {
                const result = await resolverRef.current();

                if (cancelled) return;

                // Only update state if data actually changed
                if (!isEqualRef.current(dataRef.current, result)) {
                    dataRef.current = result;
                    setData(result);
                }

                setError(undefined);
            } catch (e) {
                if (!cancelled) {
                    console.error(e);
                    setError(e as Error);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, refreshTrigger, disabled]);

    return useMemo(() => ({
        data,
        loading,
        error,
        refresh
    }), [data, loading, error, refresh]);
}
