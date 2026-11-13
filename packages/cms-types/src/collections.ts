/**
 * Admin-panel view models for a collection.
 *
 * These twelve types came out of `collections.ts`, where they sat interleaved
 * with the collection shape itself. None of them describes data: they are the
 * table's controllers, the selection state, the kanban layout, the shape of a
 * toolbar action's props. Every one names `React` or `RebaseContext`, and none is
 * imported by a single backend package — checked across `server`,
 * `server-postgres`, `client`, `common`, `utils`, `cli` and
 * `codegen`.
 *
 * That is what made them safe to lift: they were never part of the BaaS surface,
 * only stored next to it.
 */
// `import type`, and it matters: this module is reachable from the package
// barrel, which a backend process can load. `React` appears here only in type
// position (`React.ReactNode`), so a value import would have been elided
// anyway — by esbuild's rules, silently, and only for as long as nobody added a
// value use. Written as a type import it is the compiler's job instead of a
// bundler's habit. `check:headless` loads this graph and proves it.
import type React from "react";
import type { Entity, EntityStatus, FilterValues, OrderByTuple, Property, User } from "@rebasepro/types";

import type { RebaseContext } from "./rebase_context";
import type { AdminCollection, PropertyPath } from "@rebasepro/cms-types";

/**
 * Configuration for Kanban board view mode.
 * @group Collections
 */
export interface KanbanConfig<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Property key to use for Kanban board columns.
     * Must reference a string property with `enum` values defined.
     * Entities will be grouped into columns based on this property's value.
     * The column order is determined by the order of `enum` values in the property.
     *
     * Left permissive on purpose, unlike the *optional* key fields on the admin
     * block (`display`, `sort`, `propertiesOrder`, …), which are checked
     * against `M`.
     *
     * This one is **required**, and that is the whole difference: a required
     * generic-dependent property puts `Extract<keyof M, string>` in an invariant
     * position, so `AdminCollection<M>` stops being assignable to
     * `AdminCollection`. The admin package passes collections between those two
     * forms in roughly fifteen places — `CollectionBoardViewBinding`, the
     * collection editor, the view bindings — and every one of them breaks.
     * Tightening this is a worthwhile change, but it is a refactor of those call
     * sites rather than a type edit. Verified by trying it: `columnProperty:
     * Extract<keyof M, string>` alone produced ~15 errors, and doing it alongside
     * `entityViews`/`formView`/`Actions` produced 95.
     */
    columnProperty: Extract<keyof M, string> | (string & {});
}

/**
 * View mode for displaying a collection.
 * - "list": Simple, clean list view — the classic admin default
 * - "table": Table with inline editing
 * - "cards": Grid of visual cards with thumbnails
 * - "kanban": Board view grouped by a property
 *
 * Any other string is the `key` of a custom view declared in
 * `admin.customViews` or registered on `<RebaseCMS collectionViews={…}>`.
 * The `(string & {})` arm is what keeps the four built-ins in autocomplete
 * while still admitting those keys.
 *
 * @group Collections
 */
export type ViewMode = "list" | "table" | "cards" | "kanban" | (string & {});

/**
 * Parameter passed to the `Actions` prop in the collection configuration.
 * The component will receive this prop when it is rendered in the collection
 * toolbar.
 *
 * @group Models
 */
export interface CollectionActionsProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User, EC extends AdminCollection<M> = AdminCollection<M>> {
    /**
     * Full collection path of this entity. This is the full path, like
     * `users/1234/addresses`
     */
    path: string;

    /**
     * Path of the last collection, like `addresses`
     */
    relativePath: string;

    /**
     * Array of the parent path segments like `['users']`
     */
    parentCollectionSlugs: string[];
    parentEntityIds: string[];

    /**
     * The collection configuration
     */
    collection: EC;

    /**
     * What is selected — the rows, by id, or the query they stand for — and
     * how to change it.
     */
    selectionController: SelectionController<M>;

    /**
     * The view's live query: its rows, and the filter, search and sort the
     * toolbar shares.
     */
    tableController: TableController<M>;

    /**
     * Context of the app status
     */
    context: RebaseContext<USER>;

    /**
     * Count of the entities in this collection.
     * undefined means the count is still loading.
     */
    collectionEntitiesCount?: number;

    /**
     * Programmatically open the new-document form for this collection,
     * optionally pre-populating it with initial field values.
     * The form opens in the same mode configured for the collection
     * (side panel, full screen, or split).
     *
     * This is the primary hook for workflows that need to create a document
     * from external data — e.g. fetching content from a URL, importing from
     * a third-party API, or duplicating from another system.
     *
     * @example
     * // Inside a custom CollectionAction component:
     * openNewDocument({ title: "Fetched title", body: "..." });
     */
    openNewDocument: (defaultValues?: Record<string, unknown>) => void;

}

/**
 * The query a selection stands for: the view's filter, search and sort at the
 * moment "select all matching" was clicked.
 *
 * It is captured rather than read live, because the filter is editable while a
 * selection is held. A selection that silently followed the filter bar would
 * mean the rows you are about to delete are not the rows you counted.
 *
 * @group Models
 */
export interface SelectionQuery<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    filterValues?: FilterValues<Extract<keyof M, string> | (string & {})>;
    searchString?: string;
    sortBy?: OrderByTuple<Extract<keyof M, string> | (string & {})>[];
}

/**
 * What a selection *is*, as the admin holds it: the selected records in its
 * `Entity` view model. What a copy of a built-in part (`Collection.Table`, a
 * card) is handed; an app's own code reads {@link RowSelection}.
 *
 * Ticking rows gives you `"entities"` — the rows themselves, all of them
 * loaded. Clicking "select all 12,480 matching" gives you `"query"`, which
 * stands for rows that mostly have not been read and, past a few pages, never
 * will be all at once.
 *
 * This is a union rather than an `Entity[]` with a flag beside it because the
 * difference has to be unmissable at the point of use. The array it replaced
 * held, in query mode, whatever the view happened to have scrolled — so
 * `selectedEntities.length` read 50, a bulk delete deleted 50, and it reported
 * success. There is no way to write that against a union: the `"query"` branch
 * has no `entities` to reach for.
 *
 * @group Models
 */
export type EntitySelection<M extends Record<string, unknown> = Record<string, unknown>> =
    | {
        type: "entities";
        /** The rows that were picked, in the order they were picked. */
        entities: Entity<M>[];
    }
    | {
        type: "query";
        /** Every row matching this is selected, bar the exclusions. */
        query: SelectionQuery<M>;
        /**
         * Rows ticked back off after selecting the query.
         *
         * Gmail drops to a plain list when you untick one; keeping the query and
         * carrying the exclusions is both closer to what was meant ("all of them
         * except that one") and cheaper — dropping to a list would have to read
         * every row first.
         */
        excluded: Entity<M>[];
        /**
         * The server's count for `query` when the selection was made.
         *
         * `undefined` where the accessor has no `count` — a collection can be
         * selected in full without anyone knowing how large it is, and the UI
         * says so rather than inventing a number.
         */
        count?: number;
    };

/**
 * The admin's own selection state, over its `Entity` view model: what the
 * built-in views and a copy of one of them (`Collection.Table`, a card)
 * drive. An app's own code is handed a {@link SelectionController}, which
 * speaks rows and ids.
 *
 * @group Models
 */
export interface EntitySelectionController<M extends Record<string, unknown> = Record<string, unknown>> {

    /** What is selected: the rows, or the query they stand for. */
    selection: EntitySelection<M>;

    setSelection(selection: EntitySelection<M>): void;
    setSelection(action: (prev: EntitySelection<M>) => EntitySelection<M>): void;

    /**
     * How many rows are selected.
     *
     * `undefined` only in query mode against an accessor with no `count`:
     * "every matching row, we do not know how many". Callers must render that
     * case rather than defaulting it to zero.
     */
    selectedCount: number | undefined;

    /** Whether anything at all is selected. Cheap in both modes. */
    hasSelection: boolean;

    /** Replace the selection with exactly these rows. */
    setSelectedEntities(entities: Entity<M>[]): void;

    /**
     * Select every row matching `query`, minus whatever gets unticked later.
     *
     * `count` is what the UI reports and what `resolveSelection` checks its
     * ceiling against; pass the view's own filtered count so the two agree.
     */
    selectAllMatching(query: SelectionQuery<M>, count?: number): void;

    clearSelection(): void;

    isEntitySelected(entity: Entity<M>): boolean;
    toggleEntitySelection(entity: Entity<M>, newSelectedState?: boolean): void;
}

/**
 * What is selected in a collection view, as an app's code reads it.
 *
 * Ticking rows gives you `"rows"`: their ids, and the rows themselves as the
 * server sends them — ISO dates, a belongsTo as its foreign-key column, its
 * own columns and nothing else. Clicking "select all 12,480 matching" gives you `"query"`, which
 * stands for rows that mostly have not been read: the query, the ids ticked
 * back off, and the count. `resolveSelection` reads a query selection's rows.
 *
 * A union rather than a list with a flag beside it, so the difference cannot
 * be missed: the `"query"` branch has no `rows` to reach for. A bulk action
 * that acted on the rows a view had scrolled — 50 of 12,480 — and reported
 * success is not something you can write against it.
 *
 * @group Models
 */
export type RowSelection<M extends Record<string, unknown> = Record<string, unknown>> =
    | {
        type: "rows";
        /**
         * The selected rows' ids, in the order they were picked: each
         * record's primary key as a string, a composite key's parts joined
         * by `:::` — the id `useSidePanel().open` and a route take.
         */
        ids: string[];
        /** The selected rows, in the same order as `ids`. */
        rows: Record<string, unknown>[];
    }
    | {
        type: "query";
        /** Every row matching this is selected, bar `excludedIds`. */
        query: SelectionQuery<M>;
        /** The ids of the rows ticked back off after selecting the query, as `ids` spells them. */
        excludedIds: string[];
        /**
         * The server's count for `query` when the selection was made;
         * `undefined` where the data source has no count.
         */
        count?: number;
    };

/**
 * A collection view's selection, as an app's code reads and changes it: in a
 * custom view, a collection action, a toolbar slot or an entity action.
 *
 * Read {@link SelectionController.selection} to find out what is selected. It
 * is a {@link RowSelection} union, so a consumer that wants rows has to say
 * what it does when the selection is a query — `resolveSelection` reads them,
 * page by page, with a ceiling and a progress callback.
 *
 * @group Models
 */
export interface SelectionController<M extends Record<string, unknown> = Record<string, unknown>> {

    /** What is selected: the rows and their ids, or the query they stand for. */
    selection: RowSelection<M>;

    /**
     * How many rows are selected.
     *
     * `undefined` only in query mode against a data source with no count:
     * "every matching row, we do not know how many". Render that case rather
     * than defaulting it to zero.
     */
    selectedCount: number | undefined;

    /** Whether anything at all is selected. Cheap in both modes. */
    hasSelection: boolean;

    /**
     * Whether the row with this id is selected, in either mode. The id is
     * compared as a string, so an integer key's `5` and `"5"` are one row.
     */
    isSelected(id: string | number): boolean;

    /**
     * Tick or untick a row — `selected` says which; without it, the row
     * flips. The row is found by its primary-key columns, so pass a row the
     * view handed you, or one carrying those columns. In query mode, unticking a row excludes it from the query.
     */
    toggleSelection(row: Record<string, unknown>, selected?: boolean): void;

    /** Replace the selection with exactly these rows, each carrying its primary-key columns. */
    setSelectedRows(rows: Record<string, unknown>[]): void;

    /**
     * Select every row matching `query`, minus whatever gets unticked later.
     *
     * `count` is what the UI reports and what `resolveSelection` checks its
     * ceiling against; pass the view's own filtered count so the two agree.
     */
    selectAllMatching(query: SelectionQuery<M>, count?: number): void;

    clearSelection(): void;
}

// Canonical filter types — re-exported from the single source-of-truth.

/**
 * Used to indicate valid filter combinations (e.g. created in Firestore)
 * If the user selects a specific filter/sort combination, the admin checks if it's
 * valid, otherwise it reverts to the simpler valid case
 * @group Models
 */
export type FilterCombination<Key extends string> = Partial<Record<Key, "asc" | "desc">>;

/**
 * Sizes in which a collection can be rendered
 * @group Models
 */
export type CollectionSize = "xs" | "s" | "m" | "l" | "xl";

/**
 * What an additional field's `Builder` and `value` are handed. `row` is the
 * record as the server sends it — the shape `useRows` and `context.data`
 * return: dates as ISO strings, a belongsTo as its foreign-key column, its
 * own columns and nothing else (`id` only where the table has that column).
 * `id` is the record's id beside it: its primary key as a string, a
 * composite one's parts joined by `:::` — the id `useSidePanel().open` and a
 * route take.
 */
export type AdditionalFieldDelegateProps<
    // Unused by `row`, which is the server's shape and not the view model's;
    // kept so the delegate types around it keep their parameters.
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = {
    row: Record<string, unknown>,
    id: string,
    context: RebaseContext<USER>
};

/**
 * Use this interface for adding additional fields to entity collection views and forms.
 *
 * **Computed for display only. The server never sees it.**
 *
 * `value` is async and receives the whole {@link RebaseContext}, so it *can*
 * read another collection, and its result is cached per record. That makes it
 * read like a computed column, and it is not one: it runs in the browser, once
 * per row, **after** the page has already been fetched and ordered. There is no
 * point at which its result could take part in choosing which rows came back or
 * in what order. So a derived value can be shown, and can never be filtered,
 * sorted or paged on — no matter what it is derived from.
 *
 * To filter or sort on a derived value it has to exist in the database. Two
 * ways, in order of preference:
 *
 *  - if the value is an aggregate over a relation, ask for it in the query
 *    instead — `where: { "applications.status": ["in", [...]] }` and
 *    `orderBy: [[{ relation: "applications", field: "created_at", agg: "min" }, "asc"]]`
 *    are both compiled by the driver, which means they run before paging;
 *  - otherwise denormalise it onto the row — a generated column, or a
 *    trigger-maintained one — and it becomes an ordinary property.
 *
 * @group Models
 */
export interface AdditionalFieldDelegate<M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User> {

    /**
     * ID of this column. You can use this id in the `properties` field of the
     * collection in any order you want
     */
    key: string;

    /**
     * Header of this column
     */
    name: string;

    /**
     * Width of the generated column in pixels
     */
    width?: number;

    /**
     * Builder for the custom field
     */
    Builder?(props: AdditionalFieldDelegateProps<M, USER>): React.ReactNode;

    /**
     * If this column needs to update dynamically based on other properties,
     * you can define an array of keys as strings with the
     * `dependencies` prop.
     * e.g. ["name", "surname"]
     * This is a performance optimization, if you don't define dependencies
     * it will be updated in every render.
     *
     * A key that is not a property of this collection can never change, so
     * listing one is always a mistake — it silently pins the column to the
     * "never re-render" path, which reads as a stale cell rather than a typo.
     * The `NoInfer` wrappers keep these keys from participating in inference of
     * `M`; the `(string & {})` arms they used to sit beside made the whole union
     * `string`, so the wrappers had nothing to protect.
     */
    dependencies?: NoInfer<PropertyPath<M>> | NoInfer<PropertyPath<M>>[];

    /**
     * Use this prop to define the value of the column as a string or number.
     * This is the value that will be used for exporting the collection.
     * If `Builder` is defined, this prop will be ignored in the collection
     * view.
     */
    value?(props: AdditionalFieldDelegateProps<M>): string | number | Promise<string | number> | undefined;
}

/**
 * Used in the {@link AdminCollection#defaultSelectedView} to define the default
 * @group Models
 */
export type DefaultSelectedViewBuilder = (params: DefaultSelectedViewParams) => string | undefined;

/**
 * Used in the {@link AdminCollection#defaultSelectedView} to define the default
 * @group Models
 */
export type DefaultSelectedViewParams = {
    status?: EntityStatus;
    /** The record's id; absent for a new one. */
    id?: string | number;
};

/**
 * A collection view's live query, as an app's code reads it: in a custom
 * view, a collection action or a toolbar slot.
 *
 * `rows` are the rows the toolbar's search, filters and sort select, as the
 * server sends them — the shape `useRows` returns: ISO date strings
 * (`YYYY-MM-DD` for a date-only column), a belongsTo as its foreign-key
 * column, `id` only where the table has that column. A relation the view loaded arrives nested under its
 * name, as REST's `include` returns it. `ids` are their ids beside them, at
 * the same positions, as a selection's `ids` are beside its `rows`.
 *
 * ```tsx
 * tableController.rows.map((row, i) => {
 *     const id = tableController.ids[i];
 *     return <Card key={id}
 *         className={highlightedIds?.includes(id) ? "ring-2 ring-primary" : undefined}
 *         onClick={() => onRowClick?.(row)}>{String(row.title ?? id)}</Card>;
 * })
 * ```
 *
 * @group Models
 */
export type TableController<M extends Record<string, unknown> = Record<string, unknown>> = {
    /** The rows read, in order. */
    rows: Record<string, unknown>[];
    /**
     * The id of each of `rows`, at the same position: the record's primary
     * key as a string, a composite one's parts joined by `:::` — the id
     * `useSidePanel().open`, a route and `highlightedIds` take. A row has an
     * `id` column only where its table does; every row has an id here.
     */
    ids: string[];
    /**
     * `rows` by position in the collection, with `undefined` where a row
     * exists but has not been read: the rows above a scroll position a view
     * came back to, until it scrolls to them. Present only while there are
     * such rows, and only once a view has reported what it draws
     * (`onRowsRendered`).
     */
    sparseRows?: (Record<string, unknown> | undefined)[];
    /** The id of each of `sparseRows`, at the same position; present when it is. */
    sparseIds?: (string | undefined)[];
    /**
     * Called by a view with the positions of the rows it draws in
     * `sparseRows ?? rows` (end exclusive), and with `undefined` when it stops
     * drawing them. Under realtime, the rows near them are read again on each
     * change; without a report, every row held is.
     */
    onRowsRendered?: (range?: { start: number; end: number }) => void;
    /** Whether a read is in flight. */
    loading: boolean;
    /** Whether every matching row has been read. */
    noMoreToLoad: boolean;
    /** Why the last read failed. */
    error?: Error;
    filterValues?: FilterValues<Extract<keyof M, string> | (string & {})>;
    setFilterValues?: (filterValues?: FilterValues<Extract<keyof M, string> | (string & {})>) => void;
    /** The sort keys in order of significance, the second breaking ties on the first. */
    sortBy?: OrderByTuple<Extract<keyof M, string> | (string & {})>[];
    setSortBy?: (sortBy?: OrderByTuple<Extract<keyof M, string> | (string & {})>[]) => void;
    searchString?: string;
    setSearchString?: (searchString?: string) => void;
    clearFilter?: () => void;
    /** How many rows the view holds; raise it to read the next page. */
    itemCount?: number;
    setItemCount?: (itemCount: number) => void;
    initialScroll?: number;
    onScroll?: (props: {
        scrollDirection: "forward" | "backward",
        scrollOffset: number,
        scrollUpdateWasRequested: boolean
    }) => void;
    paginationEnabled?: boolean;
    pageSize?: number;
    checkFilterCombination?: (filterValues: FilterValues<string>,
        sortBy?: OrderByTuple[]) => boolean;
    /** Add a column to the table, by property key. */
    onAddColumn?: (column: string) => void;
};

/**
 * The admin's own table state, over its `Entity` view model: what the
 * built-in views and a copy of one of them (`Collection.Table`, a card)
 * drive. An app's own code is handed a {@link TableController}, which speaks
 * rows.
 *
 * @group Models
 */
export type EntityTableController<M extends Record<string, unknown> = Record<string, unknown>> = {
    data: Entity<M>[];
    /**
     * `data` by position in the collection, with `undefined` where a row
     * exists but has not been read: the rows above a scroll position a view
     * came back to, until it scrolls to them. Present only while there are
     * such rows, and only once a view has reported what it draws
     * (`onRowsRendered`). A view that draws it shows a placeholder for each
     * `undefined`; `data` holds the rows read, in order.
     */
    sparseData?: (Entity<M> | undefined)[];
    /**
     * Called by a view with the positions of the rows it draws in
     * `sparseData ?? data` (end exclusive), and with `undefined` when it stops
     * drawing them. Under realtime, the rows within a page of them are read
     * again on each change and rows further away when they come near; without
     * a report, every row held is.
     */
    onRowsRendered?: (range?: { start: number; end: number }) => void;
    dataLoading: boolean;
    noMoreToLoad: boolean;
    dataLoadingError?: Error;
    filterValues?: FilterValues<Extract<keyof M, string> | (string & {})>;
    setFilterValues?: (filterValues?: FilterValues<Extract<keyof M, string> | (string & {})>) => void;
    /**
     * The sort keys in order of significance, the second breaking ties on the
     * first. A single key is a one-element list — this was a bare tuple, which
     * could only ever express one, so `collection.sort` could not describe an
     * order like "by role, newest first within each role" and the table had no
     * state to hold one in.
     */
    sortBy?: OrderByTuple<Extract<keyof M, string> | (string & {})>[];
    setSortBy?: (sortBy?: OrderByTuple<Extract<keyof M, string> | (string & {})>[]) => void;
    searchString?: string;
    setSearchString?: (searchString?: string) => void;
    clearFilter?: () => void;
    itemCount?: number;
    setItemCount?: (itemCount: number) => void;
    initialScroll?: number;
    onScroll?: (props: {
        scrollDirection: "forward" | "backward",
        scrollOffset: number,
        scrollUpdateWasRequested: boolean
    }) => void;
    paginationEnabled?: boolean;
    pageSize?: number;
    checkFilterCombination?: (filterValues: FilterValues<string>,
        sortBy?: OrderByTuple[]) => boolean;
    popupCell?: SelectedCellProps<M>;
    setPopupCell?: (popupCell?: SelectedCellProps<M>) => void;

    onAddColumn?: (column: string) => void;
}

export type SelectedCellProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    propertyKey: Extract<keyof M, string> | (string & {});
    cellRect: DOMRect;
    width: number;
    height: number;
    entityPath: string;
    /** The record's id: its primary key as a string, a composite one's parts joined by `:::`. */
    id: string;
};