import { useSyncExternalStore, useCallback, useRef } from "react";

export interface SelectedCell {
    columnKey: string;
    rowId: string | number;
    cellRect?: DOMRect;
    width?: number;
    height?: number;
}

export function createVirtualTableSelectionStore<T extends SelectedCell = SelectedCell>() {
    let selectedCell: T | undefined = undefined;
    const listeners = new Set<() => void>();

    function getSnapshot(): T | undefined {
        return selectedCell;
    }

    function subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function select(cell: T | undefined) {
        selectedCell = cell;
        listeners.forEach(l => l());
    }

    return {
        getSnapshot,
        subscribe,
        select
    };
}

export type VirtualTableSelectionStore<T extends SelectedCell = SelectedCell> = ReturnType<typeof createVirtualTableSelectionStore<T>>;

export function useVirtualTableCellSelected<T extends SelectedCell = SelectedCell>(
    store: VirtualTableSelectionStore<T>,
    columnKey: string,
    rowId: string | number
): boolean {
    const selectorRef = useRef({ columnKey, rowId });
    selectorRef.current = { columnKey, rowId };

    const getSnapshot = useCallback(() => {
        const cell = store.getSnapshot();
        if (!cell) return false;
        const s = selectorRef.current;
        return cell.columnKey === s.columnKey && cell.rowId === s.rowId;
    }, [store]);

    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
