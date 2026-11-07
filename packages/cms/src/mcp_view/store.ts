import { useSyncExternalStore } from "react";

/** A value set from outside React — by the host's messages — and read by components. */
export interface ViewStore<T> {
    get(): T;
    set(value: T): void;
    subscribe(listener: () => void): () => void;
}

export function createViewStore<T>(initial: T): ViewStore<T> {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set(next) {
            value = next;
            for (const listener of listeners) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}

/** The store's value, re-rendering when it changes. */
export function useViewStore<T>(store: ViewStore<T>): T {
    return useSyncExternalStore(store.subscribe, store.get, store.get);
}
