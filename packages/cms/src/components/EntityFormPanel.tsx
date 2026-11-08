import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { deepEqual as equal } from "fast-equals";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Alert, Button, CenteredView, CircularProgressCenter } from "@rebasepro/ui";
import { CollectionScopeProvider, entityOfRow, ErrorView, rowOfEntity, useFetch, usePermissions, useTranslation } from "@rebasepro/app";

import { EntityFormBinding } from "../form/EntityFormBinding";
import type { EntityFormBindingProps } from "../form/EntityFormBinding";
import type { OnSavedParams } from "../types/components/EntityFormProps";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { CollectionsScopeContext, isRegistered } from "./CollectionsScopeContext";
import { CollectionsProvider } from "./CollectionsProvider";
import { PanelNotFound } from "./PanelNotFound";

/**
 * Props for {@link EntityFormPanel}.
 *
 * @group Components
 */
export type EntityFormPanelProps<M extends Record<string, unknown> = Record<string, unknown>> =
    EntityFormPanelOptions<M> & RecordPanelCollection<M>;

/**
 * Which collection a record panel's record belongs to: named by `path`, the
 * way {@link CollectionPanel} names it, or handed over as a value.
 *
 * @group Components
 */
export type RecordPanelCollection<M extends Record<string, unknown> = Record<string, unknown>> =
    | {
        /**
         * Where the collection is addressed (`"orders"`, a subcollection's
         * `"posts/p1/comments"`), registered with `<RebaseCMS>` or a
         * {@link CollectionsProvider} above.
         */
        path: string;
        /** The collection itself, when it is not registered. */
        collection?: AdminCollection<M>;
    }
    | {
        /**
         * The collection the record belongs to, as a value — a
         * `defineCollection` config or a resolved collection. Where no CMS
         * navigation is mounted above, the panel brings its own
         * {@link CollectionsProvider} for it.
         */
        collection: AdminCollection<M>;
        /**
         * Defaults to `collection.slug`; a subcollection's record takes its
         * full path (`posts/p1/comments`).
         */
        path?: string;
    };

/**
 * The options of an {@link EntityFormPanel}, beside its collection.
 *
 * @group Components
 */
export type EntityFormPanelOptions<M extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * The record to edit. When no record has this id yet, the form creates
     * it under this id — so a record kept at a known key (a settings record,
     * a profile keyed by its user's id) needs no seeding. Omit it to create a
     * new record under an id the data source assigns.
     */
    id?: string | number;

    /** Called after every successful save, with the saved record. */
    onSaved?: (params: OnSavedParams) => void;

    /**
     * Called when the form asks to be left — after its record is deleted, or
     * by an action that closes it. The form is your page's, so where that
     * leads is yours to say; without it, nothing happens.
     */
    onClose?: () => void;

    /** Values a new record starts with — one created without an id, or under an id no record has yet. */
    defaultValues?: Partial<M>;

    className?: string;

    /**
     * The fields the form shows, in this order; any other property is left
     * out. Sections and the rail keep their grouping, each holding only these
     * fields. The form validates only what it shows, and, creating a record,
     * refuses with an error naming them when a required field it leaves out
     * has no default value and is not filled by the server or the database.
     */
    fields?: string[];

    /**
     * Your own arrangement of the fields, in place of the generated ones:
     * `<FormField name="…"/>`s inside any JSX. Validation covers the fields
     * its `<FormField>`s render, with the same create-time check as
     * {@link fields}. Wins over the collection's `formView.Builder`.
     *
     * @example
     * ```tsx
     * <EntityFormPanel collection={orders} id={id}
     *     layout={<div className="grid grid-cols-2 gap-4">
     *         <FormField name="customer"/>
     *         <FormField name="status"/>
     *     </div>}/>
     * ```
     */
    layout?: React.ReactNode;

    /**
     * Collection settings for this form only, applied over the registered
     * collection the way `CollectionPanel` applies its own: a shallow merge,
     * so `properties` given here replaces the collection's whole map.
     */
    collectionOverrides?: Partial<AdminCollection>;

    /** Anything else {@link EntityFormBinding} takes. */
    formProps?: Partial<Omit<EntityFormBindingProps<M>, "path" | "collection" | "id" | "row" | "initialStatus">>;
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
 *         <EntityFormPanel collection={postsCollection} id="123"
 *             onSaved={({ id }) => toast(`Saved ${id}`)}/>
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
    const path = props.path ?? collection?.slug ?? "";
    const ownCollections = useMemo(() => collection ? [collection] : [], [collection]);

    // As `CollectionPanel`: a collection handed over as a value brings its own
    // scope where none is above, or where the one above has settled without
    // it. One named by path is looked up in the scope above.
    const needsOwnScope = collection !== undefined && (!inScope
        || (!navigationState.loading && !isRegistered(collectionRegistry.collections, path)));
    // One form per record: the binding keeps the id and status it mounted
    // with, so a page that hands over another id (a route `/posts/:id` going
    // from p1 to p2) gets a fresh form instead of one that shows p2 and saves
    // into p1. Keyed on the prop, so the id a create assigns keeps the form.
    const recordKey = `${path}/${props.id ?? "new"}`;
    // Named by path with no scope above to look it up in: nothing will ever
    // register it, so it is not found rather than loading.
    if (!inScope && collection === undefined) return <PanelNotFound className={props.className}/>;
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
    id: entityId,
    path: pathProp,
    onSaved,
    onClose,
    defaultValues,
    className,
    fields,
    layout,
    collectionOverrides,
    formProps
}: EntityFormPanelProps<M>) {
    const { t } = useTranslation();
    const path = pathProp ?? collectionProp?.slug ?? "";
    const collectionRegistry = useCollectionRegistryController<Record<string, unknown>, AdminCollection<M>>();
    const navigationState = useNavigationStateController();
    const { canCreate, canEdit } = usePermissions();

    // The registry's copy: it carries the plugins' changes and the user's
    // saved overrides.
    // Looked up once per registry: each lookup builds a new object, and the
    // record's subscription is keyed on the collection it was opened with.
    // The overrides are compared by value for the same reason: they are an
    // inline object at most call sites, a new one on every render.
    const overridesRef = useRef(collectionOverrides);
    if (!equal(overridesRef.current, collectionOverrides)) overridesRef.current = collectionOverrides;
    const stableOverrides = overridesRef.current;
    const lookUp = collectionRegistry.initialised || !navigationState.loading;
    const collection = useMemo(() => {
        const registered = lookUp ? collectionRegistry.getCollection(path) : undefined;
        return registered && stableOverrides
            ? { ...registered, ...stableOverrides } as AdminCollection<M>
            : registered;
    }, [lookUp, collectionRegistry, path, stableOverrides]);

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
        const values: Partial<M> = typedValues.current ?? lastSeenEntity?.values ?? {};
        setAsNew(previous => ({ values, n: (previous?.n ?? 0) + 1 }));
    }, [lastSeenEntity]);

    if (!collection) {
        if (navigationState.loading) return <CircularProgressCenter/>;
        return <PanelNotFound className={className}/>;
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
                    row={asNew.saved ? rowOfEntity(asNew.saved, collection) : undefined}
                    initialStatus={"new"}
                    initialDirtyValues={asNew.values}
                    fields={fields ?? formProps?.fields}
                    layout={layout ?? formProps?.layout}
                    disabled={!canCreate(collection, path) || formProps?.disabled}
                    onRowChange={(changed) => {
                        // The record it created, which it edits from then on.
                        const saved = entityOfRow(changed.row, changed.id, path, collection) as Entity<M>;
                        setAsNew(current => current && { ...current, saved });
                        formProps?.onRowChange?.(changed);
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
    const editable = creating ? canCreate(collection, path) : canEdit(collection, path, shownEntity?.values ?? null);

    return (
        <CollectionScopeProvider collection={collection}>
            <EntityFormBinding<M>
                {...formProps}
                className={className ?? formProps?.className}
                path={path}
                collection={collection}
                id={entityId}
                row={shownEntity ? rowOfEntity(shownEntity, collection) : undefined}
                initialStatus={creating ? "new" : "existing"}
                initialDirtyValues={creating ? defaultValues : formProps?.initialDirtyValues}
                fields={fields ?? formProps?.fields}
                layout={layout ?? formProps?.layout}
                disabled={!editable || formProps?.disabled}
                onRowChange={(changed) => {
                    setSavedEntity(entityOfRow(changed.row, changed.id, path, collection) as Entity<M>);
                    formProps?.onRowChange?.(changed);
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
