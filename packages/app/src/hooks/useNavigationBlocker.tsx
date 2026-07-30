import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Blocker, BlockerFunction, useBlocker } from "react-router";

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
 * Owns the single React Router blocker for the whole app.
 *
 * React Router only honours **one** blocker at a time: `shouldBlockNavigation`
 * picks the last-registered blocker function and silently ignores every other
 * one (it only logs a dev warning). Because blockers register in a `useEffect`,
 * the winner is whichever surface mounted most recently — so an unsaved-changes
 * guard could be disabled by an unrelated component mounting after it.
 *
 * This provider registers the only `useBlocker` in the tree and multiplexes it,
 * so every surface that needs to guard navigation gets a say regardless of
 * mount order. Surfaces register through {@link useNavigationBlocker}.
 */
export function NavigationBlockerProvider({ children }: { children: React.ReactNode }) {

    const predicates = useRef(new Map<string, BlockerFunction>());

    // State, not a ref: the owning registration only renders its dialog once
    // this has propagated, so it has to go through React.
    const [blockedBy, setBlockedBy] = useState<string | null>(null);

    const shouldBlock = useCallback<BlockerFunction>((args) => {
        for (const [id, predicate] of predicates.current) {
            if (predicate(args)) {
                setBlockedBy(id);
                return true;
            }
        }
        setBlockedBy(null);
        return false;
    }, []);

    const blocker = useBlocker(shouldBlock);

    const register = useCallback((id: string, predicate: BlockerFunction) => {
        predicates.current.set(id, predicate);
    }, []);

    const unregister = useCallback((id: string) => {
        predicates.current.delete(id);
        setBlockedBy((current) => (current === id ? null : current));
    }, []);

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
