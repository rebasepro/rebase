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
import { resolveDataSource } from "@rebasepro/common";
import { CollectionRegistry, buildRoutedRebaseData } from "@rebasepro/cms-types";
import type { AdminCollection, AppView, RebasePlugin, TableCustomization, UrlController } from "@rebasepro/cms-types";
import type { TableDescriptor } from "@rebasepro/types";

import { useBuildCollectionRegistryController } from "../hooks/navigation/useBuildCollectionRegistryController";
import { useBuildUrlController } from "../hooks/navigation/useBuildUrlController";
import { useBuildNavigationStateController } from "../hooks/navigation/useBuildNavigationStateController";
import { composeCollectionsInput } from "../hooks/navigation/compose_collections_input";
import { usePanelTables } from "../hooks/navigation/usePanelTables";
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
const NO_CUSTOMIZATIONS: readonly TableCustomization[] = [];
const NO_EXTERNAL_COLLECTIONS: readonly AdminCollection[] = [];

/**
 * @group Components
 */
export interface CollectionsProviderProps {
    /**
     * Presentation for the tables the server serves, one `customizeTable(...)`
     * result per table — as on `<RebaseCMS>`. Every served table is known to
     * this scope without one.
     */
    tableCustomizations?: readonly TableCustomization[];
    /**
     * Collections whose rows live outside the Rebase backend
     * (`defineFirestoreCollection`), known to this scope beside the tables —
     * as on `<RebaseCMS>`. Keep the array stable (a module constant, or
     * `useMemo`): a new array is a new set of collections.
     */
    externalCollections?: readonly AdminCollection[];
    /**
     * For embedding and tests: the tables to render instead of the ones the
     * server serves — as on `<RebaseCMS>`. Given, the server is asked for
     * none.
     */
    tables?: readonly TableDescriptor[];
    children: React.ReactNode;
}

/**
 * Everything a collection view or a record form needs to work in a page of
 * your own app, without `<RebaseCMS>`, `<RebaseNavigation>` or
 * `<RebaseShell>`: a registry of the tables the server serves (with your
 * `tableCustomizations`) and of your `externalCollections`, the record side
 * panel and dialogs (rendered here), and the navigation guard.
 *
 * It needs `<Rebase>` above it and a React Router router — any router, at any
 * path; a data router is not required. No CMS route serves the page, so a
 * record opens in a side panel or a dialog over it, never by URL.
 *
 * `CollectionPanel` and `RecordForm` given a `collection` bring one of
 * these themselves when none is above; mount it yourself to share one between
 * several of them, or to use the lower-level pieces (`CollectionViewBinding`,
 * `useSidePanel`) directly.
 *
 * @example
 * ```tsx
 * <Rebase client={client} authController={authController}>
 *     <BrowserRouter>
 *         <CollectionsProvider tableCustomizations={[postsCms]}>
 *             <CollectionPanel collection="posts"/>
 *             <CollectionPanel collection="authors"/>
 *         </CollectionsProvider>
 *     </BrowserRouter>
 * </Rebase>
 * ```
 *
 * @group Components
 */
export function CollectionsProvider({
    tableCustomizations = NO_CUSTOMIZATIONS,
    externalCollections = NO_EXTERNAL_COLLECTIONS,
    tables: givenTables,
    children
}: CollectionsProviderProps) {
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

    // The same two inputs as <RebaseCMS>: the tables, customized, and the
    // external collections.
    const descriptors = usePanelTables(givenTables, true);
    const servedTables = descriptors.tables;
    const collectionsBuilder = useMemo(
        () => composeCollectionsInput({ tables: servedTables, tableCustomizations, externalCollections }),
        [servedTables, tableCustomizations, externalCollections]);
    const navigationStateController = useBuildNavigationStateController({
        plugins: customizationController.plugins ?? EMPTY_PLUGINS,
        collections: collectionsBuilder,
        // Until the tables arrive, a panel shows its loading state rather
        // than "collection not found".
        collectionsPending: descriptors.status === "loading",
        views: NO_VIEWS,
        authController: context.authController!,
        // The collection and view builders get the rows the server sends.
        data: context.data,
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
