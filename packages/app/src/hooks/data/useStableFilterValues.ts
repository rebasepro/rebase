import { useRef } from "react";
import { deepEqual } from "fast-equals";

/**
 * The same filter object for as long as its contents stay the same.
 *
 * Callers write filters inline — the hooks guide does — so every render hands
 * a data hook a new object. Used as an effect dependency by identity, that
 * re-subscribed on every render, and every delivery rendered again: a
 * subscribe loop against the server for as long as the component was mounted.
 */
export function useStableFilterValues<T>(filterValues: T): T {
    const ref = useRef(filterValues);
    if (!deepEqual(ref.current, filterValues)) {
        ref.current = filterValues;
    }
    return ref.current;
}
