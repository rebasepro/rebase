import type { EntityCollection, EntityCustomViewParams } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import type { PluginFormActionProps } from "@rebasepro/types";
import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Entity, EntityStatus } from "@rebasepro/types";
import { PluginProviderStack } from "@rebasepro/core";

import { EntityCollectionView, EntityView } from "../components";
import { CircularProgressCenter, iconSize } from "@rebasepro/ui";
import { CodeIcon, HistoryIcon, Maximize2Icon } from "lucide-react";
import { ErrorBoundary } from "@rebasepro/ui";
import { ErrorView } from "@rebasepro/core";
import {
    getSubcollections,
    removeInitialAndTrailingSlashes,
    resolveDefaultSelectedView
} from "@rebasepro/common";
import { resolvedSelectedEntityView } from "../util/resolutions";
import { getEntityTitlePropertyKey } from "../util/previews";
import { CenteredView, CircularProgress, cls, defaultBorderMixin, IconButton, Tab, Tabs, Tooltip, Typography, Skeleton } from "@rebasepro/ui";
import {
    useCustomizationController,
    useEntityFetch,
    useRebaseContext,
    useLargeLayout,
    useSlot
} from "@rebasepro/core";
import { getEntityFromMemoryCache } from "@rebasepro/core";
import { EntityForm } from "../form";
import type { EntityFormProps, OnUpdateParams } from "../types/components/EntityFormProps";
import { EntityEditViewFormActions } from "./EntityEditViewFormActions";
import { EntityJsonPreview } from "../components/EntityJsonPreview";
// Lazy-load history view — only loaded when user clicks the HistoryIcon tab
const EntityHistoryView = lazy(() => import("../components/history").then(m => ({ default: m.EntityHistoryView })));
import { createFormexStub, getEntityFromCache } from "@rebasepro/core";
import { usePermissions } from "@rebasepro/core";
import { useUrlController } from "../index";
import { useNavigate } from "react-router-dom";

export const MAIN_TAB_VALUE = "__main_##Q$SC^#S6";
export const JSON_TAB_VALUE = "__json";
export const HISTORY_TAB_VALUE = "__rebase_history";

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

export interface EntityEditViewProps<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * The CMS path of the entity, e.g. "users" or "products".
     */
    path: string;
    collection: EntityCollection<M>;
    entityId?: string | number;
    databaseId?: string;
    copy?: boolean;
    selectedTab?: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    onValuesModified?: (modified: boolean, values: M) => void;
    onSaved?: (params: OnUpdateParams) => void;
    onTabChange?: (props: OnTabChangeParams<M>) => void;
    layout?: "side_panel" | "full_screen" | "split";
    barActions?: (params: BarActionsParams) => any;
    formProps?: Partial<EntityFormProps<M>>,
}

/**
 * This is the default view that is used as the content of a side panel when
 * an entity is opened.
 */
export function EntityEditView<M extends Record<string, unknown>>({
    entityId,
    ...props
}: EntityEditViewProps<M>) {

    const {
        entity,
        dataLoading,

        dataLoadingError
    } = useEntityFetch<M>({
        path: props.path,
        entityId: entityId,
        collection: props.collection,
        databaseId: props.databaseId,
        useCache: false
    });

    const initialDirtyValues = entityId
        ? getEntityFromMemoryCache(props.path + "/" + entityId)
        : getEntityFromMemoryCache(props.path + "#new");

    const { canEdit: canEditHook } = usePermissions();

    const initialStatus = props.copy ? "copy" : (entityId ? "existing" : "new");
    const [status, setStatus] = useState<EntityStatus>(initialStatus);

    const canEdit = useMemo(() => {
        if (status === "new" || status === "copy") {
            return true;
        } else {
            return entity ? canEditHook(props.collection, props.path, entity ?? null) : undefined;
        }
    }, [canEditHook, entity, status, props.collection, props.path]);

    if (!dataLoading && dataLoadingError) {
        return <CenteredView>
            <ErrorView error={dataLoadingError} />
        </CenteredView>
    }

    if (!dataLoading && !initialDirtyValues && !entity && (status === "existing" || status === "copy")) {
        console.error(`Entity with id ${entityId} not found in collection ${props.path}`);
        return <CenteredView>
            <Typography variant="label">Entity not found</Typography>
        </CenteredView>;
    }

    return <EntityEditViewInner<M> {...props}
        entityId={entityId}
        entity={entity}
        initialDirtyValues={initialDirtyValues as Partial<M>}
        dataLoading={dataLoading}
        status={status}
        setStatus={setStatus}
        canEdit={canEdit}
    />;
}

export function EntityEditViewInner<M extends Record<string, unknown>>({
    path,
    entityId,
    selectedTab: selectedTabProp,
    collection,
    parentCollectionSlugs, parentEntityIds,
    onValuesModified,
    onSaved,
    onTabChange,
    entity,
    initialDirtyValues,
    dataLoading,
    layout = "side_panel",
    barActions,
    status,
    setStatus,
    formProps,
    canEdit
}: EntityEditViewProps<M> & {
    entity?: Entity<M>,
    initialDirtyValues?: Partial<M>, // dirty cached entity in memory
    dataLoading: boolean,
    status: EntityStatus,
    setStatus: (status: EntityStatus) => void,
    canEdit?: boolean,
}) {

    const context = useRebaseContext();
    const urlController = useUrlController();
    const navigate = useNavigate();

    const [usedEntity, setUsedEntity] = useState<Entity<M> | undefined>(entity);

    useEffect(() => {
        if (entity)
            setUsedEntity(entity);
    }, [entity]);

    const [formContext, setFormContext] = useState<FormContext<M> | undefined>(undefined);

    const largeLayout = useLargeLayout();

    const customizationController = useCustomizationController();
    const plugins = customizationController.plugins;

    const formActionTopProps: PluginFormActionProps = {
        entityId,
        parentCollectionSlugs, parentEntityIds,
        path: path,
        status,
        collection: collection!,
        context,
        formContext: formContext as FormContext<Record<string, unknown>> | undefined,
        openEntityMode: layout,
        disabled: false
    };
    const pluginActionsTop = useSlot("form.actions.top", formActionTopProps);

    const defaultSelectedView = useMemo(() => resolveDefaultSelectedView(
        collection ? collection.defaultSelectedView : undefined,
        {
            status,
            entityId
        }
    ), [collection, status, entityId]);

    const [selectedTab, setSelectedTab] = useState<string>(selectedTabProp ?? defaultSelectedView ?? MAIN_TAB_VALUE);
    useEffect(() => {
        const target = selectedTabProp ?? defaultSelectedView ?? MAIN_TAB_VALUE;
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
        resolvedEntityViews,
        selectedEntityView,
        selectedSecondaryForm
    } = resolvedSelectedEntityView(customViews, customizationController, selectedTab, canEdit);

    const actionsAtTheBottom = layout === "side_panel" || selectedEntityView?.includeActions === "bottom";

    const mainViewVisible = selectedTab === MAIN_TAB_VALUE || Boolean(selectedSecondaryForm);

    const customViewsView: any[] | undefined = customViews && resolvedEntityViews
        .filter(e => !e.includeActions)
        .map((customView) => {

            if (!customView)
                return null;
            const Builder = customView.Builder;
            if (!Builder) {
                console.error("INTERNAL: customView.Builder is not defined");
                return null;
            }

            if (!entityId) {
                return null;
            }

            const formexStub = createFormexStub<M>(usedEntity?.values ?? {} as M);
            const usedFormContext: FormContext<M> = formContext ?? {
                entityId,
                disabled: false,
                openEntityMode: layout,
                status: status,
                values: usedEntity?.values ?? ({} as M),
                setFieldValue: (key: string, value: any) => {
                    throw new Error("You can't update values in read only mode");
                },
                save: () => {
                    throw new Error("You can't save in read only mode");
                },
                collection,
                path: path,
                entity: usedEntity,
                savingError: undefined,
                formex: formexStub
            };

            return <div
                className={cls(defaultBorderMixin,
                    "relative flex-1 w-full h-full overflow-auto",
                    { "hidden": selectedTab !== customView.key }
                )}
                key={`custom_view_${customView.key}`}
                role="tabpanel">
                <ErrorBoundary>
                    {usedFormContext && <Builder
                        collection={collection}
                        parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                        entity={usedEntity}
                        modifiedValues={usedFormContext?.formex?.values ?? usedEntity?.values}
                        formContext={usedFormContext as unknown as FormContext<Record<string, unknown>>}
                    />}
                </ErrorBoundary>
            </div>;
        }).filter(Boolean);

    const globalLoading = (dataLoading && !usedEntity) || (canEdit === undefined && (status === "existing" || status === "copy"));

    const jsonView = <div
        className={cls("relative flex-1 h-full overflow-auto w-full",
            { "hidden": selectedTab !== JSON_TAB_VALUE })}
        key={"json_view"}
        role="tabpanel">
        <ErrorBoundary>
            <EntityJsonPreview
                values={formContext?.values ?? entity?.values ?? {}} />
        </ErrorBoundary>
    </div>;

    const historyView = includeHistoryView ? <div
        className={cls("relative flex-1 h-full overflow-auto w-full",
            { "hidden": selectedTab !== HISTORY_TAB_VALUE })}
        key={"history_view"}
        role="tabpanel">
        <ErrorBoundary>
            <Suspense fallback={<CircularProgressCenter />}>
                <EntityHistoryView
                    collection={collection}
                    entity={usedEntity}
                    formContext={formContext as FormContext<Record<string, unknown>>}
                    modifiedValues={formContext?.values ?? usedEntity?.values}
                />
            </Suspense>
        </ErrorBoundary>
    </div> : null;

    const subCollectionsViews = subcollections && subcollections.map((subcollection) => {
        const subcollectionId = subcollection.slug;
        const newFullPath = usedEntity ? `${path}/${usedEntity?.id}/${removeInitialAndTrailingSlashes(subcollection.slug)}` : undefined;

        if (selectedTab !== subcollectionId) return null;
        return (
            <div
                className={"relative flex-1 h-full overflow-auto w-full"}
                key={`subcol_${subcollectionId}`}
                role="tabpanel">

                {globalLoading && <CircularProgressCenter />}

                {!globalLoading &&
                    (usedEntity && newFullPath
                        ? <EntityCollectionView
                            path={newFullPath}
                            parentCollectionSlugs={[...parentCollectionSlugs, collection.slug]}
                            parentEntityIds={[...parentEntityIds, String(usedEntity?.id)]}
                            updateUrl={false}
                            {...subcollection}
                            openEntityMode={layout} />
                        : <div className="flex items-center justify-center w-full h-full p-3">
                            <Typography variant={"label"}>
                                You need to save your entity before
                                adding additional collections
                            </Typography>
                        </div>)
                }

            </div>
        );
    }).filter(Boolean);

    const onSideTabClick = (value: string) => {
        setSelectedTab(value);
        if (status === "existing") {
            onTabChange?.({
                path: path,
                entityId,
                selectedTab: value === MAIN_TAB_VALUE ? undefined : value,
                collection
            });
        }
    };

    const entityReadOnlyView = !canEdit && entity ? <div
        className={cls("flex-1 flex flex-row w-full overflow-y-auto justify-center", (canEdit || !mainViewVisible || selectedSecondaryForm) ? "hidden" : "")}>
        <div
            className={cls("relative flex flex-col max-w-4xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-6xl w-full h-fit")}>
            <Typography className={"mt-16 mb-8 mx-8"} variant={"h4"}>
                {collection.singularName ?? collection.name}
            </Typography>
            <EntityView
                className={"px-8 h-full overflow-auto"}
                entity={entity}
                path={path}
                collection={collection} />
            <div className="h-16" />
        </div>
    </div> : null;

    const entityView = <EntityForm<M>
        collection={collection}
        path={path}
        entityId={entityId ?? usedEntity?.id}
        onValuesModified={onValuesModified}
        entity={entity}
        initialDirtyValues={initialDirtyValues}
        openEntityMode={layout}
        forceActionsAtTheBottom={actionsAtTheBottom}
        initialStatus={status}
        className={cls((!mainViewVisible || !canEdit) && !selectedSecondaryForm ? "hidden" : "", formProps?.className)}
        EntityFormActionsComponent={EntityEditViewFormActions}
        disabled={!canEdit}
        {...formProps}
        onEntityChange={(entity) => {
            setUsedEntity(entity);
            formProps?.onEntityChange?.(entity);
        }}
        onStatusChange={(status) => {
            setStatus(status);
            formProps?.onStatusChange?.(status);
        }}
        onFormContextReady={(formContext) => {
            setFormContext(formContext);
            formProps?.onFormContextReady?.(formContext);
        }}
        onSaved={(params) => {
            const res = {
                ...params,
                selectedTab: MAIN_TAB_VALUE === selectedTab ? undefined : selectedTab
            };
            onSaved?.(res);
            formProps?.onSaved?.(res);
        }}
        Builder={selectedSecondaryForm?.Builder as React.ComponentType<EntityCustomViewParams<M>> | undefined}
    />;

    const subcollectionTabs = subcollections && subcollections.map((subcollection) =>
        <Tab
            className="text-sm min-w-[90px]"
            value={subcollection.slug}
            key={`entity_detail_collection_tab_${subcollection.name}`}>
            {subcollection.name}
        </Tab>
    );

    const customViewTabsStart = resolvedEntityViews.filter(view => view.position === "start")
        .map((view) =>
            <Tab
                className={!view.tabComponent ? "text-sm min-w-[90px]" : undefined}
                value={view.key}
                key={`entity_detail_collection_tab_${view.name}`}>
                {view.tabComponent ?? view.name}
            </Tab>
        );
    const customViewTabsEnd = resolvedEntityViews.filter(view => !view.position || view.position === "end")
        .map((view) =>
            <Tab
                className={!view.tabComponent ? "text-sm min-w-[90px]" : undefined}
                value={view.key}
                key={`entity_detail_collection_tab_${view.name}`}>
                {view.tabComponent ?? view.name}
            </Tab>
        );

    const shouldShowTopBar = Boolean(barActions) || hasAdditionalViews || layout === "side_panel";

    const fullScreenButton = !barActions && (layout === "side_panel" || layout === "split") && entityId ? (
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

    // Compute contextual title for subcollection tabs, e.g. "Orders of James"
    const subcollectionContextTitle = useMemo(() => {
        if (selectedTab === MAIN_TAB_VALUE || selectedTab === JSON_TAB_VALUE || selectedTab === HISTORY_TAB_VALUE) {
            return null;
        }
        // Check if the selected tab is a subcollection
        const matchedSubcollection = subcollections.find(sc => sc.slug === selectedTab);
        if (!matchedSubcollection) {
            return null;
        }
        // Check if the selected tab is a custom view (not a subcollection)
        const isCustomView = resolvedEntityViews.some(v => v.key === selectedTab);
        if (isCustomView) {
            return null;
        }
        // Resolve the parent entity's title
        const titleKey = getEntityTitlePropertyKey(collection, customizationController.propertyConfigs);
        const entityValues = usedEntity?.values;
        if (!titleKey || !entityValues) {
            return matchedSubcollection.name;
        }
        const titleValue = entityValues[titleKey as keyof M];
        if (!titleValue || typeof titleValue !== "string") {
            return matchedSubcollection.name;
        }
        return `${matchedSubcollection.name} of ${titleValue}`;
    }, [selectedTab, subcollections, resolvedEntityViews, collection, customizationController.propertyConfigs, usedEntity?.values]);

    let result = <div className="relative flex flex-col h-full w-full bg-white dark:bg-surface-800">

        {shouldShowTopBar && <div
            className={cls("h-[52px] items-center flex overflow-hidden w-full border-b pl-2 pr-2 flex bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>

            {fullScreenButton}

            {barActions?.({
                path,
                entityId,
                values: formContext?.values ?? usedEntity?.values ?? {},
                status
            })}

            {subcollectionContextTitle && (
                <Typography
                    variant="label"
                    className="truncate min-w-0 shrink ml-2 text-surface-600 dark:text-surface-400"
                >
                    {subcollectionContextTitle}
                </Typography>
            )}

            {pluginActionsTop}

            {hasAdditionalViews && <div className={"flex-1 flex justify-end min-w-0 shrink-0"}>
                <Tabs
                    className={"!w-fit max-w-full"}
                    value={selectedTab}
                    onValueChange={(value) => {
                        onSideTabClick(value);
                    }}>

                    {includeJsonView && <Tab
                        disabled={!hasAdditionalViews}
                        value={JSON_TAB_VALUE}
                        className={"text-sm"}>
                        <CodeIcon size={iconSize.small} />
                    </Tab>}

                    {includeHistoryView && <Tab
                        disabled={!hasAdditionalViews}
                        value={HISTORY_TAB_VALUE}
                        className={"text-sm"}>
                        <HistoryIcon size={iconSize.small} />
                    </Tab>}

                    <Tab
                        disabled={!hasAdditionalViews}
                        value={MAIN_TAB_VALUE}
                        className={"text-sm min-w-[90px]"}>
                        {collection.singularName ?? collection.name}
                    </Tab>

                    {customViewTabsStart}

                    {customViewTabsEnd}

                    {subcollectionTabs}
                </Tabs>
            </div>}
        </div>}

        {globalLoading
            ? <EntityFormSkeleton collection={collection} />
            : <>
                {entityReadOnlyView}
                {entityView}
            </>}

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
                    status,
                    path,
                    collection,
                    entity: usedEntity,
                    context,
                    formContext
                }}>
                {result}
            </PluginProviderStack>
        );
    }

    return result;
}

function EntityFormSkeleton({ collection }: { collection: EntityCollection<any> }) {
    return (
        <div className="flex-1 flex flex-row w-full overflow-y-auto justify-center">
            <div className="relative flex flex-row max-w-4xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-6xl w-full h-fit">
                <div className="flex flex-col w-full pt-12 pb-16 px-4 sm:px-8 md:px-10">

                    <div className="flex flex-row gap-4 self-end sticky top-4 z-10">
                        <Skeleton height={24} className="w-8 rounded-full" />
                    </div>

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

