import React, { useCallback, useContext, useMemo, useState } from "react";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { CenteredView, CircularProgressCenter, Typography } from "@rebasepro/ui";
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
    if (needsOwnScope) {
        return (
            <CollectionsProvider collections={ownCollections}>
                <EntityFormPanelInScope {...props}/>
            </CollectionsProvider>
        );
    }
    return <EntityFormPanelInScope {...props}/>;
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
    const { canEdit } = usePermissions();

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
    const shownEntity = entity ?? savedEntity;

    const navigateBack = useCallback(() => onClose?.(), [onClose]);

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

    if (entityId !== undefined && dataLoadingError) {
        return <CenteredView className={className}><ErrorView error={dataLoadingError}/></CenteredView>;
    }
    if (entityId !== undefined && !shownEntity && dataLoading) return <CircularProgressCenter/>;

    // An id no record has yet is a record to create under that id. The form
    // keeps the status it opened with, so once it creates the record it edits
    // it from then on.
    const creating = shownEntity === undefined;
    const editable = creating || canEdit(collection, path, shownEntity);

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
                onSaved={(params) => {
                    formProps?.onSaved?.(params);
                    onSaved?.(params);
                }}
                navigateBack={navigateBack}
            />
        </CollectionScopeProvider>
    );
}
