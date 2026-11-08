import type { CollectionConfig, Entity } from "@rebasepro/types";
import type {
    EntitySelection,
    EntitySelectionController,
    EntityTableController,
    RowSelection,
    SelectionController,
    TableController
} from "@rebasepro/cms-types";
import { entityOfRow, idOfRow, rowOfEntity } from "./entity_row";

/*
 * The admin keeps a collection view's table and selection in its `Entity`
 * view model; an app's code is handed them as rows and ids. These are the row
 * views, one per controller object and collection, so a view hands the same
 * object back until the state under it changes — stable as a prop and as a
 * hook dependency.
 *
 * An id handed out is the string the admin addresses the record by, and an id
 * handed in is compared as one: an integer key's `5` and `"5"` are one record.
 */

type Row = Record<string, unknown>;

function requireIdOfRow(row: Row, collection: CollectionConfig | undefined): string {
    const id = idOfRow(row, collection);
    if (id !== undefined) return id;
    throw new Error("A row handed to a selection controller has no primary key. Pass the rows the view handed you.");
}

const rowsOfData = new WeakMap<readonly Entity[], { collection: CollectionConfig | undefined; rows: Row[] }>();
const rowsOfSparseData = new WeakMap<readonly (Entity | undefined)[], { collection: CollectionConfig | undefined; rows: (Row | undefined)[] }>();

function rowsOf(data: readonly Entity[], collection: CollectionConfig | undefined): Row[] {
    const cached = rowsOfData.get(data);
    if (cached && cached.collection === collection) return cached.rows;
    const rows = data.map((entity) => rowOfEntity(entity, collection));
    rowsOfData.set(data, { collection, rows });
    return rows;
}

function sparseRowsOf(data: readonly (Entity | undefined)[], collection: CollectionConfig | undefined): (Row | undefined)[] {
    const cached = rowsOfSparseData.get(data);
    if (cached && cached.collection === collection) return cached.rows;
    const rows = data.map((entity) => entity ? rowOfEntity(entity, collection) : undefined);
    rowsOfSparseData.set(data, { collection, rows });
    return rows;
}

/** The ids of records, as an app's code is handed them. */
function idsOf(entities: readonly Entity[]): string[] {
    return entities.map((entity) => String(entity.id));
}

/*
 * Each cache below is keyed by the controller object and holds the view made
 * for it, which is only ever read back for that controller: its `M` is the
 * one the view was made with.
 */
const tableViews = new WeakMap<object, { collection: CollectionConfig | undefined; view: object }>();

/**
 * The row view of a collection view's table controller: its rows as the
 * server sends them, and its query state as it is.
 *
 * @internal
 */
export function tableControllerOf<M extends Record<string, unknown>>(
    controller: EntityTableController<M>,
    collection: CollectionConfig | undefined
): TableController<M> {
    const cached = tableViews.get(controller);
    if (cached && cached.collection === collection) return cached.view as TableController<M>;
    const view: TableController<M> = {
        rows: rowsOf(controller.data, collection),
        ...(controller.sparseData && { sparseRows: sparseRowsOf(controller.sparseData, collection) }),
        onRowsRendered: controller.onRowsRendered,
        loading: controller.dataLoading,
        noMoreToLoad: controller.noMoreToLoad,
        error: controller.dataLoadingError,
        filterValues: controller.filterValues,
        setFilterValues: controller.setFilterValues,
        sortBy: controller.sortBy,
        setSortBy: controller.setSortBy,
        searchString: controller.searchString,
        setSearchString: controller.setSearchString,
        clearFilter: controller.clearFilter,
        itemCount: controller.itemCount,
        setItemCount: controller.setItemCount,
        initialScroll: controller.initialScroll,
        onScroll: controller.onScroll,
        paginationEnabled: controller.paginationEnabled,
        pageSize: controller.pageSize,
        checkFilterCombination: controller.checkFilterCombination,
        onAddColumn: controller.onAddColumn
    };
    tableViews.set(controller, { collection, view });
    return view;
}

const rowSelections = new WeakMap<object, { collection: CollectionConfig | undefined; view: object }>();

/**
 * A selection as an app's code reads it: the rows and their ids, or the
 * query with the ids ticked back off.
 *
 * @internal
 */
export function rowSelectionOf<M extends Record<string, unknown>>(
    selection: EntitySelection<M>,
    collection: CollectionConfig | undefined
): RowSelection<M> {
    const cached = rowSelections.get(selection);
    if (cached && cached.collection === collection) return cached.view as RowSelection<M>;
    const rowSelection: RowSelection<M> = selection.type === "entities"
        ? {
            type: "rows",
            ids: idsOf(selection.entities),
            rows: rowsOf(selection.entities, collection)
        }
        : {
            type: "query",
            query: selection.query,
            excludedIds: idsOf(selection.excluded),
            ...(selection.count !== undefined && { count: selection.count })
        };
    rowSelections.set(selection, { collection, view: rowSelection });
    return rowSelection;
}

const selectionViews = new WeakMap<object, { collection: CollectionConfig | undefined; path: string; view: object }>();
/** The admin's controller behind each row view, so a view handed back to the admin drives the real thing. */
const controllersOfViews = new WeakMap<object, object>();

/**
 * The row view of a collection view's selection controller. A row handed
 * back to it is found again as the record the view holds.
 *
 * @param path where a row that is not one of the view's is addressed
 * @internal
 */
export function selectionControllerOf<M extends Record<string, unknown>>(
    controller: EntitySelectionController<M>,
    collection: CollectionConfig | undefined,
    path: string
): SelectionController<M> {
    const cached = selectionViews.get(controller);
    if (cached && cached.collection === collection && cached.path === path) return cached.view as SelectionController<M>;
    const selection = rowSelectionOf(controller.selection, collection);
    // Selected ids in rows mode, excluded ones in query mode.
    const listed = new Set<string>(selection.type === "rows" ? selection.ids : selection.excludedIds);
    const entityOf = (row: Row) => entityOfRow(row, requireIdOfRow(row, collection), path, collection) as Entity<M>;
    const view: SelectionController<M> = {
        selection,
        selectedCount: controller.selectedCount,
        hasSelection: controller.hasSelection,
        isSelected: (id) => selection.type === "query" ? !listed.has(String(id)) : listed.has(String(id)),
        toggleSelection: (row, selected) => controller.toggleEntitySelection(entityOf(row), selected),
        setSelectedRows: (rows) => controller.setSelectedEntities(rows.map(entityOf)),
        selectAllMatching: (query, count) => controller.selectAllMatching(query, count),
        clearSelection: () => controller.clearSelection()
    };
    selectionViews.set(controller, { collection, path, view });
    controllersOfViews.set(view, controller);
    return view;
}

/**
 * The admin's controller behind a row view {@link selectionControllerOf}
 * made — what a view adopts when it is handed one as
 * `admin.selectionController`.
 *
 * @internal
 */
export function entitySelectionControllerOf<M extends Record<string, unknown>>(
    view: SelectionController<M>
): EntitySelectionController<M> | undefined {
    return controllersOfViews.get(view) as EntitySelectionController<M> | undefined;
}
