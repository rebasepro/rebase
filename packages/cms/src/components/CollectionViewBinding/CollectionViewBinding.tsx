import type { AdminCollection, ViewMode } from "@rebasepro/cms-types";
import React, { useCallback, useRef } from "react";

import { deepEqual as equal } from "fast-equals"
import { CollectionScopeProvider } from "@rebasepro/app";
import { Alert, cls } from "@rebasepro/ui";
import { SplitListView } from "./SplitListView";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import { useCollectionViewState } from "./useCollectionViewState";
import { CollectionViewScopeContext } from "./CollectionViewScope";
import { CollectionToolbarSlot, CollectionToolbarSlotContext, DEFAULT_TOOLBAR } from "./CollectionToolbar";
import { CollectionViewContent } from "./CollectionViewContent";
import { CollectionViewDialogs } from "./CollectionViewDialogs";
import { CollectionViewFrame } from "./CollectionViewFrame";
import { EntitiesCount } from "./EntitiesCount";

export { EntitiesCount } from "./EntitiesCount";

/**
 * @group Components
 */
export type CollectionViewBindingProps<M extends Record<string, unknown>> = {
    /**
     * The path the collection is addressed by: its slug, or for a
     * subcollection `parentSlug/{id}/slug`. Defaults to the collection's slug.
     * Not the `path` a Firestore collection declares for its store:
     * the data layer translates to that one, and another collection's slug may
     * be spelled the same.
     */
    path?: string;
    /**
     * Full path using navigation ids.
     */
    idPath?: string;
    /**
     * If this is a subcollection, specify the parent collection ids.
     */
    parentCollectionSlugs?: string[], parentEntityIds?: string[];
    /**
     * Whether this is a subcollection or not.
     */
    isSubCollection?: boolean;

    className?: string;

    /**
     * If true, this view will store its filter and sorting status in the url params
     */
    updateUrl?: boolean;

    /**
     * When provided, the split view will render this entity's detail panel.
     * Used by the router to pass the entity ID from the URL path.
     */
    selectedEntityId?: string | number;

    /**
     * When provided, the split view will open this tab (e.g. a subcollection slug)
     * in the entity detail panel. Used by the router to pass the subcollection from the URL.
     */
    selectedTab?: string;

    /**
     * What this view changes about the collection it draws — a fixed filter,
     * a default view mode, a sort — applied over the registered collection.
     *
     * The collection's own props are not that: where the path is registered
     * the view draws the registry's copy, which carries the user's saved
     * overrides and the plugins' changes, and the props are only its fallback.
     * `CollectionPanel`'s `viewMode`, `sort`, `limit` and `collectionOverrides`
     * arrive here; spread onto the props, they were dropped for every
     * registered collection.
     */
    collectionOverrides?: Partial<AdminCollection<M>>;

    /**
     * The ids of the rows drawn as selected, where the caller decides which
     * they are — a page that shows the opened row beside the list. `[]`
     * draws none. Without it the view highlights the row last opened, by
     * itself.
     */
    highlightedIds?: (string | number)[];

    /**
     * The properties this view shows, in this order; the ones it leaves out
     * are not drawn. In the table they are the columns. In the list, on a card
     * and on a kanban card they are what the row's or card's places — title,
     * image, subtitle, status, date, relation chips, the list's columns — are
     * filled from, earlier ones first; a place none of them fills stays empty.
     *
     * Over `propertiesOrder`, the order the user saved, `listProperties` and
     * what the cards infer, for this view only. Column widths the user drags
     * still persist; the column order is the caller's, so columns are not
     * dragged. A property hidden from collections stays hidden, and a custom
     * view is handed the whole collection.
     */
    fields?: string[];

    /**
     * The mode this view opens in, over the one in the URL and the one the
     * person last picked. They can still switch.
     */
    viewMode?: ViewMode;

    /**
     * The title the list view draws above its rows; `false` draws none.
     * Defaults to the collection's name.
     */
    title?: string | false;

    /**
     * The toolbar drawn above the rows. Defaults to the full toolbar —
     * `<CollectionToolbar/>`; `null` draws none. Compose a smaller one from
     * its pieces: `CollectionSearchBar`, `CollectionFiltersButton`,
     * `CollectionViewModeToggle`, `CollectionAddButton`.
     */
    toolbar?: React.ReactNode;

    /**
     * Called with the row and its id when one is clicked, instead of the
     * view opening it. Without it the record opens as the collection's
     * `openEntityMode` says. The row is the server's, as `useRows` returns
     * it; the id is the string `highlightedIds` and `useSidePanel().open`
     * take.
     */
    onRowClick?: (row: Record<string, unknown>, id: string) => void;

} & AdminCollection<M>;

/**
 * Props a caller commonly rebuilds on every render — a parent path array, a
 * properties object, an `Actions` list made with `toArray` — compared by value,
 * so a re-render that builds the same ones again does not redraw the view.
 */
const PROPS_COMPARED_BY_VALUE = new Set<string>([
    "path", "parentCollectionSlugs", "parentEntityIds", "isSubCollection", "className",
    "properties", "propertiesOrder", "hideIdFromCollection", "inlineEditing", "selectionEnabled",
    "selectionController", "Actions", "defaultSize", "includeJsonView", "additionalFields",
    "sideDialogWidth", "openEntityMode", "exportable", "history", "fixedFilter",
    "selectedEntityId", "selectedTab", "collectionOverrides", "highlightedIds", "fields"
]);

/**
 * Whether the view would draw the same thing with these props.
 *
 * Every prop counts: the listed ones by value, every other one — the name, the
 * entity actions, the custom views, the callbacks, anything a collection
 * carries — by reference. It used to compare the listed ones only, so a
 * collection passed as props (one not in the registry, where the view reads it
 * from) that changed anything else was never redrawn. A caller spreading a
 * registry collection hands over the same references each render.
 */
function collectionViewPropsEqual(a: CollectionViewBindingProps<any>, b: CollectionViewBindingProps<any>): boolean {
    const previous = a as Record<string, unknown>;
    const next = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
        if (previous[key] === next[key]) continue;
        if (PROPS_COMPARED_BY_VALUE.has(key) && equal(previous[key], next[key])) continue;
        return false;
    }
    return true;
}

/**
 * This component is in charge of binding a driver path with an {@link AdminCollection}
 * where it's configuration is defined. It includes an infinite scrolling table
 * and a 'Add' new entities button,
 *
 * This component is the default one used for displaying entity collections
 * and is in charge of generating all the specific actions and customization
 * of the lower level {@link CollectionTableBinding}
 *
 * Please **note** that you only need to use this component if you are building
 * a custom view. If you just need to create a default view you can do it
 * exclusively with config options.
 *
 * If you need a lower level implementation with more granular options, you
 * can use {@link CollectionTableBinding}.
 *
 * If you need a generic table that is not bound to the driver or entities and
 * properties at all, you can check {@link VirtualTable}
 *
 * @param path
 * @param collection

 * @group Components
 */
const CollectionViewBindingInner = React.memo(
    function CollectionViewBindingInner(props: CollectionViewBindingProps<Record<string, unknown>>) {

        const state = useCollectionViewState(props);
        const {
            t,
            containerRef,
            path,
            parentCollectionSlugs,
            parentEntityIds,
            selectedEntityId,
            selectedTab,
            collection,
            tableController,
            lastDeleteTimestamp,
            setDocsCount,
            pluginErrorView,
            isSplitLayout,
            viewMode,
            onEntityClick,
            onNewClick,
            usedSelectionController,
            selectionEnabled,
            highlightedEntities,
            listSize,
            emptyComponent
        } = state;

        const toolbarNode = <CollectionToolbarSlot/>;
        const collectionSurface = <CollectionViewContent state={state}/>;

        return (
            <CollectionViewScopeContext.Provider value={state}>
            <CollectionViewFrame className={props.className} containerRef={containerRef}>

                {/* Fetches the count and reports it — the toolbar renders it. */}
                <EntitiesCount
                    path={path}
                    collection={collection}
                    filter={tableController.filterValues}
                    sortBy={tableController.sortBy}
                    searchString={tableController.searchString}
                    onCountChange={setDocsCount}
                    refreshKey={lastDeleteTimestamp}
                />

                {/* A plugin's error view takes priority over the built-in
                    banner, the same precedence the empty state uses. This was
                    computed above and then rendered nowhere, so `collection.error`
                    — a declared, documented slot with its own props interface —
                    did nothing at all, and a plugin author had no way to tell. */}
                {pluginErrorView ?? (tableController.dataLoadingError && tableController.data.length > 0 && (
                    <div className="px-4 pt-2 flex-shrink-0">
                        <Alert color="error" size="small">
                            <strong>{t("error_loading_data")}</strong>
                            {tableController.dataLoadingError.message ? <>: {tableController.dataLoadingError.message}</> : null}
                        </Alert>
                    </div>
                ))}

                {/* When isSplitLayout, SplitListView is ALWAYS mounted — regardless
                    of viewMode. The toolbar + current view live in the left panel;
                    the right panel (entity detail) shows/hides based on selection.
                    This keeps the toolbar's React tree position stable across view
                    mode switches, preventing the ViewModeToggle popover from flashing. */}
                {isSplitLayout ? (
                    <SplitListView
                        key={`split-list-view-${path}`}
                        collection={collection}
                        tableController={tableController}
                        onEntityClick={onEntityClick}
                        onNewClick={onNewClick}
                        selectionController={usedSelectionController}
                        selectionEnabled={selectionEnabled}
                        highlightedEntities={highlightedEntities}
                        onScroll={tableController.onScroll}
                        initialScroll={tableController.initialScroll}
                        size={listSize}
                        emptyComponent={emptyComponent}
                        path={path}
                        parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                        selectedEntityId={selectedEntityId}
                        selectedTab={selectedTab}
                        toolbar={toolbarNode}
                    >
                        {/* The left panel keeps rendering whichever view mode is
                            active. Swapping it to a list on selection would make
                            a board or card grid vanish on every click. */}
                        {collectionSurface}
                    </SplitListView>
                ) : (
                    <div className="flex flex-col w-full h-full min-h-0">
                        {toolbarNode}
                        {/* `min-h-0` is what lets the board scroll its columns.
                            A flex item defaults to `min-height: auto`, so this
                            one grew to the board's full content height — 1230px
                            in a 883px area — and the ancestor's `overflow-hidden`
                            simply cut the rest off, with each column's own
                            scroller never reaching its limit. */}
                        {/* `max-h-dvh` for a view whose parent gives it no
                            height: it draws its rows, up to the window's
                            height, and scrolls inside that — rather than
                            growing with every page it loads. */}
                        <div className={cls(
                            "flex-1 min-h-0 max-h-dvh flex flex-col",
                            (viewMode === "list" || viewMode === "cards") && "overflow-y-auto"
                        )}>
                            {collectionSurface}
                        </div>
                    </div>
                )}

                <CollectionViewDialogs state={state}/>

            </CollectionViewFrame>
            </CollectionViewScopeContext.Provider>
        );
    }, collectionViewPropsEqual) as React.FunctionComponent<CollectionViewBindingProps<any>>;

export const CollectionViewBinding = React.memo(
    function CollectionViewBinding<M extends Record<string, unknown>>({
        toolbar,
        onRowClick,
        ...props
    }: CollectionViewBindingProps<M>) {
        const collectionRegistry = useCollectionRegistryController();
        const path = props.path ?? props.slug;
        const collection = collectionRegistry.getCollection(path) ?? props;

        // Both are commonly written inline, a new value on every render of
        // the caller. Neither reaches the memoised view as a prop: the
        // handler is called through a ref, and the toolbar is read from
        // context by the one element that draws it, so a caller's re-render
        // redraws the toolbar and nothing else.
        const onRowClickRef = useRef(onRowClick);
        onRowClickRef.current = onRowClick;
        const callRowClick = useCallback((row: Record<string, unknown>, id: string) => onRowClickRef.current?.(row, id), []);

        const content = (
            <CollectionToolbarSlotContext.Provider value={toolbar === undefined ? DEFAULT_TOOLBAR : toolbar}>
                <CollectionViewBindingInner {...props} onRowClick={onRowClick ? callRowClick : undefined}/>
            </CollectionToolbarSlotContext.Provider>
        );

        if (collection) {
            return (
                <CollectionScopeProvider collection={collection as AdminCollection}>
                    {content}
                </CollectionScopeProvider>
            );
        }
        return content;
    }
) as React.FunctionComponent<CollectionViewBindingProps<any>>;
