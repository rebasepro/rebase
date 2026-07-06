import { useSyncExternalStore, useCallback, useRef } from "react";

export interface SelectedCell {
    columnKey: string;
    id: string | number;
    cellRect?: DOMRect;
    width?: number;
    height?: number;
}

export function createVirtualTableSelectionStore<T extends SelectedCell = SelectedCell>() {
    let selectedCell: T | undefined = undefined;
    const listeners = new Set<() => void>();

    function getEntity(): T | undefined {
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
        getEntity,
        subscribe,
        select
    };
}

export type VirtualTableSelectionStore<T extends SelectedCell = SelectedCell> = ReturnType<typeof createVirtualTableSelectionStore<T>>;

export function useVirtualTableCellSelected<T extends SelectedCell = SelectedCell>(
    store: VirtualTableSelectionStore<T>,
    columnKey: string,
    id: string | number
): boolean {
    const selectorRef = useRef({ columnKey, id });
    selectorRef.current = { columnKey, id };

    const getEntity = useCallback(() => {
        const cell = store.getEntity();
        if (!cell) return false;
        const s = selectorRef.current;
        return cell.columnKey === s.columnKey && cell.id === s.id;
    }, [store]);

    return useSyncExternalStore(store.subscribe, getEntity, getEntity);
}
