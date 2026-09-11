/**
 * Admin-panel view models for a collection.
 *
 * These twelve types came out of `collections.ts`, where they sat interleaved
 * with the collection shape itself. None of them describes data: they are the
 * table's controllers, the selection state, the kanban layout, the shape of a
 * toolbar action's props. Every one names `React` or `RebaseContext`, and none is
 * imported by a single backend package — checked across `server`,
 * `server-postgres`, `server-mongo`, `client`, `common`, `utils`, `cli` and
 * `codegen`.
 *
 * That is what made them safe to lift: they were never part of the BaaS surface,
 * only stored next to it.
 */
// `import type`, and it matters: this module is reachable from the package
// barrel, which a collection file imports `defineCollection` from, and a
// collection file is loaded by the backend. `React` appears here only in type
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
     * Use this controller to get the selected entities and to update the
     * selected entities state.
     */
    selectionController: SelectionController<M>;

    /**
     * Use this controller to get the table controller and to update the
     * table controller state.
     */
    tableController: EntityTableController<M>;

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
 * What a selection *is*.
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
 * has no `entities` to reach for, and `resolveSelection` is the only thing that
 * can produce them.
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
 * Use this controller to retrieve the selection or modify it in an
 * {@link AdminCollection}.
 *
 * Read {@link SelectionController.selection} to find out what is selected. It
 * is a {@link EntitySelection} union, so a consumer that wants rows has to say
 * what it does when the selection is a query — {@link resolveSelection} reads
 * them, page by page, with a ceiling and a progress callback.
 *
 * {@link SelectionController.isEntitySelected} and
 * {@link SelectionController.toggleEntitySelection} work the same in both
 * modes and are what a per-row checkbox should use.
 *
 * @group Models
 */
export interface SelectionController<M extends Record<string, unknown> = Record<string, unknown>> {

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
     * `count` is what the UI reports and what {@link resolveSelection} checks
     * its ceiling against; pass the view's own filtered count so the two agree.
     */
    selectAllMatching(query: SelectionQuery<M>, count?: number): void;

    clearSelection(): void;

    isEntitySelected(entity: Entity<M>): boolean;
    toggleEntitySelection(entity: Entity<M>, newSelectedState?: boolean): void;
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

export type AdditionalFieldDelegateProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {
    entity: Entity<M>,
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
    Builder?(props: { entity: Entity<M>, context: RebaseContext<USER> }): React.ReactNode;

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
     * @param entity
     */
    value?(props: {
        entity: Entity<M>,
        context: RebaseContext
    }): string | number | Promise<string | number> | undefined;
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
    entityId?: string | number;
};

/**
 * You can use this controller to control the table view of a collection.
 */
export type EntityTableController<M extends Record<string, unknown> = Record<string, unknown>> = {
    data: Entity<M>[];
    dataLoading: boolean;
    noMoreToLoad: boolean;
    dataLoadingError?: Error;
    filterValues?: FilterValues<Extract<keyof M, string> | (string & {})>;
    setFilterValues?: (filterValues: FilterValues<Extract<keyof M, string> | (string & {})>) => void;
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
    entityId: string | number;
};