import type { ComponentRef, SnapshotCollection, SnapshotCustomViewParams, FormViewConfig } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import type { PluginFormActionProps } from "@rebasepro/types";
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Snapshot, SnapshotStatus, getCollectionDataPath } from "@rebasepro/types";
import { PluginProviderStack, resolveComponentRef, useComponentOverride, CollectionComponentOverrideProvider } from "@rebasepro/core";

import { SnapshotCollectionView, SnapshotView } from "../components";
import { CircularProgressCenter, iconSize } from "@rebasepro/ui";
import {
    CenteredView,
    CircularProgress,
    cls,
    CodeIcon,
    defaultBorderMixin,
    HistoryIcon,
    IconButton,
    Maximize2Icon,
    Skeleton,
    Tab,
    Tabs,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { ErrorView } from "@rebasepro/core";
import {
    getSubcollections,
    removeInitialAndTrailingSlashes,
    resolveDefaultSelectedView
} from "@rebasepro/common";
import { resolvedSelectedSnapshotView } from "../util/resolutions";
import {
    useCustomizationController,
    useSnapshotFetch,
    useRebaseContext,
    useLargeLayout,
    useSlot,
    getIcon
} from "@rebasepro/core";
import { getSnapshotFromMemoryCache } from "@rebasepro/core";
import { SnapshotFormBinding } from "../form";
import type { SnapshotFormBindingProps } from "../form";
import type { OnUpdateParams } from "../types/components/SnapshotFormProps";
import { SnapshotEditViewFormActions } from "./SnapshotEditViewFormActions";
import { SnapshotJsonPreview } from "../components/SnapshotJsonPreview";
// Lazy-load history view — only loaded when user clicks the HistoryIcon tab
const SnapshotHistoryView = lazy(() => import("../components/history").then(m => ({ default: m.SnapshotHistoryView })));
import { createFormexStub, getSnapshotFromCache } from "@rebasepro/core";
import { usePermissions } from "@rebasepro/core";
import { useUrlController } from "../index";
import { useNavigate } from "react-router-dom";

import { MAIN_TAB_VALUE, JSON_TAB_VALUE, HISTORY_TAB_VALUE } from "../util/snapshot_view_constants";
export { MAIN_TAB_VALUE, JSON_TAB_VALUE, HISTORY_TAB_VALUE };

export type BarActionsParams = {
    values: object,
    status: SnapshotStatus,
    path: string,
    snapshotId?: string | number;
};

export type OnTabChangeParams<M extends Record<string, unknown>> = {
    path: string;
    snapshotId?: string | number;
    selectedTab?: string;
    collection: SnapshotCollection<M>;

};

export interface SnapshotEditViewProps<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * The CMS path of the snapshot, e.g. "users" or "products".
     */
    path: string;
    collection: SnapshotCollection<M>;
    snapshotId?: string | number;
    databaseId?: string;
    copy?: boolean;
    selectedTab?: string;
    parentCollectionSlugs: string[], parentSnapshotIds: string[];
    onValuesModified?: (modified: boolean, values: M) => void;
    onSaved?: (params: OnUpdateParams) => void;
    onTabChange?: (props: OnTabChangeParams<M>) => void;
    navigateBack?: () => void;
    layout?: "side_panel" | "full_screen" | "split" | "dialog";
    barActions?: (params: BarActionsParams) => React.ReactNode;
    formProps?: Partial<SnapshotFormBindingProps<M>>,
    /**
     * Pre-populate the form with these values when creating a new snapshot.
     * Only applied when the form is in "new" mode (no snapshotId).
     * Sourced from SnapshotSidePanelProps (side panel) or location.state (full screen).
     */
    defaultValues?: Partial<M>;
}

/**
 * This is the default view that is used as the content of a side panel when
 * a snapshot is opened.
 */
export function SnapshotEditView<M extends Record<string, unknown>>({
    snapshotId,
    ...props
}: SnapshotEditViewProps<M>) {

    const {
        snapshot,
        dataLoading,

        dataLoadingError
    } = useSnapshotFetch<M>({
        path: props.path,
        snapshotId: snapshotId,
        collection: props.collection,
        databaseId: props.databaseId,
        useCache: false
    });

    const initialDirtyValues = snapshotId
        ? getSnapshotFromMemoryCache(props.path + "/" + snapshotId)
        : (props.defaultValues ?? getSnapshotFromMemoryCache(props.path + "#new"));

    const { canEdit: canEditHook } = usePermissions();

    const initialStatus = props.copy ? "copy" : (snapshotId ? "existing" : "new");
    const [status, setStatus] = useState<SnapshotStatus>(initialStatus);

    const canEdit = useMemo(() => {
        if (status === "new" || status === "copy") {
            return true;
        } else {
            return snapshot ? canEditHook(props.collection, props.path, snapshot ?? null) : undefined;
        }
    }, [canEditHook, snapshot, status, props.collection, props.path]);

    if (!dataLoading && dataLoadingError) {
        return <CenteredView>
            <ErrorView error={dataLoadingError} />
        </CenteredView>
    }

    if (!dataLoading && !initialDirtyValues && !snapshot && (status === "existing" || status === "copy")) {
        console.error(`Snapshot with id ${snapshotId} not found in collection ${props.path}`);
        return <CenteredView>
            <Typography variant="label">Snapshot not found</Typography>
        </CenteredView>;
    }

    const content = (
        <SnapshotEditViewInner<M> {...props}
            snapshotId={snapshotId}
            snapshot={snapshot}
            initialDirtyValues={initialDirtyValues as Partial<M>}
            dataLoading={dataLoading}
            status={status}
            setStatus={setStatus}
            canEdit={canEdit}
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

export function SnapshotEditViewInner<M extends Record<string, unknown>>({
    path,
    snapshotId,
    selectedTab: selectedTabProp,
    collection,
    parentCollectionSlugs, parentSnapshotIds,
    onValuesModified,
    onSaved,
    onTabChange,
    navigateBack,
    snapshot,
    initialDirtyValues,
    dataLoading,
    layout = "side_panel",
    barActions,
    status,
    setStatus,
    formProps,
    canEdit
}: SnapshotEditViewProps<M> & {
    snapshot?: Snapshot<M>,
    initialDirtyValues?: Partial<M>, // dirty cached snapshot in memory
    dataLoading: boolean,
    status: SnapshotStatus,
    setStatus: (status: SnapshotStatus) => void,
    canEdit?: boolean,
}) {

    const ResolvedFormActions = useComponentOverride("Snapshot.FormActions", SnapshotEditViewFormActions);
    const ResolvedSnapshotForm = useComponentOverride("Snapshot.Form", SnapshotFormBinding) as typeof SnapshotFormBinding;
    const ResolvedCollectionView = useComponentOverride("Collection.View", SnapshotCollectionView);

    const context = useRebaseContext();
    const urlController = useUrlController();
    const navigate = useNavigate();

    const [usedSnapshot, setUsedSnapshot] = useState<Snapshot<M> | undefined>(snapshot);

    useEffect(() => {
        if (snapshot)
            setUsedSnapshot(snapshot);
    }, [snapshot]);

    const [formContext, setFormContext] = useState<FormContext<M> | undefined>(undefined);

    const largeLayout = useLargeLayout();

    const customizationController = useCustomizationController();
    const plugins = customizationController.plugins;

    const formActionTopProps: PluginFormActionProps = useMemo(() => ({
        snapshotId,
        parentCollectionSlugs,
parentSnapshotIds,
        path: path,
        status,
        collection: collection!,
        context,
        formContext: formContext as FormContext<Record<string, unknown>> | undefined,
        openSnapshotMode: layout,
        disabled: false
    }), [snapshotId, parentCollectionSlugs, parentSnapshotIds, path, status, collection, context, formContext, layout]);
    const pluginActionsTop = useSlot("form.actions.top", formActionTopProps);

    const defaultSelectedView = useMemo(() => resolveDefaultSelectedView(
        collection ? collection.defaultSelectedView : undefined,
        {
            status,
            snapshotId
        }
    ), [collection, status, snapshotId]);

    // Track whether the user has explicitly clicked a tab in this component
    // instance. When false, we fall back to defaultSelectedView (which may
    // resolve asynchronously if the collection loads from the registry after
    // mount). Once true, selectedTabProp=undefined means the user selected
    // the form tab, so we must NOT re-apply defaultSelectedView.
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
    const customViews = collection.snapshotViews ?? [];
    const customViewsCount = customViews?.length ?? 0;
    const includeJsonView = collection.includeJsonView === undefined ? true : collection.includeJsonView;
    const includeHistoryView = Boolean(collection.history);
    const hasAdditionalViews = customViewsCount > 0 || subcollectionsCount > 0 || includeJsonView || includeHistoryView;

    const {
        resolvedSnapshotViews
    } = resolvedSelectedSnapshotView(customViews, customizationController, undefined, canEdit);

    const validTabValues = useMemo(() => {
        const set = new Set<string>([
            MAIN_TAB_VALUE,
            ...(includeJsonView ? [JSON_TAB_VALUE] : []),
            ...(includeHistoryView ? [HISTORY_TAB_VALUE] : []),
            ...resolvedSnapshotViews.map(v => v.key),
            ...subcollections.map(s => s.slug)
        ]);
        return set;
    }, [includeJsonView, includeHistoryView, resolvedSnapshotViews, subcollections]);

    const activeTab = validTabValues.has(selectedTab) ? selectedTab : MAIN_TAB_VALUE;

    const {
        selectedSnapshotView,
        selectedSecondaryForm
    } = resolvedSelectedSnapshotView(customViews, customizationController, activeTab, canEdit);

    const actionsAtTheBottom = layout === "side_panel" || layout === "dialog" || selectedSnapshotView?.includeActions === "bottom";

    const mainViewVisible = activeTab === MAIN_TAB_VALUE || Boolean(selectedSecondaryForm);

    // Track which custom view tabs have been visited so we keep them mounted
    // (preserving their state) but don't eagerly mount tabs never visited.
    const mountedTabsRef = useRef<Set<string>>(new Set());
    if (activeTab) {
        mountedTabsRef.current.add(activeTab);
    }

    // Memoize the read-only fallback form context to avoid recreating it every render
    const readOnlyFormContext = useMemo<FormContext<M> | undefined>(() => {
        if (formContext) return undefined; // not needed when real formContext exists
        if (!snapshotId) return undefined;
        const formexStub = createFormexStub<M>(usedSnapshot?.values ?? {} as M);
        return {
            snapshotId,
            disabled: false,
            readOnly: true,
            openSnapshotMode: layout,
            status: status,
            values: usedSnapshot?.values ?? ({} as M),
            setFieldValue: (key: string, value: unknown) => {
                throw new Error("You can't update values in read only mode");
            },
            save: () => {
                throw new Error("You can't save in read only mode");
            },
            submit: () => {
                throw new Error("You can't submit in read only mode");
            },
            collection,
            path: path,
            snapshot: usedSnapshot,
            savingError: undefined,
            formex: formexStub
        };
    }, [formContext, snapshotId, layout, status, usedSnapshot, collection, path]);

    const nonActionCustomViews = useMemo(() =>
        resolvedSnapshotViews.filter(e => !e.includeActions),
        [resolvedSnapshotViews]
    );

    const customViewsView: React.ReactNode[] | undefined = customViews && nonActionCustomViews
        .map((customView) => {

            if (!customView)
                return null;
            const Builder = resolveComponentRef<SnapshotCustomViewParams>(customView.Builder);
            if (!Builder) {
                console.error("INTERNAL: customView.Builder is not defined or could not be resolved");
                return null;
            }

            if (!snapshotId) {
                return null;
            }

            // Only mount tabs that have been visited at least once
            const isActive = activeTab === customView.key;
            const hasBeenMounted = mountedTabsRef.current.has(customView.key);
            if (!isActive && !hasBeenMounted) {
                return null;
            }

            const usedFormContext: FormContext<M> = formContext ?? readOnlyFormContext!;

            return <div
                className={cls(defaultBorderMixin,
                    "relative flex-1 w-full h-full overflow-auto",
                    { "hidden": !isActive }
                )}
                key={`custom_view_${customView.key}`}
                role="tabpanel">
                <ErrorBoundary>
                    <Suspense fallback={<CircularProgressCenter />}>
                        {usedFormContext && <Builder
                            collection={collection}
                            parentCollectionSlugs={parentCollectionSlugs} parentSnapshotIds={parentSnapshotIds}
                            snapshot={usedSnapshot}
                            modifiedValues={usedFormContext?.formex?.values ?? usedSnapshot?.values}
                            formContext={usedFormContext as FormContext<Record<string, unknown>>}
                        />}
                    </Suspense>
                </ErrorBoundary>
            </div>;
        }).filter(Boolean);

    const globalLoading = (dataLoading && !usedSnapshot) || (canEdit === undefined && (status === "existing" || status === "copy"));

    // Only mount JSON view when its tab is selected (or was previously selected)
    const jsonTabMounted = mountedTabsRef.current.has(JSON_TAB_VALUE);
    const jsonView = (activeTab === JSON_TAB_VALUE || jsonTabMounted) ? <div
        className={cls("relative flex-1 h-full overflow-auto w-full",
            { "hidden": activeTab !== JSON_TAB_VALUE })}
        key={"json_view"}
        role="tabpanel">
        <ErrorBoundary>
            <SnapshotJsonPreview
                values={formContext?.values ?? snapshot?.values ?? {}} />
        </ErrorBoundary>
    </div> : null;

    // Only mount history view when its tab is actually selected
    const historyView = includeHistoryView && activeTab === HISTORY_TAB_VALUE ? <div
        className={"relative flex-1 h-full overflow-auto w-full"}
        key={"history_view"}
        role="tabpanel">
        <ErrorBoundary>
            <Suspense fallback={<CircularProgressCenter />}>
                <SnapshotHistoryView
                    collection={collection}
                    snapshot={usedSnapshot}
                    formContext={formContext as FormContext<Record<string, unknown>>}
                    modifiedValues={formContext?.values ?? usedSnapshot?.values}
                />
            </Suspense>
        </ErrorBoundary>
    </div> : null;

    const subCollectionsViews = subcollections && subcollections.map((subcollection) => {
        const subcollectionId = subcollection.slug;
        const newFullPath = usedSnapshot ? `${path}/${usedSnapshot?.id}/${removeInitialAndTrailingSlashes(getCollectionDataPath(subcollection))}` : undefined;

        if (activeTab !== subcollectionId) return null;
        return (
            <div
                className={"relative flex-1 h-full overflow-auto w-full"}
                key={`subcol_${subcollectionId}`}
                role="tabpanel">

                {globalLoading && <CircularProgressCenter />}

                {!globalLoading &&
                    (usedSnapshot && newFullPath
                        ? <ResolvedCollectionView
                            path={newFullPath}
                            parentCollectionSlugs={[...parentCollectionSlugs, collection.slug]}
                            parentSnapshotIds={[...parentSnapshotIds, String(usedSnapshot?.id)]}
                            updateUrl={false}
                            {...subcollection}
                            openSnapshotMode={layout} />
                        : <div className="flex items-center justify-center w-full h-full p-3">
                            <Typography variant={"label"}>
                                You need to save your snapshot before
                                adding additional collections
                            </Typography>
                        </div>)
                }

            </div>
        );
    }).filter(Boolean);

    const onSideTabClick = useCallback((value: string) => {
        userHasChangedTab.current = true;
        setSelectedTab(value);
        if (status === "existing") {
            onTabChange?.({
                path: path,
                snapshotId,
                selectedTab: value === MAIN_TAB_VALUE ? undefined : value,
                collection
            });
        }
    }, [status, onTabChange, path, snapshotId, collection]);

    // Resolve formView.Builder if provided
    const formViewConfig = (collection as SnapshotCollection<M> & { formView?: FormViewConfig<M> }).formView;
    const FormViewBuilder = formViewConfig?.Builder ? resolveComponentRef<SnapshotCustomViewParams>(formViewConfig.Builder as ComponentRef<SnapshotCustomViewParams>) : null;
    const formViewIncludeActions = formViewConfig?.includeActions !== false;

    const snapshotReadOnlyView = !canEdit && snapshot ? <div
        className={cls("flex-1 flex flex-row w-full overflow-y-auto justify-center", (canEdit || !mainViewVisible || selectedSecondaryForm) ? "hidden" : "")}>
        <div
            className={cls("relative flex flex-col max-w-4xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-6xl w-full h-fit")}>
            <Typography className={"mt-16 mb-8 mx-8"} variant={"h4"}>
                {collection.singularName ?? collection.name}
            </Typography>
            {FormViewBuilder && readOnlyFormContext ? (
                <ErrorBoundary>
                    <Suspense fallback={<CircularProgressCenter />}>
                        <FormViewBuilder
                            collection={collection}
                            parentCollectionSlugs={parentCollectionSlugs} parentSnapshotIds={parentSnapshotIds}
                            snapshot={usedSnapshot}
                            modifiedValues={usedSnapshot?.values}
                            formContext={readOnlyFormContext as FormContext<Record<string, unknown>>}
                        />
                    </Suspense>
                </ErrorBoundary>
            ) : (
                <SnapshotView
                    className={"px-8 h-full overflow-auto"}
                    snapshot={snapshot}
                    path={path}
                    collection={collection} />
            )}
            <div className="h-16" />
        </div>
    </div> : null;

    const snapshotView = FormViewBuilder ? (
        // formView.Builder replaces the default form
        <div className={cls(
            "relative flex-1 w-full h-full overflow-auto",
            (!mainViewVisible || !canEdit) && !selectedSecondaryForm ? "hidden" : ""
        )}>
            <ErrorBoundary>
                <Suspense fallback={<CircularProgressCenter />}>
                    {(formContext ?? readOnlyFormContext) && <FormViewBuilder
                        collection={collection}
                        parentCollectionSlugs={parentCollectionSlugs} parentSnapshotIds={parentSnapshotIds}
                        snapshot={usedSnapshot}
                        modifiedValues={(formContext ?? readOnlyFormContext)?.formex?.values ?? usedSnapshot?.values}
                        formContext={(formContext ?? readOnlyFormContext) as FormContext<Record<string, unknown>>}
                    />}
                </Suspense>
            </ErrorBoundary>
        </div>
    ) : (
        <ResolvedSnapshotForm<M>
            collection={collection}
            path={path}
            snapshotId={snapshotId ?? usedSnapshot?.id}
            onValuesModified={onValuesModified}
            snapshot={snapshot}
            initialDirtyValues={initialDirtyValues}
            openSnapshotMode={layout}
            forceActionsAtTheBottom={actionsAtTheBottom}
            initialStatus={status}
            className={cls((!mainViewVisible || !canEdit) && !selectedSecondaryForm ? "hidden" : "", formProps?.className)}
            SnapshotFormActionsComponent={ResolvedFormActions as React.FC<typeof ResolvedFormActions extends React.ComponentType<infer P> ? P : never>}
            disabled={!canEdit}
            navigateBack={navigateBack}
            {...formProps}
            onSnapshotChange={(snapshot) => {
                setUsedSnapshot(snapshot);
                formProps?.onSnapshotChange?.(snapshot);
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
                    selectedTab: MAIN_TAB_VALUE === activeTab ? undefined : activeTab
                };
                onSaved?.(res);
                formProps?.onSaved?.(res);
            }}
            Builder={resolveComponentRef(selectedSecondaryForm?.Builder as ComponentRef<SnapshotCustomViewParams<M>> | undefined) as React.ComponentType<SnapshotCustomViewParams<M>> | undefined}
        />
    );

    const subcollectionTabs = subcollections && subcollections.map((subcollection) => {
        const icon = getIcon(subcollection.icon, undefined, undefined, "smallest");
        return (
            <Tab
                className="text-sm min-w-[90px]"
                value={subcollection.slug}
                key={`snapshot_detail_collection_tab_${subcollection.name}`}>
                <span className="flex items-center gap-1.5">
                    {icon}
                    {subcollection.name}
                </span>
            </Tab>
        );
    });

    const customViewTabsStart = resolvedSnapshotViews.filter(view => view.position === "start")
        .map((view) => {
            const icon = getIcon(view.icon, undefined, undefined, "smallest");
            return (
                <Tab
                    className={!view.tabComponent ? "text-sm min-w-[90px]" : undefined}
                    value={view.key}
                    key={`snapshot_detail_collection_tab_${view.name}`}>
                    {view.tabComponent ?? (
                        <span className="flex items-center gap-1.5">
                            {icon}
                            {view.name}
                        </span>
                    )}
                </Tab>
            );
        });
    const customViewTabsEnd = resolvedSnapshotViews.filter(view => !view.position || view.position === "end")
        .map((view) => {
            const icon = getIcon(view.icon, undefined, undefined, "smallest");
            return (
                <Tab
                    className={!view.tabComponent ? "text-sm min-w-[90px]" : undefined}
                    value={view.key}
                    key={`snapshot_detail_collection_tab_${view.name}`}>
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

    const fullScreenButton = !barActions && (layout === "side_panel" || layout === "split" || layout === "dialog") && snapshotId ? (
        <Tooltip title={"Open full screen"}>
            <IconButton
                size="small"
                onClick={() => {
                    const editSuffix = collection.defaultSnapshotAction === "view" ? "/edit" : "";
                    const snapshotUrl = urlController.buildUrlCollectionPath(`${path}/${snapshotId}${editSuffix}`);
                    navigate(`${snapshotUrl}#full`);
                }}
            >
                <Maximize2Icon size={iconSize.smallest} />
            </IconButton>
        </Tooltip>
    ) : null;


    let result = <div className="relative flex flex-col h-full w-full bg-white dark:bg-surface-800">

        {shouldShowTopBar && <div
            className={cls("h-[52px] items-center flex overflow-hidden w-full border-b pl-2 pr-2 flex bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>

            {fullScreenButton}

            {barActions?.({
                path,
                snapshotId,
                values: formContext?.values ?? usedSnapshot?.values ?? {},
                status
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
            ? <SnapshotFormSkeleton collection={collection} />
            : <>
                {snapshotReadOnlyView}
                {snapshotView}
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
                    snapshot: usedSnapshot,
                    context,
                    formContext
                }}>
                {result}
            </PluginProviderStack>
        );
    }

    return result;
}

function SnapshotFormSkeleton({ collection }: { collection: SnapshotCollection }) {
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

