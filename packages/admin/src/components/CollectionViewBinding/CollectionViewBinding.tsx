import type { AdditionalFieldDelegate, EntityAction, CollectionConfig, Property } from "@rebasepro/types";
import {
    CollectionSize,
    Entity,
    EntityReference,
    EntityTableController,
    FilterValues,
    getCollectionDataPath,
    PartialCollectionConfig,
    ViewMode
} from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { deepEqual as equal } from "fast-equals"
import { CollectionRowActions, CollectionTableBinding } from "../CollectionTableBinding";
import { CollectionTableToolbar } from "../CollectionTableBinding/internal/CollectionTableToolbar";
import { getSubcollections } from "@rebasepro/common";
import { useCollectionInlineEditor } from "./hooks/useCollectionInlineEditor";
import { navigateToEntity } from "../../util/navigation_utils";
import { mergeEntityActions } from "../../util/entity_actions";
import { resolveEntityAction } from "../../util/resolutions";
import { getPropertyInPath } from "../../util/property_utils";
import { ReferencePreview } from "../../preview";
import {
    CollectionScopeProvider,
    OnColumnResizeParams,
    useAnalyticsController,
    useAuthController,
    useColumnIds,
    useComponentOverride,
    useCustomizationController,
    useData,
    useDataTableController,
    useLargeLayout,
    usePermissions,
    useScrollRestoration,
    useSlot,
    useTranslation,
    useUserConfigurationPersistence
} from "@rebasepro/app";
import { CollectionViewActions } from "./CollectionViewActions";
import { CollectionCardViewBinding } from "./CollectionCardViewBinding";
import { CollectionListViewBinding } from "./CollectionListViewBinding";
import { SplitListView } from "./SplitListView";
import { CollectionBoardViewBinding } from "./CollectionBoardViewBinding";
import { KanbanPropertyOption, ViewModeToggle } from "./ViewModeToggle";
import {
    ArrowRightToLineIcon,
    Button,
    cls,
    ErrorBoundary,
    focusedDisabled,
    IconButton,
    iconSize,
    PlusIcon,
    Popover,
    SearchIcon,
    TextField,
    Tooltip,
    Typography,
    VirtualTableColumn
} from "@rebasepro/ui";
import { getSubcollectionColumnId } from "../CollectionTableBinding/internal/common";
import { copyEntityAction, deleteEntityAction, editEntityAction } from "../common/default_entity_actions";
import { PopupFormField } from "../CollectionTableBinding/internal/popup_field/PopupFormField";
import { GetPropertyForProps } from "../CollectionTableBinding/CollectionTableBindingProps";
import { DeleteEntityDialog } from "../DeleteEntityDialog";
import { useSelectionController } from "./useSelectionController";
import { CollectionViewStartActions } from "./CollectionViewStartActions";
import { addRecentId, getRecentIds } from "./utils";
import { mergeDeep } from "@rebasepro/utils";
import { useBreadcrumbsController } from "../../hooks/useBreadcrumbsController";
import { useCMSContext } from "../../hooks/useCMSContext";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import { useSidePanel } from "../../hooks/useSidePanel";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";

const EMPTY_ARRAY: never[] = [];
const DEFAULT_ENTITY_OPEN_MODE = "split";

function getOpenEntityMode(
    viewMode: ViewMode,
    configuredMode?: "side_panel" | "full_screen" | "split" | "dialog"
): "side_panel" | "full_screen" | "split" | "dialog" {
    if (configuredMode) return configuredMode;
    if (viewMode === "kanban") return "side_panel";
    if (viewMode === "table" || viewMode === "cards") return "full_screen";
    // "list" view defaults to split
    return "split";
}

/**
 * @group Components
 */
export type CollectionViewBindingProps<M extends Record<string, unknown>> = {
    /**
     * Complete path where this collection is located.
     * It defaults to the collection path if not provided.
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

} & CollectionConfig<M>;

/**
 * This component is in charge of binding a driver path with an {@link CollectionConfig}
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
    function CollectionViewBindingInner<M extends Record<string, unknown>>({
        path: pathProp,

        parentCollectionSlugs, parentEntityIds,
        isSubCollection,
        className,
        updateUrl,
        selectedEntityId: selectedEntityIdProp,
        selectedTab: selectedTabProp,
        ...collectionProp
    }: CollectionViewBindingProps<M>
    ) {

        const { t } = useTranslation();
        const context = useCMSContext();
        const collectionRegistry = useCollectionRegistryController();
        const urlController = useUrlController();
        const breadcrumbs = useBreadcrumbsController();
        const path = pathProp ?? getCollectionDataPath(collectionProp);
        const dataClient = useData();
        const sidePanelController = useSidePanel();
        const authController = useAuthController();
        const userConfigPersistence = useUserConfigurationPersistence();
        const analyticsController = useAnalyticsController();
        const customizationController = useCustomizationController();
        const { canCreate, canEdit, canDelete } = usePermissions();

        const containerRef = React.useRef<HTMLDivElement>(null);

        const scrollRestoration = useScrollRestoration();

        const collection = useMemo(() => {
            const registryCollection = collectionRegistry.getCollection(path) || collectionProp;
            const userOverride = userConfigPersistence?.getCollectionConfig<M>(path);
            return (userOverride ? mergeDeep(registryCollection, userOverride) : registryCollection) as CollectionConfig<M>;
        }, [collectionProp, path, userConfigPersistence, collectionRegistry]);

        const collectionRef = React.useRef(collection);
        useEffect(() => {
            collectionRef.current = collection;
        }, [collection]);

        const canCreateEntities = canCreate(collection, path);
        const [highlightedEntity, setHighlightedEntity] = useState<Entity<M> | undefined>(undefined);
        const [deleteEntityClicked, setDeleteEntityClicked] = React.useState<Entity<M> | Entity<M>[] | undefined>(undefined);

        const [lastDeleteTimestamp, setLastDeleteTimestamp] = React.useState<number>(0);

        // Track recently deleted entities for optimistic Kanban count updates
        const [deletedEntities, setDeletedEntities] = React.useState<Entity<M>[]>([]);

        // number of entities in the collection (undefined = loading)
        const [docsCount, setDocsCount] = useState<number | null | undefined>(null);

        // Optimistic state for column order to prevent UI flickering during persistence
        const [localPropertiesOrder, setLocalPropertiesOrder] = useState<string[] | undefined>(collection.propertiesOrder);

        // Sync local state with collection's propertiesOrder when it changes from external sources
        useEffect(() => {
            setLocalPropertiesOrder(collection.propertiesOrder);
        }, [collection.propertiesOrder]);

        const unselectNavigatedEntity = useCallback(() => {
            const currentSelection = highlightedEntity;
            setTimeout(() => {
                if (currentSelection === highlightedEntity)
                    setHighlightedEntity(undefined);
            }, 2400);
        }, [highlightedEntity]);

        const checkInlineEditing = useCallback((entity?: Entity<M>): boolean => {
            const collection = collectionRef.current;
            if (!canEdit(collection, path, entity ?? null)) {
                return false;
            }
            return collection.inlineEditing === undefined || collection.inlineEditing;
        }, [canEdit, path]);

        const selectionEnabled = collection.selectionEnabled === undefined || collection.selectionEnabled;
        const hoverRow = !checkInlineEditing();

        const [popOverOpen, setPopOverOpen] = useState(false);

        // View mode priority: URL > saved user config > collection.defaultViewMode
        const defaultViewMode = collection.defaultViewMode ?? "list";
        const [searchParams, setSearchParams] = useSearchParams();

        // Read view from React Router's searchParams (reactive on back/forward)
        const urlView = useMemo((): ViewMode | null => {
            const v = searchParams.get("__view");
            if (v && ["list", "table", "kanban", "cards"].includes(v)) {
                return v as ViewMode;
            }
            return null;
        }, [searchParams]);

        // Get saved view from local persistence
        const getSavedView = useCallback((): ViewMode | null => {
            const saved = userConfigPersistence?.getCollectionConfig<M>(path)?.defaultViewMode;
            return (saved as ViewMode) ?? null;
        }, [userConfigPersistence, path]);

        const [viewMode, setViewModeState] = useState<ViewMode>(() => {
            // Priority: URL > saved config > collection default
            if (urlView) return urlView;
            const savedView = getSavedView();
            if (savedView) return savedView;
            return defaultViewMode;
        });

        const openEntityMode = getOpenEntityMode(viewMode, collection?.openEntityMode);

        // Sync URL with current view on init (if view came from saved config)
        useEffect(() => {
            if (!urlView && viewMode !== defaultViewMode) {
                // View came from saved config but URL doesn't have it - update URL without push
                setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("__view", viewMode);
                    return next;
                }, { replace: true });
            }
        }, []); // Only on mount

        // Update URL when view mode changes (user action)
        const setViewMode = useCallback((newMode: ViewMode) => {
            setViewModeState(newMode);

            // Update URL with __view param via React Router
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                if (newMode === defaultViewMode) {
                    next.delete("__view");
                } else {
                    next.set("__view", newMode);
                }
                return next;
            });
        }, [defaultViewMode, setSearchParams]);

        // Sync viewMode state when URL changes via back/forward navigation
        useEffect(() => {
            if (urlView) {
                setViewModeState(urlView);
            } else {
                const savedView = getSavedView();
                setViewModeState(savedView ?? defaultViewMode);
            }
        }, [urlView, getSavedView, defaultViewMode]);

        // List view size state - controls row height and info density
        const [listSize, setListSize] = useState<CollectionSize>(collection.defaultSize ?? "m");

        // Card view size state - controls the grid column count
        const [cardSize, setCardSize] = useState<CollectionSize>(collection.defaultSize ?? "m");

        // Table view size state - controls row height
        const [tableSize, setTableSize] = useState<CollectionSize>(collection.defaultSize ?? "m");

        const selectionController = useSelectionController<M>();
        const usedSelectionController = collection.selectionController ?? selectionController;
        const {
            selectedEntities,
            setSelectedEntities
        } = usedSelectionController;

        const tableController = useDataTableController<M>({
            path,
            collection,
            lastDeleteTimestamp,
            scrollRestoration,
            updateUrl
        });

        const tableKey = React.useRef<string>(Math.random().toString(36));
        const popupCell = tableController.popupCell as {
            entityId: string | number;
            propertyKey: Extract<keyof M, string>;
            cellRect?: DOMRect;
        } | undefined;

        const onPopupClose = useCallback(() => {
            tableController.setPopupCell?.(undefined);
        }, [tableController.setPopupCell]);

        const onEntityClick = useCallback((clickedEntity: Entity<M>) => {
            const collection = collectionRef.current;
            setHighlightedEntity(clickedEntity);
            analyticsController.onAnalyticsEvent?.("edit_entity_clicked", {
                path: clickedEntity.path,
                entityId: clickedEntity.id
            });

            if (collection) {
                addRecentId(collection.slug, clickedEntity.id);
            }

            const entityPath = path ?? clickedEntity.path;
            navigateToEntity({
                navigation: urlController,
                path: entityPath,
                sidePanelController,
                openEntityMode,
                collection,
                entityId: clickedEntity.id,
                replace: openEntityMode === "split" && selectedEntityIdProp !== undefined
            });

        }, [sidePanelController, openEntityMode, selectedEntityIdProp, path, urlController, analyticsController]);

        const onNewClick = useCallback(() => {
            const collection = collectionRef.current;
            analyticsController.onAnalyticsEvent?.("new_entity_click", {
                path: path
            });
            navigateToEntity({
                openEntityMode,
                collection,
                entityId: undefined,
                path: path,
                sidePanelController,
                navigation: urlController,
                onClose: unselectNavigatedEntity
            })
        }, [path, sidePanelController]);

        const openNewDocument = useCallback((defaultValues?: Record<string, unknown>) => {
            const collection = collectionRef.current;
            analyticsController.onAnalyticsEvent?.("new_entity_click", {
                path: path
            });
            navigateToEntity({
                openEntityMode,
                collection,
                entityId: undefined,
                defaultValues,
                path: path,
                sidePanelController,
                navigation: urlController,
                onClose: unselectNavigatedEntity
            });
        }, [path, sidePanelController, openEntityMode, urlController, unselectNavigatedEntity]);

        const onMultipleDeleteClick = () => {
            analyticsController.onAnalyticsEvent?.("multiple_delete_dialog_open", {
                path: path
            });
            setDeleteEntityClicked(selectedEntities);
        };

        const internalOnEntityDelete = (_path: string, entity: Entity<M>) => {
            analyticsController.onAnalyticsEvent?.("single_entity_deleted", {
                path: path
            });
            setSelectedEntities((selectedEntities) => selectedEntities.filter((e) => e.id !== entity.id));
            setDeletedEntities(prev => [...prev, entity]);
            setLastDeleteTimestamp(Date.now());
        };

        const internalOnMultipleEntitiesDelete = (_path: string, entities: Entity<M>[]) => {
            analyticsController.onAnalyticsEvent?.("multiple_entities_deleted", {
                path: path
            });
            setSelectedEntities([]);
            setDeleteEntityClicked(undefined);
            setDeletedEntities(prev => [...prev, ...entities]);
            setLastDeleteTimestamp(Date.now());
        };

        const pluginAddColumnComponents = useSlot("collection.add-column", {
            path,
            parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
            collection,
            tableController
        });

        const pluginToolbarWidgets = useSlot("collection.toolbar", {
            path,
            parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
            collection: collection,
            tableController: tableController,
            selectionController: usedSelectionController
        });

        const pluginEmptyStates = useSlot("collection.empty-state", {
            path,
            parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
            collection,
            canCreate: canCreateEntities,
            onNewClick
        });

        const pluginInsights = useSlot("collection.insights", {
            path,
            parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
parentEntityIds: parentEntityIds ?? EMPTY_ARRAY,
            collection
        });

        const onCollectionModifiedForUser = useCallback((path: string, partialCollection: PartialCollectionConfig<M>) => {
            if (userConfigPersistence) {
                const currentStoredConfig = userConfigPersistence.getCollectionConfig(path);
                const updatedConfig = mergeDeep(currentStoredConfig, partialCollection);
                userConfigPersistence.onCollectionModified(path, updatedConfig);
            }
        }, [userConfigPersistence]);

        const onColumnResize = useCallback(({
            width,
            key
        }: OnColumnResizeParams) => {

            const collection = collectionRef.current;
            // Only for property columns
            if (!getPropertyInPath(collection.properties, key)) return;
            const localCollection = buildPropertyWidthOverwrite(key, width) as PartialCollectionConfig<M>;
            onCollectionModifiedForUser(path, localCollection);
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
            setViewMode(mode);
            // Save to local persistence for next visit
            if (userConfigPersistence) {
                onCollectionModifiedForUser(path, { defaultViewMode: mode } as PartialCollectionConfig<M>);
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

        // Check if Kanban view is available (needs kanban.columnProperty with enum)
        const kanbanEnabled = useMemo(() => {
            if (!collection.kanban?.columnProperty) return false;
            const property = getPropertyInPath(resolvedCollection.properties, collection.kanban.columnProperty);
            if (!property || property.type !== "string") return false;
            return Boolean("enum" in property && property.enum);
        }, [collection.kanban?.columnProperty, resolvedCollection.properties]);

        // Compute the effective enabled views:
        // - Start from collection.enabledViews (defaults to all three)
        // - Filter out kanban if no enum properties exist
        const hasEnumProperty = useMemo(() => {
            return Object.values(resolvedCollection.properties).some((p: Property) => p.type === "string" && "enum" in p && p.enum);
        }, [resolvedCollection.properties]);

        const enabledViews: ViewMode[] = useMemo(() => {
            const configured = collection.enabledViews ?? ["list", "table", "cards", "kanban"];
            if (!hasEnumProperty) {
                return configured.filter(v => v !== "kanban");
            }
            return configured;
        }, [collection.enabledViews, hasEnumProperty]);

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
            const saved = userConfigPersistence?.getCollectionConfig<M>(path);
            return (saved as Record<string, unknown>)?.kanbanColumnProperty as string | undefined;
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
                onCollectionModifiedForUser(path, { kanbanColumnProperty: property } as PartialCollectionConfig<M>);
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


            // In v4, properties are already resolved, so we return them directly
            return property ?? null;
        }, [collection.properties, resolvedCollection.properties]);

        // Use a collection with local propertiesOrder for optimistic UI updates
        const collectionWithLocalOrder = useMemo(() => {
            if (localPropertiesOrder && localPropertiesOrder !== resolvedCollection.propertiesOrder) {
                return {
                    ...resolvedCollection,
                    propertiesOrder: localPropertiesOrder
                };
            }
            return resolvedCollection;
        }, [resolvedCollection, localPropertiesOrder]);

        const displayedColumnIds = useColumnIds(collectionWithLocalOrder, true);

        const additionalFields = useMemo(() => {
            // v4: use getSubcollections helper to access subcollections
            const subcollectionsList = getSubcollections(collection);
            const subcollectionColumns: AdditionalFieldDelegate<M, any>[] = subcollectionsList.map((subcollection: CollectionConfig) => {
                return {
                    key: getSubcollectionColumnId(subcollection),
                    name: subcollection.name,
                    width: 200,
                    dependencies: [],
                    Builder: ({ entity }: { entity: Entity }) => (
                        <Button
                            className={"max-w-full truncate justify-start"}
                            startIcon={<ArrowRightToLineIcon size={iconSize.small}/>}
                            onClick={(event: React.MouseEvent) => {
                                event.stopPropagation();
                                navigateToEntity({
                                    openEntityMode,
                                    collection,
                                    entityId: entity.id,
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
        }, [collection, path, sidePanelController]);

        const updateLastDeleteTimestamp = useCallback(() => {
            setLastDeleteTimestamp(Date.now());
        }, []);

        const largeLayout = useLargeLayout();

        const isSplitLayout = openEntityMode === "split";
        const isCompact = isSplitLayout && selectedEntityIdProp !== undefined;
        const activeSelectionEnabled = !isCompact && selectionEnabled;

        const getActionsForEntity = useCallback(({
            entity,
            customEntityActions
        }: {
            entity?: Entity<M>,
            customEntityActions?: EntityAction[]
        }): EntityAction[] => {
            const deleteEnabled = entity ? canDelete(collection, path, entity) : true;
            const disableActions = collection.disableDefaultActions ?? [];
            const actions: EntityAction[] = [];
            if (!disableActions.includes("edit")) {
                actions.push(editEntityAction);
            }
            if (createEnabled && !disableActions.includes("copy"))
                actions.push(copyEntityAction);
            if (deleteEnabled && !disableActions.includes("delete"))
                actions.push(deleteEntityAction);
            if (customEntityActions)
                return mergeEntityActions(actions, customEntityActions);
            return actions;
        }, [canDelete, collection, path, createEnabled]);

        const getIdColumnWidth = useCallback(() => {
            const entityActions = getActionsForEntity({});
            const collapsedActions = entityActions.filter(a => a.collapsed !== false);
            const uncollapsedActions = entityActions.filter(a => a.collapsed === false);
            const actionsWidth = uncollapsedActions.length * (largeLayout ? 40 : 30);
            return (largeLayout ? (80 + actionsWidth) : (70 + actionsWidth)) + (collapsedActions.length > 0 ? (largeLayout ? 40 : 30) : 0);
        }, [getActionsForEntity, largeLayout]);

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

            const isSelected = Boolean(usedSelectionController.selectedEntities.find(e => e.id == entity.id && e.path == entity.path));
            const customEntityActions = (collection.entityActions ?? EMPTY_ARRAY)
                .map(action => resolveEntityAction(action, customizationController.entityActions))
                .filter(Boolean) as EntityAction<M>[];

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
                    highlightEntity={setHighlightedEntity}
                    unhighlightEntity={unselectNavigatedEntity}
                    collection={collection}
                    path={path}
                    actions={actions}
                    hideId={collection?.hideIdFromCollection}
                    onCollectionChange={updateLastDeleteTimestamp}
                    selectionController={usedSelectionController}
                    openEntityMode={openEntityMode}
                />
            );

        }, [updateLastDeleteTimestamp, usedSelectionController]);

        // Update breadcrumb count when count changes
        const updateCountRef = React.useRef(breadcrumbs.updateCount);
        updateCountRef.current = breadcrumbs.updateCount;
        useEffect(() => {
            updateCountRef.current(path, docsCount);
        }, [docsCount, path]);

        // EntitiesCount fetches count and updates breadcrumb - no visual rendering needed here
        const countFetcher = <EntitiesCount
            path={path}
            collection={collection}
            filter={tableController.filterValues}
            sortBy={tableController.sortBy}
            onCountChange={setDocsCount}
        />;

        const { resolvedSlots } = customizationController;

        // Pre-compute header action slot contributions (avoid useSlot inside callback)
        const headerActionContributions = useMemo(() => resolvedSlots
            .filter(s => s.slot === "collection.header.action")
            .sort((a, b) => (a.order ?? 50) - (b.order ?? 50)), [resolvedSlots]);

        const buildAdditionalHeaderWidget = useCallback(({
            property,
            propertyKey,
            onHover
        }: {
            property: Property,
            propertyKey: string,
            onHover: boolean
        }) => {
            const collection = collectionRef.current;
            const headerSlotProps = {
                property,
                propertyKey,
                onHover,
                path,
                collection: collection as CollectionConfig,
                tableController: tableController as EntityTableController,
                parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY,
parentEntityIds: parentEntityIds ?? EMPTY_ARRAY
            };
            return <>{headerActionContributions.map((s, i) => (
                <ErrorBoundary key={`header_action_${propertyKey}_${i}`}>
                    <s.Component {...headerSlotProps} {...(s.props ?? {})}/>
                </ErrorBoundary>
            ))}</>;
        }, [headerActionContributions, path, parentCollectionSlugs]);

        const addColumnComponentInternal = pluginAddColumnComponents.length > 0
            ? function () {
                return (
                    <div className="flex flex-row items-center gap-2">
                        {pluginAddColumnComponents}
                    </div>
                );
            }
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
                onCollectionModifiedForUser(path, { propertiesOrder: newPropertiesOrder } as PartialCollectionConfig<M>);
            }
        }, [collection, setLocalPropertiesOrder, customizationController, path, parentCollectionSlugs, parentEntityIds, userConfigPersistence, onCollectionModifiedForUser]);

        // Popover open state managed at parent level to prevent closing when view changes
        const [viewModePopoverOpen, setViewModePopoverOpen] = useState(false);

        // Create ViewModeToggle once to prevent remounting when view changes
        const viewModeToggleElement = (
            <ViewModeToggle
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                enabledViews={enabledViews}
                size={viewMode === "list" ? listSize : viewMode === "table" ? tableSize : viewMode === "cards" ? cardSize : undefined}
                onSizeChanged={viewMode === "list" ? onListSizeChanged : viewMode === "table" ? onTableSizeChanged : viewMode === "cards" ? setCardSize : undefined}
                open={viewModePopoverOpen}
                onOpenChange={setViewModePopoverOpen}
                kanbanPropertyOptions={kanbanPropertyOptions}
                selectedKanbanProperty={selectedKanbanProperty}
                onKanbanPropertyChange={onKanbanPropertyChange}
            />
        );

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
        const isSearching = !!tableController.searchString;
        const isFilteredOrSorted = tableController.filterValues !== undefined || tableController.sortBy !== undefined || isSearching;
        const ResolvedEmptyState = useComponentOverride("Collection.EmptyState", DefaultCollectionEmptyState);
        const ResolvedCollectionActions = useComponentOverride("Collection.Actions", CollectionViewActions);
        const ResolvedCollectionTable = useComponentOverride("Collection.Table", CollectionTableBinding) as typeof CollectionTableBinding;
        const emptyComponent = pluginEmptyStates.length > 0
            ? <>{pluginEmptyStates}</>
            : <ResolvedEmptyState
                canCreate={canCreateEntities && !isFilteredOrSorted}
                onNewClick={onNewClick}
                isSearching={isSearching}
                searchString={tableController.searchString ?? ""}
            />;

        const toolbarNode = (
            <CollectionTableToolbar
                compact={isCompact}
                loading={tableController.dataLoading}
                onTextSearch={tableController.setSearchString}
                initialSearchText={tableController.searchString}
                viewModeToggle={viewModeToggleElement}
                actionsStart={<CollectionViewStartActions
                    parentCollectionSlugs={parentCollectionSlugs ?? EMPTY_ARRAY} parentEntityIds={parentEntityIds ?? EMPTY_ARRAY}
                    collection={collection}
                    tableController={tableController}
                    path={path}
                    relativePath={getCollectionDataPath(collection)}
                    selectionController={usedSelectionController}
                    collectionEntitiesCount={docsCount ?? undefined}
                    resolvedProperties={resolvedCollection.properties}
                    openNewDocument={openNewDocument}
                    compact={isCompact}/>}
                actions={
                    <ResolvedCollectionActions
                        parentCollectionSlugs={parentCollectionSlugs ?? EMPTY_ARRAY} parentEntityIds={parentEntityIds ?? EMPTY_ARRAY}
                        collection={collection}
                        tableController={tableController}
                        onMultipleDeleteClick={onMultipleDeleteClick}
                        onNewClick={onNewClick}
                        openNewDocument={openNewDocument}
                        path={path}
                        relativePath={getCollectionDataPath(collection)}
                        selectionController={usedSelectionController}
                        selectionEnabled={activeSelectionEnabled}
                        collectionEntitiesCount={docsCount ?? undefined}
                        compact={isCompact}
                    >
                        {pluginToolbarWidgets}
                    </ResolvedCollectionActions>
                }
            />
        ); const innerView = viewMode === "kanban" ? (
            <CollectionBoardViewBinding
                key={`kanban-view-${path}-${selectedKanbanProperty}`}
                collection={collection}
                tableController={tableController}
                fullPath={path}
                parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                columnProperty={selectedKanbanProperty}
                onEntityClick={onEntityClick}
                selectionController={usedSelectionController}
                selectionEnabled={selectionEnabled}
                highlightedEntities={highlightedEntity ? [highlightedEntity] : []}
                deletedEntities={deletedEntities}
                emptyComponent={emptyComponent}
            />
        ) : viewMode === "cards" ? (
            <CollectionCardViewBinding
                key={`cards-view-${path}`}
                collection={collection}
                tableController={tableController}
                onEntityClick={onEntityClick}
                selectionController={usedSelectionController}
                selectionEnabled={selectionEnabled}
                highlightedEntities={highlightedEntity ? [highlightedEntity] : []}
                onScroll={tableController.onScroll}
                initialScroll={tableController.initialScroll}
                size={cardSize}
                emptyComponent={emptyComponent}
            />
        ) : viewMode === "list" ? (
            <CollectionListViewBinding
                key={`list-view-${path}`}
                collection={collection}
                tableController={tableController}
                onEntityClick={onEntityClick}
                selectionController={usedSelectionController}
                selectionEnabled={selectionEnabled}
                highlightedEntities={highlightedEntity ? [highlightedEntity] : []}
                size={listSize}
                emptyComponent={emptyComponent}
                getActionsForEntity={getActionsForEntity}
                path={path}
                openEntityMode={openEntityMode}
            />
        ) : (
            <ResolvedCollectionTable
                key={`collection_table_${path}`}
                hideToolbar={true}
                additionalFields={additionalFields}
                tableController={tableController}
                enablePopupIcon={true}
                displayedColumnIds={displayedColumnIds}
                onSizeChanged={onTableSizeChanged}
                onEntityClick={onEntityClick}
                onColumnResize={onColumnResize}
                onValueChange={onValueChange}
                tableRowActionsBuilder={tableRowActionsBuilder}
                uniqueFieldValidator={uniqueFieldValidator}
                selectionController={usedSelectionController}
                highlightedEntities={highlightedEntity ? [highlightedEntity] : []}
                defaultSize={tableSize}
                properties={resolvedCollection.properties}
                getPropertyFor={getPropertyFor}
                onScroll={tableController.onScroll}
                initialScroll={tableController.initialScroll}
                emptyComponent={emptyComponent}
                hoverRow={hoverRow}
                inlineEditing={checkInlineEditing()}
                AdditionalHeaderWidget={buildAdditionalHeaderWidget}
                AddColumnComponent={addColumnComponentInternal}
                getIdColumnWidth={getIdColumnWidth}
                additionalIDHeaderWidget={<EntityIdHeaderWidget
                    path={path}
                    idPath={path}
                    collection={collection}/>}
                openEntityMode={openEntityMode}
                onColumnsOrderChange={onColumnsOrderChange}
            />
        );

        const mainContent = (
            <div className={cls("overflow-hidden h-full w-full rounded-md flex flex-col dark:bg-surface-800", className)}
                ref={containerRef}>

                {countFetcher}

                {tableController.dataLoadingError && tableController.data.length > 0 && (
                    <div className="flex items-center gap-4 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex-shrink-0">
                        <Typography variant="body2" className="text-red-700 dark:text-red-300 flex-1">
                            <strong>Warning:</strong> {tableController.dataLoadingError.message || "Failed to update data."}
                        </Typography>
                    </div>
                )}


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
                        highlightedEntities={highlightedEntity ? [highlightedEntity] : []}
                        onScroll={tableController.onScroll}
                        initialScroll={tableController.initialScroll}
                        size={listSize}
                        emptyComponent={emptyComponent}
                        path={path}
                        parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                        selectedEntityId={selectedEntityIdProp}
                        selectedTab={selectedTabProp}
                        toolbar={toolbarNode}
                    >
                        {/* When detail panel is open, left panel is always the list
                            view — regardless of which view mode triggered the entity
                            click. When no detail, show the active view mode. */}
                        {(selectedEntityIdProp !== undefined || viewMode === "list") ? (
                            <div
                                className={cls(
                                    "flex flex-col w-full",
                                    selectedEntityIdProp === undefined
                                        ? "max-w-6xl mx-auto px-3 md:px-4 lg:px-6 py-4"
                                        : ""
                                )}
                            >
                                {/* Collapsible title — grid-rows for smooth height, transform for GPU */}
                                <div
                                    className={cls(
                                        "grid transition-[grid-template-rows,transform,margin] duration-150 ease-out",
                                        selectedEntityIdProp === undefined
                                            ? "grid-rows-[1fr] translate-y-0 mt-12 mb-6"
                                            : "grid-rows-[0fr] -translate-y-2 mt-0 mb-0"
                                    )}
                                >
                                    <div className="overflow-hidden flex items-center gap-4">
                                        <Typography gutterBottom variant="h4" className="grow mb-0" component="h4">
                                            {collection.name}
                                        </Typography>
                                    </div>
                                </div>
                                {pluginInsights.length > 0 && (
                                    <div
                                        className={cls(
                                            "grid transition-[grid-template-rows] duration-150 ease-out",
                                            selectedEntityIdProp === undefined
                                                ? "grid-rows-[1fr]"
                                                : "grid-rows-[0fr]"
                                        )}
                                    >
                                        <div className="overflow-hidden flex-shrink-0">
                                            {pluginInsights}
                                        </div>
                                    </div>
                                )}
                                <CollectionListViewBinding
                                    key={`list-view-${path}`}
                                    collection={collection}
                                    tableController={tableController}
                                    onEntityClick={onEntityClick}
                                    selectionController={usedSelectionController}
                                    selectionEnabled={selectionEnabled}
                                    highlightedEntities={highlightedEntity ? [highlightedEntity] : []}
                                    size={listSize}
                                    emptyComponent={emptyComponent}
                                    selectedEntityId={selectedEntityIdProp}
                                    getActionsForEntity={getActionsForEntity}
                                    path={path}
                                    openEntityMode={openEntityMode}
                                />
                            </div>
                        ) : (
                            innerView
                        )}
                    </SplitListView>
                ) : (
                    <div className="flex flex-col w-full h-full">
                        {toolbarNode}
                        <div className={cls(
                            "flex-1 flex flex-col",
                            (viewMode === "list" || viewMode === "cards") && "overflow-y-auto"
                        )}>
                            {viewMode === "list" ? (
                                <div
                                    className={cls(
                                        "flex flex-col w-full",
                                        selectedEntityIdProp === undefined
                                            ? "max-w-6xl mx-auto px-3 md:px-4 lg:px-6 py-4"
                                            : ""
                                    )}
                                >
                                    <div
                                        className={cls(
                                            "grid transition-[grid-template-rows,transform,margin] duration-150 ease-out",
                                            selectedEntityIdProp === undefined
                                                ? "grid-rows-[1fr] translate-y-0 mt-12 mb-6"
                                                : "grid-rows-[0fr] -translate-y-2 mt-0 mb-0"
                                        )}
                                    >
                                        <div className="overflow-hidden flex items-center gap-4">
                                            <Typography gutterBottom variant="h4" className="grow mb-0" component="h4">
                                                {collection.name}
                                            </Typography>
                                        </div>
                                    </div>
                                    {pluginInsights.length > 0 && (
                                        <div className="flex-shrink-0">
                                            {pluginInsights}
                                        </div>
                                    )}
                                    {innerView}
                                </div>
                            ) : (
                                innerView
                            )}
                        </div>
                    </div>
                )}

                {popupCell && <PopupFormField
                    key={`popup_form_${popupCell?.propertyKey}_${popupCell?.entityId}`}
                    open={Boolean(popupCell)}
                    onClose={onPopupClose}
                    cellRect={popupCell?.cellRect}
                    propertyKey={popupCell?.propertyKey}
                    collection={collection}
                    entityId={popupCell.entityId}
                    tableKey={tableKey.current}
                    customFieldValidator={uniqueFieldValidator}
                    path={path}
                    onCellValueChange={onValueChange}
                    container={containerRef.current}/>}

                {deleteEntityClicked &&
                    <DeleteEntityDialog
                        entityOrEntitiesToDelete={deleteEntityClicked}
                        path={path}
                        collection={collection}
                        callbacks={collection.callbacks}
                        open={Boolean(deleteEntityClicked)}
                        onEntityDelete={internalOnEntityDelete}
                        onMultipleEntitiesDelete={internalOnMultipleEntitiesDelete}
                        onClose={() => setDeleteEntityClicked(undefined)}/>}

            </div>
        );

        return mainContent;
    }, (a, b) => {
        return equal(a.path, b.path) &&
            equal(a.parentCollectionSlugs, b.parentCollectionSlugs) && equal(a.parentEntityIds, b.parentEntityIds) &&
            equal(a.isSubCollection, b.isSubCollection) &&
            equal(a.className, b.className) &&
            equal(a.properties, b.properties) &&
            equal(a.propertiesOrder, b.propertiesOrder) &&
            equal(a.hideIdFromCollection, b.hideIdFromCollection) &&
            equal(a.inlineEditing, b.inlineEditing) &&
            equal(a.selectionEnabled, b.selectionEnabled) &&
            equal(a.selectionController, b.selectionController) &&
            equal(a.Actions, b.Actions) &&
            equal(a.defaultSize, b.defaultSize) &&
            equal(a.includeJsonView, b.includeJsonView) &&
            equal(a.additionalFields, b.additionalFields) &&
            equal(a.sideDialogWidth, b.sideDialogWidth) &&
            equal(a.openEntityMode, b.openEntityMode) &&
            equal(a.exportable, b.exportable) &&
            equal(a.history, b.history) &&
            equal(a.fixedFilter, b.fixedFilter) &&
            equal(a.selectedEntityId, b.selectedEntityId) &&
            equal(a.selectedTab, b.selectedTab);
    }) as React.FunctionComponent<CollectionViewBindingProps<any>>;

export const CollectionViewBinding = React.memo(
    function CollectionViewBinding<M extends Record<string, unknown>>(props: CollectionViewBindingProps<M>) {
        const collectionRegistry = useCollectionRegistryController();
        const path = props.path ?? props.slug;
        const collection = collectionRegistry.getCollection(path) ?? props;

        const content = <CollectionViewBindingInner {...props} />;

        if (collection) {
            return (
                <CollectionScopeProvider collection={collection as CollectionConfig}>
                    {content}
                </CollectionScopeProvider>
            );
        }
        return content;
    }
) as React.FunctionComponent<CollectionViewBindingProps<any>>;

/**
 * Default empty state shown when a collection has no entities.
 * Used as the fallback for the `"Collection.EmptyState"` component override.
 *
 * @internal
 */
function DefaultCollectionEmptyState({
    canCreate,
    onNewClick,
    isSearching,
    searchString
}: {
    canCreate: boolean;
    onNewClick: () => void;
    isSearching: boolean;
    searchString: string;
}) {
    const { t } = useTranslation();
    if (canCreate) {
        return (
            <div className="flex flex-col items-center justify-center">
                <Typography variant={"subtitle2"}>{t("so_empty")}</Typography>
                <Button
                    onClick={onNewClick}
                    className="mt-4"
                >
                    <PlusIcon/>
                    {t("create_your_first_entry")}
                </Button>
            </div>
        );
    }
    return (
        <Typography variant={"label"}>
            {isSearching
                ? t("no_results_search", { search: searchString })
                : t("no_results_filter_sort")}
        </Typography>
    );
}

/**
 * Inflight count request deduplication map.
 * Keyed by `path|filterKey|sortByProperty|sortDir` so that concurrent
 * callers (e.g. React StrictMode double-mount) share the same promise.
 */
const inflightCountRequests = new Map<string, Promise<number>>();

function EntitiesCount({
    path,
    collection,
    filter,
    sortBy,
    onCountChange
}: {
    path: string,
    collection: CollectionConfig,
    filter?: FilterValues<any>,
    sortBy?: [string, "asc" | "desc"],
    onCountChange?: (count: number | null | undefined) => void,
}) {

    const dataClient = useData();

    const sortByProperty = sortBy ? sortBy[0] : undefined;
    const currentSort = sortBy ? sortBy[1] : undefined;

    // Use refs for values that should NOT trigger re-fetches
    const dataClientRef = React.useRef(dataClient);
    dataClientRef.current = dataClient;
    const onCountChangeRef = React.useRef(onCountChange);
    onCountChangeRef.current = onCountChange;

    // Serialize filter to a stable string to avoid re-fetches on object identity changes
    const filterKey = React.useMemo(() => filter ? JSON.stringify(filter) : "", [filter]);

    useEffect(() => {
        const accessor = dataClientRef.current.collection(path);
        if (!accessor.count) {
            onCountChangeRef.current?.(undefined);
            return;
        }

        let cancelled = false;

        // filterValues is already FilterValues — pass directly
        const whereParams = filter && Object.keys(filter).length > 0 ? filter : undefined;
        const orderByParams: [string, "asc" | "desc"] | undefined = sortByProperty && currentSort ? [String(sortByProperty), currentSort] : undefined;

        // Deduplicate inflight count requests (e.g. React StrictMode double-mount)
        const cacheKey = `${path}|${filterKey}|${sortByProperty ?? ""}|${currentSort ?? ""}`;
        let countPromise = inflightCountRequests.get(cacheKey);
        if (!countPromise) {
            countPromise = accessor.count({
                where: whereParams,
                orderBy: orderByParams
            });
            inflightCountRequests.set(cacheKey, countPromise);
            // Clean up the inflight entry once resolved/rejected
            countPromise.finally(() => inflightCountRequests.delete(cacheKey));
        }

        countPromise.then((c) => {
            if (!cancelled) onCountChangeRef.current?.(c);
        }).catch((e) => {
            console.warn("Error fetching count", e);
            if (!cancelled) onCountChangeRef.current?.(undefined);
        });

        return () => { cancelled = true; };
    }, [path, filterKey, sortByProperty, currentSort]);

    // Count is now displayed in the breadcrumb bar, this component only fetches and reports
    return null;
}

function buildPropertyWidthOverwrite(key: string, width: number): PartialCollectionConfig {
    if (key.includes(".")) {
        const [parentKey, ...childKey] = key.split(".");
        return { properties: { [parentKey]: buildPropertyWidthOverwrite(childKey.join("."), width) } } as PartialCollectionConfig;
    }
    return { properties: { [key]: { ui: { columnWidth: width } } } } as PartialCollectionConfig;
}

function EntityIdHeaderWidget({
    collection,
    path,
    idPath
}: {
    collection: CollectionConfig,
    path: string,
    idPath: string
}) {

    const { t } = useTranslation();
    const urlController = useUrlController();
    const [openPopup, setOpenPopup] = React.useState(false);
    const [searchString, setSearchString] = React.useState("");
    const [recentIds, setRecentIds] = React.useState<string[]>(getRecentIds(collection.slug).map(String));
    const sidePanelController = useSidePanel();

    const openEntityMode = collection?.openEntityMode ?? DEFAULT_ENTITY_OPEN_MODE;

    return (
        <Tooltip title={!openPopup ? t("find_by_id") : undefined} asChild={false}>
            <Popover
                open={openPopup}
                onOpenChange={setOpenPopup}
                sideOffset={0}
                align={"start"}
                alignOffset={-117}
                trigger={
                    <IconButton size={"small"}>
                        <SearchIcon size={iconSize.small}/>
                    </IconButton>
                }>
                <div
                    className={cls("my-2 rounded-lg bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-white")}>
                    <form noValidate={true}
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!searchString) return;
                            setOpenPopup(false);
                            const entityId = searchString.trim();
                            setRecentIds(addRecentId(collection.slug, entityId).map(String));
                            navigateToEntity({
                                openEntityMode,
                                collection,
                                entityId,
                                path,

                                sidePanelController,
                                navigation: urlController
                            })
                        }}
                        className={"w-96 max-w-full"}>

                        <div className="flex p-2 w-full gap-2">
                            <TextField
                                autoFocus={openPopup}
                                placeholder={t("find_entity_by_id")}
                                size="small"
                                onChange={(e) => {
                                    setSearchString(e.target.value);
                                }}
                                value={searchString}
                                className="flex-grow"
                                inputClassName={cls("rounded-lg bg-white dark:bg-surface-900", focusedDisabled)}
                            />
                            <Button variant={"text"}
                                disabled={!(searchString.trim())}
                                type={"submit"}
                            ><ArrowRightToLineIcon/></Button>
                        </div>
                    </form>
                    {recentIds && recentIds.length > 0 && <div className="flex flex-col gap-2 p-2">
                        {recentIds.map(id => (
                            <ReferencePreview reference={new EntityReference({ id,
path })}
                                key={id}
                                hover={true}
                                onClick={() => {
                                    setOpenPopup(false);
                                    navigateToEntity({
                                        openEntityMode,
                                        collection,
                                        entityId: id,
                                        path,

                                        sidePanelController,
                                        navigation: urlController
                                    })
                                }}
                                includeEntityLink={false}
                                size={"small"}/>
                        ))}
                    </div>}
                </div>
            </Popover>

        </Tooltip>
    );
}
