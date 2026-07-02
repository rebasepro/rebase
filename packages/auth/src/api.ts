import type { AuthResponse, RefreshResponse } from "./types";
import type { DeviceSession, User } from "@rebasepro/types";

class AuthApiError extends Error {
    code: string;

    constructor(message: string, code: string) {
        super(message);
        this.code = code;
        this.name = "AuthApiError";
    }
}

async function handleResponse<T>(response: Response): Promise<T> {
    let data: Record<string, unknown>;
    try {
        data = await response.json();
    } catch (parseError) {
        // Response wasn't JSON - could be network error or server issue
        throw new AuthApiError(
            `Server returned non-JSON response (status: ${response.status})`,
            "PARSE_ERROR"
        );
    }

    if (!response.ok) {
        throw new AuthApiError(
            (data as Record<string, Record<string, string>>).error?.message || "Request failed",
            (data as Record<string, Record<string, string>>).error?.code || "UNKNOWN_ERROR"
        );
    }

    return data as T;
}

/**
 * Wrapper for fetch that catches generic network failures (like server down)
 * and translates them to an AuthApiError.
 */
async function fetchWithHandling(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(input, init);
    } catch (error: unknown) {
        if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
            throw new AuthApiError(
                "Failed to connect to the backend server. The backend might be down or failed to initialize (e.g., database connection timeout).",
                "NETWORK_ERROR"
            );
        }
        throw new AuthApiError("Network error: " + (error instanceof Error ? error.message : String(error)), "NETWORK_ERROR");
    }
}

/**
 * Register a new user with email/password
 */
export async function register(
    apiUrl: string,
    email: string,
    password: string,
    displayName?: string
): Promise<AuthResponse> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email,
password,
displayName })
    });

    return handleResponse<AuthResponse>(response);
}

/**
 * Login with email/password
 */
export async function login(apiUrl: string, email: string, password: string): Promise<AuthResponse> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email,
password })
    });

    return handleResponse<AuthResponse>(response);
}

/**
 * Google login payload — one of the three supported flows.
 */
export type GoogleLoginPayload =
    | { idToken: string }
    | { accessToken: string }
    | { code: string; redirectUri: string };

/**
 * Login with Google.
 *
 * Accepts one of:
 * - `{ idToken }` — ID-token flow (One Tap / Sign In button)
 * - `{ accessToken }` — Access-token flow (popup)
 * - `{ code, redirectUri }` — Authorization code flow (most secure)
 */
export async function googleLogin(apiUrl: string, payload: GoogleLoginPayload): Promise<AuthResponse> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    return handleResponse<AuthResponse>(response);
}

/**
 * Login with LinkedIn OAuth code
 */
export async function linkedinLogin(apiUrl: string, code: string, redirectUri: string): Promise<AuthResponse> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/linkedin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code,
redirectUri })
    });

    return handleResponse<AuthResponse>(response);
}

/**
 * Generic OAuth login — works with any provider registered on the backend.
 * The `providerId` is used to build the endpoint: `/api/auth/{providerId}`.
 */
export async function oauthLogin(apiUrl: string, providerId: string, payload: Record<string, unknown>): Promise<AuthResponse> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/${providerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    return handleResponse<AuthResponse>(response);
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(apiUrl: string, refreshToken: string): Promise<RefreshResponse> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
    });

    return handleResponse<RefreshResponse>(response);
}

/**
 * Logout and invalidate refresh token
 */
export async function logout(apiUrl: string, refreshToken?: string): Promise<void> {
    await fetchWithHandling(`${apiUrl}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
    });
}

/**
 * Get current user info
 */
export async function getCurrentUser(apiUrl: string, accessToken: string): Promise<{ user: User }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/me`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    return handleResponse<{ user: User }>(response);
}

/**
 * Request password reset email
 */
export async function forgotPassword(apiUrl: string, email: string): Promise<{ success: boolean; message: string }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
    });

    return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Reset password using token from email
 */
export async function resetPassword(apiUrl: string, token: string, password: string): Promise<{ success: boolean; message: string }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token,
password })
    });

    return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Change password for authenticated user
 */
export async function changePassword(
    apiUrl: string,
    accessToken: string,
    oldPassword: string,
    newPassword: string
): Promise<{ success: boolean; message: string }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/change-password`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({ oldPassword,
newPassword })
    });

    return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Send email verification link
 */
export async function sendVerificationEmail(apiUrl: string, accessToken: string): Promise<{ success: boolean; message: string }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/send-verification`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Verify email address using token
 */
export async function verifyEmail(apiUrl: string, token: string): Promise<{ success: boolean; message: string }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
    });

    return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Update current user profile
 */
export async function updateProfile(
    apiUrl: string,
    accessToken: string,
    displayName?: string,
    photoURL?: string
): Promise<{ user: User }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/me`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        },
        body: JSON.stringify({ displayName,
photoURL })
    });

    return handleResponse<{ user: User }>(response);
}

/**
 * Fetch active sessions for current user
 */
export async function fetchSessions(apiUrl: string, accessToken: string, currentRefreshToken?: string): Promise<{ sessions: DeviceSession[] }> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
    };
    if (currentRefreshToken) {
        headers["X-Refresh-Token"] = currentRefreshToken;
    }

    const response = await fetchWithHandling(`${apiUrl}/api/auth/sessions`, {
        method: "GET",
        headers
    });

    return handleResponse<{ sessions: DeviceSession[] }>(response);
}

/**
 * Revoke a specific session
 */
export async function revokeSession(apiUrl: string, accessToken: string, sessionId: string): Promise<{ success: boolean; message: string }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/sessions/${sessionId}`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Revoke all sessions for current user
 */
export async function revokeAllSessions(apiUrl: string, accessToken: string): Promise<{ success: boolean; message: string }> {
    const response = await fetchWithHandling(`${apiUrl}/api/auth/sessions`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
        }
    });

    return handleResponse<{ success: boolean; message: string }>(response);
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
    /** Whether password reset is supported */
    passwordReset?: boolean;
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
export async function fetchAuthConfig(apiUrl: string, cache: AuthConfigCache): Promise<AuthConfigResponse> {
    if (cache.cached) {
        return cache.cached;
    }

    if (cache.inflight) {
        return cache.inflight;
    }

    cache.inflight = (async () => {
        const response = await fetchWithHandling(`${apiUrl}/api/auth/config`, {
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

export { AuthApiError };
