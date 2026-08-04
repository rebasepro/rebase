import type { ComponentRef } from "@rebasepro/types";
import type { EntityCustomViewParams, FormViewConfig, AdminCollection } from "@rebasepro/admin-types";
import type { FormContext } from "../types/fields";
import type { PluginFormActionProps } from "@rebasepro/admin-types";
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, EntityStatus, getCollectionDataPath, Property } from "@rebasepro/types";
import { PluginProviderStack, resolveComponentRef, useComponentOverride, CollectionScopeProvider, getAdminEntityChildViews } from "@rebasepro/app";

import { CollectionViewBinding } from "./CollectionViewBinding/CollectionViewBinding";
import { EntityViewBinding } from "./EntityViewBinding";
import { EntityIdentityBar } from "./EntityIdentityBar";
import { SplitListCloseButton } from "./CollectionViewBinding/SplitListCloseButton";
import { SplitListShowButton } from "./CollectionViewBinding/SplitListShowButton";
import { EntityInspector, InspectorTab } from "./EntityInspector";
import { CircularProgressCenter, iconSize } from "@rebasepro/ui";
import {
    Alert,
    Button,
    CenteredView,
    cls,
    CodeIcon,
    defaultBorderMixin,
    HistoryIcon,
    IconButton,
    Maximize2Icon,
    PencilIcon,
    Skeleton,
    Tab,
    Tabs,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { ErrorView, createFormexStub, usePermissions, useTranslation, getIcon } from "@rebasepro/app";

import { removeInitialAndTrailingSlashes, resolveDefaultSelectedView } from "@rebasepro/app";
import { withViewMode } from "../util/view_mode";
import { resolvedSelectedEntityView } from "../util/resolutions";
import {
    useCustomizationController,
    useFetch,
    useRebaseContext,
    useLargeLayout,
    useSlot
} from "@rebasepro/app";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigate } from "react-router";
import { useEntityDisplayTitle } from "../hooks/useEntityDisplayTitle";


import { MAIN_TAB_VALUE, JSON_TAB_VALUE, HISTORY_TAB_VALUE } from "../util/view_constants";

export type BarActionsParams = {
    values: object,
    status: EntityStatus,
    path: string,
    entityId?: string | number;
};

export type OnTabChangeParams<M extends Record<string, unknown>> = {
    path: string;
    entityId?: string | number;
    selectedTab?: string;
    collection: AdminCollection<M>;
};

export interface DetailViewBindingProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    collection: AdminCollection<M>;
    entityId: string | number;
    selectedTab?: string;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    onTabChange?: (props: OnTabChangeParams<M>) => void;
    onEditClick?: () => void;
    layout?: "side_panel" | "full_screen" | "split" | "dialog";
    barActions?: (params: BarActionsParams) => React.ReactNode;
    /**
     * Controls the owning panel puts at the identity bar's leading edge, ahead
     * of the breadcrumb — the side panel's close button.
     */
    barActionsStart?: React.ReactNode;
    /**
     * Full screen only: bring the list back beside this record. Set when the
     * record was opened out of a split collection, so folding the list away is
     * reversible; it takes the place of the back arrow when present.
     */
    onShowList?: () => void;
}

export function DetailViewBinding<M extends Record<string, unknown>>({
    entityId,
    ...props
}: DetailViewBindingProps<M>) {

    const {
        entity,
        dataLoading,
        dataLoadingError
    } = useFetch<M>({
        path: props.path,
        entityId: entityId,
        collection: props.collection,
        useCache: false
    });

    if (!dataLoading && dataLoadingError) {
        return <CenteredView>
            <ErrorView error={dataLoadingError} />
        </CenteredView>;
    }

    if (!dataLoading && !entity) {
        return <CenteredView>
            <Typography variant="label">Entity not found</Typography>
        </CenteredView>;
    }

    const content = (
        <DetailViewBindingInner<M>
            {...props}
            entityId={entityId}
            entity={entity}
            dataLoading={dataLoading}
        />
    );

    return (
        <CollectionScopeProvider collection={props.collection}>
            {content}
        </CollectionScopeProvider>
    );
}

function DetailViewBindingInner<M extends Record<string, unknown>>({
    path,
    entityId,
    selectedTab: selectedTabProp,
    collection,
    parentCollectionSlugs,
    parentEntityIds,
    onTabChange,
    onEditClick,
    entity,
    dataLoading,
    layout = "full_screen",
    barActions,
    barActionsStart,
    onShowList
}: DetailViewBindingProps<M> & {
    entity?: Entity<M>,
    dataLoading: boolean,
}) {
    const ResolvedCollectionView = useComponentOverride("Collection.View", CollectionViewBinding);
    const { t } = useTranslation();
    const context = useRebaseContext();
    const urlController = useUrlController();
    const navigate = useNavigate();
    const customizationController = useCustomizationController();
    const plugins = customizationController.plugins;
    const collectionRegistryController = useCollectionRegistryController();
    const { canEdit: canEditHook } = usePermissions();

    const canEdit = useMemo(() => {
        return entity ? canEditHook(collection, path, entity) : false;
    }, [canEditHook, entity, collection, path]);

    const [usedEntity, setUsedEntity] = useState<Entity<M> | undefined>(entity);
    useEffect(() => {
        if (entity) setUsedEntity(entity);
    }, [entity]);

    const defaultSelectedView = useMemo(() => resolveDefaultSelectedView(
        collection.defaultSelectedView,
        { status: "existing",
entityId }
    ), [collection, entityId]);

    // Track whether the user has explicitly clicked a tab in this component
    // instance. See EditViewBindingInner for full explanation.
    const userHasChangedTab = useRef(false);

    const [selectedTab, setSelectedTab] = useState<string>(() => {
        const val = selectedTabProp ?? defaultSelectedView ?? MAIN_TAB_VALUE;
        return val === "edit" ? MAIN_TAB_VALUE : val;
    });
    useEffect(() => {
        const val = userHasChangedTab.current
            ? (selectedTabProp ?? MAIN_TAB_VALUE)
            : (selectedTabProp ?? defaultSelectedView ?? MAIN_TAB_VALUE);
        const target = val === "edit" ? MAIN_TAB_VALUE : val;
        if (target !== selectedTab) {
            setSelectedTab(target);
        }
    }, [selectedTabProp, defaultSelectedView]);

    const childViews = getAdminEntityChildViews(collection).filter(v => !v.collection.hideFromNavigation);
    const subcollections = childViews.map(v => v.collection);
    const subcollectionsCount = subcollections?.length ?? 0;
    const customViews = collection.entityViews ?? [];
    const customViewsCount = customViews?.length ?? 0;
    const includeJsonView = collection.includeJsonView === undefined ? true : collection.includeJsonView;
    const includeHistoryView = Boolean(collection.history);
    // Same split as the edit view: the strip is for destinations, the inspector
    // for the developer tools that used to sit in front of them.
    const hasAdditionalViews = customViewsCount > 0 || subcollectionsCount > 0;

    const [inspectorTab, setInspectorTab] = useState<InspectorTab | null>(null);

    const legacyInspectorTab: InspectorTab | undefined = selectedTab === JSON_TAB_VALUE
        ? "json"
        : selectedTab === HISTORY_TAB_VALUE ? "history" : undefined;
    useEffect(() => {
        if (legacyInspectorTab) setInspectorTab(legacyInspectorTab);
    }, [legacyInspectorTab]);

    const {
        resolvedEntityViews
    } = resolvedSelectedEntityView(customViews, customizationController, undefined, canEdit);

    const validTabValues = useMemo(() => {
        const set = new Set<string>([
            MAIN_TAB_VALUE,
            ...resolvedEntityViews.map(v => v.key),
            ...subcollections.map(s => s.slug)
        ]);
        return set;
    }, [resolvedEntityViews, subcollections]);

    const activeTab = validTabValues.has(selectedTab) ? selectedTab : MAIN_TAB_VALUE;

    const {
        selectedEntityView
    } = resolvedSelectedEntityView(customViews, customizationController, activeTab, canEdit);

    const mainViewVisible = activeTab === MAIN_TAB_VALUE;

    // Track which custom view tabs have been visited
    const mountedTabsRef = useRef<Set<string>>(new Set());
    if (activeTab) {
        mountedTabsRef.current.add(activeTab);
    }

    // Read-only form context for custom entity views
    const readOnlyFormContext = useMemo<FormContext<M> | undefined>(() => {
        if (!entityId) return undefined;
        const formexStub = createFormexStub<M>(usedEntity?.values ?? {} as M);
        return {
            entityId,
            disabled: true,
            readOnly: true,
            openEntityMode: layout,
            status: "existing",
            values: usedEntity?.values ?? ({} as M),
            setFieldValue: () => {
                throw new Error("Cannot update values in read-only detail view");
            },
            save: () => {
                throw new Error("Cannot save in read-only detail view");
            },
            submit: () => {
                throw new Error("Cannot submit in read-only detail view");
            },
            collection,
            path,
            entity: usedEntity,
            savingError: undefined,
            formex: formexStub
        };
    }, [entityId, layout, usedEntity, collection, path]);

    // Plugin slots
    const formActionTopProps: PluginFormActionProps = useMemo(() => ({
        entityId,
        parentCollectionSlugs,
        parentEntityIds,
        path,
        status: "existing",
        collection: collection!,
        context,
        formContext: readOnlyFormContext as FormContext<Record<string, unknown>> | undefined,
        openEntityMode: layout,
        disabled: true
    }), [entityId, parentCollectionSlugs, parentEntityIds, path, collection, context, readOnlyFormContext, layout]);
    const pluginActionsTop = useSlot("form.actions.top", formActionTopProps);

    // Resolve formView.Builder if provided
    const formViewConfig = (collection as AdminCollection<M> & { formView?: FormViewConfig<M> }).formView;
    const FormViewBuilder = formViewConfig?.Builder ? resolveComponentRef<EntityCustomViewParams>(formViewConfig.Builder as ComponentRef<EntityCustomViewParams>) : null;

    // The heading, resolved the one way — this used to be a copy of
    // `useEntityDisplayTitle`'s body, and the two had already drifted.
    const title = useEntityDisplayTitle({
        collection,
        entity: usedEntity,
        status: "existing"
    });

    // Non-action custom views
    const nonActionCustomViews = useMemo(() =>
        resolvedEntityViews.filter(e => !e.includeActions),
        [resolvedEntityViews]
    );

    const customViewsView = customViews && nonActionCustomViews
        .map((customView) => {
            if (!customView) return null;
            const Builder = resolveComponentRef<EntityCustomViewParams>(customView.Builder);
            if (!Builder) return null;
            if (!entityId) return null;

            const isActive = activeTab === customView.key;
            const hasBeenMounted = mountedTabsRef.current.has(customView.key);
            if (!isActive && !hasBeenMounted) return null;

            return <div
                className={cls(defaultBorderMixin,
                    "relative flex-1 w-full h-full overflow-auto",
                    { "hidden": !isActive }
                )}
                key={`custom_view_${customView.key}`}
                role="tabpanel">
                <ErrorBoundary>
                    <Suspense fallback={<CircularProgressCenter />}>
                        {readOnlyFormContext && <Builder
                            collection={collection}
                            parentCollectionSlugs={parentCollectionSlugs}
                            parentEntityIds={parentEntityIds}
                            entity={usedEntity}
                            modifiedValues={usedEntity?.values}
                            formContext={readOnlyFormContext as FormContext<Record<string, unknown>>}
                        />}
                    </Suspense>
                </ErrorBoundary>
            </div>;
        }).filter(Boolean);

    const globalLoading = dataLoading && !usedEntity;

    // Subcollection views
    const subCollectionsViews = childViews && childViews.map(({ collection: subcollection }) => {
        const subcollectionId = subcollection.slug;
        const newFullPath = usedEntity ? `${path}/${usedEntity?.id}/${removeInitialAndTrailingSlashes(getCollectionDataPath(subcollection))}` : undefined;

        if (activeTab !== subcollectionId) return null;
        return (
            <div
                className={"relative flex-1 h-full overflow-auto w-full"}
                key={`subcol_${subcollectionId}`}
                role="tabpanel">
                {globalLoading && <CircularProgressCenter />}
                {!globalLoading &&
                    (usedEntity && newFullPath
                        ? <ResolvedCollectionView
                            path={newFullPath}
                            parentCollectionSlugs={[...parentCollectionSlugs, collection.slug]}
                            parentEntityIds={[...parentEntityIds, String(usedEntity?.id)]}
                            updateUrl={false}
                            {...subcollection}
                            openEntityMode={layout} />
                        : <div className="flex items-center justify-center w-full h-full p-3">
                            <Typography variant={"label"}>
                                {t("save_entity_before_subcollections") ?? "You need to save your entity before adding additional collections"}
                            </Typography>
                        </div>)
                }
            </div>
        );
    }).filter(Boolean);

    const onSideTabClick = useCallback((value: string) => {
        userHasChangedTab.current = true;
        setSelectedTab(value);
        onTabChange?.({
            path,
            entityId,
            selectedTab: value === MAIN_TAB_VALUE ? undefined : value,
            collection
        });
    }, [onTabChange, path, entityId, collection]);

    const propertyDetailView = () => {
        // formView.Builder replaces the default property display. It gets the
        // centred column the record used to be given here; the default display
        // now lays itself out, rail included.
        if (FormViewBuilder && usedEntity) {
            return <div className={"flex-1 min-w-0 overflow-y-auto flex justify-center items-start"}>
                <div className={cls(
                    "w-full max-w-3xl 2xl:max-w-4xl flex flex-col",
                    layout === "dialog"
                        ? "pt-5 pb-12 px-6 sm:px-8"
                        : "pt-6 pb-16 px-5 sm:px-8"
                )}>
                    <ErrorBoundary>
                        <Suspense fallback={<CircularProgressCenter />}>
                            <FormViewBuilder
                                collection={collection}
                                parentCollectionSlugs={parentCollectionSlugs}
                                parentEntityIds={parentEntityIds}
                                entity={usedEntity}
                                modifiedValues={usedEntity?.values}
                                formContext={readOnlyFormContext as FormContext<Record<string, unknown>>}
                            />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            </div>;
        }

        return (
            <>
                {usedEntity && <EntityViewBinding
                    entity={usedEntity}
                    collection={collection}
                    path={path}
                    asPage
                    openEntityMode={layout}
                    formContext={readOnlyFormContext}
                />}
            </>
        );
    };

    // Tabs
    const subcollectionTabs = subcollections && subcollections.map((subcollection) => {
        const icon = getIcon(subcollection.icon, undefined, undefined, "smallest");
        return (
            <Tab
                className="text-sm min-w-[90px]"
                value={subcollection.slug}
                key={`entity_detail_collection_tab_${subcollection.name}`}>
                <span className="flex items-center gap-1.5">
                    {icon}
                    {subcollection.name}
                </span>
            </Tab>
        );
    });

    const customViewTabsStart = resolvedEntityViews.filter(view => view.position === "start")
        .map((view) => {
            const icon = getIcon(view.icon, undefined, undefined, "smallest");
            return (
                <Tab
                    className={!view.tabComponent ? "text-sm min-w-[90px]" : undefined}
                    value={view.key}
                    key={`entity_detail_collection_tab_${view.name}`}>
                    {view.tabComponent ?? (
                        <span className="flex items-center gap-1.5">
                            {icon}
                            {view.name}
                        </span>
                    )}
                </Tab>
            );
        });
    const customViewTabsEnd = resolvedEntityViews.filter(view => !view.position || view.position === "end")
        .map((view) => {
            const icon = getIcon(view.icon, undefined, undefined, "smallest");
            return (
                <Tab
                    className={!view.tabComponent ? "text-sm min-w-[90px]" : undefined}
                    value={view.key}
                    key={`entity_detail_collection_tab_${view.name}`}>
                    {view.tabComponent ?? (
                        <span className="flex items-center gap-1.5">
                            {icon}
                            {view.name}
                        </span>
                    )}
                </Tab>
            );
        });

    // The breadcrumb's destination, and the back arrow's when it renders. Both
    // keep the view mode: a collection reached from one of its own records must
    // come back as the user left it.
    const collectionUrl = withViewMode(urlController.buildUrlCollectionPath(path));

    // Full screen is the one layout with no way out of its own: a side panel and a
    // dialog can be dismissed, and a split keeps the list beside it, but opening an
    // entity full screen replaces the collection entirely and left browser Back as
    // the only route back to it — which is not an affordance the page shows, and is
    // wrong anyway once the user has moved between tabs inside the entity.
    //
    // Unless the list can be unfolded back beside the record: that chevron
    // leads to the same collection while keeping the record open, so it stands
    // alone rather than beside an arrow going almost the same place.
    //
    // It goes to the bar's leading edge — where a back control reads as back,
    // and where the edit view has always put the same arrow — rather than to
    // the trailing edge among the record's own actions.
    const backToCollection = layout === "full_screen" && !onShowList
        ? () => navigate(collectionUrl)
        : undefined;

    const fullScreenButton = !barActions && // Not in split: the list panel beside it carries the close control,
    // and an expand button there competes with it.
    (layout === "side_panel" || layout === "dialog") && entityId ? (
        <Tooltip title={"Open full screen"}>
            <IconButton
                size="small"
                onClick={() => {
                    const entityUrl = urlController.buildUrlCollectionPath(`${path}/${entityId}`);
                    navigate(`${entityUrl}#full`);
                }}
            >
                <Maximize2Icon size={iconSize.smallest} />
            </IconButton>
        </Tooltip>
    ) : null;

    // Edit button — only rendered when the user has edit permissions
    const editButton = canEdit && onEditClick ? (
        <Button
            variant="filled"
            color="primary"
            size="small"
            startIcon={<PencilIcon size={iconSize.smallest} />}
            onClick={onEditClick}>
            {t("edit_entity")}
        </Button>
    ) : null;

    // Main content view. The title, the `path/id` chip and the empty band under
    // them have moved into the identity bar, and the `w-80 2xl:w-96` rail that
    // held a single Edit button is gone — the bar holds it now.
    //
    // The scroll now lives on the record's own column rather than on this row,
    // so the metadata rail beside it stays put while the record scrolls — the
    // same arrangement the form uses.
    const mainView = <div
        className={cls(
            "flex-1 flex flex-row w-full min-h-0",
            !mainViewVisible ? "hidden" : ""
        )}>
        {propertyDetailView()}
    </div>;

    let result = <div className="relative flex flex-col h-full w-full bg-white dark:bg-surface-800">

        <EntityIdentityBar
            collection={collection as AdminCollection}
            collectionUrl={layout === "full_screen" || layout === "split" ? collectionUrl : undefined}
            title={title}
            entityId={entityId}
            status={"existing"}
            dirty={false}
            saving={false}
            onBack={backToCollection}
            onInspect={includeJsonView ? () => setInspectorTab("json") : undefined}
            onViewHistory={includeHistoryView ? () => setInspectorTab("history") : undefined}
            leading={<>
                {barActionsStart}
                {/* Split view: closing the list is opening this record
                    full screen, and the control for it belongs at this
                    bar's leading edge. Full screen carries its mirror. */}
                {layout === "split" && <SplitListCloseButton/>}
                {layout === "full_screen" && onShowList && <SplitListShowButton onClick={onShowList}/>}
            </>}
            trailing={<>
                {editButton}
                {pluginActionsTop}
                {fullScreenButton}
                {barActions?.({
                    path,
                    entityId,
                    values: usedEntity?.values ?? {},
                    status: "existing"
                })}
            </>}
        />

        {hasAdditionalViews && <div className={cls(
            "h-10 shrink-0 flex items-stretch border-b px-2 min-w-0",
            defaultBorderMixin
        )}>
            <Tabs
                className={"!w-full"}
                innerClassName={"h-full"}
                variant={"boxy"}
                value={activeTab}
                onValueChange={(value) => {
                    onSideTabClick(value);
                }}>

                <Tab value={MAIN_TAB_VALUE}>
                    <span className="flex items-center gap-1.5">
                        {getIcon(collection.icon, undefined, undefined, "smallest")}
                        {collection.singularName ?? collection.name}
                    </span>
                </Tab>

                {customViewTabsStart}
                {customViewTabsEnd}
                {subcollectionTabs}
            </Tabs>
        </div>}

        {/* See EditViewBinding: the inspector docks beside the record rather
            than over it, so the record stays readable and scrollable. */}
        <div className={"flex-1 min-h-0 flex"}>

            <div className={"flex-1 min-w-0 flex flex-col"}>
                {globalLoading
                    ? <DetailViewSkeleton collection={collection} />
                    : mainView}

                {customViewsView}
                {subCollectionsViews}
            </div>

            <EntityInspector
                tab={inspectorTab}
                onTabChange={setInspectorTab}
                onClose={() => setInspectorTab(null)}
                collection={collection as AdminCollection}
                entity={usedEntity as Entity<Record<string, unknown>> | undefined}
                formContext={readOnlyFormContext as FormContext<Record<string, unknown>> | undefined}
                values={usedEntity?.values}
                includeHistory={includeHistoryView}/>
        </div>

    </div>;

    if (plugins && plugins.length > 0) {
        result = (
            <PluginProviderStack
                plugins={plugins}
                scope="form"
                scopeProps={{
                    status: "existing",
                    path,
                    collection,
                    entity: usedEntity,
                    context,
                    formContext: readOnlyFormContext
                }}>
                {result}
            </PluginProviderStack>
        );
    }

    return result;
}

function DetailViewSkeleton({ collection }: { collection: AdminCollection<Record<string, unknown>> }) {
    return (
        <div className="flex-1 flex flex-row w-full overflow-y-auto justify-center">
            <div className="relative flex flex-row max-w-4xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-6xl w-full h-fit">
                <div className="flex flex-col w-full pt-12 pb-16 px-4 sm:px-8 md:px-10">
                    <div className="w-full flex flex-col items-start my-4 lg:my-6">
                        <div className={`py-1 my-4 w-2/3 ${collection.hideIdFromForm ? "mb-6" : ""}`}>
                            <Skeleton height={28} className="w-full rounded-md" />
                        </div>
                        <Skeleton height={32} className="w-full rounded-md" />
                    </div>
                    <div className="mt-12 flex flex-col gap-8">
                        <div className="flex flex-wrap gap-x-4 w-full space-y-8">
                            <div className="relative w-full">
                                <Skeleton height={60} className="w-full rounded-md" />
                            </div>
                            <div className="relative w-full">
                                <Skeleton height={60} className="w-full rounded-md" />
                            </div>
                            <div className="relative w-full">
                                <Skeleton height={60} className="w-full rounded-md" />
                            </div>
                            <div className="relative w-full">
                                <Skeleton height={60} className="w-full rounded-md" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
