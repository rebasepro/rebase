
import type { ViewMode, AdminCollection } from "@rebasepro/cms-types";
import React, { useContext, useMemo } from "react";
import { CollectionViewBinding } from "./CollectionViewBinding/CollectionViewBinding";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { CircularProgressCenter, Typography } from "@rebasepro/ui";
import { useComponentOverride, CollectionScopeProvider } from "@rebasepro/app";
import { CollectionsScopeContext, isRegistered } from "./CollectionsScopeContext";
import { CollectionsProvider } from "./CollectionsProvider";

/**
 * Props for the {@link CollectionPanel} component.
 *
 * This is a high-level, consumer-friendly wrapper around {@link CollectionViewBinding}
 * designed for embedding collection views inside custom pages (home pages,
 * dashboards, entity detail views, etc.).
 *
 * Name the collection by `path` (one registered with `<RebaseCMS>`, or with a
 * {@link CollectionsProvider} above), or hand it over as a value with
 * `collection`. All other props are optional overrides that take precedence
 * over the collection's default configuration.
 *
 * @group Components
 */
export type CollectionPanelProps = CollectionPanelOptions & (
    | {
        /**
         * The collection slug / path to display (e.g. "tasks", "clients"),
         * registered with `<RebaseCMS>` or a {@link CollectionsProvider}.
         */
        path: string;
        /** The collection itself, when it is not registered. */
        collection?: AdminCollection;
    }
    | {
        /**
         * The collection to display, as a value — a `defineCollection` config
         * or a resolved collection. Where no CMS navigation is mounted above,
         * the panel brings its own {@link CollectionsProvider} for it, so it
         * works anywhere under `<Rebase>` and a router.
         */
        collection: AdminCollection;
        /** Defaults to `collection.slug`. */
        path?: string;
    }
);

/**
 * The display options of a {@link CollectionPanel}.
 *
 * @group Components
 */
export type CollectionPanelOptions = {

    /**
     * Optional title displayed above the collection.
     * Set to `false` to hide the title entirely.
     * Defaults to the collection's `name`.
     */
    title?: string | false;

    /**
     * Force a specific view mode, overriding the collection's default.
     */
    viewMode?: ViewMode;

    /**
     * Override the sort field.
     */
    sort?: [string, "asc" | "desc"];

    /**
     * Maximum number of entities to display.
     */
    limit?: number;

    /**
     * Whether to sync filter/sort state with URL query params.
     * Defaults to `false` (embedded panels shouldn't hijack the URL).
     */
    updateUrl?: boolean;

    /**
     * Override the entity open mode when clicking a entity.
     */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * Additional CSS class name for the container.
     */
    className?: string;

    /**
     * Any additional collection-level overrides (e.g. `previewProperties`,
     * `enabledViews`, `entityActions`, `defaultFilter`, etc.).
     */
    collectionOverrides?: Partial<AdminCollection>;
};

/**
 * A high-level, reusable wrapper for embedding a Rebase collection view
 * inside custom pages (dashboards, home pages, entity detail views, etc.).
 *
 * Usage inside the CMS, by registered slug:
 * ```tsx
 * import { CollectionPanel } from "@rebasepro/cms";
 *
 * function MyDashboard() {
 *     return (
 *         <div>
 *             <CollectionPanel path="tasks" title="Pending Tasks" />
 *             <CollectionPanel
 *                 path="clients"
 *                 viewMode="table"
 *                 collectionOverrides={{
 *                     defaultFilter: { status: ["!=", "completed"] }
 *                 }}
 *             />
 *         </div>
 *     );
 * }
 * ```
 *
 * Usage in a page of your own app, with the collection as a value — no
 * `<RebaseCMS>`, `<RebaseNavigation>` or `<RebaseShell>` needed, and any
 * React Router router will do. Records open in a side panel over the page:
 * ```tsx
 * <Rebase client={client} authController={authController}>
 *     <BrowserRouter>
 *         <CollectionPanel collection={postsCollection} />
 *     </BrowserRouter>
 * </Rebase>
 * ```
 *
 * @group Components
 */
function CollectionPanelInner({
    mergedCollection,
    path,
    title,
    updateUrl,
    className
}: CollectionPanelProps & { mergedCollection: AdminCollection }) {
    const ResolvedCollectionView = useComponentOverride("Collection.View", CollectionViewBinding);

    return (
        <div className={className}>
            {title !== false && (
                <Typography
                    variant="subtitle2"
                    className="font-semibold mb-2 text-surface-700 dark:text-surface-300"
                >
                    {title ?? mergedCollection.name}
                </Typography>
            )}
            <ResolvedCollectionView
                {...mergedCollection}
                path={path}
                updateUrl={updateUrl}
            />
        </div>
    );
}

export function CollectionPanel(props: CollectionPanelProps) {
    const inScope = useContext(CollectionsScopeContext);
    const collectionRegistry = useCollectionRegistryController();
    const navigationState = useNavigationStateController();
    const collection = props.collection;
    const ownCollections = useMemo(() => collection ? [collection] : [], [collection]);

    // A collection handed over as a value brings its own scope where there is
    // none above — or where the one above has settled without it, since a
    // collection the data layer does not know gives its rows no address.
    const needsOwnScope = collection !== undefined && (!inScope
        || (!navigationState.loading && !isRegistered(collectionRegistry.collections, props.path ?? collection.slug)));
    if (needsOwnScope) {
        return (
            <CollectionsProvider collections={ownCollections}>
                <CollectionPanelInScope {...props}/>
            </CollectionsProvider>
        );
    }
    return <CollectionPanelInScope {...props}/>;
}

function CollectionPanelInScope(props: CollectionPanelProps) {
    const {
        viewMode,
        sort,
        limit,
        openEntityMode,
        className,
        collectionOverrides,
        collection: collectionProp
    } = props;
    const path = props.path ?? collectionProp?.slug ?? "";
    const collectionRegistry = useCollectionRegistryController();
    const navigationState = useNavigationStateController();
    const urlController = useUrlController();
    // The registry's copy, also for a collection handed over as a value: it
    // carries the user's saved overrides and the plugins' changes. Not asked
    // before it has been filled.
    const lookUp = collectionRegistry.initialised || !navigationState.loading;
    const baseCollection = useMemo(
        () => lookUp ? collectionRegistry.getCollection(path) : undefined,
        [lookUp, collectionRegistry, path]);
    const routesMounted = urlController.routesMounted !== false;

    const mergedCollection = useMemo(() => {
        if (!baseCollection) return undefined;

        // Build overrides object from shorthand props + explicit overrides
        const propOverrides: Record<string, unknown> = {};
        if (viewMode) propOverrides.defaultViewMode = viewMode;
        if (sort) propOverrides.sort = sort;
        if (limit) propOverrides.pagination = limit;
        if (openEntityMode) propOverrides.openEntityMode = openEntityMode;

        const merged = {
            ...baseCollection,
            ...(collectionOverrides ?? {}),
            ...propOverrides
        } as AdminCollection;
        // Without CMS routes a record has no page of its own, nor a split
        // beside the list that a URL selects: it opens over the page.
        if (!routesMounted && merged.openEntityMode !== "dialog") {
            merged.openEntityMode = "side_panel";
        }
        return merged;
    }, [baseCollection, collectionOverrides, viewMode, sort, limit, openEntityMode, routesMounted]);

    if (!mergedCollection) {
        if (navigationState.loading) {
            return <div className={className}><CircularProgressCenter/></div>;
        }
        return (
            <div className={className}>
                <Typography variant="body2" color="secondary">
                    Collection &quot;{path}&quot; not found.
                </Typography>
            </div>
        );
    }

    const content = (
        <CollectionPanelInner
            {...props}
            path={path}
            mergedCollection={mergedCollection}
        />
    );

    return (
        <CollectionScopeProvider collection={mergedCollection}>
            {content}
        </CollectionScopeProvider>
    );
}
