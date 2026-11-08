import React, { useContext, useMemo, useRef } from "react";
import { deepEqual as equal } from "fast-equals";
import type { AdminCollection } from "@rebasepro/cms-types";
import { CenteredView, CircularProgressCenter } from "@rebasepro/ui";
import { CollectionScopeProvider, ErrorView, useFetch } from "@rebasepro/app";

import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { CollectionsScopeContext, isRegistered } from "./CollectionsScopeContext";
import { CollectionsProvider } from "./CollectionsProvider";
import { EntityViewBody, useReadOnlyFormContext } from "./EntityViewBody";
import { PanelNotFound } from "./PanelNotFound";
import { collectionPropOf, type ScopedRecordPanelProps } from "./collection_prop";
import type { RecordPanelCollection } from "./RecordForm";

/**
 * Props for {@link RecordDetail}.
 *
 * @group Components
 */
export type RecordDetailProps<M extends Record<string, unknown> = Record<string, unknown>> =
    RecordDetailOptions<M> & RecordPanelCollection<M>;

/**
 * The options of an {@link RecordDetail}, beside its collection.
 *
 * @group Components
 */
export type RecordDetailOptions<M extends Record<string, unknown> = Record<string, unknown>> = {
    /** The record to show. */
    id: string | number;

    className?: string;

    /**
     * The fields the view shows, in this order; any other property is left
     * out. Sections and the rail keep their grouping, each holding only these
     * fields. Wins over the collection's `formView.Builder`.
     */
    fields?: string[];

    /**
     * Collection settings for this view only, applied over the registered
     * collection the way `CollectionPanel` and `RecordForm` apply their
     * own: a shallow merge, so `properties` given here replaces the
     * collection's whole map.
     */
    collectionOverrides?: Partial<AdminCollection>;
};

/**
 * One record, read-only — loaded by id, drawn the way the CMS's own detail
 * view draws it — to drop into a page of your own app. The read-only twin of
 * `RecordForm`.
 *
 * Each field renders its `PropertyPreview`: an enum as its chip, a date in its
 * timezone, a relation as its target's title, a property's own
 * `admin.Preview`. A field a dynamic `conditions` rule hides for this record,
 * or that the signed-in user may not read, is left out, exactly as the form
 * leaves it out.
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
 *         <RecordDetail collection={ordersCollection} id="123"
 *             fields={["customer", "status", "total"]}/>
 *     </BrowserRouter>
 * </Rebase>
 * ```
 *
 * @group Components
 */
export function RecordDetail<M extends Record<string, unknown> = Record<string, unknown>>(rawProps: RecordDetailProps<M>) {
    const inScope = useContext(CollectionsScopeContext);
    const collectionRegistry = useCollectionRegistryController();
    const navigationState = useNavigationStateController();
    const { collection, path } = collectionPropOf<AdminCollection<M>>(rawProps.collection, rawProps.path);
    const props: ScopedRecordPanelProps<RecordDetailOptions<M>, M> = { ...rawProps, collection, path };
    const ownCollections = useMemo(() => collection ? [collection] : [], [collection]);

    // As `RecordForm`: a collection handed over as a value brings its own
    // scope where none is above, or where the one above has settled without
    // it. One named by path is looked up in the scope above.
    const needsOwnScope = collection !== undefined && (!inScope
        || (!navigationState.loading && !isRegistered(collectionRegistry.collections, path)));
    const recordKey = `${path}/${props.id}`;
    // As `RecordForm`: named by path with no scope above, it is not found.
    if (!inScope && collection === undefined) return <PanelNotFound className={props.className}/>;
    if (needsOwnScope) {
        return (
            <CollectionsProvider collections={ownCollections}>
                <RecordDetailInScope key={recordKey} {...props}/>
            </CollectionsProvider>
        );
    }
    return <RecordDetailInScope key={recordKey} {...props}/>;
}

function RecordDetailInScope<M extends Record<string, unknown>>({
    collection: collectionProp,
    id: entityId,
    path: pathProp,
    className,
    fields,
    collectionOverrides
}: ScopedRecordPanelProps<RecordDetailOptions<M>, M>) {
    const path = pathProp;
    const collectionRegistry = useCollectionRegistryController<Record<string, unknown>, AdminCollection<M>>();
    const navigationState = useNavigationStateController();

    // The registry's copy, as in `RecordForm`: it carries the plugins'
    // changes and the user's saved overrides. Looked up once per registry, and
    // the overrides compared by value, because the record's subscription is
    // keyed on the collection it was opened with.
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

    const formContext = useReadOnlyFormContext<M>({
        entityId,
        entity,
        collection: collection ?? collectionProp,
        path,
        openEntityMode: "full_screen"
    });

    if (!collection) {
        if (navigationState.loading) return <CircularProgressCenter/>;
        return <PanelNotFound className={className}/>;
    }
    if (dataLoadingError) {
        return <CenteredView className={className}><ErrorView error={dataLoadingError}/></CenteredView>;
    }
    if (!entity) {
        if (dataLoading) return <CircularProgressCenter/>;
        return <PanelNotFound className={className}/>;
    }

    return (
        <CollectionScopeProvider collection={collection}>
            <EntityViewBody<M>
                entity={entity}
                collection={collection}
                path={path}
                formContext={formContext}
                fields={fields}
                className={className}
            />
        </CollectionScopeProvider>
    );
}
