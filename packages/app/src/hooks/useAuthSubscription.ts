import { useState, useEffect, useMemo, useCallback } from "react";
import { AuthClient, User } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";

export function useAuthSubscription(authClient?: AuthClient): AuthController {

    // Check initial state
    const currentSession = authClient?.getSession();
    const [user, setUser] = useState<User | null>(currentSession?.user ?? null);

    const [authLoading, setAuthLoading] = useState(false);
    const [authError, setAuthError] = useState<Error>();
    const [loginSkipped, setLoginSkipped] = useState(false);
    const [extra, setExtra] = useState<any>();

    /**
     * Whether asking the server "who am I?" could possibly answer.
     *
     * A client configured with `persistSession: false` and JSON auth — the
     * shape used when one client borrows another's credential, as the hosted
     * Studio does — has no stored session and no auth cookie, so the probe
     * below is guaranteed to 401. Sending it anyway put three failing
     * `GET /auth/me` calls on the wire per mount, each one landing in the
     * *customer's* request log as an authentication failure against their own
     * backend.
     *
     * A client that does not implement the capability is treated as "might
     * work" — the historical behaviour.
     */
    const mayHaveRestorableSession = authClient?.canRestoreSession?.() ?? true;

    /**
     * `true` only while a probe is genuinely outstanding.
     *
     * It used to be seeded from `!currentSession` alone, which left a client
     * that cannot restore a session — and therefore never runs the probe that
     * clears the flag — reporting "still loading" forever. Anything gated on
     * `initialLoading` (a spinner, a redirect to the login view) would never
     * resolve.
     */
    const [initialLoading, setInitialLoading] = useState(!currentSession && mayHaveRestorableSession);

    useEffect(() => {
        if (!authClient) return;
        // If we don't have a session initially, try to get user which restores session if a persistent token exists
        if (!currentSession && mayHaveRestorableSession) {
            setInitialLoading(true);
            authClient.getUser()
                .then(user => {
                    if (user) {
                        setUser(user);
                    }
                    setAuthError(undefined);
                })
                .catch((e: unknown) => {
                    // A 401 or 403 is the ordinary first load of an anonymous
                    // visitor: there is no session, which is not an error.
                    //
                    // Everything else is. This used to swallow the lot with
                    // "Ignore, user just isn't logged in", leaving `authError`
                    // — a field this controller declares and `Rebase` renders a
                    // full-screen "Error loading auth" view for — permanently
                    // undefined. So the view was unreachable, and a backend that
                    // was down, misconfigured, or blocked by CORS looked exactly
                    // like being signed out: the app showed the login form.
                    const status = (e as { status?: number } | undefined)?.status;
                    if (status === 401 || status === 403) {
                        setAuthError(undefined);
                        return;
                    }
                    setAuthError(e instanceof Error ? e : new Error(String(e)));
                })
                .finally(() => {
                    setInitialLoading(false);
                });
        }
    }, [authClient, currentSession, mayHaveRestorableSession]);

    useEffect(() => {
        if (!authClient) return;
        const unsubscribe = authClient.onAuthStateChange((event, session) => {
            if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
                setUser(session?.user ?? null);
            } else if (event === "SIGNED_OUT") {
                setUser(null);
            }
        });
        return unsubscribe;
    }, [authClient]);

    const signOut = useCallback(async () => {
        if (!authClient) return;
        setAuthLoading(true);
        try {
            await authClient.signOut();
        } finally {
            setAuthLoading(false);
        }
    }, [authClient]);

    const getAuthToken = useCallback(async () => {
        if (!authClient) return "";
        const session = authClient.getSession();
        if (!session) return "";
        if (session.expiresAt < Date.now()) {
            try {
                const refreshed = await authClient.refreshSession();
                return refreshed.accessToken;
            } catch (e) {
                return "";
            }
        }
        return session.accessToken;
    }, [authClient]);

    return useMemo(() => ({
        user,
        initialLoading: authClient ? initialLoading : false,
        authLoading,
        signOut,
        authError,
        getAuthToken,
        loginSkipped,
        extra,
        setExtra
    } as AuthController), [
        user, initialLoading, authLoading, signOut, authError,
        getAuthToken, loginSkipped, extra, setExtra, authClient
    ]);
}
