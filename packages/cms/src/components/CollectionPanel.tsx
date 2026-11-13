
import type { ViewMode, AdminCollection } from "@rebasepro/cms-types";
import type { FilterValues } from "@rebasepro/types";
import React, { useContext, useMemo, useRef, useState } from "react";
import { deepEqual } from "fast-equals";
import { CollectionViewBinding } from "./CollectionViewBinding/CollectionViewBinding";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { CircularProgressCenter, cls, Typography } from "@rebasepro/ui";
import { useComponentOverride, CollectionScopeProvider } from "@rebasepro/app";
import { CollectionsScopeContext, isRegistered } from "./CollectionsScopeContext";
import { CollectionsProvider } from "./CollectionsProvider";
import { collectionPropOf } from "./collection_prop";
import { warnDeprecated } from "@rebasepro/common";
import { ROW_ACTIONS_FIELD, RowActionsContext, type RowActionsRenderer } from "./CollectionViewBinding/RowActions";
import { ViewTitleReportContext } from "./CollectionViewBinding/CollectionViewContent";
import {
    CollectionSearchBar,
    CollectionToolbar,
    CollectionViewModeToggle
} from "./CollectionViewBinding/CollectionToolbar";
import { CollectionAddButton } from "./CollectionViewBinding/CollectionAddButton";

import type { TableDescriptor } from "@rebasepro/types";

/** A collection handed over as a value is shown on its own: no served table beside it. */
const NO_TABLES: readonly TableDescriptor[] = [];

/**
 * Props for the {@link CollectionPanel} component.
 *
 * This is a high-level, consumer-friendly wrapper around {@link CollectionViewBinding}
 * designed for embedding collection views inside custom pages (home pages,
 * dashboards, entity detail views, etc.).
 *
 * Name the collection — `collection="orders"`, one registered with
 * `<RebaseCMS>` or a {@link CollectionsProvider} above — or hand it over as a
 * value, `collection={ordersCollection}`. All other props are optional overrides that take precedence
 * over the collection's default configuration.
 *
 * @group Components
 */
export type CollectionPanelProps = CollectionPanelOptions & ({
    /**
     * The collection to display: its name (`"orders"`), registered with
     * `<RebaseCMS>` or a {@link CollectionsProvider} above, or the collection
     * as a value — a `defineFirestoreCollection`, or a table's collection you
     * built (`collectionFromTable`). Handed over as a value where no CMS
     * navigation is mounted above, the panel brings its own
     * {@link CollectionsProvider} for it, holding that collection alone, so
     * it works anywhere under `<Rebase>` and a router.
     */
    collection: AdminCollection | string;
    /**
     * Where the rows live, where that is not the collection's name: a
     * subcollection's full path, `posts/p1/comments`.
     */
    path?: string;
} | {
    /**
     * @deprecated Name the collection with `collection`:
     * `<CollectionPanel collection="orders"/>`. It warns once.
     */
    path: string;
    collection?: undefined;
});

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
     * @deprecated Use {@link orderBy}: `orderBy="field:desc"`. It warns once.
     */
    sort?: [string, "asc" | "desc"];

    /**
     * The order the rows open in, as `"field:desc"` or `["field", "desc"]`.
     * The person can still sort by another column.
     */
    orderBy?: `${string}:asc` | `${string}:desc` | readonly [string, "asc" | "desc"];

    /**
     * Your own JSX on every row, card and kanban card — an "Approve" button,
     * a "Ship" — handed the row as the server sends it and its id:
     *
     * ```tsx
     * <CollectionPanel collection="orders" rowActions={(row, id) =>
     *     <Button size="small" onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>}/>
     * ```
     *
     * In the table it is the last column; on a list row, a card and a kanban
     * card it sits beside the collection's own actions. A click on it does
     * not open the record.
     */
    rowActions?: RowActionsRenderer;

    /**
     * Maximum number of entities to display.
     */
    limit?: number;

    /**
     * Which rows the panel holds, as `useRows`' `where` takes it:
     * `{ status: ["==", "pending"] }`. The person's own filters on other
     * fields combine with it (AND); these fields cannot be changed or
     * cleared from the toolbar. It follows the prop, so a tab bar or a chart
     * click can drive it from state. Over the collection's `fixedFilter`,
     * field by field.
     */
    where?: FilterValues<string>;

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
     * For this panel it wins over the table's `fieldOrder` and `listFields`
     * (`customizeTable`), the column order the user saved, and what the cards
     * infer. Column widths the user drags still persist; the order is yours,
     * so columns are not dragged. A field customized `hidden` stays hidden,
     * and a custom view is handed the whole collection.
     */
    fields?: string[];

    /**
     * The toolbar above the rows.
     *
     * - `"full"`, the default: the collection page's own toolbar.
     * - `"compact"`: the view-mode switch, search, and New where the person
     *   may create.
     * - `"none"`: no toolbar.
     *
     * Or compose one from its pieces:
     *
     * ```tsx
     * <CollectionPanel collection="orders" toolbar={
     *     <CollectionToolbar
     *         start={<CollectionFiltersButton/>}
     *         end={<><CollectionSearchBar/><CollectionAddButton/></>}/>
     * }/>
     * ```
     */
    toolbar?: "full" | "compact" | "none" | React.ReactElement;

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
     * <CollectionPanel collection="orders"
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
 *             <CollectionPanel collection="tasks" title="Pending Tasks" />
 *             <CollectionPanel
 *                 collection="clients"
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
    rowActions,
    className
}: ScopedPanelProps & { mergedCollection: AdminCollection; overrides: Partial<AdminCollection> }) {
    const ResolvedCollectionView = useComponentOverride("Collection.View", CollectionViewBinding);
    const toolbarNode = toolbarOf(toolbar);
    const rowActionsScope = useMemo(
        () => rowActions ? { path: path ?? mergedCollection.slug, render: rowActions } : null,
        [path, mergedCollection.slug, rowActions]);
    // The list draws its title as its own heading: there the panel draws none,
    // and hands the view its title instead.
    const [viewDrawsTitle, setViewDrawsTitle] = useState(false);
    const titleReport = useMemo(
        () => ({ path: path ?? mergedCollection.slug, onViewDrawsTitle: setViewDrawsTitle }),
        [path, mergedCollection.slug]);

    // A column, so a height or a max-height on the panel reaches the view:
    // it sizes to its rows up to that, then scrolls inside.
    return (
        <div className={cls("flex flex-col min-h-0", className)}>
            {title !== false && !viewDrawsTitle && (
                <Typography
                    variant="subtitle2"
                    className="font-semibold mb-2 text-surface-700 dark:text-surface-300"
                >
                    {title ?? mergedCollection.name}
                </Typography>
            )}
            <RowActionsContext.Provider value={rowActionsScope}>
                <ViewTitleReportContext.Provider value={titleReport}>
                    <ResolvedCollectionView
                        {...mergedCollection}
                        collectionOverrides={overrides}
                        {...(highlightedIds !== undefined && { highlightedIds })}
                        {...(viewMode && { viewMode })}
                        {...(fields && { fields })}
                        {...(toolbarNode !== undefined && { toolbar: toolbarNode })}
                        {...(onRowClick && { onRowClick })}
                        {...(title !== undefined && { title })}
                        path={path}
                        updateUrl={updateUrl}
                    />
                </ViewTitleReportContext.Provider>
            </RowActionsContext.Provider>
        </div>
    );
}

export function CollectionPanel(rawProps: CollectionPanelProps) {
    const inScope = useContext(CollectionsScopeContext);
    const collectionRegistry = useCollectionRegistryController();
    const navigationState = useNavigationStateController();
    const { collection, path } = collectionPropOf(rawProps.collection, rawProps.path);
    if (rawProps.collection === undefined) {
        warnDeprecated("CollectionPanel.path", "`<CollectionPanel path=\"…\"/>` names its collection with `collection` now: `<CollectionPanel collection=\"…\"/>`.");
    }
    const props: ScopedPanelProps = { ...rawProps, collection, path };
    const ownCollections = useMemo(() => collection ? [collection] : [], [collection]);

    // A collection handed over as a value brings its own scope where there is
    // none above — or where the one above has settled without it, since a
    // collection the data layer does not know gives its rows no address.
    const needsOwnScope = collection !== undefined && (!inScope
        || (!navigationState.loading && !isRegistered(collectionRegistry.collections, path)));
    // Named by path with no scope above to look it up in: nothing will ever
    // register it, so it is not found rather than loading.
    if (!inScope && collection === undefined) return <CollectionNotFound className={props.className} path={path}/>;
    if (needsOwnScope) {
        return (
            <CollectionsProvider externalCollections={ownCollections} tables={NO_TABLES}>
                <CollectionPanelInScope {...props}/>
            </CollectionsProvider>
        );
    }
    return <CollectionPanelInScope {...props}/>;
}

/** A panel's props once its `collection` is a value or absent, and its `path` known. */
type ScopedPanelProps = CollectionPanelOptions & { collection?: AdminCollection; path: string };

function CollectionPanelInScope(props: ScopedPanelProps) {
    const {
        viewMode,
        sort,
        limit,
        openEntityMode,
        className,
        collectionOverrides,
        where,
        orderBy,
        rowActions,
        collection: collectionProp
    } = props;
    if (sort !== undefined) warnDeprecated("CollectionPanel.sort", "`CollectionPanel`'s `sort` is `orderBy` now: `orderBy=\"field:desc\"`.");
    const order = orderBy ? orderByTuple(orderBy) : sort;
    const orderKey = order ? order.join(":") : undefined;
    // Whether, not which: the column reads the renderer through context, so a
    // new function each render leaves the collection alone.
    const hasRowActions = rowActions !== undefined;
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
    // Compared by value: it is an inline object at most call sites, and a new
    // one on every render would rebuild the overrides each time.
    const whereRef = useRef(where);
    if (!deepEqual(whereRef.current, where)) whereRef.current = where;
    const stableWhere = whereRef.current;

    // What this panel changes about the collection: the shorthand props over
    // the explicit overrides. Handed to the view as overrides, which it applies
    // over the registered collection it draws.
    const overrides = useMemo<Partial<AdminCollection>>(() => {
        const merged: Partial<AdminCollection> = {
            ...(collectionOverrides ?? {}),
            ...(viewMode && { defaultViewMode: viewMode }),
            ...(order && { sort: order }),
            ...(limit && { pagination: limit }),
            ...(openEntityMode && { openEntityMode }),
            ...(stableWhere && {
                fixedFilter: { ...(baseCollection?.fixedFilter ?? {}), ...(collectionOverrides?.fixedFilter ?? {}), ...stableWhere }
            }),
            ...(hasRowActions && {
                additionalFields: [...(collectionOverrides?.additionalFields ?? baseCollection?.additionalFields ?? []), ROW_ACTIONS_FIELD]
            })
        };
        // Without CMS routes a record has no page of its own, nor a split
        // beside the list that a URL selects: it opens over the page.
        if (!routesMounted && (merged.openEntityMode ?? baseCollection?.openEntityMode) !== "dialog") {
            return { ...merged, openEntityMode: "side_panel" };
        }
        return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `order` by its key: `orderBy` is an inline tuple at most call sites.
    }, [baseCollection, collectionOverrides, viewMode, orderKey, limit, openEntityMode, stableWhere, hasRowActions, routesMounted]);

    const mergedCollection = useMemo(
        () => baseCollection ? { ...baseCollection, ...overrides } as AdminCollection : undefined,
        [baseCollection, overrides]);

    if (!mergedCollection) {
        if (navigationState.loading) {
            return <div className={className}><CircularProgressCenter/></div>;
        }
        return <CollectionNotFound className={className} path={path}/>;
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

function CollectionNotFound({ className, path }: { className?: string, path: string }) {
    return (
        <div className={className}>
            <Typography variant="body2" color="secondary">
                Collection &quot;{path}&quot; not found.
            </Typography>
        </div>
    );
}

/** `"field:desc"` or `["field", "desc"]`, as the collection's `sort` takes it. */
function orderByTuple(orderBy: NonNullable<CollectionPanelOptions["orderBy"]>): [string, "asc" | "desc"] {
    if (typeof orderBy !== "string") return [orderBy[0], orderBy[1]];
    const at = orderBy.lastIndexOf(":");
    return [orderBy.slice(0, at), orderBy.slice(at + 1) as "asc" | "desc"];
}

/** The node a `toolbar` keyword stands for; a composed toolbar as it is. */
function toolbarOf(toolbar: CollectionPanelOptions["toolbar"]): React.ReactNode {
    if (toolbar === "full") return undefined;
    if (toolbar === "none") return null;
    if (toolbar === "compact") return COMPACT_TOOLBAR;
    return toolbar;
}

const COMPACT_TOOLBAR = (
    <CollectionToolbar
        start={<CollectionViewModeToggle/>}
        end={<><CollectionSearchBar/><CollectionAddButton/></>}/>
);
