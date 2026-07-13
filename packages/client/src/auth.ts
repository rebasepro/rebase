import { RebaseApiError, Transport } from "./transport";
import type { AuthChangeEvent, RebaseSession, AuthTokens, DeviceSession, User } from "@rebasepro/types";

// Re-export canonical types so `import { RebaseSession } from "@rebasepro/client"` keeps working
export type { RebaseSession, AuthTokens, AuthChangeEvent, DeviceSession } from "@rebasepro/types";

/** @deprecated Use `User` from `@rebasepro/types` instead. */
export type RebaseUser = User;
/** @deprecated Use `AuthTokens` from `@rebasepro/types` instead. */
export type RebaseTokens = AuthTokens;


export interface AuthConfig {
    needsSetup: boolean;
    registrationEnabled: boolean;
    emailServiceEnabled?: boolean;
    passwordReset?: boolean;
    emailVerification?: boolean;
    magicLink?: boolean;
    enabledProviders: string[];
}

export interface AuthStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
}

export function createMemoryStorage(): AuthStorage {
    const store: Record<string, string> = {};
    return {
        getItem(key) { return store[key] ?? null; },
        setItem(key, value) { store[key] = value; },
        removeItem(key) { delete store[key]; }
    };
}

function detectStorage(): AuthStorage {
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("__rebase_test__", "1");
            localStorage.removeItem("__rebase_test__");
            return localStorage;
        }
    } catch (e) { /* ignore */ }
    return createMemoryStorage();
}

export interface CreateAuthOptions {
    storage?: AuthStorage;
    authPath?: string;
    autoRefresh?: boolean;
    persistSession?: boolean;
    /**
     * Authentication flow mode.
     * - 'json' (default): Tokens are sent/received in JSON bodies. Refresh token is stored in local storage.
     * - 'cookie': Refresh token is sent/received via httpOnly cookies. Access token remains in memory.
     */
    authFlowMode?: "json" | "cookie";
}

export function createAuth(transport: Transport, options?: CreateAuthOptions) {
    const opts = options || {};
    const storage = opts.storage || detectStorage();
    const authPath = opts.authPath || "/auth";
    const autoRefresh = opts.autoRefresh !== false;
    const persistSession = opts.persistSession !== false;
    const authFlowMode = opts.authFlowMode || "json";

    const STORAGE_KEY = "rebase_auth";
    const REFRESH_BUFFER_MS = 120000;

    let currentSession: RebaseSession | null = null;
    const listeners = new Set<(event: AuthChangeEvent, session: RebaseSession | null) => void>();
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    // De-dupe concurrent refreshes. On boot (esp. cookie mode + React StrictMode)
    // multiple callers can trigger refresh at once; without this they race — the
    // server rotates the refresh token twice and the browser can end up with a
    // cookie the DB no longer matches. A single in-flight promise is shared.
    let inFlightRefresh: Promise<RebaseSession> | null = null;
    let resolveInitialized: (value: void | PromiseLike<void>) => void;
    const isInitialized = new Promise<void>((resolve) => {
        resolveInitialized = resolve;
    });

    function authUrl(endpoint: string) {
        return transport.baseUrl + transport.apiPath + authPath + endpoint;
    }

    function getFetch() {
        return transport.fetchFn || globalThis.fetch;
    }

    function throwApiError(status: number, body: { error?: { message?: string; code?: string; details?: unknown }; message?: string; code?: string; details?: unknown } | undefined, statusText: string): never {
        throw new RebaseApiError(
            body?.error?.message || body?.message || statusText,
            {
                status,
                code: body?.error?.code || body?.code,
                details: body?.error?.details || body?.details
            }
        );
    }

    function emit(event: AuthChangeEvent, session: RebaseSession | null) {
        for (const fn of listeners) {
            try { fn(event, session); } catch (e) { /* ignore */ }
        }
    }

    function saveSession(session: RebaseSession) {
        if (!persistSession || authFlowMode === "cookie") return;
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch (e) { /* ignore */ }
    }

    function clearStoredSession() {
        try {
            storage.removeItem(STORAGE_KEY);
        } catch (e) { /* ignore */ }
    }

    function loadStoredSession(): RebaseSession | null {
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw) as RebaseSession;
        } catch (e) { /* ignore */ }
        return null;
    }

    function scheduleRefresh(expiresAt: number) {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        if (!autoRefresh) return;

        const delay = (expiresAt - REFRESH_BUFFER_MS) - Date.now();

        if (delay <= 0) {
            refreshSession().catch(() => signOut());
            return;
        }

        refreshTimeout = setTimeout(async () => {
            try {
                await refreshSession();
            } catch (e) {
                signOut();
            }
        }, delay);
    }

    function handleAuthResponse(data: { tokens: AuthTokens, user: Record<string, unknown> }, event?: AuthChangeEvent): RebaseSession {
        const rawUser = data.user;
        const user: User = {
            uid: rawUser.uid as string,
            email: (rawUser.email as string | null) ?? null,
            displayName: (rawUser.displayName as string | null) ?? null,
            photoURL: (rawUser.photoURL as string | null) ?? null,
            providerId: (rawUser.providerId as string | undefined) ?? "password",
            isAnonymous: (rawUser.isAnonymous as boolean | undefined) ?? false,
            emailVerified: rawUser.emailVerified as boolean | undefined,
            roles: rawUser.roles as string[] | undefined,
            metadata: rawUser.metadata as Record<string, unknown> | undefined,
        };
        const session: RebaseSession = {
            accessToken: data.tokens.accessToken,
            refreshToken: data.tokens.refreshToken || (currentSession?.refreshToken) || "",
            expiresAt: data.tokens.accessTokenExpiresAt,
            user
        };
        currentSession = session;
        saveSession(session);
        transport.setToken(session.accessToken);
        scheduleRefresh(session.expiresAt);
        emit(event || "SIGNED_IN", session);
        return session;
    }

    async function signInWithEmail(email: string, password: string) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email,
password }),
            credentials: authFlowMode === "cookie" ? "include" : undefined
        } as RequestInit);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        const session = handleAuthResponse(body, "SIGNED_IN");
        return { user: session.user,
accessToken: session.accessToken,
refreshToken: session.refreshToken };
    }

    async function signUp(email: string, password: string, displayName?: string) {
        const fetchFn = getFetch();
        const payload: Record<string, string> = { email,
password };
        if (displayName !== undefined) payload.displayName = displayName;
        const res = await fetchFn(authUrl("/register"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: authFlowMode === "cookie" ? "include" : undefined
        } as RequestInit);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        const session = handleAuthResponse(body, "SIGNED_IN");
        return { user: session.user,
accessToken: session.accessToken,
refreshToken: session.refreshToken };
    }

    /**
     * Sign in with Google.
     *
     * Supports three invocation styles:
     * - `signInWithGoogle({ idToken })` — ID-token flow (One Tap / Sign In button)
     * - `signInWithGoogle({ accessToken })` — Access-token flow (popup)
     * - `signInWithGoogle({ code, redirectUri })` — Authorization code flow (most secure)
     */
    async function signInWithGoogle(
        payload: { idToken: string } | { accessToken: string } | { code: string; redirectUri: string }
    ) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/google"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: authFlowMode === "cookie" ? "include" : undefined
        } as RequestInit);
        const responseBody = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, responseBody, res.statusText);
        const session = handleAuthResponse(responseBody, "SIGNED_IN");
        return { user: session.user,
accessToken: session.accessToken,
refreshToken: session.refreshToken };
    }

    async function signInWithLinkedin(code: string, redirectUri: string) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/linkedin"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code,
redirectUri }),
            credentials: authFlowMode === "cookie" ? "include" : undefined
        } as RequestInit);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        const session = handleAuthResponse(body, "SIGNED_IN");
        return { user: session.user,
accessToken: session.accessToken,
refreshToken: session.refreshToken };
    }

    /**
     * Generic OAuth sign-in. Posts the given payload to `/auth/{providerId}`.
     * Use this for any provider registered on the backend.
     */
    async function signInWithOAuth(providerId: string, payload: Record<string, unknown>) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl(`/${providerId}`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: authFlowMode === "cookie" ? "include" : undefined
        } as RequestInit);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        const session = handleAuthResponse(body, "SIGNED_IN");
        return { user: session.user,
accessToken: session.accessToken,
refreshToken: session.refreshToken };
    }

    // Convenience wrappers for all supported OAuth providers

    async function signInWithGitHub(code: string, redirectUri: string) {
        return signInWithOAuth("github", { code,
redirectUri });
    }

    async function signInWithMicrosoft(code: string, redirectUri: string) {
        return signInWithOAuth("microsoft", { code,
redirectUri });
    }

    async function signInWithApple(code: string, redirectUri: string, user?: { name?: { firstName?: string; lastName?: string }; email?: string }) {
        return signInWithOAuth("apple", { code,
redirectUri,
user });
    }

    async function signInWithFacebook(code: string, redirectUri: string) {
        return signInWithOAuth("facebook", { code,
redirectUri });
    }

    async function signInWithTwitter(code: string, redirectUri: string, codeVerifier: string) {
        return signInWithOAuth("twitter", { code,
redirectUri,
codeVerifier });
    }

    async function signInWithDiscord(code: string, redirectUri: string) {
        return signInWithOAuth("discord", { code,
redirectUri });
    }

    async function signInWithGitLab(code: string, redirectUri: string) {
        return signInWithOAuth("gitlab", { code,
redirectUri });
    }

    async function signInWithBitbucket(code: string, redirectUri: string) {
        return signInWithOAuth("bitbucket", { code,
redirectUri });
    }

    async function signInWithSlack(code: string, redirectUri: string) {
        return signInWithOAuth("slack", { code,
redirectUri });
    }

    async function signInWithSpotify(code: string, redirectUri: string) {
        return signInWithOAuth("spotify", { code,
redirectUri });
    }

    async function signOut() {
        const fetchFn = getFetch();
        try {
            if (authFlowMode === "cookie" || currentSession?.refreshToken) {
                await fetchFn(authUrl("/logout"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ refreshToken: currentSession?.refreshToken }),
                    credentials: authFlowMode === "cookie" ? "include" : undefined
                } as RequestInit);
            }
        } catch (e) { /* ignore */ }
        currentSession = null;
        clearStoredSession();
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
            refreshTimeout = null;
        }
        transport.setToken(null);
        emit("SIGNED_OUT", null);
    }

    function refreshSession(): Promise<RebaseSession> {
        // Share a single in-flight refresh across concurrent callers.
        if (inFlightRefresh) return inFlightRefresh;
        inFlightRefresh = doRefreshSession().finally(() => {
            inFlightRefresh = null;
        });
        return inFlightRefresh;
    }

    async function doRefreshSession(): Promise<RebaseSession> {
        if (authFlowMode !== "cookie" && !currentSession?.refreshToken) {
            throw new Error("No active session to refresh");
        }
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/refresh"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: currentSession?.refreshToken }),
            credentials: authFlowMode === "cookie" ? "include" : undefined
        } as RequestInit);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);

        const accessToken = body.tokens.accessToken;
        transport.setToken(accessToken);

        // Resolve the user, in order of preference:
        //   1. the user returned by /refresh (modern backends include it),
        //   2. the user already in memory,
        //   3. a fetch of /me — required to restore a session from an httpOnly
        //      cookie alone (cold start in cookie mode), where there is no
        //      in-memory user and the backend didn't echo one.
        let user = currentSession?.user;
        if (body.user && typeof body.user.uid === "string") {
            const raw = body.user as Record<string, unknown>;
            user = {
                uid: raw.uid as string,
                email: (raw.email as string | null) ?? null,
                displayName: (raw.displayName as string | null) ?? null,
                photoURL: (raw.photoURL as string | null) ?? null,
                providerId: (raw.providerId as string | undefined) ?? "password",
                isAnonymous: (raw.isAnonymous as boolean | undefined) ?? false,
                emailVerified: raw.emailVerified as boolean | undefined,
                roles: raw.roles as string[] | undefined,
                metadata: raw.metadata as Record<string, unknown> | undefined,
            };
        } else if (!user || !user.uid) {
            try {
                user = await getUser();
            } catch { /* fall through to the empty stub below */ }
        }

        const session: RebaseSession = {
            accessToken,
            refreshToken: body.tokens.refreshToken || currentSession?.refreshToken || "",
            expiresAt: body.tokens.accessTokenExpiresAt,
            user: user ?? { uid: "", email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false }
        };
        currentSession = session;
        saveSession(session);
        transport.setToken(session.accessToken);
        scheduleRefresh(session.expiresAt);
        emit("TOKEN_REFRESHED", session);
        return session;
    }

    async function getUser() {
        const data = await transport.request<{ user: User }>(authPath + "/me", { method: "GET" });
        return data.user;
    }

    async function updateUser(updates: { displayName?: string, photoURL?: string }) {
        const data = await transport.request<{ user: User }>(authPath + "/me", {
            method: "PATCH",
            body: JSON.stringify(updates)
        });
        if (currentSession) {
            currentSession = { ...currentSession,
user: data.user };
            saveSession(currentSession);
            emit("USER_UPDATED", currentSession);
        }
        return data.user;
    }

    async function resetPasswordForEmail(email: string) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/forgot-password"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        return body as { success: boolean; message: string; };
    }

    async function resetPassword(token: string, password: string) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/reset-password"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token,
password })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        return body as { success: boolean; message: string; };
    }

    async function changePassword(oldPassword: string, newPassword: string) {
        return transport.request<{ success: boolean; message: string; }>(authPath + "/change-password", {
            method: "POST",
            body: JSON.stringify({ oldPassword,
newPassword })
        });
    }

    async function sendVerificationEmail() {
        return transport.request<{ success: boolean; message: string; }>(authPath + "/send-verification", {
            method: "POST"
        });
    }

    async function verifyEmail(token: string) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/verify-email?token=" + encodeURIComponent(token)), {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        return body as { success: boolean; message: string; };
    }

    async function sendMagicLink(email: string) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/magic-link"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        return body as { success: boolean; message: string; };
    }

    async function verifyMagicLink(token: string) {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/magic-link/verify"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
            credentials: authFlowMode === "cookie" ? "include" : undefined
        } as RequestInit);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        const session = handleAuthResponse(body, "SIGNED_IN");
        return { user: session.user,
accessToken: session.accessToken,
refreshToken: session.refreshToken };
    }

    async function getSessions(): Promise<DeviceSession[]> {
        const data = await transport.request<{ sessions: DeviceSession[] }>(authPath + "/sessions", { method: "GET" });
        return data.sessions;
    }

    async function revokeSession(sessionId: string) {
        return transport.request<{ success: boolean }>(authPath + "/sessions/" + encodeURIComponent(sessionId), {
            method: "DELETE"
        });
    }

    async function revokeAllSessions() {
        const result = await transport.request<{ success: boolean }>(authPath + "/sessions", {
            method: "DELETE"
        });
        currentSession = null;
        clearStoredSession();
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
            refreshTimeout = null;
        }
        transport.setToken(null);
        emit("SIGNED_OUT", null);
        return result;
    }

    async function getAuthConfig() {
        const fetchFn = getFetch();
        const res = await fetchFn(authUrl("/config"), {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throwApiError(res.status, body, res.statusText);
        return body as AuthConfig;
    }

    function getSession() {
        return currentSession;
    }

    function onAuthStateChange(callback: (event: AuthChangeEvent, session: RebaseSession | null) => void) {
        listeners.add(callback);
        return () => listeners.delete(callback);
    }

    if (persistSession) {
        const stored = loadStoredSession();
        if (stored && stored.accessToken) {
            if (stored.expiresAt > Date.now()) {
                currentSession = stored;
                transport.setToken(stored.accessToken);
                scheduleRefresh(stored.expiresAt);
                resolveInitialized!();
            } else if (authFlowMode === "cookie" || stored.refreshToken) {
                currentSession = stored;
                refreshSession().then(() => {
                    resolveInitialized!();
                }).catch(() => {
                    currentSession = null;
                    clearStoredSession();
                    transport.setToken(null);
                    resolveInitialized!();
                });
            } else {
                resolveInitialized!();
            }
        } else if (authFlowMode === "cookie") {
            // Silent refresh on boot to pick up httpOnly session
            refreshSession().then(() => {
                resolveInitialized!();
            }).catch(() => {
                resolveInitialized!();
            });
        } else {
            resolveInitialized!();
        }
    } else {
        resolveInitialized!();
    }

    return {
        signInWithEmail,
        signUp,
        signInWithGoogle,
        signInWithLinkedin,
        signInWithOAuth,
        signInWithGitHub,
        signInWithMicrosoft,
        signInWithApple,
        signInWithFacebook,
        signInWithTwitter,
        signInWithDiscord,
        signInWithGitLab,
        signInWithBitbucket,
        signInWithSlack,
        signInWithSpotify,
        signOut,
        refreshSession,
        getUser,
        updateUser,
        resetPasswordForEmail,
        resetPassword,
        changePassword,
        sendVerificationEmail,
        verifyEmail,
        sendMagicLink,
        verifyMagicLink,
        getSessions,
        revokeSession,
        revokeAllSessions,
        getAuthConfig,
        getSession,
        onAuthStateChange,
        isInitialized: () => isInitialized
    };
}

export interface CookieStorageOptions {
    path?: string;
    domain?: string;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    maxAge?: number;
}

export function createCookieStorage(options: CookieStorageOptions = {}): AuthStorage {
    const defaultOptions = {
        path: "/",
        sameSite: "Lax" as const,
        ...options
    };

    return {
        getItem(key: string): string | null {
            if (typeof document === "undefined") return null;
            const nameEQ = encodeURIComponent(key) + "=";
            const ca = document.cookie.split(";");
            for (let i = 0; i < ca.length; i++) {
                let c = ca[i];
                while (c.charAt(0) === " ") c = c.substring(1, c.length);
                if (c.indexOf(nameEQ) === 0) {
                    return decodeURIComponent(c.substring(nameEQ.length, c.length));
                }
            }
            return null;
        },
        setItem(key: string, value: string): void {
            if (typeof document === "undefined") return;
            let cookieStr = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;

            if (defaultOptions.path) {
                cookieStr += `; path=${defaultOptions.path}`;
            }
            if (defaultOptions.domain) {
                cookieStr += `; domain=${defaultOptions.domain}`;
            }
            if (defaultOptions.maxAge !== undefined) {
                cookieStr += `; max-age=${defaultOptions.maxAge}`;
            } else {
                cookieStr += `; max-age=${365 * 24 * 60 * 60}`;
            }
            if (defaultOptions.secure) {
                cookieStr += "; secure";
            }
            if (defaultOptions.sameSite) {
                cookieStr += `; samesite=${defaultOptions.sameSite}`;
            }

            document.cookie = cookieStr;
        },
        removeItem(key: string): void {
            if (typeof document === "undefined") return;
            let cookieStr = `${encodeURIComponent(key)}=; path=${defaultOptions.path || "/"}; max-age=-1`;
            if (defaultOptions.domain) {
                cookieStr += `; domain=${defaultOptions.domain}`;
            }
            document.cookie = cookieStr;
        }
    };
}
