import { useCallback, useMemo, useRef, useState } from "react";
import { Entity } from "@rebasepro/types";
import { EntitySelection, SelectionController, SelectionQuery } from "@rebasepro/cms-types";

/** Same row: id alone is not unique across a junction-backed tab's two paths. */
function sameEntity(a: Entity<any>, b: Entity<any>): boolean {
    return a.id === b.id && a.path === b.path;
}

/**
 * The rows of a list, by path and then by id, for asking about one row in
 * constant time. Keyed in two levels rather than by a joined string: a path
 * and an id may both contain a slash, and `1` and `"1"` are different ids, as
 * they are to `sameEntity`.
 */
type RowIndex = Map<unknown, Set<unknown>>;

function indexRows(entities: Entity<any>[]): RowIndex {
    const index: RowIndex = new Map();
    for (const entity of entities) {
        let ids = index.get(entity.path);
        if (!ids) {
            ids = new Set();
            index.set(entity.path, ids);
        }
        ids.add(entity.id);
    }
    return index;
}

function indexHas(index: RowIndex, entity: Entity<any>): boolean {
    return index.get(entity.path)?.has(entity.id) ?? false;
}

const EMPTY_SELECTION: EntitySelection<any> = {
    type: "entities",
    entities: []
};

export function useSelectionController<M extends Record<string, unknown> = Record<string, unknown>>(
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void
): SelectionController<M> {

    const [selection, setSelection] = useState<EntitySelection<M>>(EMPTY_SELECTION as EntitySelection<M>);

    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;

    const toggleEntitySelection = useCallback((entity: Entity<M>, newSelectedState?: boolean) => {
        setSelection(prev => {

            // In query mode a row is selected unless it was taken back out, so
            // unticking one ADDS to the exclusions rather than removing from a
            // list of the selected — the list does not exist, and building it
            // would mean reading every matching row first.
            if (prev.type === "query") {
                const isExcluded = prev.excluded.some(e => sameEntity(e, entity));
                const shouldSelect = newSelectedState ?? isExcluded;
                if (shouldSelect === !isExcluded) return prev;
                onSelectionChangeRef.current?.(entity, shouldSelect);
                return {
                    ...prev,
                    excluded: shouldSelect
                        ? prev.excluded.filter(e => !sameEntity(e, entity))
                        : [...prev.excluded, entity]
                };
            }

            const isSelected = prev.entities.some(e => sameEntity(e, entity));
            const shouldSelect = newSelectedState ?? !isSelected;
            if (shouldSelect === isSelected) return prev;
            onSelectionChangeRef.current?.(entity, shouldSelect);
            return {
                type: "entities",
                entities: shouldSelect
                    ? [...prev.entities, entity]
                    : prev.entities.filter(e => !sameEntity(e, entity))
            };
        });
    }, []);

    // Built once per selection. The views ask about every row they hold —
    // the selection menu and the list or card view, after each change — and a
    // linear search per row made "select all loaded rows" quadratic: 10,000
    // rows, ~200 ms per view per change.
    const selectionIndex = useMemo(
        () => indexRows(selection.type === "query" ? selection.excluded : selection.entities),
        [selection]);

    const isEntitySelected = useCallback((entity: Entity<M>) => {
        // Every row a view can show you in query mode came out of that query,
        // so membership is the exclusion list and nothing else. The binding
        // clears the selection if the filter moves underneath it, which is what
        // keeps that true.
        if (selection.type === "query")
            return !indexHas(selectionIndex, entity);
        return indexHas(selectionIndex, entity);
    }, [selection, selectionIndex]);

    const setSelectedEntities = useCallback((entities: Entity<M>[]) => {
        setSelection({
            type: "entities",
            entities
        });
    }, []);

    const selectAllMatching = useCallback((query: SelectionQuery<M>, count?: number) => {
        setSelection({
            type: "query",
            query,
            excluded: [],
            count
        });
    }, []);

    const clearSelection = useCallback(() => {
        setSelection(EMPTY_SELECTION as EntitySelection<M>);
    }, []);

    const selectedCount = useMemo(() => {
        if (selection.type === "entities") return selection.entities.length;
        // An accessor with no `count` can still be selected in full; the number
        // is genuinely unknown and says so, rather than reading as zero.
        if (selection.count === undefined) return undefined;
        return Math.max(0, selection.count - selection.excluded.length);
    }, [selection]);

    const hasSelection = selection.type === "query"
        ? (selectedCount === undefined || selectedCount > 0)
        : selection.entities.length > 0;

    return useMemo(() => ({
        selection,
        setSelection,
        selectedCount,
        hasSelection,
        setSelectedEntities,
        selectAllMatching,
        clearSelection,
        isEntitySelected,
        toggleEntitySelection
    }), [selection, selectedCount, hasSelection, setSelectedEntities, selectAllMatching, clearSelection, isEntitySelected, toggleEntitySelection]);
}
