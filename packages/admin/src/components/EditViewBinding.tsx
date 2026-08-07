import type { ComponentRef } from "@rebasepro/types";
import type { EntityCustomViewParams, FormViewConfig, AdminCollection } from "@rebasepro/admin-types";
import type { FormContext } from "../types/fields";
import type { PluginFormActionProps } from "@rebasepro/admin-types";
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, EntityStatus, getCollectionDataPath } from "@rebasepro/types";
import { PluginProviderStack, resolveComponentRef, useComponentOverride, CollectionScopeProvider, getAdminEntityChildViews } from "@rebasepro/app";

import { CollectionViewBinding } from "./CollectionViewBinding/CollectionViewBinding";
import { EntityViewBinding } from "./EntityViewBinding";
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
    MenuItem,
    Skeleton,
    Tab,
    Tabs,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { ErrorView } from "@rebasepro/app";

import { removeInitialAndTrailingSlashes, resolveDefaultSelectedView } from "@rebasepro/app";
import { resolvedSelectedEntityView } from "../util/resolutions";
import {
    useCustomizationController,
    useFetch,
    useRebaseContext,
    useLargeLayout,
    useSlot,
    getIcon
} from "@rebasepro/app";
import { getEntityFromMemoryCache, removeEntityFromMemoryCache, saveEntityToMemoryCache } from "@rebasepro/app";
import { EntityFormBinding } from "../form";
import { getEditHandoffValues } from "../form/form_utils";
import type { EntityFormBindingProps } from "../form";
import type { OnUpdateParams } from "../types/components/EntityFormProps";
import { EditFormActions } from "./EditFormActions";
import { EntityIdentityBar } from "./EntityIdentityBar";
import { SplitListCloseButton } from "./CollectionViewBinding/SplitListCloseButton";
import { SplitListShowButton } from "./CollectionViewBinding/SplitListShowButton";
import { useRecordActions } from "../hooks/useRecordActions";
import { useSideDialogContext } from "./SideDialogs";
import { useAdminContext } from "../hooks/useAdminContext";
import { EntityInspector, InspectorTab } from "./EntityInspector";
import { useEntityDisplayTitle } from "../hooks/useEntityDisplayTitle";
import { createFormexStub, getEntityFromCache } from "@rebasepro/app";
import { usePermissions } from "@rebasepro/app";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { withViewMode } from "../util/view_mode";
import { useNavigate } from "react-router";

import {
    MAIN_TAB_VALUE,
    JSON_TAB_VALUE,
    HISTORY_TAB_VALUE,
    ENTITY_VIEW_TAB_BAR_CLASS,
    ENTITY_VIEW_TAB_CLASS,
    ENTITY_VIEW_TAB_LABEL_CLASS
} from "../util/view_constants";
export { MAIN_TAB_VALUE, JSON_TAB_VALUE, HISTORY_TAB_VALUE };

export type BarActionsParams = {
    values: object,
    status: EntityStatus,
    path: string,
    entityId?: string | number;
    /** Whether `values` differ from what is stored. */
    dirty: boolean;
    /**
     * Hand the edit in progress to the layout this action is about to open, so
     * the record arrives showing — and still holding — what the user typed here.
     * Call it from any action that changes layout without leaving the record;
     * it decides on its own whether there is anything worth carrying, so a
     * record nobody edited still arrives clean.
     *
     * Only supplied where there is a form to carry: the detail view passes no
     * such thing.
     */
    carryEdit?: () => void;
};

export type OnTabChangeParams<M extends Record<string, unknown>> = {
    path: string;
    entityId?: string | number;
    selectedTab?: string;
    collection: AdminCollection<M>;

};

export interface EditViewBindingProps<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * The admin path of the entity, e.g. "users" or "products".
     */
    path: string;
    collection: AdminCollection<M>;
    entityId?: string | number;
    databaseId?: string;
    copy?: boolean;
    selectedTab?: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    onValuesModified?: (modified: boolean, values: M) => void;
    onSaved?: (params: OnUpdateParams) => void;
    onTabChange?: (props: OnTabChangeParams<M>) => void;
    navigateBack?: () => void;
    /**
     * Dismiss this record — the ✕ at the identity bar's trailing edge, and what
     * "save and close" reaches once the save lands.
     *
     * Set by the layouts that own the record's place on screen but are not side
     * dialogs: the split, where dismissing is navigating back to the collection.
     * The side panel and the dialog close through {@link useSideDialogContext}
     * instead, which is what runs their unsaved-changes prompt.
     */
    onCloseRequest?: () => void;
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
    formProps?: Partial<EntityFormBindingProps<M>>,
    /**
     * Pre-populate the form with these values when creating a new entity.
     * Only applied when the form is in "new" mode (no entityId).
     * Sourced from SidePanelBindingProps (side panel) or location.state (full screen).
     */
    defaultValues?: Partial<M>;
}

/**
 * This is the default view that is used as the content of a side panel when
 * a record is opened.
 */
export function EditViewBinding<M extends Record<string, unknown>>({
    entityId,
    ...props
}: EditViewBindingProps<M>) {

    const {
        entity,
        dataLoading,

        dataLoadingError
    } = useFetch<M>({
        path: props.path,
        entityId: entityId,
        collection: props.collection,
        databaseId: props.databaseId,
        useCache: false
    });

    // The edit handed over by another layout of this same record — see
    // {@link carryEdit} below for the sending half.
    //
    // Read once per record and consumed: this is a handoff, and an edit left in
    // the channel after it has been picked up is one that reopens the record
    // dirty on a later, unrelated visit, carrying values the user walked away
    // from. Held in a ref rather than re-read each render, because the read has
    // to survive the clear — {@link EntityFormBinding} measures the
    // local-changes banner against what the form opens showing, and a prop that
    // reverted to `undefined` once the cache was cleared would raise the banner
    // over the very edit that was just carried in.
    //
    // A copy is keyed with the new records, not under the record it was copied
    // from: it is going to be stored as its own row, and both the handoff and
    // the local-changes backup have always keyed it that way from the writing
    // side. Reading it under `path/id` meant a copy in progress was written to
    // one key and looked for under another.
    const carriesAsNew = props.copy || entityId === undefined;
    const handoffKey = carriesAsNew ? props.path + "#new" : props.path + "/" + entityId;
    const handoff = useRef<{ key: string, values: object | undefined } | null>(null);
    if (handoff.current?.key !== handoffKey) {
        handoff.current = {
            key: handoffKey,
            values: getEntityFromMemoryCache(handoffKey)
        };
    }
    useEffect(() => {
        removeEntityFromMemoryCache(handoffKey);
    }, [handoffKey]);

    const initialDirtyValues = carriesAsNew
        ? (props.defaultValues ?? handoff.current.values)
        : handoff.current.values;

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

    const content = (
        <EditViewBindingInner<M> {...props}
            entityId={entityId}
            entity={entity}
            initialDirtyValues={initialDirtyValues as Partial<M>}
            dataLoading={dataLoading}
            status={status}
            setStatus={setStatus}
            canEdit={canEdit}
        />
    );

    return (
        <CollectionScopeProvider collection={props.collection}>
            {content}
        </CollectionScopeProvider>
    );
}

export function EditViewBindingInner<M extends Record<string, unknown>>({
    path,
    entityId,
    selectedTab: selectedTabProp,
    collection,
    parentCollectionSlugs, parentEntityIds,
    onValuesModified,
    onSaved,
    onTabChange,
    navigateBack,
    onCloseRequest,
    entity,
    initialDirtyValues,
    dataLoading,
    layout = "side_panel",
    barActions,
    barActionsStart,
    onShowList,
    status,
    setStatus,
    formProps,
    canEdit
}: EditViewBindingProps<M> & {
    entity?: Entity<M>,
    initialDirtyValues?: Partial<M>, // dirty cached entity in memory
    dataLoading: boolean,
    status: EntityStatus,
    setStatus: (status: EntityStatus) => void,
    canEdit?: boolean,
}) {

    const ResolvedFormActions = useComponentOverride("EditView.FormActions", EditFormActions);
    const ResolvedEntityForm = useComponentOverride("Entity.Form", EntityFormBinding) as typeof EntityFormBinding;
    const ResolvedCollectionView = useComponentOverride("Collection.View", CollectionViewBinding);

    const context = useRebaseContext();
    const adminContext = useAdminContext();
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

    const formActionTopProps: PluginFormActionProps = useMemo(() => ({
        entityId,
        parentCollectionSlugs,
parentEntityIds,
        path: path,
        status,
        collection: collection!,
        context,
        formContext: formContext as FormContext<Record<string, unknown>> | undefined,
        openEntityMode: layout,
        disabled: false
    }), [entityId, parentCollectionSlugs, parentEntityIds, path, status, collection, context, formContext, layout]);
    const pluginActionsTop = useSlot("form.actions.top", formActionTopProps);

    const defaultSelectedView = useMemo(() => resolveDefaultSelectedView(
        collection ? collection.defaultSelectedView : undefined,
        {
            status,
            entityId
        }
    ), [collection, status, entityId]);

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

    // See DetailViewBinding: tabs are governed by `hideFromEntityViews`, the
    // drawer by `hideFromNavigation`. They are separate roles.
    const childViews = getAdminEntityChildViews(collection).filter(v => !v.collection.hideFromEntityViews);
    const subcollections = childViews.map(v => v.collection);
    const subcollectionsCount = subcollections?.length ?? 0;
    const customViews = collection.entityViews ?? [];
    const customViewsCount = customViews?.length ?? 0;
    const includeJsonView = collection.includeJsonView === undefined ? true : collection.includeJsonView;
    const includeHistoryView = Boolean(collection.history);
    // The inspector holds the developer tools; the tab strip holds destinations.
    // A strip with only the record in it has nothing to choose between, so it
    // does not render at all.
    const hasAdditionalViews = customViewsCount > 0 || subcollectionsCount > 0;

    const {
        resolvedEntityViews
    } = resolvedSelectedEntityView(customViews, customizationController, undefined, canEdit);

    // JSON and history are no longer tab values, but a bookmarked or in-flight
    // URL may still name one. They resolve to the record, and open the
    // inspector on that pane, so an old link keeps working.
    const legacyInspectorTab = selectedTab === JSON_TAB_VALUE
        ? "json"
        : selectedTab === HISTORY_TAB_VALUE ? "history" : undefined;

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
        selectedEntityView,
        selectedSecondaryForm
    } = resolvedSelectedEntityView(customViews, customizationController, activeTab, canEdit);


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
        if (!entityId) return undefined;
        const formexStub = createFormexStub<M>(usedEntity?.values ?? {} as M);
        return {
            entityId,
            disabled: false,
            readOnly: true,
            openEntityMode: layout,
            status: status,
            values: usedEntity?.values ?? ({} as M),
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
            entity: usedEntity,
            savingError: undefined,
            formex: formexStub
        };
    }, [formContext, entityId, layout, status, usedEntity, collection, path]);

    const nonActionCustomViews = useMemo(() =>
        resolvedEntityViews.filter(e => !e.includeActions),
        [resolvedEntityViews]
    );

    const customViewsView: React.ReactNode[] | undefined = customViews && nonActionCustomViews
        .map((customView) => {

            if (!customView)
                return null;
            const Builder = resolveComponentRef<EntityCustomViewParams>(customView.Builder);
            if (!Builder) {
                console.error("INTERNAL: customView.Builder is not defined or could not be resolved");
                return null;
            }

            if (!entityId) {
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
                            parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                            entity={usedEntity}
                            modifiedValues={usedFormContext?.formex?.values ?? usedEntity?.values}
                            formContext={usedFormContext as FormContext<Record<string, unknown>>}
                        />}
                    </Suspense>
                </ErrorBoundary>
            </div>;
        }).filter(Boolean);

    const globalLoading = (dataLoading && !usedEntity) || (canEdit === undefined && (status === "existing" || status === "copy"));

    /* ---- identity bar ---------------------------------------------------- */

    const displayTitle = useEntityDisplayTitle({
        collection,
        entity: usedEntity,
        values: (formContext?.values ?? usedEntity?.values) as Record<string, unknown> | undefined,
        status
    });

    const formex = formContext?.formex;
    const hasFormErrors = Boolean(formex && Object.keys(formex.errors).length > 0 && formex.submitCount > 0);
    // Same rule the footer used: an untouched existing record has nothing to save.
    const saveDisabled = Boolean(
        !formContext
        || formContext.disabled
        || formex?.isSubmitting
        || (status === "existing" && !formex?.dirty)
    );

    /**
     * Hand this record's edit in progress to the layout about to replace this
     * one — the split's "hide list", full screen's "show list", the side panel's
     * "open full screen". None of them is a navigation *away* from the record:
     * the same record is about to be shown by a different form, and what the
     * user has typed belongs to the record, not to the pane it was typed in.
     *
     * Every control that changes layout has to call this, and none of them is
     * blocked by the unsaved-changes prompt — the prompt asks about leaving, and
     * these do not leave. What used to happen instead is that the edit reached
     * the next layout only as its local-changes backup, which is the channel for
     * a draft left behind by a closed tab: the record reopened *clean*, with a
     * banner offering to apply changes the user had never walked away from.
     */
    const carryEdit = useCallback(() => {
        const carried = formex
            ? getEditHandoffValues<M>({
                status,
                dirty: formex.dirty,
                values: formex.values,
                touched: formex.touched,
                storedValues: usedEntity?.values
            })
            : undefined;
        if (!carried) return;
        const key = (status === "new" || status === "copy") ? path + "#new" : path + "/" + entityId;
        saveEntityToMemoryCache(key, carried);
    }, [formex, status, path, entityId, usedEntity]);

    const [inspectorTab, setInspectorTab] = useState<InspectorTab | null>(null);
    // A save adds a revision, and the inspector can be open while it happens:
    // Save lives in the identity bar, above the panel. Counting saves gives the
    // history list something to react to.
    const [savedCount, setSavedCount] = useState(0);

    /* ---- record actions, in the bar's overflow menu ---------------------- */

    const sideDialogContext = useSideDialogContext();

    /**
     * Whether the save in flight was asked to dismiss the record afterwards.
     *
     * A ref, and for the reason {@link SideDialogs} keeps its own as one: the
     * flag is raised and the form submitted in a single click handler, and the
     * `onSaved` that has to act on it was captured before React could re-render.
     * As state it read one save late — the first "save and close" saved and
     * stayed open, and the *next* save closed the record.
     *
     * The side panel and the dialog use the side-dialog controller's flag,
     * which their own close path consumes; this one covers the layouts that
     * close by calling {@link onCloseRequest} instead.
     */
    const pendingCloseRef = useRef(false);

    // The split can close after a save the same way the overlays do — through
    // the callback its layout supplies. Without one there is nothing to close.
    const canCloseAfterSave = layout === "side_panel" || layout === "dialog"
        || (layout === "split" && Boolean(onCloseRequest));

    const recordActions = useRecordActions({
        collection,
        path,
        entity: usedEntity
    });

    const recordActionItems = usedEntity && recordActions.length
        ? recordActions.map((action, index) => {
            const clickProps = {
                view: "form" as const,
                entity: usedEntity,
                path,
                collection,
                context,
                sidePanelController: adminContext.sidePanelController,
                openEntityMode: layout,
                navigateBack: navigateBack ?? (() => undefined),
                formContext
            };
            const enabled = !action.isEnabled || action.isEnabled(clickProps as never);
            return (
                <MenuItem key={action.key ?? action.name ?? index}
                    disabled={!enabled}
                    onClick={() => action.onClick(clickProps as never)}>
                    {getIcon(action.icon, undefined, undefined, "smallest")}
                    {action.name}
                </MenuItem>
            );
        })
        : null;

    // Plugin form actions (Autofill and friends) render inline in the bar; the
    // form no longer has a footer to put them in.
    const formPluginActions = useSlot("form.actions", formActionTopProps);

    // A URL still naming the old `json`/`history` tab opens the inspector on
    // that pane instead of 404-ing into the record with nothing shown.
    useEffect(() => {
        if (legacyInspectorTab) setInspectorTab(legacyInspectorTab);
    }, [legacyInspectorTab]);

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
                                You need to save your entity before
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
                entityId,
                selectedTab: value === MAIN_TAB_VALUE ? undefined : value,
                collection
            });
        }
    }, [status, onTabChange, path, entityId, collection]);

    // Resolve formView.Builder if provided
    const formViewConfig = (collection as AdminCollection<M> & { formView?: FormViewConfig<M> }).formView;
    const FormViewBuilder = formViewConfig?.Builder ? resolveComponentRef<EntityCustomViewParams>(formViewConfig.Builder as ComponentRef<EntityCustomViewParams>) : null;
    const formViewIncludeActions = formViewConfig?.includeActions !== false;

    // Without edit permission the record is rendered read-only — the same
    // sections, spans and rail as the form, so losing the permission changes the
    // controls and nothing else. The `h4` that used to head this repeated the
    // collection name the identity bar above it already carries.
    const entityReadOnlyView = !canEdit && entity ? (
        FormViewBuilder && readOnlyFormContext
            ? <div className={cls(
                "@container/form flex-1 flex flex-row w-full overflow-y-auto justify-center",
                (canEdit || !mainViewVisible || selectedSecondaryForm) ? "hidden" : ""
            )}>
                {/* Same widths as the default form (see EntityForm). */}
                <div className={"w-full max-w-3xl @7xl/form:max-w-4xl 2xl:max-w-4xl flex flex-col pt-6 pb-16 px-5 sm:px-8"}>
                    <ErrorBoundary>
                        <Suspense fallback={<CircularProgressCenter />}>
                            <FormViewBuilder
                                collection={collection}
                                parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                                entity={usedEntity}
                                modifiedValues={usedEntity?.values}
                                formContext={readOnlyFormContext as FormContext<Record<string, unknown>>}
                            />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            </div>
            : <EntityViewBinding
                className={cls((canEdit || !mainViewVisible || selectedSecondaryForm) ? "hidden" : "")}
                entity={entity}
                path={path}
                collection={collection}
                asPage
                openEntityMode={layout}
                formContext={readOnlyFormContext}/>
    ) : null;

    const entityView = FormViewBuilder ? (
        // formView.Builder replaces the default form
        <div className={cls(
            "relative flex-1 w-full h-full overflow-auto",
            (!mainViewVisible || !canEdit) && !selectedSecondaryForm ? "hidden" : ""
        )}>
            <ErrorBoundary>
                <Suspense fallback={<CircularProgressCenter />}>
                    {(formContext ?? readOnlyFormContext) && <FormViewBuilder
                        collection={collection}
                        parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
                        entity={usedEntity}
                        modifiedValues={(formContext ?? readOnlyFormContext)?.formex?.values ?? usedEntity?.values}
                        formContext={(formContext ?? readOnlyFormContext) as FormContext<Record<string, unknown>>}
                    />}
                </Suspense>
            </ErrorBoundary>
        </div>
    ) : (
        <ResolvedEntityForm<M>
            collection={collection}
            path={path}
            entityId={entityId ?? usedEntity?.id}
            onValuesModified={onValuesModified}
            entity={entity}
            initialDirtyValues={initialDirtyValues}
            openEntityMode={layout}
            // Save and Discard live in the identity bar now, where they stay
            // visible while the form scrolls. The form's own footer would be a
            // second copy of them.
            showDefaultActions={false}
            initialStatus={status}
            className={cls((!mainViewVisible || !canEdit) && !selectedSecondaryForm ? "hidden" : "", formProps?.className)}
            EntityFormActionsComponent={ResolvedFormActions as React.FC<typeof ResolvedFormActions extends React.ComponentType<infer P> ? P : never>}
            disabled={!canEdit}
            navigateBack={navigateBack}
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
                setSavedCount(count => count + 1);
                const res = {
                    ...params,
                    selectedTab: MAIN_TAB_VALUE === activeTab ? undefined : activeTab
                };
                // Two caller-supplied callbacks for one save, and either may
                // navigate — the layouts' `onSaved` all do. Where both do, the
                // second one's destination is what survives (docs/bug-classes.md
                // #28), so `formProps.onSaved` is deliberately last: it belongs
                // to whoever embedded this view, which outranks the layout.
                onSaved?.(res);
                formProps?.onSaved?.(res);

                // After `onSaved`, never instead of it: the layout's own handler
                // is what lowers its dirty flag, and closing is a navigation the
                // unsaved-changes blocker would otherwise stop on values that
                // are already stored.
                //
                // And after this handler returns, not inside it. The layouts
                // that close this way close by navigating, and they have just
                // navigated themselves — the split leaves `…/edit` for the
                // record's own URL. Deferring keeps the close unambiguously
                // last, which is what decides it: of two navigations raised for
                // one action the final one survives, measured in
                // `router_two_navigations_one_handler.test.tsx`. It also lets
                // the state those handlers just set settle before the blocker
                // reads it. See docs/bug-classes.md #28.
                if (pendingCloseRef.current) {
                    pendingCloseRef.current = false;
                    setTimeout(() => onCloseRequest?.(), 0);
                }
            }}
            Builder={resolveComponentRef(selectedSecondaryForm?.Builder as ComponentRef<EntityCustomViewParams<M>> | undefined) as React.ComponentType<EntityCustomViewParams<M>> | undefined}
        />
    );

    const subcollectionTabs = subcollections && subcollections.map((subcollection) => {
        const icon = getIcon(subcollection.icon, undefined, undefined, "smallest");
        return (
            <Tab
                className={cls(ENTITY_VIEW_TAB_CLASS, ENTITY_VIEW_TAB_LABEL_CLASS)}
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
                    className={cls(ENTITY_VIEW_TAB_CLASS, !view.tabComponent && ENTITY_VIEW_TAB_LABEL_CLASS)}
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
                    className={cls(ENTITY_VIEW_TAB_CLASS, !view.tabComponent && ENTITY_VIEW_TAB_LABEL_CLASS)}
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

    const fullScreenButton = !barActions && // Not in split: the list panel beside it carries the close control,
    // and an expand button there competes with it.
    (layout === "side_panel" || layout === "dialog") && entityId ? (
        <Tooltip title={"Open full screen"}>
            <IconButton
                size="small"
                onClick={() => {
                    carryEdit();
                    const editSuffix = collection.defaultEntityAction === "view" ? "/edit" : "";
                    const entityUrl = urlController.buildUrlCollectionPath(`${path}/${entityId}${editSuffix}`);
                    navigate(`${entityUrl}#full`);
                }}
            >
                <Maximize2Icon size={iconSize.smallest} />
            </IconButton>
        </Tooltip>
    ) : null;

    let result = <div className="relative flex flex-col h-full w-full bg-white dark:bg-surface-800">

        <EntityIdentityBar
            collection={collection as AdminCollection}
            collectionUrl={layout === "full_screen" || layout === "split"
                ? withViewMode(urlController.buildUrlCollectionPath(path))
                : undefined}
            title={displayTitle}
            entityId={status === "existing" ? entityId : undefined}
            status={status}
            dirty={Boolean(formContext?.formex?.dirty)}
            saving={Boolean(formContext?.isSaving)}
            hasErrors={hasFormErrors}
            saveDisabled={!canEdit || saveDisabled}
            // Full screen replaces the collection entirely, leaving browser Back
            // as the only route to it. The detail view has carried this arrow
            // for that reason; the edit view is reached the same way. Where the
            // list can be unfolded back beside the record, that chevron reaches
            // the same collection and the arrow beside it is noise.
            onBack={layout === "full_screen" && !onShowList
                ? () => navigate(withViewMode(urlController.buildUrlCollectionPath(path)))
                : undefined}
            onSave={canEdit && formContext ? () => {
                sideDialogContext.setPendingClose?.(false);
                pendingCloseRef.current = false;
                formContext.submit();
            } : undefined}
            onSaveAndClose={canEdit && formContext && canCloseAfterSave ? () => {
                // Lowered again once the submit settles. A submit the form
                // rejects never reaches `onSaved`, so nothing would consume the
                // flag and the *next* save — a keyboard ⌘S, say — would close
                // the panel out from under an edit nobody asked to finish. A
                // save that succeeds has already closed by the time this runs.
                if (layout === "split") {
                    pendingCloseRef.current = true;
                    Promise.resolve(formContext.submit())
                        .finally(() => { pendingCloseRef.current = false; });
                    return;
                }
                sideDialogContext.setPendingClose?.(true);
                Promise.resolve(formContext.submit())
                    .finally(() => sideDialogContext.setPendingClose?.(false));
            } : undefined}
            // Welded to Save in the split, its own button in the overlays.
            saveAndClosePlacement={layout === "split" ? "menu" : "button"}
            onClose={onCloseRequest}
            onDiscard={canEdit && formContext ? () => formContext.formex.resetForm() : undefined}
            onInspect={includeJsonView ? () => setInspectorTab("json") : undefined}
            onViewHistory={includeHistoryView ? () => setInspectorTab("history") : undefined}
            externalLink={usedEntity
                ? customizationController?.entityLinkBuilder?.({ entity: usedEntity })
                : undefined}
            recordActions={recordActionItems}
            pluginActions={formPluginActions}
            leading={<>
                {barActionsStart}
                {/* Split view: closing the list is opening this record
                    full screen, and the control for it belongs at this
                    bar's leading edge. Full screen carries its mirror.
                    Both change layout, so both hand the edit over. */}
                {layout === "split" && <SplitListCloseButton onBeforeHide={carryEdit}/>}
                {layout === "full_screen" && onShowList && <SplitListShowButton onClick={() => {
                    carryEdit();
                    onShowList();
                }}/>}
            </>}
            trailing={<>
                {pluginActionsTop}
                {fullScreenButton}
                {barActions?.({
                    path,
                    entityId,
                    values: formContext?.values ?? usedEntity?.values ?? {},
                    status,
                    dirty: Boolean(formContext?.formex?.dirty),
                    carryEdit
                })}
            </>}
        />

        {/* Destinations only: the record is the page, so its tab leads rather
            than sitting third behind two unlabelled developer tools. The row
            disappears entirely when there is nowhere else to go. */}
        {hasAdditionalViews && <div className={cls(
            "h-10 shrink-0 flex items-stretch border-b px-2 min-w-0",
            ENTITY_VIEW_TAB_BAR_CLASS,
            defaultBorderMixin
        )}>
            <Tabs
                className={"!w-full items-stretch"}
                innerClassName={"h-full"}
                variant={"boxy"}
                value={activeTab}
                onValueChange={(value) => {
                    onSideTabClick(value);
                }}>

                <Tab value={MAIN_TAB_VALUE}
                     className={cls(ENTITY_VIEW_TAB_CLASS, ENTITY_VIEW_TAB_LABEL_CLASS)}>
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

        {/* The record and the inspector share the space below the bar rather
            than stacking, so the form stays reachable while the panel is open.
            `min-w-0` keeps a wide form from pushing the panel off the edge. */}
        <div className={"flex-1 min-h-0 flex"}>

            <div className={"flex-1 min-w-0 flex flex-col"}>
                {globalLoading
                    ? <EntityFormSkeleton collection={collection} />
                    : <>
                        {entityReadOnlyView}
                        {entityView}
                    </>}

                {customViewsView}

                {subCollectionsViews}
            </div>

            <EntityInspector
                tab={inspectorTab}
                onTabChange={setInspectorTab}
                onClose={() => setInspectorTab(null)}
                collection={collection as AdminCollection}
                entity={usedEntity as Entity<Record<string, unknown>> | undefined}
                formContext={formContext as FormContext<Record<string, unknown>> | undefined}
                values={formContext?.values ?? usedEntity?.values}
                refreshToken={savedCount}
                includeHistory={includeHistoryView}/>
        </div>

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

function EntityFormSkeleton({ collection }: { collection: AdminCollection }) {
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

