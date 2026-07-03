import { useSyncExternalStore, useCallback, useRef } from "react";
import { SelectedCellProps } from "@rebasepro/types";
import {
    createVirtualTableSelectionStore,
    VirtualTableSelectionStore,
    SelectedCell
} from "@rebasepro/ui";

export interface AdminSelectedCell extends SelectedCell {
    snapshotPath: string;
    snapshotId: string | number;
    propertyKey: string;
    cellRect: DOMRect;
    width: number;
    height: number;
}

export function createSelectionStore() {
    return createVirtualTableSelectionStore<AdminSelectedCell>();
}

export type SelectionStore = VirtualTableSelectionStore<AdminSelectedCell>;

export function useCellSelected(
    store: { getSnapshot: () => SelectedCellProps | undefined; subscribe: (listener: () => void) => () => void },
    propertyKey: string,
    snapshotPath: string,
    snapshotId: string | number
): boolean {
    const selectorRef = useRef({ propertyKey, snapshotPath, snapshotId });
    selectorRef.current = { propertyKey, snapshotPath, snapshotId };

    const getSnapshot = useCallback(() => {
        const cell = store.getSnapshot();
        if (!cell) return false;
        const s = selectorRef.current;
        return cell.propertyKey === s.propertyKey &&
            cell.snapshotPath === s.snapshotPath &&
            cell.snapshotId === s.snapshotId;
    }, [store]);

    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
