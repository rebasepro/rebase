import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type {
    CollectionRegistryController
} from "@rebasepro/types";
import type {
    SidePanelController,
    UrlController,
    NavigationStateController,
    BreadcrumbEntry,
    BreadcrumbsController
} from "@rebasepro/cms-types";

export type { BreadcrumbEntry, BreadcrumbsController };

// ─── Breadcrumbs ──────────────────────────────────────────────────


// ─── Bridge interface ───────────────────────────────────────────────

/**
 * StudioBridge provides optional admin capabilities to Studio components.
 * When the admin is present, a bridge provider injects real implementations.
 * When the admin is absent, noop defaults ensure Studio works standalone.
 */
/**
 * Editing a collection's source through the admin's plan/apply flow.
 *
 * Studio has its own writers — the RLS editor saves a policy, the collection
 * editor saves a property — and until this existed they did not go to the same
 * place. Saving a policy on a mapped table POSTed the rules straight to
 * `/schema-editor/collection/save`: no plan, no dialog, no record of what SQL
 * the change would produce, while the identical edit made two tabs away in the
 * collection editor showed all three.
 *
 * `available` is false when there is no collection editor above this Studio —
 * the hosted console against somebody else's container, or a panel that never
 * enabled it — and the caller falls back to whatever it did before.
 */
export interface StudioSchemaEditing {
    available: boolean;
    /**
     * Merge `patch` into the collection and take it through plan → confirm →
     * apply: the same dialog `useLiveSchemaEditing` shows the collection
     * editor.
     *
     * Resolves once the change has been applied, or written source-only if
     * that is what was chosen. Rejects with `SchemaChangeCancelled` when the
     * dialog was closed — which is not an error to report, it is an answer.
     */
    updateCollection: (collectionId: string, patch: Record<string, unknown>) => Promise<void>;
}

export interface StudioBridge {
    collectionRegistry: CollectionRegistryController;
    schemaEditing: StudioSchemaEditing;
    sidePanelController: SidePanelController;
    urlController: UrlController;
    navigationState: NavigationStateController;
    breadcrumbs: BreadcrumbsController;
    capabilities: StudioCapabilities;
}

/**
 * What the *host* of these tools can do, as opposed to what the backend can.
 *
 * Studio is mounted in two very different places. In a project's own admin
 * panel it runs next to the collection source files and can edit them through
 * the schema-editor routes. In the hosted console it runs against somebody
 * else's deployed container: there is no source to edit — the container is
 * rebuilt from the customer's repository on every deploy — and the routes that
 * would edit it are not mounted at all, because the framework switches the
 * schema editor off under `NODE_ENV=production`.
 *
 * Tools that would otherwise offer a write into the codebase read this to
 * decide whether that write is even meaningful.
 */
export interface StudioCapabilities {
    /**
     * Whether the host has the project's collection source at hand and can
     * write to it.
     *
     * Defaults to `true`, which is what an admin panel running beside its own
     * `collectionsDir` has always assumed.
     */
    codebase: boolean;
}

// ─── Noop defaults ──────────────────────────────────────────────────

const NOOP_COLLECTION_REGISTRY: CollectionRegistryController = {
    getCollection: () => undefined,
    getRawCollection: () => undefined,
    getParentReferencesFromPath: () => [],
    getParentCollectionSlugs: () => [],
    getParentEntityIds: () => [],
    convertIdsToPaths: () => [],
    initialised: false
};

const NOOP_SCHEMA_EDITING: StudioSchemaEditing = {
    available: false,
    updateCollection: async () => {
        throw new Error("No collection editor is mounted — check `available` before calling this.");
    }
};

const NOOP_SIDE_PANEL: SidePanelController = {
    open: () => {},
    replace: () => {},
    close: () => {}
};

const NOOP_URL_CONTROLLER: UrlController = {
    basePath: "/",
    baseCollectionPath: "/c",
    urlPathToDataPath: () => "",
    homeUrl: "/",
    isUrlCollectionPath: () => false,
    buildUrlCollectionPath: () => "",
    buildAppUrlPath: () => "",
    resolveDatabasePathsFrom: () => "",
    navigate: () => {}
};

const NOOP_NAVIGATION_STATE: NavigationStateController = {
    loading: false,
    refreshNavigation: () => {}
};

const NOOP_BREADCRUMBS: BreadcrumbsController = {
    breadcrumbs: [],
    set: () => {}
};

const DEFAULT_CAPABILITIES: StudioCapabilities = {
    codebase: true
};

const NOOP_BRIDGE: StudioBridge = {
    collectionRegistry: NOOP_COLLECTION_REGISTRY,
    schemaEditing: NOOP_SCHEMA_EDITING,
    sidePanelController: NOOP_SIDE_PANEL,
    urlController: NOOP_URL_CONTROLLER,
    navigationState: NOOP_NAVIGATION_STATE,
    breadcrumbs: NOOP_BREADCRUMBS,
    capabilities: DEFAULT_CAPABILITIES
};

// ─── Context & Provider ─────────────────────────────────────────────

export const StudioBridgeContext = createContext<StudioBridge>(NOOP_BRIDGE);

/**
 * Provider that injects admin capabilities into Studio.
 * Accepts partial overrides — any field not provided falls back to noop.
 *
 * Usage (in app wiring, when the admin is present):
 * ```tsx
 * <StudioBridgeProvider value={{
 *     collectionRegistry: useCollectionRegistryController(),
 *     sidePanelController: useSidePanel(),
 *     urlController: useUrlController(),
 *     navigationState: useNavigationStateController(),
 *     breadcrumbs: useBreadcrumbsController(),
 * }}>
 *     <RebaseStudio ... />
 * </StudioBridgeProvider>
 * ```
 */
export function StudioBridgeProvider({
    value,
    children
}: {
    value: Partial<StudioBridge>;
    children: React.ReactNode;
}) {
    // Keyed on the slices rather than on `value`: callers write the object
    // inline (`value={{ collectionRegistry }}`), so a `[value]` dependency
    // rebuilt the context on every render of the host and re-rendered every
    // Studio consumer with it.
    const merged = React.useMemo(
        () => ({ ...NOOP_BRIDGE,
...value }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            value.collectionRegistry,
            value.sidePanelController,
            value.urlController,
            value.navigationState,
            value.breadcrumbs,
            value.capabilities
        ]
    );
    return (
        <StudioBridgeContext.Provider value={merged}>
            {children}
        </StudioBridgeContext.Provider>
    );
}

// ─── Convenience hooks ──────────────────────────────────────────────

/**
 * Source editing through the admin's plan/apply dialog. `available` is false
 * when no collection editor is mounted.
 */
export function useStudioSchemaEditing(): StudioSchemaEditing {
    return useContext(StudioBridgeContext).schemaEditing;
}

/** Collection registry — returns noop if the admin is not present. */
export function useStudioCollectionRegistry(): CollectionRegistryController {
    return useContext(StudioBridgeContext).collectionRegistry;
}

/** Side panel controller — returns noop if the admin is not present. */
export function useStudioSidePanelController(): SidePanelController {
    return useContext(StudioBridgeContext).sidePanelController;
}

/** URL controller — returns noop if the admin is not present. */
export function useStudioUrlController(): UrlController {
    return useContext(StudioBridgeContext).urlController;
}

/** Navigation state — returns noop if the admin is not present. */
export function useStudioNavigationState(): NavigationStateController {
    return useContext(StudioBridgeContext).navigationState;
}

/** Breadcrumbs controller — returns noop if the admin is not present. */
export function useStudioBreadcrumbs(): BreadcrumbsController {
    return useContext(StudioBridgeContext).breadcrumbs;
}

/** What the host can do — see {@link StudioCapabilities}. */
export function useStudioCapabilities(): StudioCapabilities {
    return useContext(StudioBridgeContext).capabilities;
}

// ─── Self-Assembling Bridge Registry ────────────────────────────────

/**
 * Registry that controllers use to self-register their implementations
 * into the Studio bridge. Each controller calls `register(key, value)`
 * on mount and `unregister(key)` on unmount.
 */
export interface StudioBridgeRegistry {
    register: <K extends keyof StudioBridge>(key: K, value: StudioBridge[K]) => void;
    unregister: (key: keyof StudioBridge) => void;
}

export const StudioBridgeRegistryContext = createContext<StudioBridgeRegistry | null>(null);

/**
 * Provider that creates a self-assembling bridge.
 *
 * Mount this above the controller providers. Each controller calls
 * `useBridgeRegistration(key, value)` to inject its implementation.
 * The bridge context value is automatically kept in sync.
 *
 * ```tsx
 * <StudioBridgeRegistryProvider>
 *     <CollectionRegistryProvider>   // auto-registers
 *     <SidePanelProvider>           // auto-registers
 *     <UrlProvider>                  // auto-registers
 *         <RebaseStudio />           // consumes bridge
 *     </UrlProvider>
 *     </SidePanelProvider>
 *     </CollectionRegistryProvider>
 * </StudioBridgeRegistryProvider>
 * ```
 */
export function StudioBridgeRegistryProvider({ children }: { children: React.ReactNode }) {
    const [version, setVersion] = useState(0);
    const slicesRef = useRef<Partial<StudioBridge>>({});

    const register = useCallback(<K extends keyof StudioBridge>(key: K, value: StudioBridge[K]) => {
        slicesRef.current[key] = value;
        setVersion(v => v + 1);
    }, []);

    const unregister = useCallback((key: keyof StudioBridge) => {
        delete slicesRef.current[key];
        setVersion(v => v + 1);
    }, []);

    const registry = useMemo<StudioBridgeRegistry>(() => ({ register,
unregister }), [register, unregister]);

    const bridgeValue = useMemo<StudioBridge>(() => ({
        ...NOOP_BRIDGE,
        ...slicesRef.current
    }), [version]);

    return (
        <StudioBridgeRegistryContext.Provider value={registry}>
            <StudioBridgeContext.Provider value={bridgeValue}>
                {children}
            </StudioBridgeContext.Provider>
        </StudioBridgeRegistryContext.Provider>
    );
}
