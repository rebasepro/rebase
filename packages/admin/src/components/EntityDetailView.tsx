import type { ComponentRef, EntityCollection, EntityCustomViewParams, FormViewConfig } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import type { PluginFormActionProps } from "@rebasepro/types";
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, EntityStatus, getCollectionDataPath, Property } from "@rebasepro/types";
import { PluginProviderStack, resolveComponentRef, useComponentOverride, CollectionComponentOverrideProvider } from "@rebasepro/core";

import { EntityCollectionView, EntityView } from "../components";
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
import { ErrorView, createFormexStub, usePermissions, useTranslation, getIcon } from "@rebasepro/core";
import {
    getSubcollections,
    removeInitialAndTrailingSlashes,
    resolveDefaultSelectedView
} from "@rebasepro/common";
import { resolvedSelectedEntityView } from "../util/resolutions";
import {
    useCustomizationController,
    useEntityFetch,
    useRebaseContext,
    useLargeLayout,
    useSlot
} from "@rebasepro/core";
import { useUrlController, useCollectionRegistryController } from "../index";
import { useNavigate } from "react-router-dom";
import { getValueInPath } from "@rebasepro/utils";
import { getEntityTitlePropertyKey, resolveTitleToString } from "../util/previews";
import { EntityJsonPreview } from "../components/EntityJsonPreview";

const EntityHistoryView = lazy(() => import("../components/history").then(m => ({ default: m.EntityHistoryView })));

import { MAIN_TAB_VALUE, JSON_TAB_VALUE, HISTORY_TAB_VALUE } from "../util/entity_view_constants";

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
    collection: EntityCollection<M>;
};

export interface EntityDetailViewProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    collection: EntityCollection<M>;
    entityId: string | number;
    selectedTab?: string;
    parentCollectionSlugs: string[];
    parentEntityIds: string[];
    onTabChange?: (props: OnTabChangeParams<M>) => void;
    onEditClick?: () => void;
    layout?: "side_panel" | "full_screen" | "split" | "dialog";
    barActions?: (params: BarActionsParams) => React.ReactNode;
}

export function EntityDetailView<M extends Record<string, unknown>>({
    entityId,
    ...props
}: EntityDetailViewProps<M>) {

    const {
        entity,
        dataLoading,
        dataLoadingError
    } = useEntityFetch<M>({
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
        <EntityDetailViewInner<M>
            {...props}
            entityId={entityId}
            entity={entity}
            dataLoading={dataLoading}
        />
    );

    if (props.collection.components) {
        return (
            <CollectionComponentOverrideProvider overrides={props.collection.components}>
                {content}
            </CollectionComponentOverrideProvider>
        );
    }
    return content;
}

function EntityDetailViewInner<M extends Record<string, unknown>>({
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
    barActions
}: EntityDetailViewProps<M> & {
    entity?: Entity<M>,
    dataLoading: boolean,
}) {
    const ResolvedCollectionView = useComponentOverride("Collection.View", EntityCollectionView);
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
    // instance. See EntityEditViewInner for full explanation.
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

    const subcollections = getSubcollections(collection).filter(c => !c.hideFromNavigation);
    const subcollectionsCount = subcollections?.length ?? 0;
    const customViews = collection.entityViews ?? [];
    const customViewsCount = customViews?.length ?? 0;
    const includeJsonView = collection.includeJsonView === undefined ? true : collection.includeJsonView;
    const includeHistoryView = Boolean(collection.history);
    const hasAdditionalViews = customViewsCount > 0 || subcollectionsCount > 0 || includeJsonView || includeHistoryView;

    const {
        resolvedEntityViews
    } = resolvedSelectedEntityView(customViews, customizationController, undefined, canEdit);

    const validTabValues = useMemo(() => {
        const set = new Set<string>([
            MAIN_TAB_VALUE,
            ...(includeJsonView ? [JSON_TAB_VALUE] : []),
            ...(includeHistoryView ? [HISTORY_TAB_VALUE] : []),
            ...resolvedEntityViews.map(v => v.key),
            ...subcollections.map(s => s.slug)
        ]);
        return set;
    }, [includeJsonView, includeHistoryView, resolvedEntityViews, subcollections]);

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
    const formViewConfig = (collection as EntityCollection<M> & { formView?: FormViewConfig<M> }).formView;
    const FormViewBuilder = formViewConfig?.Builder ? resolveComponentRef<EntityCustomViewParams>(formViewConfig.Builder as ComponentRef<EntityCustomViewParams>) : null;

    // Title resolution
    const titlePropertyKey = getEntityTitlePropertyKey(collection, customizationController.propertyConfigs);
    const rawTitle = usedEntity?.values && titlePropertyKey ? getValueInPath(usedEntity.values, titlePropertyKey) : undefined;
    const title = rawTitle !== undefined && rawTitle !== null
        ? resolveTitleToString(rawTitle)
        : (collection.singularName ?? collection.name);

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

    // JSON view
    const jsonTabMounted = mountedTabsRef.current.has(JSON_TAB_VALUE);
    const jsonView = (activeTab === JSON_TAB_VALUE || jsonTabMounted) ? <div
        className={cls("relative flex-1 h-full overflow-auto w-full",
            { "hidden": activeTab !== JSON_TAB_VALUE })}
        key={"json_view"}
        role="tabpanel">
        <ErrorBoundary>
            <EntityJsonPreview values={usedEntity?.values ?? {}} />
        </ErrorBoundary>
    </div> : null;

    // History view
    const historyView = includeHistoryView && activeTab === HISTORY_TAB_VALUE ? <div
        className={"relative flex-1 h-full overflow-auto w-full"}
        key={"history_view"}
        role="tabpanel">
        <ErrorBoundary>
            <Suspense fallback={<CircularProgressCenter />}>
                <EntityHistoryView
                    collection={collection}
                    entity={usedEntity}
                    formContext={readOnlyFormContext as FormContext<Record<string, unknown>>}
                    modifiedValues={usedEntity?.values}
                />
            </Suspense>
        </ErrorBoundary>
    </div> : null;

    // Subcollection views
    const subCollectionsViews = subcollections && subcollections.map((subcollection) => {
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
        // formView.Builder replaces the default property display
        if (FormViewBuilder && usedEntity) {
            return <ErrorBoundary>
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
            </ErrorBoundary>;
        }

        return (
            <>
                {usedEntity && <EntityView
                    entity={usedEntity}
                    collection={collection}
                    path={path}
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

    const shouldShowTopBar = Boolean(barActions) || hasAdditionalViews || layout === "side_panel" || layout === "dialog";

    const fullScreenButton = !barActions && (layout === "side_panel" || layout === "split" || layout === "dialog") && entityId ? (
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

    // Main content view with title and properties
    const mainView = <div
        className={cls(
            "flex-1 flex flex-row w-full overflow-y-auto justify-center",
            !mainViewVisible ? "hidden" : ""
        )}>
        <div
            className={cls("relative flex flex-row max-w-4xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-6xl w-full h-fit")}>
            <div className={cls(
                "flex flex-col w-full",
                layout === "dialog"
                    ? "pt-4 pb-12 px-6 sm:px-8"
                    : "pt-12 pb-16 px-4 sm:px-8 md:px-10"
            )}>
                {/* Title and entity path */}
                <div className={"w-full flex flex-col items-start my-4 lg:my-6"}>
                    <div className="flex items-center justify-between w-full">
                        <Typography
                            className={cls("my-4 grow line-clamp-1", collection.hideIdFromForm ? "mb-6" : "")}
                            variant={"h4"}>
                            {title}
                        </Typography>
                        {editButton}
                    </div>

                    <Alert color={"base"} outerClassName={"w-full"} size={"small"}>
                        <code
                            className={"text-xs select-all text-text-secondary dark:text-text-secondary-dark"}>
                            {usedEntity?.path ?? path}/{entityId}
                        </code>
                    </Alert>
                </div>

                {/* Property detail display */}
                <div className="mt-12 flex flex-col gap-8">
                    {propertyDetailView()}
                </div>

                <div className="h-16" />
            </div>

            {/* Side action bar for large screens */}
            {canEdit && onEditClick && layout === "full_screen" && <div
                className={cls(
                    "overflow-auto h-full hidden @6xl:flex flex-col gap-2 w-80 2xl:w-96 px-4 py-16 sticky top-0 border-l",
                    defaultBorderMixin
                )}>
                <Button
                    fullWidth={true}
                    variant="filled"
                    color="primary"
                    startIcon={<PencilIcon size={iconSize.small} />}
                    onClick={onEditClick}>
                    {t("edit_entity")}
                </Button>
            </div>}
        </div>
    </div>;

    let result = <div className="relative flex flex-col h-full w-full bg-white dark:bg-surface-800">

        {shouldShowTopBar && <div
            className={cls("h-[52px] items-center flex overflow-hidden w-full border-b pl-2 pr-2 flex bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>

            {fullScreenButton}

            {barActions?.({
                path,
                entityId,
                values: usedEntity?.values ?? {},
                status: "existing"
            })}

            {pluginActionsTop}

            {hasAdditionalViews && <div className={"flex-1 flex justify-end min-w-0 shrink-0"}>
                <Tabs
                    className={"!w-fit max-w-full"}
                    value={activeTab}
                    onValueChange={(value) => {
                        onSideTabClick(value);
                    }}>

                    {includeJsonView && <Tab
                        disabled={!hasAdditionalViews}
                        value={JSON_TAB_VALUE}
                        className={"text-sm"}>
                        <CodeIcon size={iconSize.smallest} />
                    </Tab>}

                    {includeHistoryView && <Tab
                        disabled={!hasAdditionalViews}
                        value={HISTORY_TAB_VALUE}
                        className={"text-sm"}>
                        <HistoryIcon size={iconSize.smallest} />
                    </Tab>}

                    <Tab
                        disabled={!hasAdditionalViews}
                        value={MAIN_TAB_VALUE}
                        className={"text-sm min-w-[90px]"}>
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
        </div>}

        {globalLoading
            ? <DetailViewSkeleton collection={collection} />
            : mainView}

        {jsonView}
        {historyView}
        {customViewsView}
        {subCollectionsViews}

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

function DetailViewSkeleton({ collection }: { collection: EntityCollection<Record<string, unknown>> }) {
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
