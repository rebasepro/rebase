import React, { createContext, useContext, useMemo } from "react";
import type { ComponentOverrideMap } from "@rebasepro/cms-types";

/** Stable empty reference to avoid re-creating context values on every render. */
const EMPTY_OVERRIDES: ComponentOverrideMap = {};

/**
 * Internal state for the component override resolution chain.
 * Holds both global overrides (set on `<Rebase>`) and collection-scoped
 * overrides (set on individual collections).
 *
 * Resolution priority: collection > global > default.
 *
 * @internal
 */
interface ComponentOverrideState {
    globalOverrides: ComponentOverrideMap;
    collectionOverrides: ComponentOverrideMap;
}

export const ComponentOverrideContext = createContext<ComponentOverrideState>({
    globalOverrides: EMPTY_OVERRIDES,
    collectionOverrides: EMPTY_OVERRIDES
});

/**
 * Provider set at the `<Rebase>` root level to supply global component overrides.
 *
 * @internal — Used by the Rebase component. End users set overrides via
 * the `components` prop on `<Rebase>`.
 */
export function GlobalComponentOverrideProvider({
    overrides,
    children
}: {
    overrides?: ComponentOverrideMap;
    children: React.ReactNode;
}) {
    const value = useMemo<ComponentOverrideState>(() => ({
        globalOverrides: overrides ?? EMPTY_OVERRIDES,
        collectionOverrides: EMPTY_OVERRIDES
    }), [overrides]);

    return (
        <ComponentOverrideContext.Provider value={value}>
            {children}
        </ComponentOverrideContext.Provider>
    );
}

/**
 * Provider set at the collection level to layer collection-scoped overrides
 * on top of global overrides.
 *
 * When a collection defines `components`, this provider is mounted
 * around the collection's view subtree. Components within the subtree
 * will resolve overrides in order: collection → global → default.
 *
 * @internal — Used by DataCollectionView when a collection has
 * `components` defined.
 */
export function CollectionComponentOverrideProvider({
    overrides,
    children
}: {
    overrides?: ComponentOverrideMap;
    children: React.ReactNode;
}) {
    const parent = useContext(ComponentOverrideContext);

    const value = useMemo<ComponentOverrideState>(() => ({
        globalOverrides: parent.globalOverrides,
        collectionOverrides: overrides ?? EMPTY_OVERRIDES
    }), [parent.globalOverrides, overrides]);

    return (
        <ComponentOverrideContext.Provider value={value}>
            {children}
        </ComponentOverrideContext.Provider>
    );
}
