import { useCallback, useMemo, useRef, useState } from "react";
import { Entity, SelectionController } from "@rebasepro/types";

export function useSelectionController<M extends Record<string, unknown> = Record<string, unknown>>(
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void
): SelectionController<M> {

    const [selectedEntitys, setSelectedEntitys] = useState<Entity<M>[]>([]);

    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;

    const toggleEntitySelection = useCallback((entity: Entity<M>, newSelectedState?: boolean) => {
        setSelectedEntitys(prev => {
            const isSelected = Boolean(prev.find(e => e.id === entity.id && e.path === entity.path));
            const shouldSelect = newSelectedState ?? !isSelected;

            if (shouldSelect && !isSelected) {
                onSelectionChangeRef.current?.(entity, true);
                return [...prev, entity];
            } else if (!shouldSelect && isSelected) {
                onSelectionChangeRef.current?.(entity, false);
                return prev.filter((item: Entity<M>) => !(item.id === entity.id && item.path === entity.path));
            }
            return prev;
        });
    }, []);

    const isEntitySelected = useCallback((entity: Entity<M>) => {
        return Boolean(selectedEntitys.find(e => e.id === entity.id && e.path === entity.path));
    }, [selectedEntitys]);

    return useMemo(() => ({
        selectedEntitys,
        setSelectedEntitys,
        isEntitySelected,
        toggleEntitySelection
    }), [selectedEntitys, setSelectedEntitys, isEntitySelected, toggleEntitySelection]);
}
