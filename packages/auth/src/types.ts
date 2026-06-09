import { AuthController, User } from "@rebasepro/types";

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
    fetchSessions: () => Promise<Session[]>;
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
 * Props for useRebaseAuthController hook
 */
export interface RebaseAuthControllerProps {
    /** The Rebase Client instance */
    client?: {
        baseUrl?: string;
        resolveToken?: () => Promise<string | null>;
        setAuthTokenGetter?: (getter: () => Promise<string | null>) => void;
        setOnUnauthorized?: (handler: () => Promise<boolean>) => void;
        ws?: { setAuthTokenGetter: (getter: () => Promise<string>) => void };
    };
    /** Base URL of the backend API */
    apiUrl?: string;
    /** Google OAuth client ID (optional, enables Google login) */
    googleClientId?: string;
    /** Callback when user signs out */
    onSignOut?: () => void;
    /** Define roles for a user after login */
    defineRolesFor?: (user: User) => Promise<string[] | undefined> | string[] | undefined;
}

/**
 * Auth tokens returned from the backend
 */
export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    /** Unix timestamp (ms) when the access token expires */
    accessTokenExpiresAt: number;
}

/**
 * User info from the backend
 */
export interface UserInfo {
    uid: string;
    email: string;
    displayName?: string | null;
    photoURL?: string | null;
    emailVerified?: boolean;
    roles?: string[];
    metadata?: Record<string, unknown>;
}

/**
 * Auth response from backend login/register endpoints
 */
export interface AuthResponse {
    user: UserInfo;
    tokens: AuthTokens;
}

/**
 * Response from token refresh endpoint
 */
export interface RefreshResponse {
    tokens: AuthTokens;
}

/**
 * Session info from the backend
 */
export interface Session {
    id: string;
    userAgent?: string;
    ipAddress?: string;
    createdAt: string;
    isCurrentSession?: boolean;
}
