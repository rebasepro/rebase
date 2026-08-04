import { useCallback, useEffect, useRef, useState } from "react";
import type { User, AuthChangeEvent, RebaseSession } from "@rebasepro/types";
import type { AuthConfigResponse } from "./api";
import { RebaseAuthController, RebaseAuthControllerProps } from "./types";

/**
 * Auth controller hook for JWT-based authentication.
 *
 * This is a thin React binding over the headless SDK `client.auth`.
 * It synchronizes React state with the SDK's internal state and delegates
 * all operations to the SDK to ensure a single source of truth for
 * authentication sessions across the entire application.
 *
 * @param props Configuration options
 * @returns RebaseAuthController instance
 */
export function useRebaseAuthController(
    props: RebaseAuthControllerProps = {}
): RebaseAuthController {
    const { client, onSignOut, defineRolesFor } = props;
    const auth = client?.auth;

    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [authError, setAuthError] = useState<Error | null>(null);
    const [authProviderError, setAuthProviderError] = useState<Error | null>(null);
    const [loginSkipped, setLoginSkipped] = useState(false);
    const [extra, setExtra] = useState<unknown>(null);
    const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);

    const isMountedRef = useRef(true);
    // Keep a stable ref to onSignOut so the listener never goes stale.
    const onSignOutRef = useRef(onSignOut);
    onSignOutRef.current = onSignOut;
    // Keep a stable ref to defineRolesFor too, so an inline (non-memoized)
    // function from the consumer does not re-run the sync effect on every
    // render — which would re-subscribe to auth events and re-fetch the
    // (uncached) auth config each time.
    const defineRolesForRef = useRef(defineRolesFor);
    defineRolesForRef.current = defineRolesFor;

    const clearError = useCallback(() => {
        setAuthProviderError(null);
    }, []);

    // Sync state with client.auth
    useEffect(() => {
        if (!auth) {
            setInitialLoading(false);
            return;
        }

        isMountedRef.current = true;

        const updateState = async (session: RebaseSession | null) => {
            if (!isMountedRef.current) return;

            let userToSet = session?.user ?? null;
            const defineRolesFor = defineRolesForRef.current;
            if (userToSet && defineRolesFor) {
                try {
                    const roles = await defineRolesFor(userToSet);
                    if (roles && isMountedRef.current) {
                        userToSet = { ...userToSet, roles };
                    }
                } catch (e) {
                    console.error("Error defining roles:", e);
                }
            }

            if (isMountedRef.current) {
                setUser(userToSet);
            }
        };

        const syncState = async (event: AuthChangeEvent, session: RebaseSession | null) => {
            await updateState(session);
            if (event === "SIGNED_OUT") {
                if (isMountedRef.current) {
                    setLoginSkipped(false);
                }
                onSignOutRef.current?.();
            }
        };

        // Initial sync with whatever is currently in the SDK
        updateState(auth.getSession());

        // Wait for SDK initialization (restoring session from storage or silent refresh)
        auth.isInitialized().then(() => {
            if (isMountedRef.current) {
                updateState(auth.getSession());
                setInitialLoading(false);
            }
        }).catch(() => {
            if (isMountedRef.current) setInitialLoading(false);
        });

        // Fetch backend auth configuration
        auth.getAuthConfig().then((config: AuthConfigResponse) => {
            if (isMountedRef.current) setAuthConfig(config);
        }).catch((e: unknown) => {
            // Swallowed entirely before. This is what tells the login view which
            // providers exist, so losing it renders a login form that is wrong
            // rather than one that is broken — the hardest kind to report. Not
            // promoted to `authError`, which blanks the whole app: a signed-in
            // user is unaffected by this failing.
            console.warn("[Rebase] Could not load the backend auth configuration; " +
                "the login view will fall back to defaults.", e);
        });

        const unsubscribe = auth.onAuthStateChange(syncState);

        return () => {
            isMountedRef.current = false;
            unsubscribe();
        };
    }, [auth]);

    const getAuthToken = useCallback(async (): Promise<string> => {
        if (!auth) throw new Error("Rebase client with auth is required");
        const session = auth.getSession();

        // If we have a valid token, return it
        if (session?.accessToken && session.expiresAt > Date.now() + 10000) {
            return session.accessToken;
        }

        // Otherwise, refresh
        const newSession = await auth.refreshSession();
        return newSession.accessToken;
    }, [auth]);

    const signOut = useCallback(async () => {
        if (!auth) return;
        setAuthLoading(true);
        try {
            await auth.signOut();
            // signOut emits SIGNED_OUT → syncState calls onSignOutRef.current
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const emailPasswordLogin = useCallback(async (email: string, password: string) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            await auth.signInWithEmail(email, password);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const register = useCallback(async (email: string, password: string, displayName?: string) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            await auth.signUp(email, password, displayName);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const googleLogin = useCallback(async (
        payload: { idToken: string } | { accessToken: string } | { code: string; redirectUri: string }
    ) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            await auth.signInWithGoogle(payload);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const oauthLogin = useCallback(async (providerId: string, payload: Record<string, unknown>) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            await auth.signInWithOAuth(providerId, payload);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const skipLogin = useCallback(() => {
        setLoginSkipped(true);
        setUser(null);
    }, []);

    const forgotPassword = useCallback(async (email: string) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            await auth.resetPasswordForEmail(email);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const resetPassword = useCallback(async (token: string, password: string) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            await auth.resetPassword(token, password);
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            await auth.changePassword(oldPassword, newPassword);
            // Sign out after password change as sessions are usually invalidated
            await auth.signOut();
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const updateProfile = useCallback(async (displayName?: string, photoURL?: string) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        setAuthLoading(true);
        setAuthProviderError(null);
        try {
            const updatedUser = await auth.updateUser({ displayName, photoURL });
            return updatedUser;
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            setAuthProviderError(err);
            throw error;
        } finally {
            setAuthLoading(false);
        }
    }, [auth]);

    const fetchSessions = useCallback(async () => {
        if (!auth) throw new Error("Rebase client with auth is required");
        return await auth.getSessions();
    }, [auth]);

    const revokeSession = useCallback(async (sessionId: string) => {
        if (!auth) throw new Error("Rebase client with auth is required");
        await auth.revokeSession(sessionId);
    }, [auth]);

    const revokeAllSessions = useCallback(async () => {
        if (!auth) throw new Error("Rebase client with auth is required");
        await auth.revokeAllSessions();
    }, [auth]);

    return {
        user,
        authLoading,
        initialLoading,
        authError,
        authProviderError,
        loginSkipped,
        needsSetup: authConfig?.needsSetup ?? false,
        registrationEnabled: authConfig?.registrationEnabled ?? false,
        getAuthToken,
        getApiUrl: () => client?.baseUrl,
        signOut,
        emailPasswordLogin,
        register,
        googleLogin,
        oauthLogin,
        skipLogin,
        forgotPassword,
        resetPassword,
        changePassword,
        updateProfile,
        fetchSessions,
        revokeSession,
        revokeAllSessions,
        clearError,
        setAuthProviderError,
        extra,
        setExtra,
        capabilities: {
            emailPasswordLogin: true,
            googleLogin: !!(props.googleClientId),
            registration: authConfig?.registrationEnabled ?? false,
            passwordReset: authConfig?.passwordReset ?? false,
            // Defaults to true so backends predating this field keep showing the
            // action. Adapters that don't support it report `false` explicitly.
            adminPasswordReset: authConfig?.adminPasswordReset ?? true,
            sessionManagement: true,
            profileUpdate: true,
            emailVerification: authConfig?.emailVerification ?? false,
            enabledProviders: authConfig?.enabledProviders ?? []
        }
    };
}
