import React, { useMemo, lazy, Suspense } from "react";
import {
    useRebaseRegistry,
    useRebaseContext,
    useAuthController,
    useCustomizationController,
    useAdminModeController,
    useBuildLocalConfigurationPersistence,
    useRebaseClient,
    StudioBridgeRegistryProvider,
    useBridgeRegistration,
    CustomizationControllerContext
} from "@rebasepro/core";
import { CircularProgressCenter } from "@rebasepro/ui";
import type { AppView, CollectionEditorOptions, EntityCustomView, EntityAction, EntityCollection, RebasePlugin } from "@rebasepro/types";
import type { CollectionRegistryController } from "@rebasepro/types";
import type { UrlController, NavigationStateController } from "@rebasepro/types";

const EMPTY_PLUGINS: RebasePlugin[] = [];
const EMPTY_COLLECTIONS: EntityCollection[] = [];

import { useBuildNavigationStateController } from "../hooks/navigation/useBuildNavigationStateController";
import { useBuildUrlController } from "../hooks/navigation/useBuildUrlController";
import { useBuildCollectionRegistryController } from "../hooks/navigation/useBuildCollectionRegistryController";

import { CollectionRegistryContext } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { UrlContext } from "../hooks/navigation/contexts/UrlContext";
import { NavigationStateContext } from "../hooks/navigation/contexts/NavigationStateContext";

import { SideEntityProvider } from "./SideEntityProvider";

// Collection editor internals — used when collectionEditor is enabled
import { useLocalCollectionsConfigController } from "../collection_editor/useLocalCollectionsConfigController";
import { ConfigControllerProvider } from "../collection_editor/ConfigControllerProvider";

// Lazy-load the schema view — only fetched when studio schema tool is active
const CollectionsStudioView = lazy(() =>
    import("../collection_editor/ui/collection_editor/CollectionsStudioView")
        .then(m => ({ default: m.CollectionsStudioView }))
);

export interface RebaseNavigationProps {
    children: React.ReactNode;
}

/**
 * Navigation layer — builds and provides all CMS navigation controllers:
 * collection registry, URL controller, navigation state, side entity,
 * and the self-assembling Studio bridge.
 *
 * Also handles the collection editor config controller when enabled.
 *
 * **Independently usable**: Use this when you need CMS navigation
 * (entity tables, side panels) in a custom layout.
 *
 * @example
 * ```tsx
 * <RebaseNavigation>
 *   <MyCustomLayout>
 *     <EntityCollectionView ... />
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

    const collectionRegistryController = useBuildCollectionRegistryController({ userConfigPersistence });

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

    const navigationStateController = useBuildNavigationStateController({
        plugins: registry.cmsConfig?.plugins ?? EMPTY_PLUGINS,
        collections: collectionsBuilder,
        views: devViews,
        navigationGroupMappings: registry.cmsConfig?.navigationGroupMappings,
        authController: context.authController!,
        data: context.data,
        collectionRegistryController,
        urlController,
        adminMode: adminModeController?.mode
    });

    // ── Merge CMS-registered entityViews/entityActions into the customization controller ──
    // The <Rebase> component builds the customizationController from its own props,
    // but entity views passed to <RebaseCMS> are stored in the registry and not
    // automatically merged. We re-provide an enriched controller here so that
    // downstream consumers (EntityEditView, side panels, etc.) can resolve
    // string-keyed entity views like "blog_preview".
    const parentCustomizationController = useCustomizationController();
    const enrichedCustomizationController = useMemo(() => {
        const cmsEntityViews = (registry.cmsConfig?.entityViews ?? []) as EntityCustomView[];
        const cmsEntityActions = (registry.cmsConfig?.entityActions ?? []) as EntityAction[];
        if (cmsEntityViews.length === 0 && cmsEntityActions.length === 0) {
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
            ]
        };
    }, [parentCustomizationController, registry.cmsConfig?.entityViews, registry.cmsConfig?.entityActions]);

    // ── Inner content with all context providers ──────────────────────
    const navigationContent = (
        <CustomizationControllerContext.Provider value={enrichedCustomizationController}>
        <StudioBridgeRegistryProvider>
            <CollectionRegistryContext.Provider value={collectionRegistryController}>
                <UrlContext.Provider value={urlController}>
                    <NavigationStateContext.Provider value={navigationStateController}>
                        <SideEntityProvider>
                            <BridgeAutoRegistrar
                                collectionRegistryController={collectionRegistryController}
                                urlController={urlController}
                                navigationStateController={navigationStateController}
                            />
                            {children}
                        </SideEntityProvider>
                    </NavigationStateContext.Provider>
                </UrlContext.Provider>
            </CollectionRegistryContext.Provider>
        </StudioBridgeRegistryProvider>
        </CustomizationControllerContext.Provider>
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
