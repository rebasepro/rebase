
import type { ViewMode, AdminCollection } from "@rebasepro/admin-types";
import { useLocation } from "react-router";
import { EditViewBinding } from "../components/EditViewBinding";
import { DetailViewBinding } from "../components/DetailViewBinding";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CollectionViewBinding } from "../components/CollectionViewBinding/CollectionViewBinding";
import { ErrorView, NotFoundPage, useUserConfigurationPersistence, useComponentOverride, useNavigationBlocker } from "@rebasepro/app";
import { resolveOpenEntityMode, resolveViewMode } from "../util/view_mode";
import { UnsavedChangesDialog } from "@rebasepro/app";
import { CenteredView, CircularProgressCenter } from "@rebasepro/ui";
import { NavigationViewCollectionInternal, NavigationViewEntityCustomInternal, NavigationViewInternal } from "@rebasepro/app";
import { getNavigationEntriesFromPath } from "@rebasepro/app";
import { toArray } from "@rebasepro/utils";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useUrlController } from "../hooks/navigation/contexts/UrlContext";
import { useBreadcrumbsController } from "../hooks/useBreadcrumbsController";

export function RebaseRoute() {

    const location = useLocation();
    const collectionRegistry = useCollectionRegistryController();
    const urlController = useUrlController();
    const breadcrumbs = useBreadcrumbsController();
    const userConfigPersistence = useUserConfigurationPersistence();
    const ResolvedCollectionView = useComponentOverride("Collection.View", CollectionViewBinding);

    const hash = location.hash;
    const isSidePanel = hash.includes("#side");
    const isNew = hash.includes("#new") || hash.includes("#new_side");
    const isCopy = hash.includes("#copy");
    const isFullScreen = hash.includes("#full");

    const pathname = location.pathname;
    const navigationPath = urlController.urlPathToDataPath(pathname);

    const navigationEntries = getNavigationEntriesFromPath({
        path: navigationPath,
        collections: collectionRegistry.collections ?? []
    });

    useEffect(() => {
        breadcrumbs.set({
            breadcrumbs: navigationEntries.map((entry) => {

                if (entry.type === "entity") {
                    return ({
                        title: String(entry.entityId),
                        url: urlController.buildUrlCollectionPath(entry.path)
                    });
                } else if (entry.type === "custom_view") {
                    return ({
                        title: String(entry.view.name ?? entry.view.key),
                        url: urlController.buildUrlCollectionPath(entry.path)
                    });
                } else if (entry.type === "collection") {
                    return ({
                        title: entry.collection.name,
                        url: urlController.buildUrlCollectionPath(entry.path),
                        id: entry.path
                    });
                } else {
                    throw new Error("Unexpected navigation entry type");
                }
            })
        });
    }, [navigationEntries.map(entry => entry.path).join(",")]);

    if (isNew) {
        // New entities always use full-screen mode, even for split-layout collections
        return <EntityFullScreenRoute
            pathname={pathname}
            navigationEntries={navigationEntries}
            isNew={true}
            isCopy={false}
        />;
    }

    if (navigationEntries.length === 1 && navigationEntries[0].type === "collection") {
        let collection: AdminCollection<any> | undefined;
        collection = collectionRegistry.getCollection(navigationEntries[0].id);
        if (!collection)
            collection = collectionRegistry.getCollection(navigationEntries[0].slug);
        if (!collection) {
            if (!collectionRegistry.initialised) {
                return <CircularProgressCenter/>;
            }
            return <UnresolvedCollectionView path={navigationEntries[0].slug}/>;
        }
        return <ResolvedCollectionView
            key={`collection_view_${collection.slug}`}
            {...collection}
            parentCollectionSlugs={[]} parentEntityIds={[]}
            path={collection.slug}
            updateUrl={true}
            Actions={toArray(collection.Actions)}/>
    }

    if (isSidePanel) {
        const lastCollectionEntry = [...navigationEntries].reverse().find((entry) => entry.type === "collection");
        if (lastCollectionEntry) {
            let collection: AdminCollection<any> | undefined;
            const firstEntry = navigationEntries[0] as NavigationViewCollectionInternal<any>;
            collection = collectionRegistry.getCollection(firstEntry.id);
            if (!collection)
                collection = collectionRegistry.getCollection(firstEntry.slug);
            if (!collection) {
                if (!collectionRegistry.initialised) {
                    return <CircularProgressCenter/>;
                }
                return <UnresolvedCollectionView path={firstEntry.slug}/>;
            }
            return <ResolvedCollectionView
                key={`collection_view_${collection.slug}`}
                {...collection}
                parentCollectionSlugs={[]} parentEntityIds={[]}
                path={collection.slug}
                updateUrl={true}
                Actions={toArray(collection.Actions)}/>;
        }
    }

    // Check if this is a simple entity route (collection + entity) for a split-layout collection.
    // If so, render the collection view with the entity shown in the split detail panel
    // instead of the full-screen editor. This keeps the master-detail UX with clean URLs.
    //
    // Also handles subcollection tabs: /c/customers/39/orders produces 3 entries
    // (collection→entity→subcollection). We extract the subcollection slug as selectedTab.
    const lastEntityEntry = navigationEntries.find((entry) => entry.type === "entity");
    const firstCollectionEntry = navigationEntries[0];
    if (
        !isFullScreen &&
        !isCopy &&
        firstCollectionEntry?.type === "collection" &&
        lastEntityEntry?.type === "entity" &&
        (navigationEntries.length === 2 || navigationEntries.length === 3)
    ) {
        let collection: AdminCollection<any> | undefined;
        collection = collectionRegistry.getCollection(firstCollectionEntry.id);
        if (!collection)
            collection = collectionRegistry.getCollection(firstCollectionEntry.slug);

        const effectiveOpenMode = collection
            ? resolveOpenEntityMode({
                collection,
                viewMode: resolveViewMode({
                    collection,
                    search: location.search,
                    savedViewMode: userConfigPersistence?.getCollectionConfig(collection.slug)?.defaultViewMode as ViewMode | undefined
                })
            })
            : undefined;
        if (collection && effectiveOpenMode === "split") {
            // Extract subcollection tab from the 3rd entry if present
            let selectedTab: string | undefined;
            if (navigationEntries.length === 3) {
                const thirdEntry = navigationEntries[2];
                if (thirdEntry.type === "collection") {
                    selectedTab = thirdEntry.collection.slug;
                } else if (thirdEntry.type === "custom_view") {
                    selectedTab = thirdEntry.view.key;
                }
            }
            // Fallback: check for unregistered tabs (e.g. __json, __rebase_history)
            // that aren't parsed as navigation entries
            if (!selectedTab && (navigationEntries.length === 2) && lastEntityEntry) {
                const entityIdStr = String(lastEntityEntry.entityId);
                const entityIdIdx = pathname.lastIndexOf(`/${entityIdStr}`);
                if (entityIdIdx >= 0) {
                    const afterEntity = pathname.substring(entityIdIdx + 1 + entityIdStr.length);
                    const trailingSegment = afterEntity.startsWith("/") ? afterEntity.substring(1) : afterEntity;
                    if (trailingSegment.length > 0) {
                        selectedTab = trailingSegment;
                    }
                }
            }
            return <ResolvedCollectionView
                key={`collection_view_${collection.slug}`}
                {...collection}
                parentCollectionSlugs={[]} parentEntityIds={[]}
                path={collection.slug}
                updateUrl={true}
                selectedEntityId={lastEntityEntry.entityId}
                selectedTab={selectedTab}
                Actions={toArray(collection.Actions)}/>;
        }
    }

    return <EntityFullScreenRoute
        pathname={pathname}
        navigationEntries={navigationEntries}
        isNew={isNew}
        isCopy={isCopy}
    />;

}

function getSelectedTabFromUrl(isNew: boolean, lastCustomView: NavigationViewCollectionInternal<any> | NavigationViewEntityCustomInternal<any> | undefined) {
    if (isNew) {
        return undefined;
    } else if (lastCustomView) {
        if (lastCustomView.type === "custom_view") {
            return lastCustomView.view.key;
        } else if (lastCustomView.type === "collection") {
            return lastCustomView.id ?? lastCustomView.slug;
        }
    }
    return undefined;
}

function EntityFullScreenRoute({
    pathname,
    navigationEntries,
    isNew,
    isCopy
}: {
    pathname: string;
    navigationEntries: NavigationViewInternal[],
    isNew: boolean,
    isCopy: boolean
}) {

    const collectionRegistry = useCollectionRegistryController();
    const urlController = useUrlController();
    const navigate = useNavigate();
    const location = useLocation();
    const userConfigPersistence = useUserConfigurationPersistence();

    // defaultValues may be carried via location.state when openNewDocument() is called
    // for full-screen mode. We read it once on mount — after that, the form owns its state.
    const defaultValues = (location.state as { defaultValues?: Record<string, unknown> } | null)?.defaultValues;

    // Preserve the current hash (e.g. #full) across tab/save navigations
    const hash = location.hash;

    const navigationPath = urlController.urlPathToDataPath(pathname);

    // is navigating away blocked
    const blocked = useRef(false);

    const lastEntityEntry = [...navigationEntries].reverse().find((entry) => entry.type === "entity");
    const navigationEntriesAfterEntity = lastEntityEntry ? navigationEntries.slice(navigationEntries.indexOf(lastEntityEntry) + 1) : [];

    const lastCustomView = [...navigationEntriesAfterEntity].reverse().find(
        (entry) => entry.type === "custom_view" || entry.type === "collection"
    ) as NavigationViewCollectionInternal<any> | NavigationViewEntityCustomInternal<any> | undefined;

    const entityId = lastEntityEntry && "entityId" in lastEntityEntry ? lastEntityEntry.entityId : undefined;

    // Derive tab from navigation entries (works for registered custom views)
    let urlTab = getSelectedTabFromUrl(isNew, lastCustomView);

    // Fallback: internal tabs like __json or __rebase_history aren't registered as
    // entity views, so the navigation parser ignores them. Check the raw pathname
    // for a trailing segment after the entity ID to catch those cases.
    if (!urlTab && entityId && !isNew) {
        const entityIdStr = String(entityId);
        const entityIdIdx = pathname.lastIndexOf(`/${entityIdStr}`);
        if (entityIdIdx >= 0) {
            const afterEntity = pathname.substring(entityIdIdx + 1 + entityIdStr.length);
            const trailingSegment = afterEntity.startsWith("/") ? afterEntity.substring(1) : afterEntity;
            if (trailingSegment.length > 0 && trailingSegment !== "edit") {
                urlTab = trailingSegment;
            }
        }
    }

    const [selectedTab, setSelectedTab] = useState<string | undefined>(urlTab);

    const parentCollectionSlugs = collectionRegistry.getParentCollectionSlugs(navigationPath);
    const parentEntityIds = collectionRegistry.getParentEntityIds(navigationPath);
    useEffect(() => {
        if (urlTab !== selectedTab) {
            setSelectedTab(urlTab);
        }
    }, [urlTab]);

    const basePath = !entityId || isNew
        ? pathname
        : pathname.substring(0, pathname.lastIndexOf(`/${entityId}`));

    const entityPath = basePath + `/${entityId}`;

    const blocker = useNavigationBlocker(useCallback(({
        currentLocation,
        nextLocation
    }) => {
        if (nextLocation.pathname.startsWith(entityPath))
            return false;

        // Side panel overlay navigations preserve the underlying form via
        // base_location in router state — no data is lost in either direction.

        // Opening a side panel (e.g. clicking a relation arrow)
        const nextHash = nextLocation.hash;
        if (nextHash === "#side" || nextHash === "#new_side")
            return false;

        // Closing a side panel (navigate(-1) back to the form's own path)
        const currentHash = currentLocation.hash;
        if ((currentHash === "#side" || currentHash === "#new_side") &&
            (nextLocation.pathname === basePath ||
             nextLocation.pathname.startsWith(entityPath)))
            return false;

        return blocked.current;
    }, [entityPath, basePath]));

    const lastCollectionEntry = [...navigationEntries].reverse().find((entry) => entry.type === "collection");

    if (isNew && !lastCollectionEntry) {
        if (!collectionRegistry.initialised) {
            return <CircularProgressCenter/>;
        }
        throw new Error("INTERNAL: No collection found in the navigation");
    }

    if (!isNew && !lastEntityEntry) {
        if (!collectionRegistry.initialised) {
            return <CircularProgressCenter/>;
        }
        return <NotFoundPage/>;
    }

    const rawCollection = isNew
        ? (lastCollectionEntry && "collection" in lastCollectionEntry ? lastCollectionEntry.collection : undefined)!
        : (lastEntityEntry && "parentCollection" in lastEntityEntry ? lastEntityEntry.parentCollection : undefined)!;
    const collection = collectionRegistry.getCollection(rawCollection.slug) || rawCollection;
    const fullIdPath = isNew ? lastCollectionEntry!.slug : lastEntityEntry!.slug;
    const collectionPath = urlController.resolveDatabasePathsFrom(fullIdPath);
    const isEditRoute = pathname.endsWith("/edit") || pathname.split("/").pop() === "edit";
    // Determine if this is a detail-view-first collection showing the view page
    const isDetailMode = collection.defaultEntityAction === "view" && !isNew && !isCopy && entityId && !isEditRoute;

    // A record is full screen either because its collection has no list to show
    // beside it, or because the user folded that list away. Only the second is
    // reversible, and it is reversible by dropping `#full` alone: this is the
    // same URL the split route reads, so the same conditions decide it.
    const splitListAvailable = !isNew && !isCopy && entityId !== undefined &&
        navigationEntries[0]?.type === "collection" &&
        (navigationEntries.length === 2 || navigationEntries.length === 3) &&
        resolveOpenEntityMode({
            collection,
            viewMode: resolveViewMode({
                collection,
                search: location.search,
                savedViewMode: userConfigPersistence?.getCollectionConfig(collection.slug)?.defaultViewMode as ViewMode | undefined
            })
        }) === "split";

    const showList = splitListAvailable
        ? () => navigate({
            pathname,
            search: location.search,
            hash: ""
        })
        : undefined;

    if (isDetailMode) {
        return <>
            <DetailViewBinding
                key={collection.slug + "_view_" + entityId}
                entityId={entityId}
                collection={collection}
                layout={"full_screen"}
                path={collectionPath}
                selectedTab={selectedTab ?? undefined}
                onShowList={showList}
                onEditClick={() => {
                    const editUrl = urlController.buildUrlCollectionPath(`${collectionPath}/${entityId}`) + "/edit";
                    navigate(editUrl + hash);
                }}
                onTabChange={(params) => {
                    setSelectedTab(params.selectedTab);
                    const newSelectedTab = params.selectedTab;
                    if (newSelectedTab) {
                        navigate(`${basePath}/${entityId}/${newSelectedTab}${hash}`, { replace: true });
                    } else {
                        navigate(`${basePath}/${entityId}${hash}`, { replace: true });
                    }
                }}
                parentCollectionSlugs={parentCollectionSlugs}
                parentEntityIds={parentEntityIds}
            />
        </>;
    }

    return <>
        <EditViewBinding
            key={collection.slug + "_" + (isNew ? "new" : (isCopy ? entityId + "_copy" : entityId))}
            entityId={isNew ? undefined : entityId}
            collection={collection}
            layout={"full_screen"}
            path={collectionPath}
            copy={isCopy}
            selectedTab={selectedTab ?? undefined}
            onShowList={showList}
            defaultValues={isNew ? defaultValues : undefined}
            onValuesModified={(modified) => blocked.current = modified}
            navigateBack={() => {
                const detailUrl = urlController.buildUrlCollectionPath(`${collectionPath}/${entityId}`);
                navigate(detailUrl + hash);
            }}
            onSaved={(params) => {
                const newSelectedTab = params.selectedTab;
                const newEntityId = params.entityId;
                const savedHash = isNew ? "" : hash;
                if (newSelectedTab) {
                    navigate(`${basePath}/${newEntityId}/${newSelectedTab}${savedHash}`, { replace: true });
                } else {
                    navigate(`${basePath}/${newEntityId}${savedHash}`, { replace: true });
                }
            }}
            onTabChange={(params) => {
                setSelectedTab(params.selectedTab);
                if (isNew) {
                    return;
                }
                const newSelectedTab = params.selectedTab;
                if (newSelectedTab) {
                    navigate(`${basePath}/${entityId}/${newSelectedTab}${hash}`, { replace: true });
                } else {
                    navigate(`${basePath}/${entityId}${hash}`, { replace: true });
                }
            }}
            parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}
        />

        <UnsavedChangesDialog
            open={blocker?.state === "blocked"}
            handleOk={() => blocker?.proceed?.()}
            handleCancel={() => blocker?.reset?.()}
            body={"You have unsaved changes in this entity."}/>
    </>;
}

/**
 * Shown when a URL names a collection the registry cannot resolve.
 *
 * This used to be `return null`, which renders an empty pane inside the app
 * chrome: the sidebar, the nav highlight and the breadcrumb all still work,
 * because those read the collections array directly, while the view itself is
 * blank. Nothing is thrown, and the only trace is a `console.debug` — so the
 * panel looks like it lost its data rather than like it failed to find the
 * collection, and there is no string to search for.
 *
 * A slug containing slashes went unresolvable this way and cost an afternoon to
 * find. The lookup is fixed; this is the part that made it expensive.
 */
function UnresolvedCollectionView({ path }: { path: string }) {
    // Warn, not debug: this is a route that renders nothing useful, and it
    // should be visible at the console's default level.
    useEffect(() => {
        console.warn(
            `[rebase] No collection is registered for "${path}", so this route has nothing to render. ` +
            "Check that the collection is in the collections array and that its slug matches the URL."
        );
    }, [path]);

    return <CenteredView>
        <ErrorView
            title={"Collection not found"}
            error={`Nothing is registered for "${path}".`}
            tooltip={"The URL names a collection the panel does not know about. It may have been renamed or removed from the collections array, or the slug may not match the path."}/>
    </CenteredView>;
}
