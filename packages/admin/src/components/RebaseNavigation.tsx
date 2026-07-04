import React, { useMemo, useRef, useEffect, lazy, Suspense } from "react";
import {
    useRebaseRegistry,
    useRebaseContext,
    useAuthController,
    useCustomizationController,
    useAdminModeController,
    useBuildLocalConfigurationPersistence,
    useRebaseClient,
    useData,
    useDataSources,
    StudioBridgeRegistryProvider,
    useBridgeRegistration,
    CustomizationControllerContext,
    RebaseDataContext
} from "@rebasepro/core";
import { buildRoutedRebaseData, resolveDataSource } from "@rebasepro/common";
import { CircularProgressCenter } from "@rebasepro/ui";
import type { AppView, CollectionEditorOptions, SnapshotCustomView, SnapshotAction, CollectionConfig, RebasePlugin } from "@rebasepro/types";
import type { CollectionRegistryController } from "@rebasepro/types";
import type { UrlController, NavigationStateController } from "@rebasepro/types";

const EMPTY_PLUGINS: RebasePlugin[] = [];
const EMPTY_COLLECTIONS: CollectionConfig[] = [];

import { useBuildNavigationStateController } from "../hooks/navigation/useBuildNavigationStateController";
import { useBuildUrlController } from "../hooks/navigation/useBuildUrlController";
import { useBuildCollectionRegistryController } from "../hooks/navigation/useBuildCollectionRegistryController";

import { CollectionRegistryContext } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { UrlContext } from "../hooks/navigation/contexts/UrlContext";
import { NavigationStateContext } from "../hooks/navigation/contexts/NavigationStateContext";

import { SidePanelProvider } from "./SidePanelProvider";

// Collection editor internals — used when collectionEditor is enabled
import { useLocalCollectionsConfigController } from "../collection_editor/useLocalCollectionsConfigController";
import { ConfigControllerProvider } from "../collection_editor/ConfigControllerProvider";

// Lazy-load the schema view — only fetched when studio schema tool is active
const CollectionsStudioView = lazy(() =>
    import("../collection_editor/ui/collection_editor/RouterCollectionsStudioView")
        .then(m => ({ default: m.RouterCollectionsStudioView }))
);

export interface RebaseNavigationProps {
    children: React.ReactNode;
}

/**
 * Navigation layer — builds and provides all CMS navigation controllers:
 * collection registry, URL controller, navigation state, side snapshot,
 * and the self-assembling Studio bridge.
 *
 * Also handles the collection editor config controller when enabled.
 *
 * **Independently usable**: Use this when you need CMS navigation
 * (snapshot tables, side panels) in a custom layout.
 *
 * @example
 * ```tsx
 * <RebaseNavigation>
 *   <MyCustomLayout>
 *     <CollectionViewBinding ... />
 *   </MyCustomLayout>
 * </RebaseNavigation>
 * ```
 */
export function RebaseNavigation({ children }: RebaseNavigationProps) {
    const registry = useRebaseRegistry();
    const context = useRebaseContext();
    const adminModeController = useAdminModeController();
    const userConfigPersistence = useBuildLocalConfigurationPersistence();

    // ── Collection Editor resolution ──────────────────────────────────
    // The collection editor is ALWAYS enabled when Studio is registered.
    // The `collectionEditor` CMS config is for fine-tuning (readOnly, auth, etc.),
    // not for opting-in. When omitted, the editor defaults to enabled
    // (read-only in production).
    const collectionEditorConfig = registry.cmsConfig?.collectionEditor;
    const collectionEditorEnabled = Boolean(collectionEditorConfig) || Boolean(registry.studioConfig);
    const collectionEditorOptions: CollectionEditorOptions | undefined = useMemo(() => {
        if (collectionEditorConfig === true || !collectionEditorConfig) return {};
        return collectionEditorConfig;
    }, [collectionEditorConfig]);

    // ── Combine CMS and Studio Configs ────────────────────────────────
    const cmsCollections = registry.cmsConfig?.collections ?? EMPTY_COLLECTIONS;

    // ── Build the navigation controllers ──────────────────────────────
    const collectionsBuilder = useMemo(() => Array.isArray(cmsCollections) ? () => [...cmsCollections] : cmsCollections, [cmsCollections]);

    const dataSources = useDataSources();
    const collectionRegistryController = useBuildCollectionRegistryController({ userConfigPersistence, dataSources: dataSources.registry });

    // ── Multi-data-source routing ─────────────────────────────────────
    // Combine the default data source (server transport) with the registered
    // direct/custom sources from <Rebase> and route each collection by its
    // resolved data-source key, looked up by path against the collection
    // registry. A stable resolver ref keeps the routed data instance
    // referentially stable across registry rebuilds, so data-effect
    // dependencies don't thrash.
    const defaultData = useData();
    const getCollectionRef = useRef(collectionRegistryController.getCollection);
    getCollectionRef.current = collectionRegistryController.getCollection;
    const routedData = useMemo(() => buildRoutedRebaseData({
        defaultData,
        sources: dataSources.sources,
        resolveKey: (slugOrPath) => resolveDataSource(getCollectionRef.current(slugOrPath), dataSources.registry).key
    }), [defaultData, dataSources]);

    const urlController = useBuildUrlController({
        basePath: "/",
        baseCollectionPath: "/c",
        collectionRegistryController
    });

    // ── Build config controller internally when collection editor is enabled ──
    const rebaseClient = useRebaseClient();
    const authController = useAuthController();
    const resolvedCollections = useMemo(
        () => Array.isArray(cmsCollections) ? cmsCollections : [],
        [cmsCollections]
    );

    // ── Dev-only data-source sanity check ─────────────────────────────
    // Warn about data sources declared with a direct/custom transport that
    // have no client-side driver — these silently fall back to the default
    // (server) source, a common source of misrouting. Unambiguous: it never
    // false-positives on server-mediated sources (which intentionally have
    // no client driver).
    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        const { registry, sources } = dataSources;
        const missing = Object.values(registry)
            .filter((d) => (d.transport === "direct" || d.transport === "custom") && !sources[d.key])
            .map((d) => d.key);
        if (missing.length > 0) {
            console.warn(
                `[Rebase] These data source(s) declare a direct/custom transport but have no client-side driver and will fall back to the default data source: ${missing.map(k => `"${k}"`).join(", ")}. ` +
                `Provide a \`driver\` for them in \`dataSources\` on <Rebase>.`
            );
        }
    }, [dataSources]);

    const internalConfigController = useLocalCollectionsConfigController(
        rebaseClient,
        resolvedCollections,
        collectionEditorEnabled ? {
            readOnly: collectionEditorOptions?.readOnly ?? process.env.NODE_ENV === "production",
            getAuthToken: collectionEditorOptions?.getAuthToken ?? authController?.getAuthToken
        } : { readOnly: true }
    );

    // ── Auto-inject schema view into Studio devViews ──────────────────
    const schemaView: AppView | undefined = useMemo(() => {
        if (!collectionEditorEnabled) return undefined;
        // Only inject when Studio is registered and includes "schema" tool (or all tools)
        const studioTools = registry.studioConfig?.tools ?? ["sql", "js", "rls", "schema", "storage"];
        if (!registry.studioConfig || !studioTools.includes("schema")) return undefined;
        return {
            slug: "schema",
            name: "Edit collections",
            group: "Database",
            icon: "LayoutList",
            nestedRoutes: true,
            view: (
                <Suspense fallback={<CircularProgressCenter/>}>
                    <CollectionsStudioView configController={internalConfigController}/>
                </Suspense>
            )
        };
    }, [collectionEditorEnabled, registry.studioConfig, internalConfigController]);

    const devViews = useMemo(() => {
        const base = registry.studioConfig?.devViews ?? [];
        if (schemaView) return [...base, schemaView];
        return base;
    }, [registry.studioConfig?.devViews, schemaView]);

    // Merge CMS-registered views with Studio dev views.
    // Order: CMS views (developer's primary content) → Studio dev views (tooling).
    // Plugin views are merged later inside resolveAppViews.
    const cmsViews = registry.cmsConfig?.views;
    const mergedViews = useMemo(() => {
        if (!cmsViews) return devViews;
        if (Array.isArray(cmsViews) && cmsViews.length === 0) return devViews;
        // When cmsViews is a builder function, wrap it to append devViews after resolution
        if (typeof cmsViews === "function") {
            return async (params: Parameters<typeof cmsViews>[0]) => {
                const resolved = await cmsViews(params) ?? [];
                return [...resolved, ...devViews];
            };
        }
        return [...cmsViews, ...devViews];
    }, [cmsViews, devViews]);

    const parentCustomizationController = useCustomizationController();

    const navigationStateController = useBuildNavigationStateController({
        plugins: parentCustomizationController.plugins ?? EMPTY_PLUGINS,
        collections: collectionsBuilder,
        views: mergedViews,
        navigationGroupMappings: registry.cmsConfig?.navigationGroupMappings,
        authController: context.authController!,
        data: routedData,
        collectionRegistryController,
        urlController,
        adminMode: adminModeController?.mode
    });

    // ── Merge CMS-registered snapshotViews/snapshotActions into the customization controller ──
    // The <Rebase> component builds the customizationController from its own props,
    // but snapshot views passed to <RebaseCMS> are stored in the registry and not
    // automatically merged. We re-provide an enriched controller here so that
    // downstream consumers (EditViewBinding, side panels, etc.) can resolve
    // string-keyed snapshot views like "blog_preview".
    const enrichedCustomizationController = useMemo(() => {
        const cmsSnapshotViews = (registry.cmsConfig?.snapshotViews ?? []) as SnapshotCustomView[];
        const cmsSnapshotActions = (registry.cmsConfig?.snapshotActions ?? []) as SnapshotAction[];
        if (cmsSnapshotViews.length === 0 && cmsSnapshotActions.length === 0) {
            return parentCustomizationController;
        }
        return {
            ...parentCustomizationController,
            snapshotViews: [
                ...(parentCustomizationController.snapshotViews ?? []),
                ...cmsSnapshotViews.filter(v => !(parentCustomizationController.snapshotViews ?? []).some(ev => ev.key === v.key))
            ],
            snapshotActions: [
                ...(parentCustomizationController.snapshotActions ?? []),
                ...cmsSnapshotActions.filter(a => !(parentCustomizationController.snapshotActions ?? []).some(ea => ea.key === a.key))
            ]
        };
    }, [parentCustomizationController, registry.cmsConfig?.snapshotViews, registry.cmsConfig?.snapshotActions]);

    // ── Inner content with all context providers ──────────────────────
    // Re-provide RebaseDataContext with the routed data so that every CMS
    // consumer (list/snapshot views, references, board, import/export, and
    // `context.data`) is routed to the correct driver by collection path.
    const navigationContent = (
        <RebaseDataContext.Provider value={routedData}>
        <CustomizationControllerContext.Provider value={enrichedCustomizationController}>
        <StudioBridgeRegistryProvider>
            <CollectionRegistryContext.Provider value={collectionRegistryController}>
                <UrlContext.Provider value={urlController}>
                    <NavigationStateContext.Provider value={navigationStateController}>
                        <SidePanelProvider>
                            <BridgeAutoRegistrar
                                collectionRegistryController={collectionRegistryController}
                                urlController={urlController}
                                navigationStateController={navigationStateController}
                            />
                            {children}
                        </SidePanelProvider>
                    </NavigationStateContext.Provider>
                </UrlContext.Provider>
            </CollectionRegistryContext.Provider>
        </StudioBridgeRegistryProvider>
        </CustomizationControllerContext.Provider>
        </RebaseDataContext.Provider>
    );

    // ── Wrap with ConfigControllerProvider when collection editor is enabled ──
    if (collectionEditorEnabled) {
        return (
            <ConfigControllerProvider
                collectionConfigController={internalConfigController}
                pathSuggestions={collectionEditorOptions?.pathSuggestions}
            >
                {navigationContent}
            </ConfigControllerProvider>
        );
    }

    return navigationContent;
}

/**
 * Internal component that auto-registers CMS controllers into the
 * self-assembling Studio bridge. Must be rendered inside both the
 * navigation contexts and the StudioBridgeRegistryProvider.
 */
function BridgeAutoRegistrar({
    collectionRegistryController,
    urlController,
    navigationStateController
}: {
    collectionRegistryController: CollectionRegistryController;
    urlController: UrlController;
    navigationStateController: NavigationStateController;
}) {
    useBridgeRegistration("collectionRegistry", collectionRegistryController);
    useBridgeRegistration("urlController", urlController);
    useBridgeRegistration("navigationState", navigationStateController);
    return null;
}
