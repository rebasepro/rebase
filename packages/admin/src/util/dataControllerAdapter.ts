/**
 * Adapts an `EntityTableController<M>` (from @rebasepro/types) to a
 * `CollectionDataController<T>` (from @rebasepro/ui), bridging the
 * entity-aware data layer to the headless collection view.
 */

import { useMemo } from "react";
import type { Entity, EntityTableController } from "@rebasepro/types";
import type { CollectionDataController } from "@rebasepro/ui";

/**
 * Flatten Entity<M> objects to plain row objects.
 * The headless view works with flat `Record<string, unknown>` rows,
 * while the entity system uses `{ id, path, values: M }`.
 *
 * The flattened row includes `id` and `path` at the top level,
 * plus all values spread.
 */
function flattenEntities<M extends Record<string, unknown>>(
    entities: Entity<M>[]
): Array<M & { id: string | number; path: string }> {
    return entities.map(entity => ({
        id: entity.id,
        path: entity.path,
        ...entity.values
    }));
}

/**
 * React hook that adapts an EntityTableController to a CollectionDataController.
 *
 * Usage:
 * ```tsx
 * const tableController = useDataTableController({ path, collection });
 * const dataController = useCollectionDataController(tableController);
 *
 * <CollectionView dataController={dataController} ... />
 * ```
 */
export function useCollectionDataController<M extends Record<string, unknown>>(
    tableController: EntityTableController<M>
): CollectionDataController<M & { id: string | number; path: string }> {
    const flatData = useMemo(
        () => flattenEntities(tableController.data),
        [tableController.data]
    );

    return useMemo((): CollectionDataController<M & { id: string | number; path: string }> => ({
        data: flatData,
        loading: tableController.dataLoading,
        noMoreToLoad: tableController.noMoreToLoad,
        error: tableController.dataLoadingError,

        filterValues: tableController.filterValues as Record<string, [string, unknown]> | undefined,
        setFilterValues: tableController.setFilterValues as
            ((values: Record<string, [string, unknown]> | undefined) => void) | undefined,

        sortBy: tableController.sortBy,
        setSortBy: tableController.setSortBy,

        searchString: tableController.searchString,
        setSearchString: tableController.setSearchString,

        clearFilter: tableController.clearFilter,

        initialScroll: tableController.initialScroll,
        onScroll: tableController.onScroll,

        paginationEnabled: tableController.paginationEnabled,
        pageSize: tableController.pageSize,
        itemCount: tableController.itemCount,
        setItemCount: tableController.setItemCount,
    }), [flatData, tableController]);
}

/**
 * Non-hook version for cases where you already have the data
 * and just need to build a static controller.
 */
export function createStaticDataController<T extends Record<string, unknown>>(
    data: T[],
    options?: {
        loading?: boolean;
        error?: Error;
    }
): CollectionDataController<T> {
    return {
        data,
        loading: options?.loading ?? false,
        noMoreToLoad: true,
        error: options?.error,
    };
}
