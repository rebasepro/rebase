import { useEffect, useRef, useState } from "react";
import { useAuthController } from "@rebasepro/app";

/** How long a loaded result is reused by default, in milliseconds. */
export const DEFAULT_INSIGHT_TTL = 60_000;

/**
 * Loads in flight or done, by signed-in user and key. The user is part of the
 * key: a figure is computed under the permissions of whoever asked for it,
 * and this cache outlives a sign-out.
 */
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Forgets every cached result, so the next read of each key loads again. */
export function clearInsightData(): void {
    cache.clear();
}

export interface InsightData<T> {
    data: T | undefined;
    error: Error | undefined;
    /** True until the first result or error for this key and user arrives. */
    loading: boolean;
}

/**
 * Reads `load()` once per key and signed-in user, and shares the result.
 *
 * Every component that reads the same `key` within `ttl` gets the same
 * request, so a figure drawn on the home page and above a collection is one
 * query and one number. `key` must name what `load` returns: two calls with
 * one key and different loaders read whichever loaded first.
 *
 * Fetch whatever you like in `load`: a backend function that runs the
 * `GROUP BY`, the SDK, any API.
 *
 * @example
 * ```tsx
 * const client = useRebaseClient<RebaseClient>();
 * const { data } = useInsightData("orders/daily", () =>
 *     client.functions.invoke<DailyRow[]>("insights", undefined, { method: "GET", path: "orders/daily" }));
 * ```
 */
export function useInsightData<T>(key: string, load: () => Promise<T>, options?: { ttl?: number }): InsightData<T> {
    const userId = useAuthController().user?.uid ?? null;
    const ttl = options?.ttl ?? DEFAULT_INSIGHT_TTL;
    const cacheKey = JSON.stringify([userId, key]);
    // The loader is usually an inline arrow, a new function every render; the
    // key is what decides when to load again.
    // Declared before the effect that reads it, so it runs first.
    const loadRef = useRef(load);
    useEffect(() => {
        loadRef.current = load;
    });

    const [state, setState] = useState<{ cacheKey: string; data?: T; error?: Error }>();

    useEffect(() => {
        let cancelled = false;
        const hit = cache.get(cacheKey);
        let value: Promise<T>;
        if (hit && Date.now() - hit.at < ttl) {
            // The entry under this key was stored by a loader for the same key,
            // which by the contract above returns this type.
            value = hit.value as Promise<T>;
        } else {
            value = Promise.resolve().then(() => loadRef.current());
            cache.set(cacheKey, { at: Date.now(), value });
            // A failed load is retried by the next reader rather than served for the TTL.
            value.catch(() => {
                if (cache.get(cacheKey)?.value === value) cache.delete(cacheKey);
            });
        }
        value.then(
            (data) => {
                if (!cancelled) setState({ cacheKey, data });
            },
            (error: unknown) => {
                if (!cancelled) setState({ cacheKey, error: error instanceof Error ? error : new Error(String(error)) });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [cacheKey, ttl]);

    // A result loaded for another key or user is not this one's.
    const current = state?.cacheKey === cacheKey ? state : undefined;
    return {
        data: current?.data,
        error: current?.error,
        loading: current === undefined
    };
}
