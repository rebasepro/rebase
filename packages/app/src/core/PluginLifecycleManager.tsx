
import { useEffect, useRef } from "react";
import type { RebasePlugin, RebaseContext } from "@rebasepro/cms-types";

/**
 * Render-less component that manages plugin lifecycle hooks.
 *
 * - Calls `lifecycle.onMount(context)` once, the first time auth is ready.
 * - Calls `lifecycle.onAuthStateChange(user)` on every change of user after
 *   that — `null` on sign-out, the new user on the next sign-in.
 * - Calls `lifecycle.onUnmount()` when the Rebase tree unmounts.
 *
 * Mounted for as long as there are plugins, signed in or not. It used to be
 * mounted only while a user was signed in, so a sign-out unmounted it and the
 * next sign-in mounted a fresh one — `onAuthStateChange` could never see the
 * user change, and never fired.
 *
 * Mount this component inside the Rebase tree, below PluginProviderStack,
 * so that the RebaseContext is fully available.
 *
 * @internal
 */
export function PluginLifecycleManager({
    plugins,
    context,
    authReady
}: {
    plugins: RebasePlugin[];
    context: RebaseContext;
    /** Signed in, or sign-in skipped: what `onMount` waits for. */
    authReady: boolean;
}) {
    const mountedRef = useRef(false);
    const prevUidRef = useRef<string | null>(null);
    const currentUser = context.authController?.user ?? null;

    // ── Mount ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!authReady || mountedRef.current) return;
        mountedRef.current = true;
        prevUidRef.current = currentUser?.uid ?? null;

        for (const plugin of plugins) {
            if (plugin.lifecycle?.onMount) {
                try {
                    const result = plugin.lifecycle.onMount(context);
                    if (result instanceof Promise) {
                        result.catch((err) =>
                            console.error(`[Rebase] Plugin "${plugin.key}" onMount error:`, err)
                        );
                    }
                } catch (err) {
                    console.error(`[Rebase] Plugin "${plugin.key}" onMount error:`, err);
                }
            }
        }
        // Once: later changes of user are `onAuthStateChange`'s.
    }, [authReady]);

    // ── Unmount ──────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (!mountedRef.current) return;
            mountedRef.current = false;
            for (const plugin of plugins) {
                if (plugin.lifecycle?.onUnmount) {
                    try {
                        plugin.lifecycle.onUnmount();
                    } catch (err) {
                        console.error(`[Rebase] Plugin "${plugin.key}" onUnmount error:`, err);
                    }
                }
            }
        };
        // Only on unmount — plugins array identity should be stable
    }, []);

    // ── Auth state change ────────────────────────────────────────────
    useEffect(() => {
        // Before `onMount` there is nobody to tell.
        if (!mountedRef.current) return;

        // Only fire when the user identity actually changes
        const currUid = currentUser?.uid ?? null;
        if (prevUidRef.current === currUid) return;
        prevUidRef.current = currUid;

        for (const plugin of plugins) {
            if (plugin.lifecycle?.onAuthStateChange) {
                try {
                    plugin.lifecycle.onAuthStateChange(currentUser);
                } catch (err) {
                    console.error(
                        `[Rebase] Plugin "${plugin.key}" onAuthStateChange error:`,
                        err
                    );
                }
            }
        }
    }, [currentUser, plugins]);

    return null;
}
