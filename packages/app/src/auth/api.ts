/**
 * Auth-config fetch helper for the Rebase React frontend.
 *
 * The former per-endpoint auth client (login, register, refresh, OAuth,
 * sessions, …) has been removed: `useRebaseAuthController` now delegates to
 * the headless SDK's `client.auth` (from `@rebasepro/client`), which is the
 * single source of truth for the auth session. The only piece that remains
 * here is the unauthenticated `/api/auth/config` probe used to detect
 * bootstrap mode and enabled providers before a session exists.
 */

import { RebaseApiError } from "@rebasepro/types";
import { DEFAULT_API_PATH } from "../hooks/ApiConfigContext";

async function handleResponse<T>(response: Response): Promise<T> {
    let data: Record<string, unknown>;
    try {
        data = await response.json();
    } catch (parseError) {
        // Response wasn't JSON - could be network error or server issue
        throw new RebaseApiError(
            `Server returned non-JSON response (status: ${response.status})`,
            { status: response.status, code: "PARSE_ERROR" }
        );
    }

    if (!response.ok) {
        throw new RebaseApiError(
            (data as Record<string, Record<string, string>>).error?.message || "Request failed",
            {
                status: response.status,
                code: (data as Record<string, Record<string, string>>).error?.code || "UNKNOWN_ERROR"
            }
        );
    }

    return data as T;
}

/**
 * Wrapper for fetch that catches generic network failures (like server down)
 * and translates them to a {@link RebaseApiError} with code `NETWORK_ERROR`.
 */
async function fetchWithHandling(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(input, init);
    } catch (error: unknown) {
        if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
            throw new RebaseApiError(
                "Failed to connect to the backend server. The backend might be down or failed to initialize (e.g., database connection timeout).",
                { code: "NETWORK_ERROR", cause: error }
            );
        }
        throw new RebaseApiError(
            "Network error: " + (error instanceof Error ? error.message : String(error)),
            { code: "NETWORK_ERROR", cause: error }
        );
    }
}

/**
 * Auth config response from the backend
 */
export interface AuthConfigResponse {
    /** True when there are no users in the system and first user setup is needed */
    needsSetup: boolean;
    /** Whether new user registration is enabled */
    registrationEnabled: boolean;
    /** Whether email service is configured */
    emailServiceEnabled?: boolean;
    /** Whether the self-service password reset flow (email link) is supported */
    passwordReset?: boolean;
    /**
     * Whether an admin can reset another user's password, i.e. the adapter
     * mounts `POST /admin/users/:userId/reset-password`. Absent on backends
     * predating this field, which the frontend treats as supported.
     */
    adminPasswordReset?: boolean;
    /** Whether email verification is supported */
    emailVerification?: boolean;
    /** Complete list of enabled OAuth provider IDs (e.g. ["google", "github", "discord"]) */
    enabledProviders: string[];
}

/**
 * Cache container for `fetchAuthConfig` — holds both the inflight promise
 * (to deduplicate concurrent calls) and the cached result.
 */
export interface AuthConfigCache {
    cached: AuthConfigResponse | null;
    inflight: Promise<AuthConfigResponse> | null;
}

/**
 * Create a fresh `AuthConfigCache` instance.
 * Callers own the cache object and pass it into `fetchAuthConfig` / `clearAuthConfigCache`.
 */
export function createAuthConfigCache(): AuthConfigCache {
    return { cached: null, inflight: null };
}

/**
 * Fetch auth configuration / status from the backend
 * This is an unauthenticated endpoint used to detect bootstrap mode.
 *
 * Results are cached for the session lifetime.
 * Concurrent calls are deduplicated: only one network request is made
 * and all callers share the same promise.
 */
export async function fetchAuthConfig(
    apiUrl: string,
    cache: AuthConfigCache,
    /** The backend's `basePath`; only needed if it is not the default. */
    apiPath: string = DEFAULT_API_PATH
): Promise<AuthConfigResponse> {
    if (cache.cached) {
        return cache.cached;
    }

    if (cache.inflight) {
        return cache.inflight;
    }

    cache.inflight = (async () => {
        const response = await fetchWithHandling(`${apiUrl.replace(/\/+$/, "")}${apiPath}/auth/config`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });
        return handleResponse<AuthConfigResponse>(response);
    })();

    try {
        const result = await cache.inflight;
        cache.cached = result;
        return result;
    } finally {
        cache.inflight = null;
    }
}

/**
 * Clear the cached auth config (e.g. on logout or for testing).
 */
export function clearAuthConfigCache(cache: AuthConfigCache): void {
    cache.cached = null;
    cache.inflight = null;
}
