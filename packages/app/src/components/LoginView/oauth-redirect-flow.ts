/**
 * The browser half of the OAuth authorization-code flow.
 *
 * The server only ever sees a `code` and a `redirectUri` taken from the
 * request body, so `state`, PKCE and the binding between "this browser started
 * a login" and "this code came back" are, by construction, the client's job.
 * In the admin login they had been nobody's job: the authorize URL carried no
 * `state`, and the return leg accepted any `?code=` as long as a localStorage
 * marker naming the *provider* was set — a marker written on button click and
 * removed only on a callback that carried a code, so abandoning the flow left
 * it set indefinitely.
 *
 * Everything here is provider-agnostic on purpose. A button that wants a new
 * provider calls {@link startOAuthRedirect} and gets state, expiry and PKCE
 * without deciding anything, which is what stops the next provider shipping
 * without them.
 */

/** sessionStorage, not localStorage: a login attempt belongs to one tab. */
const STORAGE_KEY = "rebase_oauth_redirect";

/** How long a started authorization stays valid. */
const PENDING_TTL_MS = 10 * 60 * 1000;

export interface OAuthRedirectRequest {
    /** Provider id, as mounted at `POST /auth/<id>`. */
    provider: string;
    /** The provider's authorization endpoint. */
    authorizeUrl: string;
    clientId: string;
    scope: string;
    /** Where the provider sends the browser back. Echoed to the token exchange. */
    redirectUri: string;
    /** Set when the provider implements PKCE. */
    pkce?: boolean;
    /** Extra authorize-endpoint parameters (`response_type`, and so on). */
    params?: Record<string, string>;
}

/** What the browser remembers between leaving for the provider and coming back. */
export interface PendingOAuthRedirect {
    provider: string;
    state: string;
    codeVerifier?: string;
    redirectUri: string;
    startedAt: number;
}

export type OAuthCallbackResult =
    /** No OAuth callback in this URL. */
    | { status: "none" }
    /** The provider reported a failure, or the user declined. */
    | { status: "error"; error: string }
    /**
     * A code arrived that this browser cannot account for: no pending
     * authorization, an expired one, or a `state` that does not match. This is
     * what a login-CSRF / code-injection attempt looks like.
     */
    | { status: "mismatch" }
    | { status: "ok"; provider: string; code: string; codeVerifier?: string; redirectUri: string };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): Storage | null {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function base64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(byteLength = 32): string {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
}

export function readPendingOAuthRedirect(storage: Storage | null = defaultStorage()): PendingOAuthRedirect | null {
    if (!storage) return null;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as PendingOAuthRedirect;
        if (!parsed?.provider || !parsed?.state) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearPendingOAuthRedirect(storage: Storage | null = defaultStorage()): void {
    storage?.removeItem(STORAGE_KEY);
}

/**
 * Build the authorize URL and the pending record that will validate its
 * callback. Split out from {@link startOAuthRedirect} so it can be tested
 * without navigating.
 */
export async function buildOAuthAuthorization(
    request: OAuthRedirectRequest,
    now: number = Date.now()
): Promise<{ url: string; pending: PendingOAuthRedirect }> {
    const state = randomToken();
    const url = new URL(request.authorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", request.clientId);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("scope", request.scope);
    url.searchParams.set("state", state);
    for (const [key, value] of Object.entries(request.params ?? {})) {
        url.searchParams.set(key, value);
    }

    let codeVerifier: string | undefined;
    if (request.pkce) {
        codeVerifier = randomToken(32);
        url.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
        url.searchParams.set("code_challenge_method", "S256");
    }

    return {
        url: url.toString(),
        pending: { provider: request.provider, state, codeVerifier, redirectUri: request.redirectUri, startedAt: now }
    };
}

/** Remember the authorization and send the browser to the provider. */
export async function startOAuthRedirect(
    request: OAuthRedirectRequest,
    storage: Storage | null = defaultStorage()
): Promise<void> {
    const { url, pending } = await buildOAuthAuthorization(request);
    storage?.setItem(STORAGE_KEY, JSON.stringify(pending));
    window.location.href = url;
}

/**
 * Interpret a return from the provider.
 *
 * Clears the pending record on **every** path that saw a callback — including
 * `?error=` and a state mismatch — so a declined or abandoned consent screen
 * cannot leave the browser primed to accept somebody else's code later.
 */
export function consumeOAuthCallback(
    search: string,
    storage: Storage | null = defaultStorage(),
    now: number = Date.now()
): OAuthCallbackResult {
    const params = new URLSearchParams(search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");

    if (!code && !error && !state) return { status: "none" };

    const pending = readPendingOAuthRedirect(storage);
    clearPendingOAuthRedirect(storage);

    if (error) return { status: "error", error };
    if (!code) return { status: "mismatch" };
    if (!pending) return { status: "mismatch" };
    if (now - pending.startedAt > PENDING_TTL_MS) return { status: "mismatch" };
    if (!state || state !== pending.state) return { status: "mismatch" };

    return {
        status: "ok",
        provider: pending.provider,
        code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri
    };
}
