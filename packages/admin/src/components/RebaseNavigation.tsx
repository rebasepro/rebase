import React, { useMemo, useRef, useEffect, useCallback, useContext, Suspense } from "react";
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
    CollectionResolverRegistrationContext,
    StudioBridgeRegistryProvider,
    useBridgeRegistration,
    CustomizationControllerContext,
    RebaseDataContext
} from "@rebasepro/app";
import { buildRoutedRebaseData, resolveDataSource } from "@rebasepro/common";
import { CircularProgressCenter, lazyChunk } from "@rebasepro/ui";

import type { AppView, CollectionCustomView, CollectionEditorOptions, EntityCustomView, EntityAction, RebasePlugin, AdminCollection } from "@rebasepro/admin-types";
import type { CollectionRegistryController } from "@rebasepro/types";
import type { UrlController, NavigationStateController } from "@rebasepro/admin-types";

const EMPTY_PLUGINS: RebasePlugin[] = [];
const EMPTY_COLLECTIONS: AdminCollection[] = [];

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
import { useCollectionsConfigController } from "../collection_editor/useCollectionsConfigController";

// Lazy-load the schema view — only fetched when studio schema tool is active
const CollectionsStudioView = lazyChunk(() =>
    import("../collection_editor/ui/collection_editor/RouterCollectionsStudioView")
        .then(m => ({ default: m.RouterCollectionsStudioView }))
);

export interface RebaseNavigationProps {
    children: React.ReactNode;
}

/**
 * Navigation layer — builds and provides all admin navigation controllers:
 * collection registry, URL controller, navigation state, side entity,
 * and the self-assembling Studio bridge.
 *
 * Also handles the collection editor config controller when enabled.
 *
 * **Independently usable**: Use this when you need admin navigation
 * (entity tables, side panels) in a custom layout.
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
    // The `collectionEditor` admin config is for fine-tuning (readOnly, auth, etc.),
    // not for opting-in. When omitted, the editor defaults to enabled
    // (read-only in production).
    const collectionEditorConfig = registry.cmsConfig?.collectionEditor;
    const collectionEditorEnabled = Boolean(collectionEditorConfig) || Boolean(registry.studioConfig);
    const collectionEditorOptions: CollectionEditorOptions | undefined = useMemo(() => {
        if (collectionEditorConfig === true || !collectionEditorConfig) return {};
        return collectionEditorConfig;
    }, [collectionEditorConfig]);

    // ── Combine admin and Studio Configs ────────────────────────────────
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

    // Hand the data layer a way to read this registry. It was built by <Rebase>,
    // above us, and needs a collection's primary keys to give its rows an
    // address — rows themselves carry only columns.
    //
    // Registered during render, not in an effect: the views that fetch rows are
    // below us, and their effects run before ours, so an effect here would bind
    // after the first page had already been converted. The call only assigns a
    // ref, so repeating it per render is free.
    const registerCollectionResolver = useContext(CollectionResolverRegistrationContext);
    const resolveCollection = useCallback(
        (slug: string) => getCollectionRef.current(slug),
        []);
    registerCollectionResolver(resolveCollection);
    const routedData = useMemo(() => buildRoutedRebaseData({
        defaultData,
        sources: dataSources.sources,
        resolveKey: (slugOrPath) => resolveDataSource(getCollectionRef.current(slugOrPath), dataSources.registry).key
    }), [defaultData, dataSources]);

    // Normalize the configured mount prefix to a leading-slash, no-trailing-slash
    // form (e.g. "admin" or "/admin/" -> "/admin"); empty/"/" stays "/".
    const basePath = useMemo(() => {
        const raw = registry.cmsConfig?.basePath;
        if (!raw || raw === "/") return "/";
        const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "");
        return trimmed ? `/${trimmed}` : "/";
    }, [registry.cmsConfig?.basePath]);

    const urlController = useBuildUrlController({
        basePath,
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

    // `readOnly` is left undefined unless the developer set it: the controller
    // asks the backend whether its schema editor will accept a write, which is
    // the only process that knows. Deciding it here from `process.env.NODE_ENV`
    // — the *frontend bundle's* build mode — is what made the editor offer
    // itself against production backends, `baas` projects and servers without
    // `ts-morph`, and turned every save into a bare 404.
    const internalConfigController = useLocalCollectionsConfigController(
        rebaseClient,
        resolvedCollections,
        collectionEditorEnabled ? {
            readOnly: collectionEditorOptions?.readOnly,
            getAuthToken: collectionEditorOptions?.getAuthToken ?? authController?.getAuthToken,
            authKey: authController?.user?.uid ?? null
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
            // Reads the controller from context at render time rather than
            // capturing it here. A view is a React *element*, and the
            // navigation state controller resolves the view list once and holds
            // on to the elements it resolved — so a controller passed as a prop
            // is frozen at whatever it was on the first render, forever. That
            // hid every later change: the editor stayed writable after the
            // backend said it was read-only, and the collection list never
            // refreshed. Everything else in the editor already reads this from
            // `ConfigControllerProvider`, which wraps this subtree.
            view: (
                <Suspense fallback={<CircularProgressCenter/>}>
                    <CollectionsStudioViewFromContext/>
                </Suspense>
            )
        };
    }, [collectionEditorEnabled, registry.studioConfig]);

    const devViews = useMemo(() => {
        const base = registry.studioConfig?.devViews ?? [];
        if (schemaView) return [...base, schemaView];
        return base;
    }, [registry.studioConfig?.devViews, schemaView]);

    // Merge admin-registered views with Studio dev views.
    // Order: admin views (developer's primary content) → Studio dev views (tooling).
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

    // ── Merge admin-registered entityViews/entityActions into the customization controller ──
    // The <Rebase> component builds the customizationController from its own props,
    // but entity views passed to <RebaseAdmin> are stored in the registry and not
    // automatically merged. We re-provide an enriched controller here so that
    // downstream consumers (EditViewBinding, side panels, etc.) can resolve
    // string-keyed entity views like "blog_preview".
    const enrichedCustomizationController = useMemo(() => {
        const cmsEntityViews = (registry.cmsConfig?.entityViews ?? []) as EntityCustomView[];
        const cmsEntityActions = (registry.cmsConfig?.entityActions ?? []) as EntityAction[];
        // Collection view modes ride the same channel, for the same reason:
        // `admin.customViews: ["map"]` has to find the component somewhere.
        const cmsCollectionViews = (registry.cmsConfig?.collectionViews ?? []) as CollectionCustomView[];
        if (cmsEntityViews.length === 0 && cmsEntityActions.length === 0 && cmsCollectionViews.length === 0) {
            return parentCustomizationController;
        }
        return {
            ...parentCustomizationController,
            entityViews: [
                ...(parentCustomizationController.entityViews ?? []),
                ...cmsEntityViews.filter(v => !(parentCustomizationController.entityViews ?? []).some(ev => ev.key === v.key))
            ],
            entityActions: [
                ...(parentCustomizationController.entityActions ?? []),
                ...cmsEntityActions.filter(a => !(parentCustomizationController.entityActions ?? []).some(ea => ea.key === a.key))
            ],
            collectionViews: [
                ...(parentCustomizationController.collectionViews ?? []),
                ...cmsCollectionViews.filter(v => !(parentCustomizationController.collectionViews ?? []).some(cv => cv.key === v.key))
            ]
        };
    }, [parentCustomizationController, registry.cmsConfig?.entityViews, registry.cmsConfig?.entityActions, registry.cmsConfig?.collectionViews]);

    // ── Inner content with all context providers ──────────────────────
    // Re-provide RebaseDataContext with the routed data so that every admin
    // consumer (list/entity views, references, board, import/export, and
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
                                canWriteToCodebase={!internalConfigController.readOnly}
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
 * The injected "Edit collections" view, bound to the live config controller.
 *
 * Exists so the element stored in the navigation state does not close over a
 * controller instance — see the comment at its construction site.
 */
function CollectionsStudioViewFromContext() {
    const configController = useCollectionsConfigController();
    return <CollectionsStudioView configController={configController}/>;
}

/**
 * Internal component that auto-registers admin controllers into the
 * self-assembling Studio bridge. Must be rendered inside both the
 * navigation contexts and the StudioBridgeRegistryProvider.
 */
function BridgeAutoRegistrar({
    collectionRegistryController,
    urlController,
    navigationStateController,
    canWriteToCodebase
}: {
    collectionRegistryController: CollectionRegistryController;
    urlController: UrlController;
    navigationStateController: NavigationStateController;
    canWriteToCodebase: boolean;
}) {
    useBridgeRegistration("collectionRegistry", collectionRegistryController);
    useBridgeRegistration("urlController", urlController);
    useBridgeRegistration("navigationState", navigationStateController);

    // Studio tools that would write into the project's collection source — the
    // RLS editor's policy save for a mapped table, its "Import to codebase" —
    // ask the bridge whether that write can land. The default is `true`, which
    // is what an admin panel sitting next to its own `collectionsDir` assumes;
    // it is wrong for exactly the same backends that make the collection editor
    // read-only, so the two now answer from one source.
    const capabilities = useMemo(() => ({ codebase: canWriteToCodebase }), [canWriteToCodebase]);
    useBridgeRegistration("capabilities", capabilities);
    return null;
}
