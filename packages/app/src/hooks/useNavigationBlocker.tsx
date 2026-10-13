import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
    Blocker,
    BlockerFunction,
    Location,
    NavigationType,
    UNSAFE_DataRouterContext,
    UNSAFE_DataRouterStateContext,
    useBlocker
} from "react-router";

const IDLE_BLOCKER: Blocker = {
    state: "unblocked",
    proceed: undefined,
    reset: undefined,
    location: undefined
};

type NavigationBlockerContextValue = {
    register: (id: string, predicate: BlockerFunction) => void;
    unregister: (id: string) => void;
    blocker: Blocker;
    /** Id of the registration that caused the current block, if any. */
    blockedBy: string | null;
};

const NavigationBlockerContext = createContext<NavigationBlockerContextValue | null>(null);

/**
 * Owns the single navigation guard for the whole app.
 *
 * Under a React Router **data router** (`createBrowserRouter` +
 * `<RouterProvider>`) it holds the one `useBlocker` in the tree. React Router
 * only honours one blocker at a time: `shouldBlockNavigation` picks the
 * last-registered blocker function and silently ignores every other one (it
 * only logs a dev warning). Because blockers register in a `useEffect`, the
 * winner is whichever surface mounted most recently — so an unsaved-changes
 * guard could be disabled by an unrelated component mounting after it. This
 * provider registers the only one and multiplexes it, so every surface that
 * guards navigation gets a say regardless of mount order.
 *
 * Under any **other** router (a plain `<BrowserRouter>`, a `<MemoryRouter>`)
 * there is no `useBlocker` to call — it throws outside a data router — and no
 * way to intercept an in-app navigation. The guards then degrade to the
 * browser's own: leaving the page (reload, tab close, typing a URL) asks for
 * confirmation while any registered guard would block leaving.
 *
 * Surfaces register through {@link useNavigationBlocker}.
 */
export function NavigationBlockerProvider({ children }: { children: React.ReactNode }) {
    // Both contexts are set by `<RouterProvider>` and by nothing else, and
    // `useBlocker` reads both. Which provider renders is fixed by where this
    // sits, so the branch never switches hooks under a mounted component.
    const dataRouter = useContext(UNSAFE_DataRouterContext);
    const dataRouterState = useContext(UNSAFE_DataRouterStateContext);
    return dataRouter && dataRouterState
        ? <DataRouterBlockerProvider>{children}</DataRouterBlockerProvider>
        : <BeforeUnloadBlockerProvider>{children}</BeforeUnloadBlockerProvider>;
}

/** The registered guards, and which of them caused the current block. */
function useGuardRegistry() {
    const predicates = useRef(new Map<string, BlockerFunction>());

    // State, not a ref: the owning registration only renders its dialog once
    // this has propagated, so it has to go through React.
    const [blockedBy, setBlockedBy] = useState<string | null>(null);

    const register = useCallback((id: string, predicate: BlockerFunction) => {
        predicates.current.set(id, predicate);
    }, []);

    const unregister = useCallback((id: string) => {
        predicates.current.delete(id);
        setBlockedBy((current) => (current === id ? null : current));
    }, []);

    return { predicates, blockedBy, setBlockedBy, register, unregister };
}

function DataRouterBlockerProvider({ children }: { children: React.ReactNode }) {
    const { predicates, blockedBy, setBlockedBy, register, unregister } = useGuardRegistry();

    const shouldBlock = useCallback<BlockerFunction>((args) => {
        for (const [id, predicate] of predicates.current) {
            if (predicate(args)) {
                setBlockedBy(id);
                return true;
            }
        }
        setBlockedBy(null);
        return false;
    }, [predicates, setBlockedBy]);

    const blocker = useBlocker(shouldBlock);

    const value = useMemo<NavigationBlockerContextValue>(() => ({
        register,
        unregister,
        blocker,
        blockedBy
    }), [register, unregister, blocker, blockedBy]);

    return (
        <NavigationBlockerContext.Provider value={value}>
            {children}
        </NavigationBlockerContext.Provider>
    );
}

/**
 * Where a page unload goes, as a guard sees it: somewhere that is not this
 * app. No path, so it matches no record, tab or panel a guard lets through.
 */
const OUTSIDE_THE_APP: Location = {
    pathname: "",
    search: "",
    hash: "",
    state: null,
    key: "beforeunload"
};

function BeforeUnloadBlockerProvider({ children }: { children: React.ReactNode }) {
    const { predicates, register, unregister } = useGuardRegistry();

    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            const here: Location = {
                pathname: window.location.pathname,
                search: window.location.search,
                hash: window.location.hash,
                state: null,
                key: "default"
            };
            for (const predicate of predicates.current.values()) {
                if (predicate({ currentLocation: here, nextLocation: OUTSIDE_THE_APP, historyAction: NavigationType.Pop })) {
                    event.preventDefault();
                    // Still what Chrome and Safari read to show the prompt.
                    event.returnValue = "";
                    return;
                }
            }
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [predicates]);

    const value = useMemo<NavigationBlockerContextValue>(() => ({
        register,
        unregister,
        blocker: IDLE_BLOCKER,
        blockedBy: null
    }), [register, unregister]);

    return (
        <NavigationBlockerContext.Provider value={value}>
            {children}
        </NavigationBlockerContext.Provider>
    );
}

/**
 * Guard navigation with `predicate`, sharing the app-wide blocker.
 *
 * Returns a {@link Blocker} that is only ever in the `blocked` state when *this*
 * registration is what blocked the navigation — so several guards can coexist
 * without each of them popping a dialog.
 *
 * Returns an idle blocker when no {@link NavigationBlockerProvider} is mounted
 * above, rather than competing for React Router's single blocker slot.
 */
export function useNavigationBlocker(predicate: BlockerFunction): Blocker {

    const context = useContext(NavigationBlockerContext);
    const id = useId();

    // Keep the latest predicate without re-registering on every render.
    const predicateRef = useRef(predicate);
    predicateRef.current = predicate;

    const register = context?.register;
    const unregister = context?.unregister;

    useEffect(() => {
        if (!register || !unregister) return;
        register(id, (args) => predicateRef.current(args));
        return () => unregister(id);
    }, [register, unregister, id]);

    if (!context) return IDLE_BLOCKER;
    return context.blockedBy === id ? context.blocker : IDLE_BLOCKER;
}
