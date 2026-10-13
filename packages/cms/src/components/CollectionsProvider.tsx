import React, { useCallback, useContext, useEffect, useId, useMemo, useRef } from "react";
import {
    CollectionResolverRegistrationContext,
    RebaseDataContext,
    StudioBridgeRegistryContext,
    useAdminModeController,
    useCustomizationController,
    useData,
    useDataSources,
    useRebaseContext,
    useUserConfigurationPersistence
} from "@rebasepro/app";
import { buildRoutedRebaseData, CollectionRegistry, resolveDataSource } from "@rebasepro/common";
import { resolveAdminCollection } from "@rebasepro/cms-types";
import type { AdminCollection, AppView, RebasePlugin, UrlController } from "@rebasepro/cms-types";

import { useBuildCollectionRegistryController } from "../hooks/navigation/useBuildCollectionRegistryController";
import { useBuildUrlController } from "../hooks/navigation/useBuildUrlController";
import { useBuildNavigationStateController } from "../hooks/navigation/useBuildNavigationStateController";
import { CollectionRegistryContext } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { UrlContext } from "../hooks/navigation/contexts/UrlContext";
import { NavigationStateContext } from "../hooks/navigation/contexts/NavigationStateContext";
import { SidePanelProvider } from "./SidePanelProvider";
import { SideDialogs } from "./SideDialogs";
import { CollectionsScopeContext } from "./CollectionsScopeContext";

const EMPTY_PLUGINS: RebasePlugin[] = [];

/**
 * Whether `path` starts with a collection this registry holds — the longest
 * leading run of whole segments, since a slug may contain slashes.
 */
function holdsLeadingCollection(registry: CollectionRegistry, path: string): boolean {
    const segments = path.split("/").filter(Boolean);
    for (let length = segments.length; length > 0; length--) {
        if (registry.get(segments.slice(0, length).join("/"))) return true;
    }
    return false;
}
const NO_VIEWS: AppView[] = [];

/**
 * @group Components
 */
export interface CollectionsProviderProps {
    /**
     * The collections this scope can show and edit — `defineCollection`
     * configs or resolved collections. Keep the array stable (a module
     * constant, or `useMemo`): a new array is a new set of collections.
     */
    collections: AdminCollection[];
    children: React.ReactNode;
}

/**
 * Everything a collection view or a record form needs to work in a page of
 * your own app, without `<RebaseCMS>`, `<RebaseNavigation>` or
 * `<RebaseShell>`: a registry of the collections you hand it, the record side
 * panel and dialogs (rendered here), and the navigation guard.
 *
 * It needs `<Rebase>` above it and a React Router router — any router, at any
 * path; a data router is not required. No CMS route serves the page, so a
 * record opens in a side panel or a dialog over it, never by URL.
 *
 * `CollectionPanel` and `EntityFormPanel` given a `collection` bring one of
 * these themselves when none is above; mount it yourself to share one between
 * several of them, or to use the lower-level pieces (`CollectionViewBinding`,
 * `useSidePanel`) directly.
 *
 * @example
 * ```tsx
 * <Rebase client={client} authController={authController}>
 *     <BrowserRouter>
 *         <CollectionsProvider collections={[postsCollection, authorsCollection]}>
 *             <CollectionPanel path="posts"/>
 *             <CollectionPanel path="authors"/>
 *         </CollectionsProvider>
 *     </BrowserRouter>
 * </Rebase>
 * ```
 *
 * @group Components
 */
export function CollectionsProvider({ collections, children }: CollectionsProviderProps) {
    const context = useRebaseContext();
    const adminModeController = useAdminModeController();
    const userConfigPersistence = useUserConfigurationPersistence();
    const customizationController = useCustomizationController();
    const dataSources = useDataSources();
    const collectionRegistryController = useBuildCollectionRegistryController({ userConfigPersistence, dataSources: dataSources.registry });

    // The data layer gives a row its address from its collection's primary
    // key, and these collections are known only here. Registered under this
    // scope's own owner, so several scopes on one page — and the full CMS
    // beside them — do not overwrite each other. During render for the reason
    // `RebaseNavigation` gives (the views that fetch rows are below), and again
    // on mount, since a strict-mode remount runs the cleanup in between.
    const registerCollectionResolver = useContext(CollectionResolverRegistrationContext);
    const owner = useId();
    const getCollectionRef = useRef(collectionRegistryController.getCollection);
    getCollectionRef.current = collectionRegistryController.getCollection;
    const registryRef = collectionRegistryController.collectionRegistryRef;
    // Asked about every collection any owner has, so a path this scope does
    // not hold is answered quietly rather than by the registry's warning.
    const resolveCollection = useCallback((slug: string) =>
        holdsLeadingCollection(registryRef.current, slug) ? getCollectionRef.current(slug) : undefined, [registryRef]);
    const resolveDataPath = collectionRegistryController.resolveDataPath;
    registerCollectionResolver(resolveCollection, resolveDataPath, owner);
    useEffect(() => {
        registerCollectionResolver(resolveCollection, resolveDataPath, owner);
        return () => registerCollectionResolver(undefined, undefined, owner);
    }, [registerCollectionResolver, resolveCollection, resolveDataPath, owner]);

    // Each collection routed to the data source it declares, as in the CMS.
    const defaultData = useData();
    const routedData = useMemo(() => buildRoutedRebaseData({
        defaultData,
        sources: dataSources.sources,
        resolveKey: (slugOrPath) => resolveDataSource(resolveCollection(slugOrPath), dataSources.registry).key
    }), [defaultData, dataSources, resolveCollection]);

    // Paths are still built — a panel keys its records by them — but nothing
    // navigates to one, and no URL is read as a record to open.
    const builtUrlController = useBuildUrlController({
        basePath: "/",
        baseCollectionPath: "/c",
        collectionRegistryController
    });
    const urlController = useMemo<UrlController>(() => ({
        ...builtUrlController,
        isUrlCollectionPath: () => false,
        routesMounted: false
    }), [builtUrlController]);

    const resolvedCollections = useMemo(() => collections.map(collection => resolveAdminCollection(collection)), [collections]);
    const navigationStateController = useBuildNavigationStateController({
        plugins: customizationController.plugins ?? EMPTY_PLUGINS,
        collections: resolvedCollections,
        views: NO_VIEWS,
        authController: context.authController!,
        data: routedData,
        collectionRegistryController,
        urlController,
        adminMode: adminModeController?.mode
    });

    // The Studio bridge describes the CMS's own controllers. A scope embedded
    // in the shell must not replace them there, so its registrations go nowhere.
    return (
        <CollectionsScopeContext.Provider value={true}>
            <StudioBridgeRegistryContext.Provider value={null}>
                <RebaseDataContext.Provider value={routedData}>
                    <CollectionRegistryContext.Provider value={collectionRegistryController}>
                        <UrlContext.Provider value={urlController}>
                            <NavigationStateContext.Provider value={navigationStateController}>
                                <SidePanelProvider>
                                    {children}
                                    <SideDialogs/>
                                </SidePanelProvider>
                            </NavigationStateContext.Provider>
                        </UrlContext.Provider>
                    </CollectionRegistryContext.Provider>
                </RebaseDataContext.Provider>
            </StudioBridgeRegistryContext.Provider>
        </CollectionsScopeContext.Provider>
    );
}
