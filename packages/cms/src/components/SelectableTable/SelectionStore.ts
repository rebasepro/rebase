import { useSyncExternalStore, useCallback, useRef } from "react";
import { SelectedCellProps } from "@rebasepro/cms-types";
import {
    createVirtualTableSelectionStore,
    VirtualTableSelectionStore,
    SelectedCell
} from "@rebasepro/ui";

export interface AdminSelectedCell extends SelectedCell {
    entityPath: string;
    entityId: string | number;
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
    store: { getEntity: () => SelectedCellProps | undefined; subscribe: (listener: () => void) => () => void },
    propertyKey: string,
    entityPath: string,
    entityId: string | number
): boolean {
    const selectorRef = useRef({ propertyKey, entityPath, entityId });
    selectorRef.current = { propertyKey, entityPath, entityId };

    const getEntity = useCallback(() => {
        const cell = store.getEntity();
        if (!cell) return false;
        const s = selectorRef.current;
        return cell.propertyKey === s.propertyKey &&
            cell.entityPath === s.entityPath &&
            cell.entityId === s.entityId;
    }, [store]);

    return useSyncExternalStore(store.subscribe, getEntity, getEntity);
}
