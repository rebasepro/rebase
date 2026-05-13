import type { EntityCollection, ViewMode } from "@rebasepro/types";
import { Blocker, useBlocker, useLocation } from "react-router";
import { EntityEditView } from "../components/EntityEditView";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EntityCollectionView } from "../components";
import { NotFoundPage, useUserConfigurationPersistence } from "@rebasepro/core";
import { UnsavedChangesDialog } from "@rebasepro/core";
import { CircularProgressCenter } from "@rebasepro/ui";
import { getNavigationEntriesFromPath, NavigationViewCollectionInternal, NavigationViewEntityCustomInternal, NavigationViewInternal } from "@rebasepro/common";
import { toArray } from "@rebasepro/utils";
import { useCollectionRegistryController, useUrlController } from "../index";
import { useBreadcrumbsController } from "../index";

export function RebaseRoute() {

    const location = useLocation();
    const collectionRegistry = useCollectionRegistryController();
    const urlController = useUrlController();
    const breadcrumbs = useBreadcrumbsController();
    const userConfigPersistence = useUserConfigurationPersistence();

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
        const lastEntry = navigationEntries[navigationEntries.length - 1];
        const isViewingCollection = lastEntry?.type === "collection";

        breadcrumbs.set({
            breadcrumbs: navigationEntries.map((entry, index) => {
                const isLastEntry = index === navigationEntries.length - 1;

                if (entry.type === "entity") {
                    return ({
                        title: String(entry.entityId),
                        url: urlController.buildUrlCollectionPath(entry.path)
                        // count: undefined (not applicable for entities)
                    });
                } else if (entry.type === "custom_view") {
                    return ({
                        title: String(entry.view.name ?? entry.view.key),
                        url: urlController.buildUrlCollectionPath(entry.path)
                        // count: undefined (not applicable for custom views)
                    });
                } else if (entry.type === "collection") {
                    const showCount = isLastEntry && isViewingCollection;
                    return ({
                        title: entry.collection.name,
                        url: urlController.buildUrlCollectionPath(entry.path),
                        id: entry.path,
                        ...(showCount ? { count: null } : {})
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
        let collection: EntityCollection<any> | undefined;
        collection = collectionRegistry.getCollection(navigationEntries[0].id);
        if (!collection)
            collection = collectionRegistry.getCollection(navigationEntries[0].slug);
        if (!collection) {
            if (!collectionRegistry.initialised) {
                return <CircularProgressCenter/>;
            }
            return null;
        }
        return <EntityCollectionView
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
            let collection: EntityCollection<any> | undefined;
            const firstEntry = navigationEntries[0] as NavigationViewCollectionInternal<any>;
            collection = collectionRegistry.getCollection(firstEntry.id);
            if (!collection)
                collection = collectionRegistry.getCollection(firstEntry.slug);
            if (!collection) {
                if (!collectionRegistry.initialised) {
                    return <CircularProgressCenter/>;
                }
                return null;
            }
            return <EntityCollectionView
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
        let collection: EntityCollection<any> | undefined;
        collection = collectionRegistry.getCollection(firstCollectionEntry.id);
        if (!collection)
            collection = collectionRegistry.getCollection(firstCollectionEntry.slug);

        // Resolve the effective openEntityMode based on the current view mode.
        // Priority: collection.openEntityMode (explicit) > view-mode-based default.
        // View mode priority: URL __view param > saved user config > collection default.
        let effectiveOpenMode: "side_panel" | "full_screen" | "split" | undefined = collection?.openEntityMode;
        if (!effectiveOpenMode && collection) {
            const urlViewParam = new URLSearchParams(location.search).get("__view");
            let currentViewMode: ViewMode = collection.defaultViewMode ?? "list";
            if (urlViewParam && ["list", "table", "kanban", "cards"].includes(urlViewParam)) {
                currentViewMode = urlViewParam as ViewMode;
            } else {
                const savedView = userConfigPersistence?.getCollectionConfig(collection.slug)?.defaultViewMode;
                if (savedView) currentViewMode = savedView as ViewMode;
            }
            if (currentViewMode === "kanban") effectiveOpenMode = "side_panel";
            else if (currentViewMode === "table" || currentViewMode === "cards") effectiveOpenMode = "full_screen";
            else effectiveOpenMode = "split";
        }
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
            return <EntityCollectionView
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
            if (trailingSegment.length > 0) {
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

    let blocker: Blocker | undefined = undefined;
    try {
        blocker = useBlocker(({
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
        });
    } catch (e) {
        // console.warn("Blocker not available, navigation will not be blocked");
    }

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
    return <>
        <EntityEditView
            key={collection.slug + "_" + (isNew ? "new" : (isCopy ? entityId + "_copy" : entityId))}
            entityId={isNew ? undefined : entityId}
            collection={collection}
            layout={"full_screen"}
            path={collectionPath}
            copy={isCopy}
            selectedTab={selectedTab ?? undefined}
            defaultValues={isNew ? defaultValues : undefined}
            onValuesModified={(modified) => blocked.current = modified}
            onSaved={(params) => {
                const newSelectedTab = params.selectedTab;
                const newEntityId = params.entityId;
                // Clear the hash after saving a new entity — preserving #new
                // would cause the route to re-parse as "new" and show "not found".
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
