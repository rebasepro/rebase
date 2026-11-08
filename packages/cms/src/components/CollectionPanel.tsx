
import type { ViewMode, AdminCollection } from "@rebasepro/cms-types";
import React, { useContext, useMemo } from "react";
import { CollectionViewBinding } from "./CollectionViewBinding/CollectionViewBinding";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { CircularProgressCenter, cls, Typography } from "@rebasepro/ui";
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
     * The view mode the panel opens in, over the collection's default, the
     * one in the URL and the one the person last picked. They can still
     * switch.
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
     * The ids of the rows drawn as selected — the one a page shows beside
     * the list, say. `[]` draws none. Without it the panel highlights the
     * row last opened. Compared as strings, so an integer key's `5` and
     * `"5"` are one row.
     */
    highlightedIds?: (string | number)[];

    /**
     * Additional CSS class name for the container.
     */
    className?: string;

    /**
     * Any additional collection-level overrides (e.g. `previewProperties`,
     * `enabledViews`, `entityActions`, `defaultFilter`, etc.).
     */
    collectionOverrides?: Partial<AdminCollection>;

    /**
     * The properties the panel shows, in this order; the ones it leaves out
     * are not drawn.
     *
     * - Table: the columns.
     * - List, cards, kanban cards: what the row's or card's places — title,
     *   image, subtitle, status, date, relation chips, the list's columns —
     *   are filled from, earlier ones first. A place none of them fills
     *   stays empty.
     *
     * For this panel it wins over `propertiesOrder`, the column order the
     * user saved, `listProperties` and what the cards infer. Column widths
     * the user drags still persist; the order is yours, so columns are not
     * dragged. A property hidden from collections stays hidden, and a
     * custom view is handed the whole collection.
     */
    fields?: string[];

    /**
     * The toolbar above the rows. Defaults to the full toolbar; `null` draws
     * none. Compose a smaller one from its pieces:
     *
     * ```tsx
     * <CollectionPanel path="orders" toolbar={
     *     <CollectionToolbar
     *         start={<CollectionFiltersButton/>}
     *         end={<><CollectionSearchBar/><CollectionAddButton/></>}/>
     * }/>
     * ```
     */
    toolbar?: React.ReactNode;

    /**
     * Called with the row and its id when one is clicked, instead of the
     * panel opening it. Without it the record opens as `openEntityMode` says.
     *
     * The row is the one the server sends — the shape `useRows`, `useRow`
     * and `FieldValue` take: ISO date strings (`YYYY-MM-DD` for a date-only
     * column), and a belongsTo relation as its foreign key, under that key's
     * own name. It is exactly the record's columns; the id is the string the
     * admin addresses the record by — its primary key, a composite one's
     * parts joined by `:::` — which `highlightedIds` and
     * `useSidePanel().open` take.
     *
     * ```tsx
     * const [selectedId, setSelectedId] = useState<string>();
     * <CollectionPanel path="orders"
     *     onRowClick={(row, id) => setSelectedId(id)}
     *     highlightedIds={selectedId ? [selectedId] : []}/>
     * ```
     */
    onRowClick?: (row: Record<string, unknown>, id: string) => void;
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
    overrides,
    path,
    title,
    viewMode,
    updateUrl,
    highlightedIds,
    fields,
    toolbar,
    onRowClick,
    className
}: CollectionPanelProps & { mergedCollection: AdminCollection; overrides: Partial<AdminCollection> }) {
    const ResolvedCollectionView = useComponentOverride("Collection.View", CollectionViewBinding);

    // A column, so a height or a max-height on the panel reaches the view:
    // it sizes to its rows up to that, then scrolls inside.
    return (
        <div className={cls("flex flex-col min-h-0", className)}>
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
                collectionOverrides={overrides}
                {...(highlightedIds !== undefined && { highlightedIds })}
                {...(viewMode && { viewMode })}
                {...(fields && { fields })}
                {...(toolbar !== undefined && { toolbar })}
                {...(onRowClick && { onRowClick })}
                {...(title === false && { title })}
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

    // What this panel changes about the collection: the shorthand props over
    // the explicit overrides. Handed to the view as overrides, which it applies
    // over the registered collection it draws.
    const overrides = useMemo<Partial<AdminCollection>>(() => {
        const merged: Partial<AdminCollection> = {
            ...(collectionOverrides ?? {}),
            ...(viewMode && { defaultViewMode: viewMode }),
            ...(sort && { sort }),
            ...(limit && { pagination: limit }),
            ...(openEntityMode && { openEntityMode })
        };
        // Without CMS routes a record has no page of its own, nor a split
        // beside the list that a URL selects: it opens over the page.
        if (!routesMounted && (merged.openEntityMode ?? baseCollection?.openEntityMode) !== "dialog") {
            return { ...merged, openEntityMode: "side_panel" };
        }
        return merged;
    }, [baseCollection, collectionOverrides, viewMode, sort, limit, openEntityMode, routesMounted]);

    const mergedCollection = useMemo(
        () => baseCollection ? { ...baseCollection, ...overrides } as AdminCollection : undefined,
        [baseCollection, overrides]);

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
            overrides={overrides}
        />
    );

    return (
        <CollectionScopeProvider collection={mergedCollection}>
            {content}
        </CollectionScopeProvider>
    );
}
