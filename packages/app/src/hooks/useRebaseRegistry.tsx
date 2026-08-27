import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from "react";
import type { RebaseRegistryController, RebaseCMSConfig, RebaseStudioConfig, RebaseAuthViewConfig } from "@rebasepro/cms-types";

/**
 * Split into two contexts to prevent infinite re-render loops:
 * - DispatchContext: stable register/unregister functions (never changes identity)
 * - StateContext: the current config values (changes when modules register)
 *
 * Feature components (RebaseAuth, RebaseCMS, RebaseStudio) only consume
 * the dispatch context, so registering does NOT cause them to re-render.
 * RebaseShell consumes state context to read the collected configs.
 */

interface RegistryDispatch {
    registerAdmin: (config: RebaseCMSConfig) => void;
    unregisterAdmin: () => void;
    registerStudio: (config: RebaseStudioConfig) => void;
    unregisterStudio: () => void;
    registerAuth: (config: RebaseAuthViewConfig) => void;
    unregisterAuth: () => void;
}

interface RegistryState {
    cmsConfig: RebaseCMSConfig | null;
    studioConfig: RebaseStudioConfig | null;
    authConfig: RebaseAuthViewConfig | null;
}

const RegistryDispatchContext = createContext<RegistryDispatch | undefined>(undefined);
const RegistryStateContext = createContext<RegistryState>({
    cmsConfig: null,
    studioConfig: null,
    authConfig: null
});

export function RebaseRegistryProvider({ children }: { children: React.ReactNode }) {
    const [cmsConfig, setCmsConfig] = useState<RebaseCMSConfig | null>(null);
    const [studioConfig, setStudioConfig] = useState<RebaseStudioConfig | null>(null);
    const [authConfig, setAuthConfig] = useState<RebaseAuthViewConfig | null>(null);

    // Dispatch functions are stable — never change identity
    const dispatch = useMemo<RegistryDispatch>(() => ({
        registerAdmin: (config: RebaseCMSConfig) => setCmsConfig(config),
        unregisterAdmin: () => setCmsConfig(null),
        registerStudio: (config: RebaseStudioConfig) => setStudioConfig(config),
        unregisterStudio: () => setStudioConfig(null),
        registerAuth: (config: RebaseAuthViewConfig) => setAuthConfig(config),
        unregisterAuth: () => setAuthConfig(null)
    }), []);

    const state = useMemo<RegistryState>(() => ({
        cmsConfig,
studioConfig,
authConfig
    }), [cmsConfig, studioConfig, authConfig]);

    return (
        <RegistryDispatchContext.Provider value={dispatch}>
            <RegistryStateContext.Provider value={state}>
                {children}
            </RegistryStateContext.Provider>
        </RegistryDispatchContext.Provider>
    );
}

/**
 * Returns the full registry (state + dispatch).
 * Use this in RebaseShell where you need to read configs.
 */
export function useRebaseRegistry(): RebaseRegistryController {
    const dispatch = useContext(RegistryDispatchContext);
    const state = useContext(RegistryStateContext);
    if (!dispatch) {
        throw new Error("useRebaseRegistry must be used within RebaseRegistryProvider");
    }
    return useMemo(() => ({ ...state,
...dispatch }), [state, dispatch]);
}

/**
 * Returns only the stable dispatch functions.
 * Use this in feature components (RebaseAuth, RebaseCMS, RebaseStudio)
 * to avoid re-render loops.
 */
export function useRebaseRegistryDispatch(): RegistryDispatch {
    const dispatch = useContext(RegistryDispatchContext);
    if (!dispatch) {
        throw new Error("useRebaseRegistryDispatch must be used within RebaseRegistryProvider");
    }
    return dispatch;
}
