import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Alert, Button, CenteredView, CircularProgressCenter, Typography } from "@rebasepro/ui";
import { CollectionScopeProvider, ErrorView, useFetch, usePermissions, useTranslation } from "@rebasepro/app";

import { EntityFormBinding } from "../form/EntityFormBinding";
import type { EntityFormBindingProps } from "../form/EntityFormBinding";
import type { OnUpdateParams } from "../types/components/EntityFormProps";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { CollectionsScopeContext, isRegistered } from "./CollectionsScopeContext";
import { CollectionsProvider } from "./CollectionsProvider";

/**
 * Props for {@link EntityFormPanel}.
 *
 * @group Components
 */
export type EntityFormPanelProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * The collection the record belongs to, as a value — a `defineCollection`
     * config or a resolved collection.
     */
    collection: AdminCollection<M>;

    /**
     * The record to edit. When no record has this id yet, the form creates
     * it under this id — so a record kept at a known key (a settings record,
     * a profile keyed by its user's id) needs no seeding. Omit it to create a
     * new record under an id the data source assigns.
     */
    entityId?: string | number;

    /**
     * Where the collection is addressed. Defaults to `collection.slug`; a
     * subcollection's record takes its full path (`posts/p1/comments`).
     */
    path?: string;

    /** Called after every successful save, with the saved record. */
    onSaved?: (params: OnUpdateParams) => void;

    /**
     * Called when the form asks to be left — after its record is deleted, or
     * by an action that closes it. The form is your page's, so where that
     * leads is yours to say; without it, nothing happens.
     */
    onClose?: () => void;

    /** Values a new record starts with — one created without an id, or under an id no record has yet. */
    defaultValues?: Partial<M>;

    className?: string;

    /** Anything else {@link EntityFormBinding} takes. */
    formProps?: Partial<Omit<EntityFormBindingProps<M>, "path" | "collection" | "entityId" | "entity" | "initialStatus">>;
};

/**
 * One record's form — loaded by id, saved through `<Rebase>`'s data layer —
 * to drop into a page of your own app.
 *
 * Needs `<Rebase>` and a React Router router above it (any router, any path).
 * Where no CMS navigation is mounted above, it brings its own
 * {@link CollectionsProvider}, so `<RebaseCMS>`, `<RebaseNavigation>` and
 * `<RebaseShell>` are not needed.
 *
 * @example
 * ```tsx
 * <Rebase client={client} authController={authController}>
 *     <BrowserRouter>
 *         <EntityFormPanel collection={postsCollection} entityId="123"
 *             onSaved={({ entity }) => toast(`Saved ${entity.id}`)}/>
 *     </BrowserRouter>
 * </Rebase>
 * ```
 *
 * @group Components
 */
export function EntityFormPanel<M extends Record<string, unknown> = Record<string, unknown>>(props: EntityFormPanelProps<M>) {
    const inScope = useContext(CollectionsScopeContext);
    const collectionRegistry = useCollectionRegistryController();
    const navigationState = useNavigationStateController();
    const { collection } = props;
    const ownCollections = useMemo(() => [collection], [collection]);

    // As `CollectionPanel`: its own scope where none is above, or where the
    // one above has settled without this collection.
    const needsOwnScope = !inScope
        || (!navigationState.loading && !isRegistered(collectionRegistry.collections, props.path ?? collection.slug));
    // One form per record: the binding keeps the id and status it mounted
    // with, so a page that hands over another id (a route `/posts/:id` going
    // from p1 to p2) gets a fresh form instead of one that shows p2 and saves
    // into p1. Keyed on the prop, so the id a create assigns keeps the form.
    const recordKey = `${props.path ?? collection.slug}/${props.entityId ?? "new"}`;
    if (needsOwnScope) {
        return (
            <CollectionsProvider collections={ownCollections}>
                <EntityFormPanelInScope key={recordKey} {...props}/>
            </CollectionsProvider>
        );
    }
    return <EntityFormPanelInScope key={recordKey} {...props}/>;
}

function EntityFormPanelInScope<M extends Record<string, unknown>>({
    collection: collectionProp,
    entityId,
    path: pathProp,
    onSaved,
    onClose,
    defaultValues,
    className,
    formProps
}: EntityFormPanelProps<M>) {
    const { t } = useTranslation();
    const path = pathProp ?? collectionProp.slug;
    const collectionRegistry = useCollectionRegistryController<Record<string, unknown>, AdminCollection<M>>();
    const navigationState = useNavigationStateController();
    const { canCreate, canEdit } = usePermissions();

    // The registry's copy: it carries the plugins' changes and the user's
    // saved overrides.
    // Looked up once per registry: each lookup builds a new object, and the
    // record's subscription is keyed on the collection it was opened with.
    const lookUp = collectionRegistry.initialised || !navigationState.loading;
    const collection = useMemo(
        () => lookUp ? collectionRegistry.getCollection(path) : undefined,
        [lookUp, collectionRegistry, path]);

    const { entity, dataLoading, dataLoadingError } = useFetch<M>({
        path,
        entityId,
        collection: collection ?? collectionProp,
        relations: true,
        useCache: false
    });

    // The record as the form last saved it. A record created here has no id
    // to read it back by from the outside, and the form, existing from then
    // on, needs it.
    const [savedEntity, setSavedEntity] = useState<Entity<M> | undefined>(undefined);

    // The record as it was last delivered. A live read that stops delivering
    // it — someone deleted it — is not a record that was never there: as in
    // the CMS's own edit view, the form keeps showing it, with what was typed,
    // and says so. Without this the form lost its record mid-edit and threw.
    const [lastSeenEntity, setLastSeenEntity] = useState<Entity<M> | undefined>(undefined);
    useEffect(() => {
        if (entity) setLastSeenEntity(entity);
    }, [entity]);
    // "Save as new": the same values, in a form that creates a record. Counted,
    // so that each one is a fresh form.
    const [asNew, setAsNew] = useState<{ values: Partial<M>, n: number, saved?: Entity<M> } | null>(null);
    const typedValues = useRef<Partial<M> | undefined>(undefined);
    const deletedElsewhere = !asNew && entityId !== undefined && !dataLoading && !entity
        && lastSeenEntity !== undefined && String(lastSeenEntity.id) === String(entityId);
    const shownEntity = deletedElsewhere ? lastSeenEntity : (entity ?? savedEntity);

    const navigateBack = useCallback(() => onClose?.(), [onClose]);
    const saveAsNew = useCallback(() => {
        const values = typedValues.current ?? lastSeenEntity?.values;
        setAsNew(previous => ({ values: { ...values }, n: (previous?.n ?? 0) + 1 }));
    }, [lastSeenEntity]);

    if (!collection) {
        if (navigationState.loading) return <CircularProgressCenter/>;
        return (
            <CenteredView className={className}>
                <Typography variant="body2" color="secondary">
                    {t("entity_not_found")}
                </Typography>
            </CenteredView>
        );
    }

    if (asNew) {
        return (
            <CollectionScopeProvider collection={collection}>
                <EntityFormBinding<M>
                    {...formProps}
                    key={`as-new-${asNew.n}`}
                    className={className ?? formProps?.className}
                    path={path}
                    collection={collection}
                    entity={asNew.saved}
                    initialStatus={"new"}
                    initialDirtyValues={asNew.values}
                    disabled={!canCreate(collection, path) || formProps?.disabled}
                    onEntityChange={(changed) => {
                        // The record it created, which it edits from then on.
                        setAsNew(current => current && { ...current, saved: changed });
                        formProps?.onEntityChange?.(changed);
                    }}
                    onSaved={(params) => {
                        formProps?.onSaved?.(params);
                        onSaved?.(params);
                    }}
                    navigateBack={navigateBack}
                />
            </CollectionScopeProvider>
        );
    }

    if (entityId !== undefined && dataLoadingError) {
        return <CenteredView className={className}><ErrorView error={dataLoadingError}/></CenteredView>;
    }
    if (entityId !== undefined && !shownEntity && dataLoading) return <CircularProgressCenter/>;

    // An id no record has yet is a record to create under that id. The form
    // keeps the status it opened with, so once it creates the record it edits
    // it from then on.
    const creating = shownEntity === undefined;
    // As the CMS's own New button and save actions: a record to create needs
    // canCreate (false while access is simulated), an existing one canEdit.
    const editable = creating ? canCreate(collection, path) : canEdit(collection, path, shownEntity);

    return (
        <CollectionScopeProvider collection={collection}>
            <EntityFormBinding<M>
                {...formProps}
                className={className ?? formProps?.className}
                path={path}
                collection={collection}
                entityId={entityId}
                entity={shownEntity}
                initialStatus={creating ? "new" : "existing"}
                initialDirtyValues={creating ? defaultValues : formProps?.initialDirtyValues}
                disabled={!editable || formProps?.disabled}
                onEntityChange={(changed) => {
                    setSavedEntity(changed);
                    formProps?.onEntityChange?.(changed);
                }}
                onValuesModified={(modified, values) => {
                    typedValues.current = values;
                    formProps?.onValuesModified?.(modified, values);
                }}
                onSaved={(params) => {
                    formProps?.onSaved?.(params);
                    onSaved?.(params);
                }}
                navigateBack={navigateBack}
            >
                {deletedElsewhere &&
                    <Alert color={"warning"} size={"small"} outerClassName={"w-full mb-4"}
                        action={<Button size={"small"} variant={"text"} onClick={saveAsNew}>{t("save_as_new")}</Button>}>
                        {t("entity_deleted_elsewhere")}
                    </Alert>}
                {formProps?.children}
            </EntityFormBinding>
        </CollectionScopeProvider>
    );
}
