import type { Property } from "@rebasepro/types";
import type { AdditionalFieldDelegate, EntityAction, AdminCollection } from "@rebasepro/cms-types";
import { Entity } from "@rebasepro/types";
import {
    CollectionSize,
    EntitySelection,
    TableController,
    SelectionQuery,
    ViewMode
} from "@rebasepro/cms-types";
import { serializeSelectionQuery } from "../../selection";
import type { UiFieldPreferences, UiTablePreferences } from "@rebasepro/types";
import { userPreferencesOverlay } from "../../hooks/navigation/user_preferences_overlay";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { deepEqual as equal, shallowEqual } from "fast-equals"
import { CollectionRowActions, CollectionTableBinding } from "../CollectionTableBinding";
import { getEntityChildViews } from "@rebasepro/common";
import { useCollectionInlineEditor } from "./hooks/useCollectionInlineEditor";
import { navigateToEntity } from "../../util/navigation_utils";
import { mergeEntityActions } from "../../util/entity_actions";
import { resolveCollectionViews, resolveEntityAction } from "../../util/resolutions";
import { getPropertyInPath } from "../../util/property_utils";
import {
    OnColumnResizeParams,
    getRedundantChildViewColumnIds,
    useAnalyticsController,
    useAuthController,
    useColumnIds,
    useComponentOverride,
    useCustomizationController,
    useData,
    useDataTableController,
    populateFetchCache,
    usePermissions,
    useScrollRestoration,
    useSlot,
    useTranslation,
    useUserConfigurationPersistence,
    saveEntityWithCallbacks
} from "@rebasepro/app";
import { CollectionViewActions } from "./CollectionViewActions";
import { KanbanPropertyOption } from "./ViewModeToggle";
import { DefaultCollectionEmptyState } from "./DefaultCollectionEmptyState";
import {
    ArrowRightToLineIcon,
    Button,
    iconSize,
    VirtualTableColumn
} from "@rebasepro/ui";
import { getSubcollectionColumnId } from "../CollectionTableBinding/internal/common";
import { copyEntityAction, deleteEntityAction, editEntityAction, unlinkEntityAction } from "../common/default_entity_actions";
import { GetPropertyForProps } from "../CollectionTableBinding/CollectionTableBindingProps";
import { resolveCellProperty } from "../../form/resolve_cell_property";
import { useEntitySelectionController } from "./useSelectionController";
import { addRecentId } from "./utils";
import { isViewMode, resolveOpenEntityMode, VIEW_MODE_PARAM, VIEW_MODES } from "../../util/view_mode";
import { mergeDeep } from "@rebasepro/utils";
import { useAdminContext } from "../../hooks/useAdminContext";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import { useSidePanel } from "../../hooks/useSidePanel";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";
import { useChildViewSource } from "../../hooks/useChildViewSource";
import { useSelectionDialog } from "../../hooks/useSelectionDialog";
import { EntityIdHeaderWidget } from "./EntityIdHeaderWidget";
import { EMPTY_ARRAY, HeaderActionsScope, PluginAddColumnComponents } from "./PluginColumnSlots";
import type { CollectionViewBindingProps } from "./CollectionViewBinding";
import { columnsForFields, restrictCollectionToFields } from "./fields";
import type { EntityActionsScope } from "./CollectionEntityActions";
import { entityOfRow, entitySelectionControllerOf, rowOfEntity, selectionControllerOf, tableControllerOf } from "@rebasepro/app";

/** The collections already warned about a foreign `admin.selectionController`: the warning is said once, not on every render. */
const warnedForeignSelection = new Set<string>();

/**
 * Everything a collection view holds and decides: the collection it draws
 * (the registry's copy, the user's saved config and the caller's overrides,
 * in that order), its data and selection controllers, the view mode and
 * sizes, and the handlers its toolbar, views and dialogs call.
 *
 * One hook, so the toolbar, the view switch and the dialogs read the same
 * render's values: they were one component, and each part relies on a
 * decision another part made in the same render.
 */
export function useCollectionViewState<M extends Record<string, unknown>>({
    path: pathProp,
    parentCollectionSlugs,
    parentEntityIds,
    // Not state: the composition draws them.
    isSubCollection: _isSubCollection,
    className: _className,
    updateUrl,
    selectedEntityId: selectedEntityIdProp,
    selectedTab,
    collectionOverrides,
    highlightedIds,
    fields,
    viewMode: viewModeProp,
    title,
    onRowClick: onRowClickProp,
    toolbar: _toolbar,
    ...collectionProp
}: CollectionViewBindingProps<M>) {

    const { t } = useTranslation();
    const context = useAdminContext();
    const collectionRegistry = useCollectionRegistryController();
    const urlController = useUrlController();
    const path = pathProp ?? collectionProp.slug;
    const dataClient = useData();
    const sidePanelController = useSidePanel();
    const authController = useAuthController();
    const userConfigPersistence = useUserConfigurationPersistence();
    const analyticsController = useAnalyticsController();
    const customizationController = useCustomizationController();
    const { canCreate, canEdit, canDelete } = usePermissions();


    /**
     * Rows shared with other parents through a junction. The parent owns
     * the link, not the row — so the destructive action is a removal from
     * this record, which is what the server performs for such a path.
     */
    const childViewSource = useChildViewSource(path);
    const isLinkedChildView = childViewSource?.kind === "relation" && childViewSource.mode === "linked";
    const linkedTargetSlug = isLinkedChildView && childViewSource.kind === "relation"
        ? childViewSource.targetSlug
        : undefined;

    const containerRef = React.useRef<HTMLDivElement>(null);

    const scrollRestoration = useScrollRestoration();

    // `collectionProp` is a rest object: a new value on every render of this
    // component, even when nothing in it changed. Everything below derives
    // from it — the merged collection, its properties, the table's columns —
    // so an identity-only change rebuilt all of them each render, and
    // `mergeDeep` handed back a fresh `propertiesOrder` array every time,
    // which the sync effect below read as a change and set state for: a
    // render loop, and a table that threw away the column width the user
    // had just dragged. Hold the last rest object that actually differs.
    //
    // Shallow is enough, and is the comparison that fits: a re-render this
    // component causes itself re-spreads the same props, so every value in
    // the new object is the same reference. A render caused from above has
    // already been through this component's own props comparator, which is
    // where a deep difference is decided.
    const collectionPropRef = React.useRef(collectionProp);
    if (!shallowEqual(collectionPropRef.current, collectionProp)) {
        collectionPropRef.current = collectionProp;
    }
    const stableCollectionProp = collectionPropRef.current;

    // `fields` by value, for the same reason: a caller writes it as a literal.
    const fieldsRef = React.useRef(fields);
    if (!equal(fieldsRef.current, fields)) fieldsRef.current = fields;
    const stableFields = fieldsRef.current;

    const overridesRef = React.useRef(collectionOverrides);
    if (!equal(overridesRef.current, collectionOverrides)) overridesRef.current = collectionOverrides;
    const stableOverrides = overridesRef.current;

    const collection = useMemo(() => {
        const registryCollection = collectionRegistry.getCollection(path) || stableCollectionProp;
        // The user's own preferences, the composition's last layer.
        const userOverride = userConfigPersistence
            ? userPreferencesOverlay(userConfigPersistence.getTablePreferences(path), new Set(Object.keys(registryCollection.properties ?? {})))
            : undefined;
        const drawn = (userOverride ? mergeDeep(registryCollection, userOverride) : registryCollection) as AdminCollection<M>;
        return stableOverrides ? { ...drawn, ...stableOverrides } as AdminCollection<M> : drawn;
    }, [stableCollectionProp, path, userConfigPersistence, collectionRegistry, stableOverrides]);

    const collectionRef = React.useRef(collection);
    useEffect(() => {
        collectionRef.current = collection;
    }, [collection]);

    const canCreateEntities = canCreate(collection, path);
    // By id: the row actions that set it hand an id, and the views compare ids.
    const [highlightedId, setHighlightedId] = useState<string | number | undefined>(undefined);
    const [deleteEntityClicked, setDeleteEntityClicked] = React.useState<Entity<M> | EntitySelection<M> | undefined>(undefined);

    const [lastDeleteTimestamp, setLastDeleteTimestamp] = React.useState<number>(0);

    // Track recently deleted entities for optimistic Kanban count updates
    const [deletedEntities, setDeletedEntities] = React.useState<Entity<M>[]>([]);

    // number of entities in the collection (undefined = loading)
    const [docsCount, setDocsCount] = useState<number | null | undefined>(null);

    // Optimistic state for column order to prevent UI flickering during persistence
    const [localPropertiesOrder, setLocalPropertiesOrder] = useState<string[] | undefined>(collection.propertiesOrder);

    // Sync local state with collection's propertiesOrder when it changes from
    // external sources. By value, not by identity: the merged collection is
    // rebuilt whenever the user config changes, and an array with the same
    // keys in it is not an external change to follow.
    useEffect(() => {
        setLocalPropertiesOrder(previous => equal(previous, collection.propertiesOrder) ? previous : collection.propertiesOrder);
    }, [collection.propertiesOrder]);

    const unselectNavigatedEntity = useCallback(() => {
        const currentSelection = highlightedId;
        setTimeout(() => {
            if (currentSelection === highlightedId)
                setHighlightedId(undefined);
        }, 2400);
    }, [highlightedId]);

    // From this render's collection. It was read from `collectionRef`,
    // which an effect updates after the render that reads it, so a change
    // to `inlineEditing` (or to what the user may edit) reached the table
    // one render late — or never, if nothing rendered again.
    const inlineEditingEnabled = canEdit(collection, path, null) &&
        (collection.inlineEditing === undefined || collection.inlineEditing);

    const selectionEnabled = collection.selectionEnabled === undefined || collection.selectionEnabled;
    const hoverRow = !inlineEditingEnabled;

    // Custom view modes this collection can render: the ones declared
    // inline plus the ones it names by key from the app-level registry.
    // Anything unresolvable is dropped here, once, so every consumer below
    // — the switcher, `enabledViews`, the URL and saved-config checks —
    // agrees on what exists.
    const resolvedCustomViews = useMemo(
        () => resolveCollectionViews(collection.customViews, customizationController.collectionViews),
        [collection.customViews, customizationController]
    );

    const customViewKeys = useMemo(
        () => resolvedCustomViews.map((v) => v.key),
        [resolvedCustomViews]
    );

    // View mode priority: the caller's `viewMode` > URL > saved user config >
    // collection.defaultViewMode
    const defaultViewMode = isViewMode(collection.defaultViewMode, customViewKeys)
        ? collection.defaultViewMode
        // Covers a `defaultViewMode` naming a custom view that has since
        // been removed from config; without this the collection would open
        // on a mode nothing renders.
        : "list";
    const [searchParams, setSearchParams] = useSearchParams();

    // Read view from React Router's searchParams (reactive on back/forward).
    // Only for a view that keeps its state in the URL: a record's tab or a
    // panel on a page would otherwise follow — and write — the `__view` of
    // the page around it.
    const urlView = useMemo((): ViewMode | null => {
        if (!updateUrl) return null;
        const v = searchParams.get(VIEW_MODE_PARAM);
        return isViewMode(v, customViewKeys) ? v : null;
    }, [updateUrl, searchParams, customViewKeys]);

    // The mode the caller asked for. It wins when the view mounts, over the
    // URL and what the person last picked; once they pick here, theirs does.
    const callerViewMode = isViewMode(viewModeProp, customViewKeys) ? viewModeProp : undefined;
    const pickedViewModeRef = React.useRef(false);

    // Get saved view from local persistence.
    //
    // Validated rather than cast: what is stored is whatever the user last
    // picked, and a custom view removed from config since then would come
    // back as a mode nothing renders — a blank panel with a working
    // toolbar above it. An unrecognised value reads as "nothing saved",
    // which falls through to the collection default.
    const getSavedView = useCallback((): ViewMode | null => {
        const saved = userConfigPersistence?.getTablePreferences(path).defaultViewMode;
        return isViewMode(saved, customViewKeys) ? saved : null;
    }, [userConfigPersistence, path, customViewKeys]);

    const [viewMode, setViewModeState] = useState<ViewMode>(() => {
        // Priority: caller > URL > saved config > collection default
        if (callerViewMode) return callerViewMode;
        if (urlView) return urlView;
        const savedView = getSavedView();
        if (savedView) return savedView;
        return defaultViewMode;
    });

    const activeCustomView = useMemo(
        () => resolvedCustomViews.find((v) => v.key === viewMode),
        [resolvedCustomViews, viewMode]
    );

    const openEntityMode = resolveOpenEntityMode({
        collection,
        viewMode,
        customView: activeCustomView
    });

    // Sync URL with current view on init (if view came from saved config)
    useEffect(() => {
        if (updateUrl && !urlView && viewMode !== defaultViewMode) {
            // View came from saved config but URL doesn't have it - update URL without push
            // Built from `window.location.search`, not React Router's
            // `prev`. The table controller writes the filter, sort and
            // search params with `history.replaceState`, which React Router
            // never observes — so `prev` is a stale snapshot, and merging
            // into it silently dropped whatever it had not seen. Switching
            // view mode after typing a search wiped `search=` from the URL,
            // and the next reload came back unfiltered.
            setSearchParams(() => {
                const next = new URLSearchParams(window.location.search);
                next.set(VIEW_MODE_PARAM, viewMode);
                return next;
            }, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount: the mode the view opened in goes into the URL
    }, []);

    // Update URL when view mode changes (user action)
    const setViewMode = useCallback((newMode: ViewMode) => {
        setViewModeState(newMode);
        if (!updateUrl) return;

        // Update URL with __view param via React Router
        setSearchParams(() => {
            // See the note above: the live URL is the only writer both
            // this and the table controller agree on.
            const next = new URLSearchParams(window.location.search);
            if (newMode === defaultViewMode) {
                next.delete(VIEW_MODE_PARAM);
            } else {
                next.set(VIEW_MODE_PARAM, newMode);
            }
            return next;
        });
    }, [defaultViewMode, setSearchParams, updateUrl]);

    // Sync viewMode state when URL changes via back/forward navigation, and
    // when the caller asks for another mode. The URL the view mounted with
    // does not count as a change: the caller's mode won over it at mount.
    const previousUrlViewRef = React.useRef(urlView);
    const previousCallerViewModeRef = React.useRef(callerViewMode);
    useEffect(() => {
        const urlChanged = urlView !== previousUrlViewRef.current;
        previousUrlViewRef.current = urlView;
        if (callerViewMode !== previousCallerViewModeRef.current) {
            previousCallerViewModeRef.current = callerViewMode;
            pickedViewModeRef.current = false;
        }
        const callerDecides = callerViewMode !== undefined && !pickedViewModeRef.current;
        if (urlView && (urlChanged || !callerDecides)) {
            setViewModeState(urlView);
        } else if (callerDecides) {
            setViewModeState(callerViewMode);
        } else {
            const savedView = getSavedView();
            setViewModeState(urlView ?? savedView ?? defaultViewMode);
        }
    }, [urlView, getSavedView, defaultViewMode, callerViewMode]);

    // List view size state - controls row height and info density
    const [listSize, setListSize] = useState<CollectionSize>(collection.defaultSize ?? "m");

    // Card view size state - controls the grid column count
    const [cardSize, setCardSize] = useState<CollectionSize>(collection.defaultSize ?? "m");

    // Table view size state - controls row height
    const [tableSize, setTableSize] = useState<CollectionSize>(collection.defaultSize ?? "m");

    // Size for custom views that opted in with `sizeable`. One piece of
    // state for all of them: only the active view reads it, and switching
    // between two sizeable custom views keeping the same density is the
    // less surprising behaviour.
    const [customViewSize, setCustomViewSize] = useState<CollectionSize>(collection.defaultSize ?? "m");

    const selectionController = useEntitySelectionController<M>();
    // A caller's own, from `useSelectionController`: the admin drives the
    // controller behind it.
    const callerSelectionController = collection.selectionController
        ? entitySelectionControllerOf<M>(collection.selectionController)
        : undefined;
    if (collection.selectionController && !callerSelectionController && !warnedForeignSelection.has(collection.slug)) {
        warnedForeignSelection.add(collection.slug);
        console.warn(`admin.selectionController of "${collection.slug}" was not made by useSelectionController(), so the view keeps its own selection.`);
    }
    const usedSelectionController = callerSelectionController ?? selectionController;
    const {
        selection,
        clearSelection,
        toggleEntitySelection
    } = usedSelectionController;

    const tableController = useDataTableController<M>({
        path,
        collection,
        lastDeleteTimestamp,
        scrollRestoration,
        updateUrl,
        // The board reads only the search and filters from it; each of its
        // columns runs its own window. A live first page here would be one
        // more subscription nothing draws.
        enabled: viewMode !== "kanban"
    });

    const tableKey = React.useRef<string>(Math.random().toString(36));
    const popupCell = tableController.popupCell as {
        id: string;
        propertyKey: Extract<keyof M, string>;
        cellRect?: DOMRect;
    } | undefined;

    const onPopupClose = useCallback(() => {
        tableController.setPopupCell?.(undefined);
    }, [tableController.setPopupCell]);

    const onEntityClick = useCallback((clickedEntity: Entity<M>) => {
        const collection = collectionRef.current;
        setHighlightedId(clickedEntity.id);
        // The caller's handler takes the row instead of the view opening it.
        if (onRowClickProp) {
            onRowClickProp(rowOfEntity(clickedEntity, collection), String(clickedEntity.id));
            return;
        }
        analyticsController.onAnalyticsEvent?.("edit_entity_clicked", {
            path: clickedEntity.path,
            entityId: clickedEntity.id
        });

        if (collection) {
            addRecentId(collection.slug, clickedEntity.id);
        }

        const entityPath = path ?? clickedEntity.path;
        // The row on screen is what the record opens with, while its own
        // read catches up — the one row clicked, not every row held.
        populateFetchCache(entityPath, [clickedEntity]);
        navigateToEntity({
            navigation: urlController,
            path: entityPath,
            sidePanelController,
            openEntityMode,
            collection,
            id: clickedEntity.id,
            replace: openEntityMode === "split" && selectedEntityIdProp !== undefined
        });

    }, [sidePanelController, openEntityMode, selectedEntityIdProp, path, urlController, analyticsController, onRowClickProp]);

    // A record created in the side panel or a dialog leaves this view
    // mounted, so it says so the way a delete does: the toolbar counts
    // again, and a table without realtime reads its rows again.
    const onCreatedInPanel = useCallback(() => {
        setLastDeleteTimestamp(Date.now());
    }, []);

    /**
     * Attach rows that already exist to this parent.
     *
     * Writing to the row's own address under this parent — `PUT
     * posts/1/tags/5` — is what asserts membership; the backend writes the
     * junction row idempotently. Sending no values keeps it a pure link:
     * the target's own fields are none of this tab's business.
     */
    const linkExistingEntities = useCallback(async (_rows: Record<string, unknown>[], ids: string[]) => {
        const alreadyLinked = new Set(tableController.data.map(e => String(e.id)));
        const toLink = ids.filter(id => !alreadyLinked.has(id));
        if (toLink.length === 0) return;

        try {
            await Promise.all(toLink.map(id =>
                saveEntityWithCallbacks<M>({
                    path,
                    entityId: id,
                    values: {} as Partial<M>,
                    status: "existing",
                    collection,
                    data: dataClient,
                    context
                })
            ));
            setLastDeleteTimestamp(Date.now());
        } catch (e) {
            context.snackbarController?.open({
                type: "error",
                message: e instanceof Error ? e.message : String(e)
            });
        }
    }, [dataClient, path, tableController.data, collection, context]);

    const selectionDialog = useSelectionDialog<M>({
        // The whole target collection, not this parent's slice of it —
        // otherwise the picker could only ever show rows already linked.
        path: linkedTargetSlug ?? false,
        multiselect: true,
        // On Done, not on every tick: linking is a write, and a row ticked
        // and then unticked must not end up linked.
        onSelectionDone: linkExistingEntities
    });

    const openNewDocument = useCallback((defaultValues?: Record<string, unknown>) => {
        const collection = collectionRef.current;
        analyticsController.onAnalyticsEvent?.("new_entity_click", {
            path: path
        });
        navigateToEntity({
            openEntityMode,
            collection,
            id: undefined,
            defaultValues,
            path: path,
            sidePanelController,
            navigation: urlController,
            onClose: unselectNavigatedEntity,
            onSaved: onCreatedInPanel
        });
    }, [path, sidePanelController, openEntityMode, urlController, unselectNavigatedEntity, onCreatedInPanel]);

    // The toolbar's "new" and a board column's "add" open the same form,
    // one of them with values filled in.
    const onNewClick = useCallback(() => openNewDocument(), [openNewDocument]);

    const onMultipleDeleteClick = () => {
        analyticsController.onAnalyticsEvent?.("multiple_delete_dialog_open", {
            path: path
        });
        // The selection itself, not rows: in query mode there are no rows to
        // hand over yet. The dialog confirms against the count and reads
        // them only once the user has said yes.
        setDeleteEntityClicked(selection);
    };

    const internalOnEntityDelete = (_path: string, entity: Entity<M>) => {
        analyticsController.onAnalyticsEvent?.("single_entity_deleted", {
            path: path
        });
        // Untick rather than filter a list: in query mode the list does not
        // exist, and "the ones I selected, minus this one" is precisely an
        // exclusion.
        toggleEntitySelection(entity, false);
        setDeletedEntities(prev => [...prev, entity]);
        setLastDeleteTimestamp(Date.now());
    };

    const internalOnMultipleEntitiesDelete = (_path: string, entities: Entity<M>[]) => {
        analyticsController.onAnalyticsEvent?.("multiple_entities_deleted", {
            path: path
        });
        clearSelection();
        setDeleteEntityClicked(undefined);
        setDeletedEntities(prev => [...prev, ...entities]);
        setLastDeleteTimestamp(Date.now());
    };

    // What the plugins' slots are handed: the rows, not the admin's records.
    const rowTableController = tableControllerOf(tableController, collection);
    const rowSelectionController = selectionControllerOf(usedSelectionController, collection, path);

    const pluginAddColumnComponents = useSlot("collection.add-column", {
        path,
        parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
        parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
        collection,
        tableController: rowTableController
    });

    const pluginToolbarWidgets = useSlot("collection.toolbar", {
        path,
        parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
        parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
        collection: collection,
        tableController: rowTableController,
        selectionController: rowSelectionController
    });

    const pluginEmptyStates = useSlot("collection.empty-state", {
        path,
        parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
        collection,
        canCreate: canCreateEntities,
        onNewClick
    });

    const pluginWidgets = useSlot("collection.widgets", {
        path,
        parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
        collection
    });

    // The user's preferences for this view, as a delta in `customizeTable`'s
    // names: on the server for a signed-in user, in the browser otherwise.
    const onCollectionModifiedForUser = useCallback((path: string, delta: UiTablePreferences) => {
        userConfigPersistence?.saveTablePreferences(path, delta);
    }, [userConfigPersistence]);

    const onColumnResize = useCallback(({
        width,
        key
    }: OnColumnResizeParams) => {

        const collection = collectionRef.current;
        // Only for property columns
        if (!getPropertyInPath(collection.properties, key)) return;
        onCollectionModifiedForUser(path, { fields: columnWidthPreference(key, width) });
    }, [onCollectionModifiedForUser, path]);

    const onListSizeChanged = useCallback((size: CollectionSize) => {
        setListSize(size);
        if (userConfigPersistence)
            onCollectionModifiedForUser(path, { defaultSize: size })
    }, [onCollectionModifiedForUser, path, userConfigPersistence]);

    const onTableSizeChanged = useCallback((size: CollectionSize) => {
        setTableSize(size);
        if (userConfigPersistence)
            onCollectionModifiedForUser(path, { defaultSize: size })
    }, [onCollectionModifiedForUser, path, userConfigPersistence]);

    // View mode change: update URL + save to local persistence
    const onViewModeChange = useCallback((mode: ViewMode) => {
        analyticsController.onAnalyticsEvent?.("view_mode_changed", {
            path: path,
            from: viewMode,
            to: mode
        });
        pickedViewModeRef.current = true;
        setViewMode(mode);
        // Save to local persistence for next visit
        if (userConfigPersistence) {
            onCollectionModifiedForUser(path, { defaultViewMode: mode });
        }
    }, [setViewMode, userConfigPersistence, onCollectionModifiedForUser, path, analyticsController, viewMode]);

    const createEnabled = canCreate(collection, path);

    const { onValueChange, uniqueFieldValidator } = useCollectionInlineEditor({
        path,
        collection,
        dataClient,
        context
    });

    // In v4, collections are already resolved, so we use collection directly
    const resolvedCollection = collection;

    // Compute the effective enabled views:
    // - Start from collection.enabledViews (defaults to every built-in
    //   plus every custom view the collection declared)
    // - Drop anything that resolves to nothing renderable
    // - Filter out kanban if no enum properties exist
    const hasEnumProperty = useMemo(() => {
        return Object.values(resolvedCollection.properties).some((p: Property) => p.type === "string" && "enum" in p && p.enum);
    }, [resolvedCollection.properties]);

    const enabledViews: ViewMode[] = useMemo(() => {
        // Declaring a custom view is enough to offer it — a collection
        // should not have to restate the built-ins in `enabledViews` just
        // to add one. Setting `enabledViews` explicitly still wins.
        const configured = collection.enabledViews
            ?? [...VIEW_MODES, ...customViewKeys];
        const renderable = configured.filter(v => isViewMode(v, customViewKeys));
        if (!hasEnumProperty) {
            return renderable.filter(v => v !== "kanban");
        }
        return renderable;
    }, [collection.enabledViews, hasEnumProperty, customViewKeys]);

    // Compute available enum properties for kanban column selection
    const kanbanPropertyOptions: KanbanPropertyOption[] = useMemo(() => {
        const options: KanbanPropertyOption[] = [];
        const properties = resolvedCollection.properties;

        for (const [key, property] of Object.entries(properties)) {
            const prop = property;
            if (prop && prop.type === "string" && "enum" in prop && prop.enum) {
                options.push({
                    key,
                    label: prop.name || key
                });
            }
        }

        return options;
    }, [resolvedCollection.properties]);

    // Get saved kanban property from user config
    const getSavedKanbanProperty = useCallback((): string | undefined => {
        return userConfigPersistence?.getTablePreferences(path).kanban?.columnField;
    }, [userConfigPersistence, path]);

    // Selected kanban property state - priority: saved config > collection default > first available
    const [selectedKanbanProperty, setSelectedKanbanProperty] = useState<string>(() => {
        const saved = getSavedKanbanProperty();
        if (saved && kanbanPropertyOptions.some(o => o.key === saved)) return saved;
        if (collection.kanban?.columnProperty) return collection.kanban.columnProperty;
        return kanbanPropertyOptions[0]?.key ?? "";
    });

    // Update selected property if options change and current selection is no longer valid
    useEffect(() => {
        if (kanbanPropertyOptions.length > 0 && !kanbanPropertyOptions.some(o => o.key === selectedKanbanProperty)) {
            const saved = getSavedKanbanProperty();
            if (saved && kanbanPropertyOptions.some(o => o.key === saved)) {
                setSelectedKanbanProperty(saved);
            } else if (collection.kanban?.columnProperty && kanbanPropertyOptions.some(o => o.key === collection.kanban?.columnProperty)) {
                setSelectedKanbanProperty(collection.kanban.columnProperty);
            } else {
                setSelectedKanbanProperty(kanbanPropertyOptions[0]?.key ?? "");
            }
        }
    }, [kanbanPropertyOptions, selectedKanbanProperty, getSavedKanbanProperty, collection.kanban?.columnProperty]);

    // Handle kanban property change
    const onKanbanPropertyChange = useCallback((property: string) => {
        analyticsController.onAnalyticsEvent?.("kanban_property_changed", {
            path: path,
            property
        });
        setSelectedKanbanProperty(property);
        // Save to local persistence
        if (userConfigPersistence) {
            onCollectionModifiedForUser(path, { kanban: { columnField: property } });
        }
    }, [userConfigPersistence, onCollectionModifiedForUser, path, analyticsController]);

    const getPropertyFor = useCallback(({
        propertyKey,
        entity
    }: GetPropertyForProps<M>) => {
        let property: Property | undefined = getPropertyInPath(collection.properties, propertyKey);

        // we might not find the property in the collection if combining property builders and map spread
        if (!property) {
            // these 2 properties are coming from the resolved collection with default values
            property = getPropertyInPath(resolvedCollection.properties, propertyKey);
        }

        if (!property) return null;
        // A `conditions` rule or a `dynamicProps` result depends on the
        // row, and the inline editor is judged by it as the form is.
        return resolveCellProperty(property, propertyKey, entity as Entity<Record<string, unknown>>, {
            path,
            authController,
            propertyConfigs: customizationController.propertyConfigs
        });
    }, [collection.properties, resolvedCollection.properties, path, authController, customizationController.propertyConfigs]);

    // Use a collection with local propertiesOrder for optimistic UI updates
    const collectionWithLocalOrder = useMemo(() => {
        if (localPropertiesOrder && localPropertiesOrder !== resolvedCollection.propertiesOrder) {
            return {
                ...resolvedCollection,
                // Runtime column order, not authored config: these ids come
                // from the user dragging columns and include additional-field
                // and `subcollection:` ids minted below. `propertiesOrder` is
                // typed against the collection's properties for *authoring*,
                // so widening back to that type is the intent here.
                propertiesOrder: localPropertiesOrder as typeof resolvedCollection.propertiesOrder
            };
        }
        return resolvedCollection;
    }, [resolvedCollection, localPropertiesOrder]);

    // `fields` lays the columns out in its own order, over the saved one, and
    // drops the rest.
    const columnsCollection = useMemo(() => stableFields
        ? { ...collectionWithLocalOrder, propertiesOrder: stableFields as typeof collectionWithLocalOrder.propertiesOrder }
        : collectionWithLocalOrder, [collectionWithLocalOrder, stableFields]);
    const laidOutColumnIds = useColumnIds(columnsCollection, true);
    const displayedColumnIds = useMemo(
        () => stableFields ? columnsForFields(laidOutColumnIds, stableFields) : laidOutColumnIds,
        [laidOutColumnIds, stableFields]);

    // What the list, the cards and the kanban cards are drawn from: the
    // collection, or only its `fields`.
    const viewCollection = useMemo(
        () => stableFields ? restrictCollectionToFields(collection, stableFields) : collection,
        [collection, stableFields]);

    const additionalFields = useMemo(() => {
        // Each child view gets a column that jumps to its tab. Keyed by the
        // view's collection slug, which is the relation key — two relations
        // to the same target used to collapse onto one column id here.
        //
        // Except where the relation was declared as a property and so already
        // has a column showing the child rows: the button then repeated that
        // column's heading verbatim. Filtered here as well as in
        // `useColumnIds` so no id is displayed without a delegate to build it,
        // and so the column picker does not offer the one back.
        const redundant = getRedundantChildViewColumnIds(collectionWithLocalOrder);
        const subcollectionsList = getEntityChildViews(collection)
            .map(v => v.collection as AdminCollection)
            .filter(child => !redundant.has(getSubcollectionColumnId(child)));
        const subcollectionColumns: AdditionalFieldDelegate<M, any>[] = subcollectionsList.map((subcollection: AdminCollection) => {
            return {
                key: getSubcollectionColumnId(subcollection),
                name: subcollection.name,
                width: 200,
                dependencies: [],
                Builder: ({ id }) => (
                    <Button
                        className={"max-w-full truncate justify-start"}
                        startIcon={<ArrowRightToLineIcon size={iconSize.small}/>}
                        onClick={(event: React.MouseEvent) => {
                            event.stopPropagation();
                            navigateToEntity({
                                openEntityMode,
                                collection,
                                id,
                                selectedTab: subcollection.slug,
                                path: path,
                                navigation: urlController,
                                sidePanelController
                            })
                        }}>
                        {subcollection.name}
                    </Button>
                )
            };
        }) ?? EMPTY_ARRAY;

        return [
            ...(collection.additionalFields ?? EMPTY_ARRAY),
            ...subcollectionColumns
        ];
    }, [collection, collectionWithLocalOrder, path, sidePanelController, openEntityMode, urlController]);

    const updateLastDeleteTimestamp = useCallback(() => {
        setLastDeleteTimestamp(Date.now());
    }, []);

    const isSplitLayout = openEntityMode === "split";
    const isCompact = isSplitLayout && selectedEntityIdProp !== undefined;
    const activeSelectionEnabled = !isCompact && selectionEnabled;

    // Edit opens the record — or, where the caller handles clicks, hands it
    // the row the way a click does.
    const editAction = useMemo<EntityAction>(() => onRowClickProp
        ? {
            ...editEntityAction,
            onClick: ({ row, id, path: rowPath }) => {
                if (row && id !== undefined) onEntityClick(entityOfRow(row, id, rowPath ?? path, collection) as Entity<M>);
            }
        }
        : editEntityAction, [onRowClickProp, onEntityClick, path, collection]);

    const getActionsForEntity = useCallback(({
        entity,
        customEntityActions
    }: {
        entity?: Entity<M>,
        customEntityActions?: EntityAction[]
    }): EntityAction[] => {
        const deleteEnabled = entity ? canDelete(collection, path, entity.values) : true;
        const disableActions = collection.disableDefaultActions ?? [];
        const actions: EntityAction[] = [];
        if (!disableActions.includes("edit")) {
            actions.push(editAction);
        }
        if (createEnabled && !disableActions.includes("copy"))
            actions.push(copyEntityAction);
        if (deleteEnabled && !disableActions.includes("delete")) {
            // On a junction-backed tab the server removes the link, not the
            // row. Same request either way — this is the button telling the
            // truth about what it will do.
            actions.push(isLinkedChildView ? unlinkEntityAction : deleteEntityAction);
        }
        if (customEntityActions)
            return mergeEntityActions(actions, customEntityActions);
        return actions;
    }, [canDelete, collection, path, createEnabled, isLinkedChildView, editAction]);

    // Handed the table's layout: the table is drawn inside the view's own
    // box, and that box's width is what decides it.
    const getIdColumnWidth = useCallback((largeLayout: boolean) => {
        const entityActions = getActionsForEntity({});
        const collapsedActions = entityActions.filter(a => a.collapsed !== false);
        const uncollapsedActions = entityActions.filter(a => a.collapsed === false);
        const actionsWidth = uncollapsedActions.length * (largeLayout ? 40 : 30);
        return (largeLayout ? (80 + actionsWidth) : (70 + actionsWidth)) + (collapsedActions.length > 0 ? (largeLayout ? 40 : 30) : 0);
    }, [getActionsForEntity]);

    const customEntityActions = useMemo(() => (collection.entityActions ?? EMPTY_ARRAY)
        .map(action => resolveEntityAction(action, customizationController.entityActions))
        .filter(Boolean) as EntityAction<M>[], [collection.entityActions, customizationController.entityActions]);

    const tableRowActionsBuilder = useCallback(({
        entity,
        size,
        width,
        frozen
    }: {
        entity: Entity<any>,
        size: CollectionSize,
        width: number,
        frozen?: boolean
    }) => {

        const isSelected = usedSelectionController.isEntitySelected(entity);

        const actions = getActionsForEntity({
            entity,
            customEntityActions
        });

        return (
            <CollectionRowActions
                entity={entity}
                width={width}
                frozen={frozen}
                isSelected={isSelected}
                selectionEnabled={activeSelectionEnabled}
                size={size}
                highlightRow={setHighlightedId}
                unhighlightRow={unselectNavigatedEntity}
                collection={collection}
                path={path}
                actions={actions}
                hideId={collection?.hideIdFromCollection}
                onCollectionChange={updateLastDeleteTimestamp}
                selectionController={usedSelectionController}
                openEntityMode={openEntityMode}
            />
        );

        // Everything it reads. It listed two of them, so the row actions
        // kept the first collection, actions, open mode and
        // `selectionEnabled` they were built with.
    }, [updateLastDeleteTimestamp, usedSelectionController, customEntityActions, getActionsForEntity,
        activeSelectionEnabled, unselectNavigatedEntity, collection, path, openEntityMode]);

    // What the cards and the kanban cards draw a record's actions from.
    const getCardActions = useCallback(
        (entity: Entity<M>) => getActionsForEntity({ entity, customEntityActions }),
        [getActionsForEntity, customEntityActions]);
    const entityActionsScope = useMemo<EntityActionsScope<M>>(() => ({
        getActions: getCardActions,
        collection,
        path,
        openEntityMode,
        selectionController: usedSelectionController,
        onCollectionChange: updateLastDeleteTimestamp,
        highlightRow: setHighlightedId,
        unhighlightRow: unselectNavigatedEntity
    }), [getCardActions, collection, path, openEntityMode, usedSelectionController, updateLastDeleteTimestamp, unselectNavigatedEntity]);

    // Built once per change rather than once per render: each of these is a
    // prop of the table (and of the other views), and a new array or a new
    // element on every render of this component re-rendered every row of the
    // table — twice, the second time for the columns the id header widget
    // rebuilt — on each window emit, count arrival and popover toggle.
    // The caller's selection, where it gives one, among the rows held.
    const shownIds = highlightedIds ?? (highlightedId === undefined ? EMPTY_ARRAY : [highlightedId]);
    const shownKey = shownIds.map(String).join("\u0000");
    const highlightedEntities = useMemo(() => {
        if (shownIds.length === 0) return EMPTY_ARRAY;
        const wanted = new Set(shownIds.map(String));
        const found = tableController.data.filter(entity => wanted.has(String(entity.id)));
        return found.length > 0 ? found : EMPTY_ARRAY;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- by the ids' value (`shownKey`): a caller's inline array is a new one on each render
    }, [shownKey, tableController.data]);
    const idHeaderWidget = useMemo(() => <EntityIdHeaderWidget
        path={path}
        idPath={path}
        collection={collection}
        openEntityMode={openEntityMode}/>, [path, collection, openEntityMode]);


    // What "select all matching" would stand for right now. `docsCount` is
    // the count for exactly this query — the same one the toolbar shows —
    // so the number offered and the number selected cannot disagree.
    const liveSelectionQuery: SelectionQuery<M> = useMemo(() => ({
        path,
        filterValues: tableController.filterValues,
        searchString: tableController.searchString,
        sortBy: tableController.sortBy
    }), [path, tableController.filterValues, tableController.searchString, tableController.sortBy]);

    // A query selection is a promise about a *specific* query, and the
    // filter bar stays live while one is held. Letting it follow the filter
    // would mean the rows about to be deleted are not the rows that were
    // counted and agreed to; keeping the stale query would show rows the
    // selection does not cover as ticked. So the selection is dropped, the
    // way a search does in Gmail, and the banner disappears with it.
    const selectionQueryKey = selection.type === "query" ? serializeSelectionQuery(selection.query) : undefined;
    const liveQueryKey = serializeSelectionQuery(liveSelectionQuery);
    useEffect(() => {
        if (selectionQueryKey !== undefined && selectionQueryKey !== liveQueryKey)
            clearSelection();
    }, [selectionQueryKey, liveQueryKey, clearSelection]);

    const { resolvedSlots } = customizationController;

    // Pre-compute header action slot contributions (avoid useSlot inside callback)
    const headerActionContributions = useMemo(() => resolvedSlots
        .filter(s => s.slot === "collection.header.action")
        .sort((a, b) => (a.order ?? 50) - (b.order ?? 50)), [resolvedSlots]);

    // This render's values, for PluginHeaderActions. Null when no plugin
    // contributes a header action, so the headers have nothing to follow.
    const headerActionsScope = useMemo<HeaderActionsScope | null>(() => headerActionContributions.length > 0
        ? {
            contributions: headerActionContributions,
            path,
            collection: collection as AdminCollection,
            tableController: rowTableController as TableController,
            parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
            parentEntityIds: parentEntityIds ?? EMPTY_ARRAY
        }
        : null, [headerActionContributions, path, collection, rowTableController, parentCollectionSlugs, parentEntityIds]);

    // One component type for the life of the view: the plugins' controls
    // reach it through context. A function declared here was a new
    // component type on every render — the table's columns changed with
    // it, and the header remounted whatever the plugins had drawn, closing
    // anything they had open, on every row update.
    const addColumnComponentInternal = pluginAddColumnComponents.length > 0
        ? PluginAddColumnComponents
        : undefined;

    const onColumnsOrderChange = useCallback((newColumns: VirtualTableColumn[]) => {
        // Extract property keys from the new column order
        // Filter to only include actual property columns (not frozen columns, not additional fields, etc.)
        // Deduplicate to clean up any previously duplicated keys
        const seenKeys = new Set<string>();
        const newPropertiesOrder = newColumns
            .filter(col => !col.frozen && getPropertyInPath(collection.properties, col.key))
            .map(col => col.key)
            .filter(key => {
                if (seenKeys.has(key)) return false;
                seenKeys.add(key);
                return true;
            });

        // Optimistically update local state to prevent UI flickering
        setLocalPropertiesOrder(newPropertiesOrder);

        // Call each plugin's onColumnsReorder callback
        if (customizationController?.plugins) {
            customizationController.plugins
                .filter(plugin => plugin.hooks?.onColumnsReorder)
                .forEach(plugin => {
                    plugin.hooks!.onColumnsReorder!({
                        fullPath: path,
                        parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
                        parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
                        collection,
                        newPropertiesOrder
                    });
                });
        }

        // Save to user configuration persistence (local storage)
        if (userConfigPersistence) {
            onCollectionModifiedForUser(path, { fieldOrder: [...newPropertiesOrder] });
        }
    }, [collection, setLocalPropertiesOrder, customizationController, path, parentCollectionSlugs, parentEntityIds, userConfigPersistence, onCollectionModifiedForUser]);

    // Popover open state managed at parent level to prevent closing when view changes
    const [viewModePopoverOpen, setViewModePopoverOpen] = useState(false);


    // Compute plugin-provided error view for collection loading errors
    const pluginErrorViews = useSlot("collection.error", {
        path,
        collection,
        parentCollectionSlugs,
parentEntityIds,
        error: tableController.dataLoadingError as Error
    });
    const pluginErrorView = tableController.dataLoadingError && pluginErrorViews.length > 0
        ? pluginErrorViews[0]
        : null;

    // Shared empty state — plugin slot takes priority, then override, then default
    // "No results" is only true of a view the user narrowed: a search, or
    // a filter they can clear. The collection's `fixedFilter` is its
    // scope, not a filter, and a sort never empties a set — counting the
    // declared default `sort` hid "Create your first entry" from every
    // empty collection that declares one.
    const isSearching = !!tableController.searchString;
    const fixedFilter = collection.fixedFilter;
    const isFiltered = isSearching || Object.keys(tableController.filterValues ?? {})
        .some(key => !fixedFilter || !(key in fixedFilter));
    const ResolvedEmptyState = useComponentOverride("Collection.EmptyState", DefaultCollectionEmptyState);
    const ResolvedCollectionActions = useComponentOverride("Collection.Actions", CollectionViewActions);
    const ResolvedCollectionTable = useComponentOverride("Collection.Table", CollectionTableBinding) as typeof CollectionTableBinding;
    const emptyComponent = pluginEmptyStates.length > 0
        ? <>{pluginEmptyStates}</>
        : <ResolvedEmptyState
            canCreate={canCreateEntities && !isFiltered}
            onNewClick={onNewClick}
            isSearching={isSearching}
            isFiltered={isFiltered}
            searchString={tableController.searchString ?? ""}
        />;

    return {
        t,
        containerRef,
        path,
        parentCollectionSlugs,
        parentEntityIds,
        selectedEntityId: selectedEntityIdProp,
        selectedTab,
        collection,
        collectionRef,
        resolvedCollection,
        canCreateEntities,
        highlightedId,
        setHighlightedId,
        deleteEntityClicked,
        setDeleteEntityClicked,
        lastDeleteTimestamp,
        deletedEntities,
        docsCount,
        setDocsCount,
        inlineEditingEnabled,
        selectionEnabled,
        hoverRow,
        resolvedCustomViews,
        viewMode,
        activeCustomView,
        openEntityMode,
        onViewModeChange,
        listSize,
        cardSize,
        setCardSize,
        tableSize,
        customViewSize,
        setCustomViewSize,
        onListSizeChanged,
        onTableSizeChanged,
        usedSelectionController,
        tableController,
        tableKey,
        popupCell,
        onPopupClose,
        onEntityClick,
        onNewClick,
        openNewDocument,
        linkedTargetSlug,
        isLinkedChildView,
        selectionDialog,
        onMultipleDeleteClick,
        internalOnEntityDelete,
        internalOnMultipleEntitiesDelete,
        pluginAddColumnComponents,
        pluginToolbarWidgets,
        pluginWidgets,
        onColumnResize,
        onValueChange,
        uniqueFieldValidator,
        enabledViews,
        kanbanPropertyOptions,
        selectedKanbanProperty,
        onKanbanPropertyChange,
        getPropertyFor,
        displayedColumnIds,
        additionalFields,
        isSplitLayout,
        isCompact,
        activeSelectionEnabled,
        getActionsForEntity,
        getIdColumnWidth,
        customEntityActions,
        tableRowActionsBuilder,
        highlightedEntities,
        idHeaderWidget,
        liveSelectionQuery,
        headerActionsScope,
        addColumnComponentInternal,
        // With `fields` the order is the caller's: columns are not dragged.
        onColumnsOrderChange: stableFields ? undefined : onColumnsOrderChange,
        viewCollection,
        entityActionsScope,
        title,
        viewModePopoverOpen,
        setViewModePopoverOpen,
        pluginErrorView,
        emptyComponent,
        ResolvedCollectionActions,
        ResolvedCollectionTable
    };
}

/** What {@link useCollectionViewState} returns: one render's state of a collection view. */
export type CollectionViewState<M extends Record<string, unknown> = Record<string, unknown>> =
    ReturnType<typeof useCollectionViewState<M>>;

/** A column's width as a field preference; a nested column (`address.city`) nests under its document's `fields`. */
function columnWidthPreference(key: string, width: number): Record<string, UiFieldPreferences> {
    const [head, ...rest] = key.split(".");
    return { [head]: rest.length > 0 ? { fields: columnWidthPreference(rest.join("."), width) } : { columnWidth: width } };
}
