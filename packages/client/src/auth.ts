import { RebaseApiError, Transport } from "./transport";
import type { AuthChangeEvent, RebaseSession, AuthTokens, DeviceSession, User } from "@rebasepro/types";

// Re-export canonical types so `import { RebaseSession } from "@rebasepro/client"` keeps working
export type { RebaseSession, AuthTokens, AuthChangeEvent, DeviceSession } from "@rebasepro/types";

/** Minimal, non-sensitive user profile returned by {@link findUserByEmail}. */
export interface PublicUserProfile {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
}

/** Map a raw user object from an auth response (`/login`, `/refresh`, `/me`) to a `User`. */
function mapRawUser(raw: Record<string, unknown>): User {
    return {
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
}

/** Placeholder user, used only as a last resort when none can be resolved. */
const EMPTY_USER: User = { uid: "", email: null, displayName: null, photoURL: null, providerId: "password", isAnonymous: false };


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
    // Auto-refresh resilience: retry transient failures with exponential backoff
    // (1s, 2s, 4s, … capped) before giving up and signing out.
    const MAX_REFRESH_RETRIES = 5;
    const REFRESH_RETRY_BASE_MS = 1000;
    const REFRESH_RETRY_MAX_MS = 30000;

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
            try {
                fn(event, session);
            } catch (e) {
                // Isolated so one bad handler cannot stop the rest being told —
                // but reported, because the throw came from the caller's own
                // code and discarding it made a broken `onAuthStateChange`
                // handler look like an event that never fired. The socket in
                // this package already reports handler errors this way.
                console.error("Error in auth state change listener:", e);
            }
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

    /**
     * A refresh failure is only fatal if the refresh token itself is rejected
     * (expired / invalid / forbidden). Network blips, timeouts, and 5xx (e.g. a
     * backend restart mid-session) are transient and must NOT log the user out.
     */
    function isFatalRefreshError(err: unknown): boolean {
        if (!(err instanceof RebaseApiError)) return false; // network/other → transient
        // Another tab (or a retry of our own request) rotated the token we
        // were holding. In cookie mode the jar may ALREADY contain the
        // replacement, so this is the one 401 that is worth retrying: giving
        // up here is precisely the bug where opening a second tab signs you
        // out of both.
        if (err.code === "TOKEN_ALREADY_USED") return false;
        if (err.code === "INVALID_TOKEN" || err.code === "TOKEN_EXPIRED") return true;
        // 401/403 are auth failures; other statuses (incl. 5xx, 0) are transient.
        return err.status === 401 || err.status === 403;
    }

    /**
     * Drop this client's session without telling the server.
     *
     * `signOut()` is a user action: it POSTs /logout, which revokes the whole
     * sign-in. That is the wrong hammer for a refresh that failed. Our token
     * may be stale precisely because a sibling tab holds a live one, and
     * logging out on its behalf would turn one tab's bad luck into everybody
     * being signed out — the exact failure this work exists to remove.
     */
    function abandonSessionLocally() {
        currentSession = null;
        clearStoredSession();
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
            refreshTimeout = null;
        }
        transport.setToken(null);
        emit("SIGNED_OUT", null);
    }

    /**
     * Recover from a 401 on an ordinary API request.
     *
     * Returns `true` when the caller should retry — we minted a fresh access
     * token. When the refresh is rejected *fatally* (the refresh token itself
     * is invalid, expired or revoked) this client can no longer act as the
     * user at all, so we drop the session and emit `SIGNED_OUT`. UIs gate on
     * that event, so they show their login screen instead of leaving the user
     * staring at "Invalid or expired token" on every view.
     *
     * Transient failures (offline, 5xx, backend restarting) keep the session:
     * the scheduled refresh backs off and retries, and the token is very
     * likely still good once the backend answers again.
     */
    async function handleUnauthorized(): Promise<boolean> {
        // No session to recover: the 401 is just an anonymous caller hitting a
        // protected route. Emitting SIGNED_OUT here would fire sign-out
        // handlers for a user who was never signed in.
        if (!currentSession) return false;

        // Nothing to refresh *with* — the access token is dead and there is no
        // way back. Same end state as a rejected refresh token.
        if (authFlowMode !== "cookie" && !currentSession.refreshToken) {
            abandonSessionLocally();
            return false;
        }

        try {
            await refreshSession();
            return true;
        } catch (err) {
            if (isFatalRefreshError(err)) {
                abandonSessionLocally();
            }
            return false;
        }
    }

    async function attemptScheduledRefresh(attempt: number) {
        try {
            await refreshSession();
            // On success, refreshSession() re-schedules the next refresh itself.
        } catch (err) {
            if (isFatalRefreshError(err)) {
                abandonSessionLocally();
                return;
            }
            if (attempt >= MAX_REFRESH_RETRIES) {
                abandonSessionLocally();
                return;
            }
            // Transient failure — back off and retry rather than dropping the session.
            const backoff = Math.min(REFRESH_RETRY_BASE_MS * 2 ** attempt, REFRESH_RETRY_MAX_MS);
            refreshTimeout = setTimeout(() => { void attemptScheduledRefresh(attempt + 1); }, backoff);
        }
    }

    function scheduleRefresh(expiresAt: number) {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        if (!autoRefresh) return;

        const delay = (expiresAt - REFRESH_BUFFER_MS) - Date.now();

        if (delay <= 0) {
            void attemptScheduledRefresh(0);
            return;
        }

        refreshTimeout = setTimeout(() => { void attemptScheduledRefresh(0); }, delay);
    }

    /**
     * Stop the scheduled token refresh, leaving the session itself alone.
     *
     * This is teardown, not sign-out. `scheduleRefresh` arms an ordinary
     * `setTimeout` up to a token lifetime away, and it is not `unref`'d — so on
     * Node it holds the event loop open by itself. `client.close()` promised
     * that "a script that does not call this will not exit on its own", which
     * was true, while the converse it plainly implies was not: a signed-in
     * client that closed its socket still hung, because this timer outlived it.
     * Any script, cron handler or job that signs in hit that.
     *
     * Deliberately does NOT clear the session, touch storage, or emit
     * SIGNED_OUT. Closing a client is not the user signing out — `signOut()`
     * POSTs /logout and revokes the whole sign-in, which is the wrong hammer
     * (see `abandonSessionLocally`) — and a persisted session must still be
     * there for the next client to restore.
     */
    function stopAutoRefresh() {
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
            refreshTimeout = null;
        }
    }

    function handleAuthResponse(data: { tokens: AuthTokens, user: Record<string, unknown> }, event?: AuthChangeEvent): RebaseSession {
        const user: User = mapRawUser(data.user);
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

    /**
     * Serialise refreshes across TABS, not just within one.
     *
     * The in-flight promise below covers callers inside a single JavaScript
     * context. It does nothing about the far more common case: two tabs of the
     * same app booting together, each firing its own /refresh with the same
     * cookie. The server tolerates that now (superseded tokens stay usable for
     * a grace window), but tolerating a stampede is not the same as avoiding
     * one, and every extra rotation is another chance to end up holding a
     * token whose response never arrived.
     *
     * Web Locks are best-effort on purpose. supabase-js shipped this and then
     * spent a year fielding deadlock reports — a lock held by a crashed or
     * frozen tab must never be able to wedge sign-in — so a lock we cannot
     * take within the timeout is simply not taken, and the refresh proceeds
     * unserialised, exactly as it did before.
     */
    const REFRESH_LOCK_NAME = "rebase-auth-refresh";
    const REFRESH_LOCK_TIMEOUT_MS = 5000;

    async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
        const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
        if (!locks?.request) return fn();

        const controller = new AbortController();
        const giveUp = setTimeout(() => controller.abort(), REFRESH_LOCK_TIMEOUT_MS);
        try {
            return await locks.request(
                REFRESH_LOCK_NAME,
                { signal: controller.signal },
                async () => fn()
            ) as T;
        } catch (e) {
            // AbortError means only that we waited long enough for the lock.
            // Anything the callback itself threw has to keep propagating.
            if ((e as { name?: string })?.name !== "AbortError") throw e;
            return fn();
        } finally {
            clearTimeout(giveUp);
        }
    }

    function refreshSession(): Promise<RebaseSession> {
        // Share a single in-flight refresh across concurrent callers.
        if (inFlightRefresh) return inFlightRefresh;
        inFlightRefresh = withRefreshLock(() => doRefreshSession()).finally(() => {
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
            user = mapRawUser(body.user as Record<string, unknown>);
        } else if (!user || !user.uid) {
            try {
                user = await getUser();
            } catch { /* fall through to the empty stub below */ }
        }

        const session: RebaseSession = {
            accessToken,
            refreshToken: body.tokens.refreshToken || currentSession?.refreshToken || "",
            expiresAt: body.tokens.accessTokenExpiresAt,
            user: user ?? EMPTY_USER
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

    /**
     * Resolve an email to a minimal public profile (`uid`, `displayName`,
     * `photoURL`) for invite-by-email flows. Returns `null` when no account
     * matches. Requires the backend to opt in via `auth.allowUserLookup`;
     * otherwise the endpoint is absent and this rejects.
     */
    async function findUserByEmail(email: string): Promise<PublicUserProfile | null> {
        const data = await transport.request<{ user: PublicUserProfile | null }>(authPath + "/find-user", {
            method: "POST",
            body: JSON.stringify({ email })
        });
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

    /**
     * Link an OAuth provider to the **currently signed-in** account.
     *
     * Use this when `signIn*` failed with `EMAIL_NOT_VERIFIED` — an account
     * with that email already exists under a different sign-in method — or to
     * attach a provider whose email differs from the account's.
     *
     * The payload is the same one the provider's sign-in method takes, e.g.
     * `linkProvider("google", { idToken })`.
     *
     * Unlike sign-in, this does not require the provider to have verified the
     * email, and the emails need not match: the active session already proves
     * account ownership.
     *
     * Throws `IDENTITY_ALREADY_LINKED` (409) if that provider identity is
     * attached to a different user. Succeeds idempotently (`alreadyLinked:
     * true`) if it is already attached to the current one.
     */
    async function linkProvider(
        providerId: string,
        payload: Record<string, unknown>
    ) {
        return transport.request<{ success: boolean; provider: string; alreadyLinked: boolean; }>(
            authPath + "/link/" + providerId,
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );
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
        stopAutoRefresh,
        refreshSession,
        handleUnauthorized,
        getUser,
        findUserByEmail,
        updateUser,
        resetPasswordForEmail,
        resetPassword,
        changePassword,
        linkProvider,
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
        // A client that neither persists sessions nor uses cookie auth has
        // nowhere to restore one from, so "no session in memory" is the final
        // answer rather than a reason to ask the server. See the docblock on
        // `AuthClient.canRestoreSession`.
        canRestoreSession: () => persistSession || authFlowMode === "cookie",
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
