import React from "react";

/**
 * Whether the drawer is open — pinned, or floating open under the pointer —
 * as a subscription rather than a value.
 *
 * The rail floats open every time the pointer crosses it. Handed down as a
 * prop, that re-rendered every navigation row twice per crossing. The stock
 * rows follow it through the drawer's `data-expanded` attribute and CSS
 * instead, and only a row whose tooltip wants to open listens here, to mask
 * the tooltip once its label is showing.
 */
export type DrawerExpansion = {
    isExpanded(): boolean;
    subscribe(listener: () => void): () => void;
};

/** Provided by `DefaultDrawer`; `null` outside one. */
export const DrawerExpansionContext = React.createContext<DrawerExpansion | null>(null);

/** One store for the life of the drawer, updated as `expanded` changes. */
export function useDrawerExpansion(expanded: boolean): DrawerExpansion {
    const [store] = React.useState(() => {
        let current = expanded;
        const listeners = new Set<() => void>();
        return {
            isExpanded: () => current,
            subscribe: (listener: () => void) => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
            set: (next: boolean) => {
                if (next === current) return;
                current = next;
                listeners.forEach(listener => listener());
            }
        };
    });
    // Before paint, with the attribute the CSS reads, so a masked tooltip and
    // a showing label never appear together.
    React.useLayoutEffect(() => {
        store.set(expanded);
    }, [store, expanded]);
    return store;
}

const subscribeToNothing = () => () => undefined;

/**
 * Whether the drawer around this row is open — read only while `listening`.
 * A row that is not listening gets `false` and is not re-rendered when the
 * drawer opens or closes.
 */
export function useDrawerExpandedWhile(listening: boolean): boolean {
    const expansion = React.useContext(DrawerExpansionContext);
    const active = listening && expansion !== null;
    return React.useSyncExternalStore(
        active ? expansion.subscribe : subscribeToNothing,
        () => active ? expansion.isExpanded() : false,
        () => false
    );
}
