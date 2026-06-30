import React, { createContext, useContext } from "react";
import { VirtualTableSelectionStore, SelectedCell } from "./SelectionStore";

export interface VirtualTableSelectionContextProps<T extends SelectedCell = SelectedCell> {
    selectionStore: VirtualTableSelectionStore<T>;
    select: (cell: T | undefined) => void;
}

const SelectionContext = createContext<VirtualTableSelectionContextProps<any> | null>(null);

export const VirtualTableSelectionProvider = <T extends SelectedCell = SelectedCell>({
    store,
    children
}: {
    store: VirtualTableSelectionStore<T>;
    children: React.ReactNode;
}) => {
    const value = React.useMemo(() => ({
        selectionStore: store,
        select: store.select
    }), [store]);

    return (
        <SelectionContext.Provider value={value}>
            {children}
        </SelectionContext.Provider>
    );
};

export const useVirtualTableSelection = <T extends SelectedCell = SelectedCell>() => {
    const context = useContext(SelectionContext);
    if (!context) {
        throw new Error("useVirtualTableSelection must be used within a VirtualTableSelectionProvider");
    }
    return context as VirtualTableSelectionContextProps<T>;
};
