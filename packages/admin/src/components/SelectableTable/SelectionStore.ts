import { useSyncExternalStore, useCallback, useRef } from "react";
import { SelectedCellProps } from "@rebasepro/types";

/**
 * A ref-based selection store that avoids React context re-renders.
 *
 * The problem with putting `selectedCell` in a React context value is that
 * ANY cell selection change triggers a context value change, which forces
 * ALL consumers (every PropertyTableCell in the table) to re-render.
 * This causes the DOM to be replaced between mousedown and click events,
 * breaking `alwaysInteractive` cells (like relation selectors) where the
 * user needs to click a button on the very first interaction.
 *
 * This store uses `useSyncExternalStore` so only cells whose `selected`
 * derivation actually changed will re-render.
 */
export function createSelectionStore() {
    let selectedCell: SelectedCellProps<any> | undefined = undefined;
    const listeners = new Set<() => void>();

    function getSnapshot(): SelectedCellProps<any> | undefined {
        return selectedCell;
    }

    function subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function select(cell: SelectedCellProps<any> | undefined) {
        selectedCell = cell;
        listeners.forEach(l => l());
    }

    return { getSnapshot, subscribe, select };
}

export type SelectionStore = ReturnType<typeof createSelectionStore>;

/**
 * Hook that subscribes a cell to the selection store and returns
 * whether THIS cell is selected. Only re-renders when the cell's
 * `selected` boolean actually changes (not on every store update).
 */
export function useCellSelected(
    store: { getSnapshot: () => SelectedCellProps<any> | undefined; subscribe: (listener: () => void) => () => void },
    propertyKey: string,
    entityPath: string,
    entityId: string | number
): boolean {
    // Memoize a selector that derives a boolean from the store snapshot.
    // useSyncExternalStore calls this on every store notification, but
    // React only re-renders when the returned value !== the previous one.
    const selectorRef = useRef({ propertyKey, entityPath, entityId });
    selectorRef.current = { propertyKey, entityPath, entityId };

    const getSnapshot = useCallback(() => {
        const cell = store.getSnapshot();
        if (!cell) return false;
        const s = selectorRef.current;
        return cell.propertyKey === s.propertyKey &&
            cell.entityPath === s.entityPath &&
            cell.entityId === s.entityId;
    }, [store]);

    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
