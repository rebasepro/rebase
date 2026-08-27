import { User, AuthTokens, DeviceSession, RebaseSession, AuthChangeEvent } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import type { AuthConfigResponse } from "./api";

// Re-export canonical types so the auth entry point stays self-contained. `User`
// joins them because the controller hands one back and a consumer installs
// `@rebasepro/app` alone — `@rebasepro/types` is this package's dependency, not
// theirs, so it is not a specifier they can import from.
export type { User, AuthTokens, DeviceSession };

/**
 * Auth controller that extends the base AuthController
 * with additional methods for email/password and Google login
 */
export type RebaseAuthController = AuthController & {
    /** Login with Google — accepts an ID token, access token, or authorization code payload */
    googleLogin: (payload: { idToken: string } | { accessToken: string } | { code: string; redirectUri: string }) => Promise<void>;
    /** Generic OAuth login — works with any provider. Posts payload to /auth/{providerId}. */
    oauthLogin: (providerId: string, payload: Record<string, unknown>) => Promise<void>;
    /** Login with email and password */
    emailPasswordLogin: (email: string, password: string) => Promise<void>;
    /** Register a new user */
    register: (email: string, password: string, displayName?: string) => Promise<void>;
    /** Skip login (for anonymous access if enabled) */
    skipLogin: () => void;
    /** Whether login was skipped */
    loginSkipped: boolean;
    /** Error from auth provider (login failure details) */
    authProviderError: Error | null;
    /** True when there are no users in the system — first-user bootstrap mode */
    needsSetup: boolean;
    /** Whether new user registration is enabled (always true during setup) */
    registrationEnabled: boolean;
    /** Request password reset email */
    forgotPassword: (email: string) => Promise<void>;
    /** Reset password using token from email */
    resetPassword: (token: string, password: string) => Promise<void>;
    /** Change password for authenticated user */
    changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
    /** Update user profile */
    updateProfile: (displayName?: string, photoURL?: string) => Promise<User>;
    /** Fetch active sessions */
    fetchSessions: () => Promise<DeviceSession[]>;
    /** Revoke a session */
    revokeSession: (sessionId: string) => Promise<void>;
    /** Revoke all active sessions */
    revokeAllSessions: () => Promise<void>;
    /** Get internal API URL */
    getApiUrl?: () => string | undefined;
    /** Clear the current auth provider error */
    clearError: () => void;
    /** Set or clear the auth provider error */
    setAuthProviderError: (error: Error | null) => void;
}

/**
 * Structural type for the subset of `client.auth` (from `@rebasepro/client`)
 * that the React hook delegates to. Avoids a hard dependency on
 * `@rebasepro/client` while remaining fully type-safe.
 */
export interface ClientAuth {
    getSession(): RebaseSession | null;
    onAuthStateChange(callback: (event: AuthChangeEvent, session: RebaseSession | null) => void): () => void;
    isInitialized(): Promise<void>;
    getAuthConfig(): Promise<AuthConfigResponse>;
    signInWithEmail(email: string, password: string): Promise<unknown>;
    signOut(): Promise<void>;
    refreshSession(): Promise<RebaseSession>;
    signUp(email: string, password: string, displayName?: string): Promise<unknown>;
    signInWithGoogle(payload: { idToken: string } | { accessToken: string } | { code: string; redirectUri: string }): Promise<unknown>;
    signInWithOAuth(providerId: string, payload: Record<string, unknown>): Promise<unknown>;
    resetPasswordForEmail(email: string): Promise<unknown>;
    resetPassword(token: string, password: string): Promise<unknown>;
    changePassword(oldPassword: string, newPassword: string): Promise<unknown>;
    updateUser(updates: { displayName?: string; photoURL?: string }): Promise<User>;
    getSessions(): Promise<DeviceSession[]>;
    revokeSession(sessionId: string): Promise<unknown>;
    revokeAllSessions(): Promise<unknown>;
}

/**
 * Props for useRebaseAuthController hook
 */
export interface RebaseAuthControllerProps {
    /** The Rebase Client instance */
    client?: {
        baseUrl?: string;
        resolveToken?: () => Promise<string | null>;
        setAuthTokenGetter?: (getter: () => Promise<string | null>) => void;
        setOnUnauthorized?: (handler: () => Promise<boolean>) => void;
        ws?: { setAuthTokenGetter: (getter: () => Promise<string | null>) => void };
        auth?: ClientAuth;
    };
    /** Google OAuth client ID (optional, enables Google login) */
    googleClientId?: string;
    /** Callback when user signs out */
    onSignOut?: () => void;
    /** Define roles for a user after login */
    defineRolesFor?: (user: User) => Promise<string[] | undefined> | string[] | undefined;
}

/**
 * Auth response from backend login/register endpoints
 */
export interface AuthResponse {
    user: User;
    tokens: AuthTokens;
}

/**
 * Response from token refresh endpoint
 */
export interface RefreshResponse {
    tokens: AuthTokens;
}
