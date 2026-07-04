import { useCallback, useMemo, useRef, useState } from "react";
import { Snapshot, SelectionController } from "@rebasepro/types";

export function useSelectionController<M extends Record<string, unknown> = Record<string, unknown>>(
    onSelectionChange?: (snapshot: Snapshot<M>, selected: boolean) => void
): SelectionController<M> {

    const [selectedSnapshots, setSelectedSnapshots] = useState<Snapshot<M>[]>([]);

    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;

    const toggleSnapshotSelection = useCallback((snapshot: Snapshot<M>, newSelectedState?: boolean) => {
        setSelectedSnapshots(prev => {
            const isSelected = Boolean(prev.find(e => e.id === snapshot.id && e.path === snapshot.path));
            const shouldSelect = newSelectedState ?? !isSelected;

            if (shouldSelect && !isSelected) {
                onSelectionChangeRef.current?.(snapshot, true);
                return [...prev, snapshot];
            } else if (!shouldSelect && isSelected) {
                onSelectionChangeRef.current?.(snapshot, false);
                return prev.filter((item: Snapshot<M>) => !(item.id === snapshot.id && item.path === snapshot.path));
            }
            return prev;
        });
    }, []);

    const isSnapshotSelected = useCallback((snapshot: Snapshot<M>) => {
        return Boolean(selectedSnapshots.find(e => e.id === snapshot.id && e.path === snapshot.path));
    }, [selectedSnapshots]);

    return useMemo(() => ({
        selectedSnapshots,
        setSelectedSnapshots,
        isSnapshotSelected,
        toggleSnapshotSelection
    }), [selectedSnapshots, setSelectedSnapshots, isSnapshotSelected, toggleSnapshotSelection]);
}
