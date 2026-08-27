/**
 * Adapts an `EntityTableController<M>` (from @rebasepro/types) to a
 * `CollectionDataController<T>` (from @rebasepro/ui), bridging the
 * entity-aware data layer to the headless collection view.
 */

import { useMemo } from "react";
import type { Entity } from "@rebasepro/types";
import type { EntityTableController } from "@rebasepro/cms-types";
import type { CollectionDataController } from "@rebasepro/ui";

/**
 * Unwrap `Entity<M>` objects to flat rows for the headless view.
 * The entity system uses `{ id, path, values: M }`; `values` is already the
 * flat row `M` carrying its real primary key, so unwrapping is just `.values` —
 * no `id`/`path` merge (those are view-model metadata, not row columns).
 */
function flattenEntities<M extends Record<string, unknown>>(
    entities: Entity<M>[]
): M[] {
    return entities.map(entity => entity.values);
}

/**
 * React hook that adapts a EntityTableController to a CollectionDataController.
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
): CollectionDataController<M> {
    const flatData = useMemo(
        () => flattenEntities(tableController.data),
        [tableController.data]
    );

    return useMemo((): CollectionDataController<M> => ({
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
